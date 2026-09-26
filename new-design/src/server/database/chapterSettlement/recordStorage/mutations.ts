import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard,type RecordCardDb} from '../../recordCards';
import {recordWorkflowAction} from '../../cardWorkflow';
import {insertStoryRecords,updateStoryRecords,lockStoryRecords} from '../../storyTimeline/persistence';
import {insertContractRecord} from '../../aiContracts/records';
import {saveEmbeddingSourceSnapshot} from '../../embeddings/sourceStorage';
import {settlementRecordDefaults,settlementRecordChecks} from './definitions';
import {validateExtractionRecord} from './provenance';
import {validateSettlementOrigin} from './origin';
type Row=Record<string,any>;
type Result={rows:Row[];rowCount:number};
type Conflict={keys?:string[];ignore?:boolean;update?:(previous:Row,incoming:Row)=>Row};
const identities:Record<string,string[][]>={
 settlement_relation_configuration_receipt:[['book_id','request_key']],settlement_relation_configuration_version:[['draft_id','version']],
 chapter_proposal_extraction_request:[['book_id','idempotency_key'],['ai_task_id']],chapter_adoption_session:[['preparation_id'],['book_id','idempotency_key'],['settlement_id']],
 chapter_adoption_preparation:[['book_id','idempotency_key']],
 chapter_stable_checkpoint:[['session_id'],['settlement_id']],settlement_policy_version:[['book_id','version']],book_settlement_policy:[['book_id']],
 chapter_settlement_item_version:[['item_id','version']],chunking_request:[['book_id','idempotency_key']],
 ai_contract_publication:[['idempotency_key']],context_manifest_slot:[['manifest_id','slot_key']],
};
const parentKinds:Record<string,[string,string]>={settlement_relation_configuration_version:['draft_id','settlement_relation_configuration_draft']};
function same(a:Row,b:Row,keys:string[]){return keys.every(key=>(a[key]??null)===(b[key]??null));}
function collision():never{throw Object.assign(new NewDesignError('该来源或请求已保存，请核对原回执。',409),{code:'23505'});}
async function space(db:RecordCardDb,kind:string,row:Row){
 if(row.space_id)return String(row.space_id);
 if(row.book_id)return String(assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[row.book_id])).rows[0],'书籍不存在。').space_id);
 const parent=parentKinds[kind];if(parent)return assertFound(await findRecordCard(db,String(row[parent[0]]),parent[1]),'记录来源不存在。').recordSpaceId;
 if(row.item_id){const item=assertFound((await db.query('SELECT session_id FROM new_design.chapter_settlement_items WHERE id=$1',[row.item_id])).rows[0],'结算条目不存在。');return assertFound(await findRecordCard(db,String(item.session_id),'chapter_adoption_session'),'结算会话不存在。').recordSpaceId;}
 return '00000000-0000-4000-8000-000000000001';
}
async function validate(db:PoolClient,kind:string,row:Row,previous:Row|null,all:Row[]){
 if(settlementRecordChecks[kind]&&!(await db.query(settlementRecordChecks[kind],[JSON.stringify(row)])).rows[0]?.valid)throw new NewDesignError('结算记录不符合正式来源约束。',422);
 const keys=[...(identities[kind]??[])];if(kind==='chapter_stable_checkpoint'&&row.status==='stable')keys.push(['chapter_document_id','status']);
 for(const key of keys){if(key.length===1&&row[key[0]]==null)continue;if(all.some(other=>other.id!==row.id&&same(other,row,key)))collision();}
 if(kind==='chapter_adoption_session'){
  const active=['reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed'];
  if(all.some(other=>other.id!==row.id&&active.includes(row.status)&&active.includes(other.status)&&other.chapter_document_id===row.chapter_document_id))collision();
  if(row.adoption_id&&all.some(other=>other.id!==row.id&&other.adoption_id===row.adoption_id&&(row.supplement_base_checkpoint_id==null?other.supplement_base_checkpoint_id==null:row.status!=='cancelled'&&other.status!=='cancelled'&&other.supplement_base_checkpoint_id===row.supplement_base_checkpoint_id)))collision();
 }
 if(row.chapter_document_id&&row.body_version_id&&!((await db.query('SELECT 1 FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2',[row.body_version_id,row.chapter_document_id])).rowCount))throw new NewDesignError('正文版本不属于来源章节。',422);
 if(row.book_id&&row.chapter_document_id&&!((await db.query('SELECT 1 FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2',[row.chapter_document_id,row.book_id])).rowCount))throw new NewDesignError('结算来源章节不属于本书。',422);
 if(kind==='chapter_proposal_extraction_request')await validateExtractionRecord(db,row,previous);
 await validateSettlementOrigin(db,kind,row,previous);
}
export async function lockedSettlementQuery(db:RecordCardDb,sql:string,parameters:unknown[]=[],lock=true):Promise<Result>{if(lock)await lockStoryRecords(db);const result=await db.query(sql,parameters);return{rows:result.rows,rowCount:result.rowCount??0};}
export async function insertSettlementRecords(db:PoolClient,kind:string,sql:string,parameters:unknown[]=[],conflict:Conflict={}):Promise<Result>{
 if(!settlementRecordDefaults[kind])return insertStoryRecords(db,kind,sql,parameters,conflict);
 await lockStoryRecords(db);const rows=(await db.query(sql,parameters)).rows,result:Row[]=[];
 for(const incoming of rows){
  const now=new Date().toISOString(),values:Row={...Object.fromEntries(Object.entries(settlementRecordDefaults[kind]).map(([key,value])=>[key,value==='__now'?now:value])),...incoming};values.id??=randomUUID();
  if(kind==='chapter_settlement_event'){result.push(await appendSettlementEvent(db,values));continue;}
  if(kind==='embedding_source_snapshot'){await validate(db,kind,values,null,[]);const saved=await saveEmbeddingSourceSnapshot(db,values);if(saved.sourceCreated)result.push(saved);continue;}
  const all=await listRecordCards(db,kind),duplicate=conflict.keys?all.find(row=>same(row,values,conflict.keys!)):all.find(row=>row.id===values.id);
  if(duplicate){if(conflict.ignore)continue;if(!conflict.update)collision();const updated={...duplicate,...conflict.update(duplicate,values)};await validate(db,kind,updated,duplicate,all);result.push(await replaceRecordCard(db,{id:duplicate.recordCardId,spaceId:duplicate.recordSpaceId,typeKey:kind,values:updated}));continue;}
  await validate(db,kind,values,null,all);
  if(kind==='context_manifest_slot'||kind==='ai_contract_publication')result.push(await insertContractRecord(db,kind,values));
  else result.push(await createRecordCard(db,{id:String(values.id),spaceId:await space(db,kind,values),typeKey:kind,title:String(values.title??values.event_kind??kind),values}));
  if(kind==='chapter_stable_checkpoint')await db.query('SELECT new_design.reconcile_chapter_revision_after_checkpoint($1::uuid)',[values.id]);
 }
 return{rows:result,rowCount:result.length};
}
export async function updateSettlementRecords(db:PoolClient,kind:string,sql:string,parameters:unknown[]=[]):Promise<Result>{
 if(!settlementRecordDefaults[kind])return updateStoryRecords(db,kind,sql,parameters);
 await lockStoryRecords(db);const selected=(await db.query(sql,parameters)).rows,result:Row[]=[];
 for(const row of selected){const current=assertFound(await findRecordCard(db,String(row.record_card_id??row.id),kind,{lock:true}),'结算来源记录不存在。');const {record_card_id,...patch}=row;void record_card_id;const values={...current,...patch};await validate(db,kind,values,current,await listRecordCards(db,kind));result.push(await replaceRecordCard(db,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey:kind,values}));}
 return{rows:result,rowCount:result.length};
}
/** Session actions retain their original row payload and both independent request-key namespaces. */
export async function appendSettlementEvent(db:PoolClient,input:Row):Promise<Row>{
 await lockStoryRecords(db);const values:Row={id:randomUUID(),created_at:new Date().toISOString(),from_status:null,item_id:null,idempotency_key:null,editing_request_key:null,editing_input_hash:null,editing_receipt:null,actor:'',detail:{},...input};
 if(!(await db.query(settlementRecordChecks.chapter_settlement_event,[JSON.stringify(values)])).rows[0]?.valid)throw new NewDesignError('结算动作不符合审计记录约束。',422);
 const owner=assertFound(await findRecordCard(db,String(values.session_id),'chapter_adoption_session',{lock:true}),'结算会话不存在。');
 const editing=[values.editing_request_key,values.editing_input_hash,values.editing_receipt].filter(value=>value!=null).length;
 if(editing!==0&&(editing!==3||String(values.editing_request_key).length<8||String(values.editing_request_key).length>160||!/^[a-f0-9]{64}$/.test(values.editing_input_hash)||typeof values.editing_receipt!=='object'||Array.isArray(values.editing_receipt)||values.editing_receipt.sessionId!==values.session_id||values.editing_receipt.requestKey!==values.editing_request_key))throw new NewDesignError('编辑请求与原回执不匹配。',422);
 if(values.item_id&&!((await db.query('SELECT 1 FROM new_design.chapter_settlement_items WHERE id=$1',[values.item_id])).rowCount))throw new NewDesignError('结算动作引用的条目不存在。',422);
 for(const key of ['idempotency_key','editing_request_key'])if(values[key]!=null&&(await db.query("SELECT 1 FROM new_design.card_version_actions WHERE split_part(action_key,'.',1)='chapter_settlement' AND payload->>'session_id'=$1 AND payload->>$2=$3",[values.session_id,key,values[key]])).rowCount)collision();
 const card=assertFound((await db.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[owner.recordCardId])).rows[0],'结算会话版本不存在。');
 const key=values.editing_request_key!=null?`editing:${values.editing_request_key}`:values.idempotency_key!=null?`event:${values.idempotency_key}`:null;
 const action=await recordWorkflowAction(db,{id:values.id??randomUUID(),cardId:owner.recordCardId,cardVersionId:card.current_version_id,actionKey:`chapter_settlement.${values.event_kind}`,requestKey:key?`chapter_settlement:${values.session_id}:${key}`:null,inputHash:values.editing_input_hash??null,payload:values,receipt:values.editing_receipt??null});
 return{...values,id:action.id,created_at:action.created_at};
}

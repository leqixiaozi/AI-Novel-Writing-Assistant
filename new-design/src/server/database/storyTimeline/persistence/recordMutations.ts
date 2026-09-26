import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard,archiveRecordCard,type RecordCardDb} from '../../recordCards';
import {recordWorkflowAction} from '../../cardWorkflow';
import {DEFAULT_SPACE_ID} from '../../store';
import {storyRecordDefaults} from './recordDefaults';
import {storyRecordChecks} from './recordChecks';
import {storyRecordReferences} from './recordReferences';

type Row=Record<string,any>;
type Result={rows:Row[];rowCount:number};
type Conflict={keys?:string[];ignore?:boolean;update?:(previous:Row,incoming:Row)=>Row};
const identities:Record<string,string[][]>={
 canonical_fact_conflict:[['book_id','fact_a_id','fact_b_id']],
 epistemic_claim:[['book_id','subject_card_id','predicate','value_hash']],
 entity_initial_state:[['book_id','subject_kind','subject_id','state_key']],
 entity_initial_state_version:[['initial_state_id','version']],
 state_type_capability:[['space_id','type_key']],state_field_policy:[['space_id','type_key','field_key']],
 state_relation_capability:[['space_id','relation_key']],state_relation_dimension:[['space_id','relation_key','dimension_key']],
 state_value_mapping:[['space_id','type_key','field_key']],state_value_mapping_version:[['mapping_id','version']],
 state_change_proposal_version:[['proposal_id','version']],state_change:[['proposal_id']],
 knowledge_state_proposal_version:[['proposal_id','version']],knowledge_state_change:[['proposal_id']],
 current_state_projection:[['book_id','subject_kind','subject_id','state_key']],
 current_knowledge_state_projection:[['book_id','holder_kind','holder_key','claim_id']],
 story_time_proposal_version:[['proposal_id','version']],story_relation_proposal_version:[['proposal_id','version']],
 story_event_timing:[['proposal_id']],story_event_relation:[['proposal_id']],
 story_time_position:[['space_id','card_id']],payoff_window:[['book_id','card_id']],
 payoff_window_version:[['book_id','card_id','version'],['book_id','idempotency_key']],
};
const parents:Record<string,[string,string]>={
 canonical_fact_evidence:['fact_id','canonical_fact'],entity_initial_state_version:['initial_state_id','entity_initial_state'],
 state_change_proposal_version:['proposal_id','state_change_proposal'],state_value_mapping_version:['mapping_id','state_value_mapping'],
 knowledge_state_proposal_version:['proposal_id','knowledge_state_proposal'],story_time_proposal_version:['proposal_id','story_time_proposal'],
 story_relation_proposal_version:['proposal_id','story_relation_proposal'],
};
function conflictError():never{throw Object.assign(new NewDesignError('同一来源的记录已存在，请核对当前版本。',409),{code:'23505'});}
function equalKeys(a:Row,b:Row,keys:string[]){return keys.every(key=>(a[key]??null)===(b[key]??null));}
function uniqueKeys(kind:string,row:Row):string[][]{
 const keys=[...(identities[kind]??[])];
 if(kind==='story_event_timing'&&row.status==='active')keys.push(['book_id','event_card_id','status']);
 if(kind==='story_event_relation'&&row.status==='active')keys.push(['book_id','relation_family','relation_type','source_event_card_id','target_event_card_id','status']);
 if(kind==='story_event_narrative_occurrence'&&row.status==='active')keys.push(['book_id','event_card_id','chapter_card_id','role','scene_card_id','body_version_id','status']);
 return keys;
}
/** One transaction lock protects JSON natural keys, sequence allocation, and projection replacement. */
export async function lockStoryRecords(db:RecordCardDb){await db.query("SELECT pg_advisory_xact_lock(hashtextextended('story-record-writes',0))");}
export async function lockedStoryRecordQuery(db:RecordCardDb,sql:string,parameters:unknown[]=[]):Promise<Result>{
 await lockStoryRecords(db);const result=await db.query(sql,parameters);return{rows:result.rows,rowCount:result.rowCount??0};
}
async function spaceFor(db:RecordCardDb,kind:string,row:Row):Promise<string>{
 if(row.space_id)return String(row.space_id);
 if(row.book_id)return String(assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[row.book_id])).rows[0],'书籍不存在。').space_id);
 const parent=parents[kind];if(parent){const owner=assertFound(await findRecordCard(db,String(row[parent[0]]),parent[1]),'上游记录不存在。');return owner.recordSpaceId;}
 return DEFAULT_SPACE_ID;
}
async function validate(db:RecordCardDb,kind:string,row:Row,existing:Row[]){
 const check=storyRecordChecks[kind];if(check&&!(await db.query(check,[JSON.stringify(row)])).rows[0]?.valid)throw new NewDesignError('记录值不符合来源类型与范围约束。',422);
 for(const reference of storyRecordReferences[kind]??[]){
  const id=row[reference.field];if(id==null)continue;
  const found=reference.query?(await db.query(reference.query,[id])).rowCount:await findRecordCard(db,String(id),reference.kind!,{includeArchived:true});
  if(!found)throw new NewDesignError('记录引用的精确来源不存在。',422);
 }
 if(row.chapter_document_id&&row.body_version_id&&!((await db.query('SELECT 1 FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2',[row.body_version_id,row.chapter_document_id])).rowCount))throw new NewDesignError('正文版本不属于引用章节。',422);
 if(row.chapter_document_id&&row.book_id&&!((await db.query('SELECT 1 FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2',[row.chapter_document_id,row.book_id])).rowCount))throw new NewDesignError('章节不属于当前书籍。',422);
 for(const keys of uniqueKeys(kind,row)){
  // A nullable proposal reference has the original PostgreSQL UNIQUE semantics.
  if(keys.length===1&&row[keys[0]]==null)continue;
  if(existing.some(other=>other.id!==row.id&&equalKeys(other,row,keys)))conflictError();
 }
}
function payload(row:Row):Row{const {record_card_id,...values}=row;void record_card_id;return values;}

/** The supplied SQL is a static SELECT of values; writes always use the card kernel. */
export async function insertStoryRecords(db:PoolClient,kind:string,select:string,parameters:unknown[]=[],conflict:Conflict={}):Promise<Result>{
 await lockStoryRecords(db);
 const incoming=(await db.query(select,parameters)).rows,result:Row[]=[];
 for(const input of incoming){
  const existing=await listRecordCards(db,kind),now=new Date().toISOString();
  const defaults=Object.fromEntries(Object.entries(storyRecordDefaults[kind]??{}).map(([key,value])=>[key,value==='__now'?now:value==='__sequence'?null:value]));
  const values:Row={...defaults,...input};values.id??=randomUUID();
  if(Object.values(storyRecordDefaults[kind]??{}).includes('__sequence')&&values.sequence==null){
   const history=await listRecordCards(db,kind,{includeArchived:true});values.sequence=Math.max(0,...history.map(row=>Number(row.sequence??0)))+1;
  }
  const keys=conflict.keys,duplicate=keys?existing.find(row=>equalKeys(row,values,keys)):existing.find(row=>row.id===values.id||uniqueKeys(kind,values).some(key=>equalKeys(row,values,key)));
  if(duplicate){
   if(conflict.ignore)continue;
   if(!conflict.update)conflictError();
   const changed={...duplicate,...conflict.update(duplicate,values)};await validate(db,kind,changed,existing);
   result.push(await replaceRecordCard(db,{id:duplicate.recordCardId,spaceId:duplicate.recordSpaceId,typeKey:kind,values:changed}));continue;
  }
  await validate(db,kind,values,existing);
  result.push(await createRecordCard(db,{id:String(values.id),spaceId:await spaceFor(db,kind,values),typeKey:kind,title:String(values.label??values.predicate??values.state_key??values.reason??kind),values}));
 }
 return{rows:result,rowCount:result.length};
}
export async function updateStoryRecords(db:PoolClient,kind:string,select:string,parameters:unknown[]=[]):Promise<Result>{
 await lockStoryRecords(db);const selected=(await db.query(select,parameters)).rows,result:Row[]=[];
 for(const row of selected){
  const current=assertFound(await findRecordCard(db,String(row.record_card_id??row.id),kind,{lock:true}),'记录不存在。');
  const values={...current,...payload(row)};await validate(db,kind,values,await listRecordCards(db,kind));
  result.push(await replaceRecordCard(db,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey:kind,values}));
 }
 return{rows:result,rowCount:result.length};
}
export async function deleteStoryRecords(db:PoolClient,kind:string,select:string,parameters:unknown[]=[]):Promise<Result>{
 await lockStoryRecords(db);const selected=(await db.query(select,parameters)).rows;
 for(const row of selected){const current=assertFound(await findRecordCard(db,String(row.record_card_id??row.id),kind,{lock:true}),'记录不存在。');await archiveRecordCard(db,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey:kind});}
 return{rows:selected,rowCount:selected.length};
}

export type StoryReviewFamily='canonical_fact'|'knowledge_state'|'story_time'|'story_relation';
const reviewOwners:Record<StoryReviewFamily,[string,string]>={canonical_fact:['canonical_fact','fact_id'],knowledge_state:['knowledge_state_proposal','proposal_id'],story_time:['story_time_proposal','proposal_id'],story_relation:['story_relation_proposal','proposal_id']};
export async function listStoryReviewActions(db:RecordCardDb,family:StoryReviewFamily,where:{ownerId?:string;requestKey?:string}={}):Promise<Row[]>{
 const result=await db.query(`SELECT action.id,action.created_at,action.request_key,action.payload FROM new_design.card_version_actions action
  WHERE split_part(action.action_key,'.',1)=$1 AND ($2::text IS NULL OR action.payload->>$3=$2) AND ($4::text IS NULL OR action.payload->>'idempotency_key'=$4) ORDER BY action.created_at,action.id`,[family,where.ownerId??null,reviewOwners[family][1],where.requestKey??null]);
 return result.rows.map(row=>({...row.payload,id:row.id,created_at:row.created_at,idempotency_key:row.payload.idempotency_key??null}));
}
export async function insertStoryReviewActions(db:PoolClient,family:StoryReviewFamily,select:string,parameters:unknown[]=[]):Promise<Result>{
 await lockStoryRecords(db);const selected=(await db.query(select,parameters)).rows,result:Row[]=[];
 for(const values of selected){
  const [kind,key]=reviewOwners[family],owner=assertFound(await findRecordCard(db,String(values[key]),kind,{lock:true}),'审核对象不存在。');
  if(values.proposal_version_id){
   const versionKind=family==='knowledge_state'?'knowledge_state_proposal_version':family==='story_time'?'story_time_proposal_version':'story_relation_proposal_version';
   const proposalVersion=await findRecordCard(db,String(values.proposal_version_id),versionKind,{includeArchived:true});
   if(!proposalVersion||proposalVersion.proposal_id!==owner.id)throw new NewDesignError('审核动作的精确版本不属于当前提案。',422);
  }
  const version=assertFound((await db.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[owner.recordCardId])).rows[0],'审核对象版本不存在。');
  const action=await recordWorkflowAction(db,{id:values.id,cardId:owner.recordCardId,cardVersionId:version.current_version_id,actionKey:`${family}.${values.action}`,requestKey:values.idempotency_key!=null?`${family}:${values.idempotency_key}`:null,payload:values});
  result.push({...values,id:action.id,created_at:action.created_at,idempotency_key:values.idempotency_key??null});
 }
 return{rows:result,rowCount:result.length};
}

import {randomUUID} from 'node:crypto';
import type {PoolClient,QueryResultRow} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from '../../recordCards';
import {recordWorkflowAction,readCardWorkflowCapability} from '../../cardWorkflow';
import {lockStoryRecords} from '../../storyTimeline/persistence';
import {characterRecordDefaults,characterRecordChecks} from './definitions';
import {validateCharacterRecord} from './validation';
import {characterRecordCtes} from './rows';
type Row=Record<string,any>;
const identities:Record<string,string[][]>={character_dialogue_session:[['book_id','request_key']],character_dialogue_round:[['book_id','request_key'],['session_id','round_number'],['ai_task_id'],['step_id'],['attempt_id']],character_author_trial:[['request_key'],['step_id'],['attempt_id']]};
export async function characterCapability(db:PoolClient,types:string[],guard:string){
 const key=types.includes('character_author_influence_candidate')?'character_author_influence_v1':types.includes('character_author_trial')?'character_author_v1':'character_dialogue_v1';
 const capability=await readCardWorkflowCapability(db,key,types),guarded=(await db.query('SELECT to_regprocedure($1) IS NOT NULL guarded',[guard])).rows[0]?.guarded===true;
 return{installed:capability.installed,operational:capability.operational&&guarded};
}
export async function lockedCharacterQuery<T extends QueryResultRow=Row>(db:PoolClient,sql:string,parameters:unknown[]=[],lock=true){if(lock)await lockStoryRecords(db);return db.query<T>(sql,parameters);}
export async function lockCharacterRecord(db:PoolClient,id:string,kind:string){await lockStoryRecords(db);return assertFound(await findRecordCard(db,id,kind,{lock:true}),'原人物记录不存在。');}
async function validate(db:PoolClient,kind:string,row:Row,old:Row|null){
 if(!(await db.query(characterRecordChecks[kind],[JSON.stringify(row)])).rows[0]?.valid)throw new NewDesignError('人物记录不符合原始来源约束。',422);
 const records=await listRecordCards(db,kind);
 if(records.some(other=>other.id!==row.id&&((identities[kind]??[]).some(keys=>keys.every(key=>other[key]===row[key]))||kind==='character_author_trial'&&row.status==='running'&&other.status==='running'&&other.book_id===row.book_id&&other.card_id===row.card_id)))throw new NewDesignError('原人物请求、回合或执行凭证已存在。',409);
 await validateCharacterRecord(db,kind,row,old);
}
async function influenceFromReply(db:PoolClient,row:Row){
 if(row.status!=='succeeded'||row.output?.influenceDraft==null||await findRecordCard(db,String(row.id),'character_author_influence_candidate'))return;
 const first=Number((await db.query(`WITH ${characterRecordCtes.chapter_stable_checkpoints} SELECT COALESCE(max(document.logical_order),0)+1 first_order FROM new_design.chapter_documents document JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=document.adopted_version_id AND checkpoint.status='stable' WHERE document.book_id=$1 AND document.status='active'`,[row.book_id])).rows[0].first_order);
 await insertCharacterRecords(db,'character_author_influence_candidate','SELECT $1::uuid id,$2::uuid book_id,$3::uuid card_id,$4::char(64) source_hash,$5::jsonb draft,$6::integer target_start,$7::integer target_end',[row.id,row.book_id,row.card_id,row.source_snapshot.hash,JSON.stringify(row.output.influenceDraft),first,first+2]);
}
export async function insertCharacterRecords(db:PoolClient,kind:string,sql:string,parameters:unknown[]=[]){
 await lockStoryRecords(db);const selected=(await db.query(sql,parameters)).rows,rows:Row[]=[];
 if(['character_dialogue_session','character_dialogue_round','character_dialogue_selection'].includes(kind)&&!(await characterCapability(db,['character_dialogue_session','character_dialogue_round'],'new_design.assert_character_dialogue_selection(jsonb)')).operational)throw new NewDesignError('人物对话模拟处于维护状态，原请求与选择保留。',503);
 for(const input of selected){const now=new Date().toISOString(),row:Row={...Object.fromEntries(Object.entries(characterRecordDefaults[kind]).map(([key,value])=>[key,value==='__now'?now:value])),...input};row.id??=randomUUID();
  await validate(db,kind,row,null);
  if(kind==='character_dialogue_selection'||kind==='character_author_influence_decision'){
   const family=kind==='character_dialogue_selection'?'character_dialogue.select':'character_author.influence_decision',owner=await lockCharacterRecord(db,String(kind==='character_dialogue_selection'?row.session_id:row.candidate_id),kind==='character_dialogue_selection'?'character_dialogue_session':'character_author_influence_candidate');
   const prior=await db.query('SELECT 1 FROM new_design.card_version_actions WHERE action_key=$1 AND request_key=$2',[family,kind==='character_dialogue_selection'?`${family}:${row.book_id}:${row.request_key}`:`${family}:${row.request_key}`]);if(prior.rowCount)throw new NewDesignError('原作者选择键已有回执，不能覆盖。',409);
   const version=(await db.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[owner.recordCardId])).rows[0];
   await recordWorkflowAction(db,{id:row.id,cardId:owner.recordCardId,cardVersionId:version.current_version_id,actionKey:family,requestKey:kind==='character_dialogue_selection'?`${family}:${row.book_id}:${row.request_key}`:`${family}:${row.request_key}`,inputHash:row.input_hash??row.request_hash,payload:row,receipt:row.receipt??row});rows.push(row);continue;
  }
  if(await findRecordCard(db,String(row.id),kind))throw new NewDesignError('原人物记录已存在，不能替换。',409);
  const book=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[row.book_id])).rows[0],'原书不存在。');
  // Trial and influence share a logical id; their native card identities must be independent.
  rows.push(await createRecordCard(db,{spaceId:book.space_id,typeKey:kind,title:kind,values:row}));
  if(kind==='character_author_trial')await influenceFromReply(db,row);
 }
 return{rows,rowCount:rows.length};
}
export async function updateCharacterRecords(db:PoolClient,kind:string,sql:string,parameters:unknown[]=[]){
 await lockStoryRecords(db);const selected=(await db.query(sql,parameters)).rows,rows:Row[]=[];
 for(const patch of selected){const old=await lockCharacterRecord(db,String(patch.id),kind),row={...old,...patch};await validate(db,kind,row,old);rows.push(await replaceRecordCard(db,{id:old.recordCardId,spaceId:old.recordSpaceId,typeKey:kind,values:row}));if(kind==='character_author_trial')await influenceFromReply(db,row);}
 return{rows,rowCount:rows.length};
}

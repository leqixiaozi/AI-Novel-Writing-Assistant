import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {EntityInitialState,EntityInitialStateVersion} from '../../../common/contracts';
import {initialWriteInput,type InitialStateWriteInput,type InitialStateWriteReceipt} from '../../../common/storyWorkspace';
import {canonicalWriteInput} from '../../../common/storyWorkspace';
import {NewDesignError} from '../../domain/errors';
import {AiExecutionError} from '../../ai/runtime/errors';
import {getNewDesignPool} from '../runtime';
const hash=(value:unknown)=>createHash('sha256').update(canonicalWriteInput(value),'utf8').digest('hex');
type StateKey=Pick<InitialStateWriteInput,'bookId'|'subjectKind'|'subjectId'|'stateKey'>;
interface Sources {requireStateKey:(db:PoolClient,bookId:string,kind:InitialStateWriteInput['subjectKind'],id:string,key:string)=>Promise<unknown>;rebuildProjectionKey:(db:PoolClient,key:StateKey)=>Promise<void>;getInitialState:(id:string)=>Promise<EntityInitialState>}
function receipt(row:Record<string,any>):InitialStateWriteReceipt{
 const version:EntityInitialStateVersion={id:row.id,initialStateId:row.initial_state_id,version:Number(row.version),value:row.value_json,valueHash:row.value_hash,sourceFactId:row.source_fact_id??null,actor:row.actor,note:row.note,createdAt:new Date(row.created_at).toISOString()};
 const input=initialWriteInput({bookId:row.book_id,requestKey:row.id,subjectKind:row.subject_kind,subjectId:row.subject_id,stateKey:row.state_key,value:row.value_json,sourceFactId:row.source_fact_id,expectedRevision:Number(row.version)-1,actor:row.actor,note:row.note});
 return {requestKey:row.id,bookId:row.book_id,inputHash:hash(input),stateId:row.initial_state_id,resultRevision:Number(row.version),input,version};
}
async function read(db:Pick<PoolClient,'query'>,key:string){const row=(await db.query(`SELECT version.*,state.book_id,state.subject_kind,state.subject_id,state.state_key FROM new_design.entity_initial_state_versions version JOIN new_design.entity_initial_states state ON state.id=version.initial_state_id WHERE version.id=$1`,[key])).rows[0];return row?receipt(row):null;}
export async function readInitialStateWriteReceipt(bookId:string,key:string):Promise<InitialStateWriteReceipt|null>{
 const db=await (await getNewDesignPool()).connect();
 try{await db.query('BEGIN READ ONLY');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`initial-request:${key}`]);const result=await read(db,key);await db.query('COMMIT');return result?.bookId===bookId?result:null;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
/** A supplied request UUID is the immutable version UUID. No second state ledger. */
export async function saveInitialStateWithReceipt(pool:Pool,input:InitialStateWriteInput,sources:Sources):Promise<EntityInitialState>{
 const db=await pool.connect();let committing=false;
 try{
  await db.query('BEGIN');
  if(input.requestKey){
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`initial-request:${input.requestKey}`]);
   const prior=await read(db,input.requestKey);
   if(prior){if(prior.inputHash!==hash(initialWriteInput(input)))throw new NewDesignError('原初始值请求标识对应另一输入，请核对原回执。',409);await db.query('ROLLBACK');return sources.getInitialState(prior.stateId);}
  }
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`initial-subject:${input.bookId}:${input.subjectKind}:${input.subjectId}:${input.stateKey}`]);
  await sources.requireStateKey(db,input.bookId,input.subjectKind,input.subjectId,input.stateKey);
  let state=(await db.query('SELECT * FROM new_design.entity_initial_states WHERE book_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state_key=$4 FOR UPDATE',[input.bookId,input.subjectKind,input.subjectId,input.stateKey])).rows[0];
  if(state&&input.expectedRevision!==Number(state.revision))throw new NewDesignError('初始状态已更新，请刷新后核对；填写保留。',409);
  if(!state&&input.requestKey&&(input.expectedRevision??0)!==0)throw new NewDesignError('初始状态来源修订不匹配，请核对后保存。',409);
  if(input.sourceFactId&&!((await db.query("SELECT 1 FROM new_design.canonical_facts WHERE id=$1 AND book_id=$2 AND status='confirmed'",[input.sourceFactId,input.bookId])).rowCount))throw new NewDesignError('初始状态只能引用本书已确认事实。',422);
  if(!state)state=(await db.query('INSERT INTO new_design.entity_initial_states(id,book_id,subject_kind,subject_id,state_key) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),input.bookId,input.subjectKind,input.subjectId,input.stateKey])).rows[0];
  const number=Number((await db.query('SELECT COALESCE(max(version),0)+1 AS version FROM new_design.entity_initial_state_versions WHERE initial_state_id=$1',[state.id])).rows[0].version);
  // For receipt-bearing writes the original monotonic revision/version invariant is verified,
  // rather than guessing a previous revision from a mutable current value.
  if(input.requestKey&&(number!==Number(state.revision)+(state.current_version_id?1:0)||number-1!==(input.expectedRevision??0)))throw new NewDesignError('初始值版本与修订记录不一致，请在运行维护核对；未追加版本。',409);
  const id=input.requestKey??randomUUID();
  await db.query('INSERT INTO new_design.entity_initial_state_versions(id,initial_state_id,version,value_json,value_hash,source_fact_id,actor,note) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',[id,state.id,number,canonicalWriteInput(input.value),hash(input.value),input.sourceFactId??null,input.actor??'user',input.note??'']);
  await db.query('UPDATE new_design.entity_initial_states SET current_version_id=$2,revision=CASE WHEN current_version_id IS NULL THEN revision ELSE revision+1 END,updated_at=now() WHERE id=$1',[state.id,id]);
  await sources.rebuildProjectionKey(db,input);committing=true;await db.query('COMMIT');return await sources.getInitialState(state.id);
 }catch(error){let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}if(!input.requestKey)throw error;const problem=new AiExecutionError('保存初始状态',error instanceof NewDesignError?error.message:'初始值保存结果待核对，原填写和请求保留。',error instanceof NewDesignError?error.status:503);problem.recovery.mutationOutcome=!committing&&rolledBack?'not_written':'unknown';problem.recovery.sourceRoute=`/new-design/books/${input.bookId}/story-setting?selected=${input.subjectId}&detail=initial`;throw problem;}finally{db.release();}
}

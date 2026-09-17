import type {PoolClient} from 'pg';
import type {ResourceFocusRequest,ResourceFocusRecord,ResourceFocusPromptInput,ResourceFocusOutput} from '../../../../common/characterResources/focus';
import {resourceFocusRequestSchema} from '../../../../common/characterResources/focus';
import type {NewDesignAiGateway} from '../../../ai/gateway';
import {AiExecutionError} from '../../../ai/runtime/errors';
import {preparePrompt} from '../../../ai/prompts';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {formHash} from '../../formAssist';
import {getNewDesignPool} from '../../runtime';
import {freezeResourceFocusSources} from './sources';
export {previewResourceFocus} from './sources';

const contract='character_resource_focus_v1';
export class ResourceFocusWriteError extends NewDesignError {
 constructor(message:string,status:number,public readonly mutationOutcome:'not_written'|'unknown'){super(message,status);}
}
function record(row:Record<string,any>):ResourceFocusRecord {
 return{id:String(row.id),bookId:String(row.book_id),request:row.input_payload.request,status:row.status,stage:row.stage,error:row.error_message??'',snapshot:row.input_payload.snapshot,output:row.output_payload?.result??null,createdAt:new Date(row.created_at).toISOString(),sourceRoute:`/new-design/books/${row.book_id}/story-setting?tab=characters&selected=${row.input_payload.request.characterId}&detail=resources&resourceFocus=${row.id}`};
}
async function readRow(db:PoolClient,bookId:string,id:string){return(await db.query("SELECT * FROM new_design.ai_generation_batches WHERE id=$1 AND book_id=$2 AND input_payload->>'contract'=$3",[id,bookId,contract])).rows[0]??null;}
function sameRequest(row:Record<string,any>,input:ResourceFocusRequest){
 if(row.input_payload.requestHash!==formHash(input)||formHash(row.input_payload.request)!==formHash(input))throw new ResourceFocusWriteError('原人物资源建议请求与完整来源或要求不同，请保留凭证核对。',409,'unknown');
}
export async function readResourceFocusOriginal(bookId:string,input:ResourceFocusRequest):Promise<ResourceFocusRecord|null>{
 const parsed=resourceFocusRequestSchema.parse(input),db=await(await getNewDesignPool()).connect();
 try{await db.query('BEGIN READ ONLY');const row=await readRow(db,bookId,parsed.requestKey);if(row)sameRequest(row,parsed);await db.query('COMMIT');return row?record(row):null;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function getResourceFocusRecord(bookId:string,id:string):Promise<ResourceFocusRecord|null>{const db=await(await getNewDesignPool()).connect();try{const row=await readRow(db,bookId,id);return row?record(row):null;}finally{db.release();}}
export async function endUnknownResourceFocus(bookId:string,input:ResourceFocusRequest):Promise<ResourceFocusRecord>{
 const parsed=resourceFocusRequestSchema.parse(input),db=await(await getNewDesignPool()).connect();
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`resource-focus:${bookId}:${parsed.requestKey}`]);await db.query('BEGIN');
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[`resource-focus-execution:${parsed.requestKey}`])).rows[0]?.locked)throw new ResourceFocusWriteError('原资源建议仍在执行，请只读核对原结果；不能结束在途请求。',409,'not_written');
  const row=assertFound(await readRow(db,bookId,parsed.requestKey),'原领取尚未读取，不能证明未发送。');sameRequest(row,parsed);
  if(row.stage==='ended_unknown'){await db.query('COMMIT');return record(row);}
  if(row.status!=='running'||row.output_payload?.result)throw new ResourceFocusWriteError('原建议已有确定结果，请读取核对；不能丢弃已保存结果。',409,'not_written');
  const ended=(await db.query("UPDATE new_design.ai_generation_batches SET status='discarded',stage='ended_unknown',error_message='原显示建议占用已明确结束；原模型是否完成及用量仍未知，完整原来源保留。',completed_at=now(),updated_at=now() WHERE id=$1 AND book_id=$2 RETURNING *",[parsed.requestKey,bookId])).rows[0];await db.query('COMMIT');return record(ended);
 }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`resource-focus:${bookId}:${parsed.requestKey}`]).catch(()=>undefined);db.release(true);}
}
/** Claim once, then execute once; duplicates and recovery only read the full original. */
export async function generateResourceFocus(bookId:string,input:ResourceFocusRequest,ai?:NewDesignAiGateway):Promise<ResourceFocusRecord>{
 const parsed=resourceFocusRequestSchema.parse(input),pool=await getNewDesignPool(),db=await pool.connect();let committing=false,promptInput:ResourceFocusPromptInput;
 const task=parsed.includeHistory?'character_resource_history_focus':'character_resource_focus',generate=parsed.includeHistory?ai?.generateCharacterResourceHistoryFocus:ai?.generateCharacterResourceFocus;
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`resource-focus:${bookId}:${parsed.requestKey}`]);await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const original=await readRow(db,bookId,parsed.requestKey);if(original){sameRequest(original,parsed);await db.query('ROLLBACK');return record(original);}
  if(!generate)throw new NewDesignError('请在模型设置连接创作模型后准备人物资源显示建议。',503);
  const source=await freezeResourceFocusSources(db,bookId,parsed.characterId,parsed.selection,parsed.includeHistory);
  if(source.sourceHash!==parsed.expectedSourceHash)throw new NewDesignError('人物、资源策划或账本来源已变化，请重新核对完整范围；未发送模型请求。',409);
  promptInput={snapshot:source.snapshot,instruction:parsed.instruction};const prompt=preparePrompt(task,promptInput);
  await db.query("INSERT INTO new_design.ai_generation_batches(id,book_id,operation,status,stage,instruction,input_payload,prompt_id,prompt_version) VALUES($1,$2,'form_assist','running','generating',$3,$4::jsonb,$5,$6)",[parsed.requestKey,bookId,parsed.instruction,JSON.stringify({contract,request:parsed,requestHash:formHash(parsed),snapshot:source.snapshot}),prompt.assetId,prompt.version]);
  committing=true;await db.query('COMMIT');
 }catch(error){let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}if(error instanceof ResourceFocusWriteError)throw error;throw new ResourceFocusWriteError(error instanceof NewDesignError?error.message:'原资源建议领取结果待核对，请保留完整凭证。',error instanceof NewDesignError?error.status:503,!committing&&rolledBack?'not_written':'unknown');}finally{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`resource-focus:${bookId}:${parsed.requestKey}`]).catch(()=>undefined);db.release(true);}
 const execution=await pool.connect().catch(()=>{throw new ResourceFocusWriteError('原资源建议领取已保存，请只读核对原结果；未重复生成。',503,'unknown');});let modelCompleted=false;
 try{
  await execution.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`resource-focus-execution:${parsed.requestKey}`]);
  const existing=assertFound(await readRow(execution,bookId,parsed.requestKey),'原资源建议领取不存在。');sameRequest(existing,parsed);if(existing.status!=='running')return record(existing);
  const generated=await generate!(promptInput!);modelCompleted=true;
  const output=preparePrompt(task,promptInput!).parseOutput(generated.output) as ResourceFocusOutput;
  const row=(await execution.query("UPDATE new_design.ai_generation_batches SET status='review',stage='review',progress=100,output_payload=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1 AND book_id=$3 AND status='running' RETURNING *",[parsed.requestKey,JSON.stringify({...generated,result:output}),bookId])).rows[0];
  return record(assertFound(row,'原资源建议保存结果待核对。'));
 }catch(error){
  const trace=error instanceof AiExecutionError?error.executionSnapshot:null,attempts=Array.isArray(trace?.attempts)?trace!.attempts as Array<{requestSent:boolean;responseReceived:boolean}>:null;
  if(!modelCompleted&&attempts!==null&&attempts.every(attempt=>!attempt.requestSent||attempt.responseReceived)){
   const failed=(await execution.query("UPDATE new_design.ai_generation_batches SET status='failed',stage='failed',error_message=$2,output_payload=$3::jsonb,completed_at=now(),updated_at=now() WHERE id=$1 AND book_id=$4 AND status='running' RETURNING *",[parsed.requestKey,error instanceof AiExecutionError?error.message:'原回复未通过资源建议规格。',JSON.stringify({failureSnapshot:trace}),bookId]).catch(()=>({rows:[]}))).rows[0];if(failed)return record(failed);
  }
  await execution.query("UPDATE new_design.ai_generation_batches SET stage=$2,error_message='原资源建议结果待核对；完整来源保留，不能重复生成。',updated_at=now() WHERE id=$1 AND book_id=$3 AND status='running'",[parsed.requestKey,modelCompleted?'result_pending':'result_unknown',bookId]).catch(()=>undefined);
  throw new ResourceFocusWriteError('原资源建议模型调用或结果保存待核对，请读取完整原请求；不会自动重复生成。',503,'unknown');
 }finally{await execution.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`resource-focus-execution:${parsed.requestKey}`]).catch(()=>undefined);execution.release(true);}
}

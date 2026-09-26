import {updateProductionRecords} from './persistence';
import {chapterWritingRequestRows} from './persistence';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
type Row=Record<string,any>;
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
export async function retainOriginalChapterUsage(client:PoolClient,row:Row,trace:Row,unknown=false){
  if(!row.current_attempt_id)return;
  if((await client.query('SELECT id FROM new_design.ai_attempt_usage WHERE attempt_id=$1',[row.current_attempt_id])).rowCount)return;
  await client.query('INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,fallback_count,budget_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),row.ai_task_id,row.step_id,row.current_attempt_id,String(trace.provider??'unknown'),String(trace.model??'unknown'),count(trace.inputTokens),count(trace.outputTokens),count(trace.fallbackCount)??0,trace.budgetExceeded===true?'exceeded':!unknown&&count(trace.inputTokens)!==null&&count(trace.outputTokens)!==null?'within_budget':'unknown']);
}
async function events(client:PoolClient,row:Row,to:string,reason:string,detail:string){
  if(row.current_attempt_id)await client.query("INSERT INTO new_design.ai_task_events(id,task_id,step_id,attempt_id,entity_kind,from_status,to_status,checkpoint_key,reason_code,reason_detail,actor_kind,actor) VALUES($1,$2,$3,$4,'attempt','running',$5,'generate_candidate',$6,$7,'user','controlled_chapter_executor')",[randomUUID(),row.ai_task_id,row.step_id,row.current_attempt_id,to==='cancelled'?'discarded':to,reason,detail]);
  for(const kind of ['step','task'])await client.query("INSERT INTO new_design.ai_task_events(id,task_id,step_id,entity_kind,from_status,to_status,checkpoint_key,reason_code,reason_detail,actor_kind,actor) VALUES($1,$2,$3,$4,$5,$6,'generate_candidate',$7,$8,'user','controlled_chapter_executor')",[randomUUID(),row.ai_task_id,kind==='task'?null:row.step_id,kind,kind==='task'?row.task_status:row.step_status,to,reason,detail]);
}
export async function lockOriginalChapterExecution(client:PoolClient,bookId:string,requestId:string):Promise<Row>{
  const source=assertFound((await client.query(`SELECT ai_task_id FROM ${chapterWritingRequestRows} chapter_writing_request_rows_record WHERE book_id=$1 AND id=$2 AND controlled_snapshot IS NOT NULL`,[bookId,requestId])).rows[0],'本书原受控章节请求不存在。');
  await client.query('SELECT id FROM new_design.ai_tasks WHERE id=$1 FOR UPDATE',[source.ai_task_id]);
  const step=assertFound((await client.query("SELECT id,current_attempt_id FROM new_design.ai_task_steps WHERE task_id=$1 AND step_key='generate_candidate' FOR UPDATE",[source.ai_task_id])).rows[0],'原生成步骤不存在。');
  if(step.current_attempt_id)await client.query('SELECT id FROM new_design.ai_task_attempts WHERE id=$1 FOR UPDATE',[step.current_attempt_id]);
  return assertFound((await client.query(`SELECT request.*,task.status task_status,step.id step_id,step.status step_status,step.current_attempt_id,step.lease_expires_at,attempt.status attempt_status FROM ${chapterWritingRequestRows} request JOIN new_design.ai_tasks task ON task.id=request.ai_task_id JOIN new_design.ai_task_steps step ON step.id=$3 LEFT JOIN new_design.ai_task_attempts attempt ON attempt.id=step.current_attempt_id WHERE request.book_id=$1 AND request.id=$2 FOR UPDATE OF request`,[bookId,requestId,step.id])).rows[0],'原请求来源未完整读取。');
}
export async function finishKnownChapterFailure(client:PoolClient,row:Row,trace:Row,message:string,category:string){
  if(row.controlled_output)throw new NewDesignError('原模型回复已保存，不能改为生成失败；请完成候选入库。',409);
  if(row.attempt_status!=='running'||row.step_status!=='running'||row.task_status!=='running'||!row.lease_expires_at||new Date(row.lease_expires_at).getTime()<=Date.now())throw new NewDesignError('原尝试已经过期或结束，迟到失败不得覆盖；请只读核对。',409);
  await client.query("UPDATE new_design.ai_task_attempts SET status='failed',error_category=$2,retry_eligibility='none',error_summary=$3,ended_at=now() WHERE id=$1 AND status='running'",[row.current_attempt_id,category,message]);
  await client.query("UPDATE new_design.ai_task_steps SET status='failed',revision=revision+1,lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now() WHERE id=$1",[row.step_id]);
  await client.query("UPDATE new_design.ai_tasks SET status='failed',revision=revision+1,completed_at=now(),updated_at=now() WHERE id=$1",[row.ai_task_id]);
  await events(client,row,'failed','controlled_generation_failed',message);await retainOriginalChapterUsage(client,row,trace);
}
/** Same transaction as original request cancellation. No new attempt, model call or discarded reply. */
export async function endExpiredOriginalChapter(client:PoolClient,bookId:string,requestId:string){
  const row=await lockOriginalChapterExecution(client,bookId,requestId);
  if(row.status==='cancelled')return;
  if(!['queued','running'].includes(row.status)||row.controlled_output||row.result_body_version_id)throw new NewDesignError('原请求已有回复或结果，不能结束后再生成；请完成原候选回执。',409);
  if(row.lease_expires_at&&new Date(row.lease_expires_at).getTime()>Date.now())throw new NewDesignError('本章原领取尚未过期，请只读核对，不结束在途请求。',409);
  if(!['queued','running'].includes(row.step_status)||!['queued','running'].includes(row.task_status)||row.current_attempt_id&&row.attempt_status!=='running')throw new NewDesignError('原运行记录已由其他动作结束，不能覆盖旧回执。',409);
  const message=row.current_attempt_id?'作者明确结束过期原领取；原调用结果和用量仍未知，迟到回复拒绝。':'作者明确结束未领取原请求；没有新模型调用，原内容保留。';
  if(row.current_attempt_id)await client.query("UPDATE new_design.ai_task_attempts SET status='discarded',error_category='unknown',retry_eligibility='none',error_summary=$2,ended_at=now() WHERE id=$1 AND status='running'",[row.current_attempt_id,message]);
  await client.query("UPDATE new_design.ai_task_steps SET status='cancelled',revision=revision+1,lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now() WHERE id=$1",[row.step_id]);
  await client.query("UPDATE new_design.ai_tasks SET status='cancelled',revision=revision+1,completed_at=now(),updated_at=now() WHERE id=$1",[row.ai_task_id]);
  await updateProductionRecords(client, 'chapter_writing_request', `SELECT to_jsonb(record) AS record_values,jsonb_build_object('status',('cancelled')::text,'error_summary',($2)::text,'updated_at',(now())::timestamptz) AS record_patch FROM ${chapterWritingRequestRows} record WHERE id=$1 FOR UPDATE OF record`, [requestId,message], ["id"]);
  await events(client,row,'cancelled','author_ended_expired_original',message);await retainOriginalChapterUsage(client,row,row.controlled_execution??{},true);
}

/** Explicit release keeps the original reply, never adopts it or invokes a model. */
export async function endSavedReplyOriginalChapter(client:PoolClient,bookId:string,requestId:string){
  const row=await lockOriginalChapterExecution(client,bookId,requestId);
  if(row.status==='cancelled'&&row.controlled_output&&!row.result_body_version_id)return;
  if(row.status!=='running'||!row.controlled_output||row.result_body_version_id||row.attempt_status!=='running'||row.step_status!=='running'||row.task_status!=='running')throw new NewDesignError('只能保留本次已保存且尚未入候选的原回复后结束；已有候选须核对原候选回执。',409);
  const message='作者明确保留原回复并结束本次领取；没有导入或采用正文，没有重新调用模型。';
  await client.query("UPDATE new_design.ai_task_attempts SET status='discarded',error_category=NULL,retry_eligibility='none',error_summary=$2,ended_at=now() WHERE id=$1 AND status='running'",[row.current_attempt_id,message]);
  await client.query("UPDATE new_design.ai_task_steps SET status='cancelled',revision=revision+1,lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now() WHERE id=$1",[row.step_id]);
  await client.query("UPDATE new_design.ai_tasks SET status='cancelled',revision=revision+1,completed_at=now(),updated_at=now() WHERE id=$1",[row.ai_task_id]);
  await updateProductionRecords(client, 'chapter_writing_request', `SELECT to_jsonb(record) AS record_values,jsonb_build_object('status',('cancelled')::text,'error_summary',($2)::text,'updated_at',(now())::timestamptz) AS record_patch FROM ${chapterWritingRequestRows} record WHERE id=$1 FOR UPDATE OF record`, [requestId,message], ["id"]);
  await events(client,row,'cancelled','author_retained_original_reply',message);
  await retainOriginalChapterUsage(client,row,row.controlled_execution??{});
}

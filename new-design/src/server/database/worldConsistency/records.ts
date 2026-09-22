import type {PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
import {stableHash} from '../aiContracts';
import {insertProductionRecords,updateProductionRecords,qualityAuditReportRows} from '../chapterProduction/persistence';
export * from './rows';

async function guardWorldRequest(client:PoolClient,value:Record<string,any>,previous?:Record<string,any>){
  const reject=()=>{throw new NewDesignError('世界检查的冻结输入、原回复或精确运行来源不一致。',409);};
  if(!['running','failed','succeeded','stale','ended_unknown'].includes(value.status)||!['not_sent','sent_unknown','completed'].includes(value.model_request_state))reject();
  if(previous){
    for(const key of ['book_id','request_key','request_hash','input_hash','input_payload','frozen_plan','ai_task_id','step_id','attempt_id'])if(stableHash(previous[key])!==stableHash(value[key]))reject();
    if(previous.generated_output!==null&&(stableHash(previous.generated_output)!==stableHash(value.generated_output)||stableHash(previous.generated_execution)!==stableHash(value.generated_execution)))reject();
    if(previous.status!=='running'&&(previous.status!==value.status||previous.report_id!==value.report_id))reject();
  }
  if(!(await client.query(`SELECT 1 FROM new_design.ai_tasks task JOIN new_design.ai_task_steps step ON step.task_id=task.id JOIN new_design.ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id WHERE task.id=$1 AND task.book_id=$2 AND task.source_kind='world_consistency' AND task.source_id=$3 AND step.id=$4 AND attempt.id=$5 AND attempt.input_hash=$6 AND attempt.attempt_number=1 AND step.max_attempts=1`,[value.ai_task_id,value.book_id,value.id,value.step_id,value.attempt_id,value.input_hash])).rowCount)reject();
  if(value.status==='succeeded'&&!value.report_id)reject();
  if(value.report_id&&!(await client.query(`SELECT 1 FROM ${qualityAuditReportRows} report WHERE report.id=$1 AND report.book_id=$2 AND report.task_id=$3 AND report.step_id=$4 AND report.attempt_id=$5 AND report.input_hash=$6 AND report.rule_set_key='world_consistency' AND report.rule_set_version='v1'`,[value.report_id,value.book_id,value.ai_task_id,value.step_id,value.attempt_id,value.input_hash])).rowCount)reject();
  if(value.generated_output!==null){const execution=value.generated_execution,plan=value.frozen_plan;if(!execution||typeof execution!=='object'||Array.isArray(execution)||!value.generated_output||typeof value.generated_output!=='object'||Array.isArray(value.generated_output)||value.model_request_state!=='completed'||execution.routeSnapshotId!==plan.snapshotId||execution.routeSnapshotHash!==plan.snapshotHash||execution.provider!==plan.route.primary.provider||execution.model!==plan.route.primary.model||!execution.attempts?.some((attempt:Record<string,unknown>)=>attempt.status==='succeeded'&&attempt.requestSent===true&&attempt.responseReceived===true))reject();}
  if(value.status==='ended_unknown'&&value.generated_output!==null)reject();
}

export async function insertWorldRecords(client:PoolClient,type:string,select:string,parameters:unknown[],keys:string[][]){
  if(type==='world_consistency_request')for(const row of(await client.query(select,parameters)).rows)await guardWorldRequest(client,row);
  return insertProductionRecords(client,type,select,parameters,keys);
}
export async function updateWorldRecords(client:PoolClient,type:string,select:string,parameters:unknown[],identity:string[]){
  if(type==='world_consistency_request')for(const row of(await client.query(select,parameters)).rows)await guardWorldRequest(client,{...row.record_values,...row.record_patch},row.record_values);
  return updateProductionRecords(client,type,select,parameters,identity);
}

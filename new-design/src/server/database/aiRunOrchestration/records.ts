import type {PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
import {createRecordCard,listRecordCards,requireRecordCard,replaceRecordCard,type RecordCardDb} from '../recordCards';

export async function runRows(db:RecordCardDb,kind:'ai_run_preview'|'ai_run_prompt_section'|'ai_run_submission',where:Record<string,unknown>={}){
  return listRecordCards(db,kind,{where});
}
export async function readRunPreview(db:RecordCardDb,id:string,lock=false){
  return requireRecordCard(db,id,'ai_run_preview','运行预览不存在。',{lock});
}
export async function insertRunRecord(db:PoolClient,kind:'ai_run_preview'|'ai_run_prompt_section'|'ai_run_submission',values:Record<string,unknown>){
  const spaceId=kind==='ai_run_preview'?String(values.space_id):(await readRunPreview(db,String(values.preview_id))).recordSpaceId;
  return createRecordCard(db,{id:values.id as string|undefined,spaceId,typeKey:kind,title:String(values.label??values.task_key??'运行回执'),values:{...(kind==='ai_run_submission'?{submitted_at:new Date().toISOString()}:{}),...values}});
}
export async function transitionRunPreview(db:PoolClient,id:string,status:'stale'|'submitted',expectedRevision:number){
  const row=await readRunPreview(db,id,true);
  if(row.revision!==expectedRevision||!(row.status==='ready'||row.status==='blocked'&&status==='stale'))throw new NewDesignError('原预览已变化，不能重复提交。',409);
  return replaceRecordCard(db,{id:row.recordCardId,spaceId:row.recordSpaceId,typeKey:'ai_run_preview',values:{...row,status,revision:row.revision+1,updated_at:new Date().toISOString()}});
}

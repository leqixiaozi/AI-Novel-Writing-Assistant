import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChapterSettlementAiReceipt } from "../../../common/chapterSettlementAi";
import { stableHash } from "../../database/aiContracts";
import { assertFound,NewDesignError } from "../../domain/errors";
import { ChapterSettlementAiError } from "./errors";
import { database,lockBook } from "./database";
import { readRequest,receipt,appendEvent,SOURCE_KIND } from "./requests";
const count=(value:unknown):number|null=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
export async function releaseSavedChapterSettlementAiResult(requestId:string):Promise<ChapterSettlementAiReceipt>{
  z.string().uuid().parse(requestId);let route="/new-design/structure/maintenance";
  try{return await database(async client=>{
    const initial=assertFound(await readRequest(client,"request.id=$3",[requestId]),"本次提取记录不存在。 ");route=receipt(initial).sourceRoute;
    await lockBook(client,String(initial.book_id));const row=assertFound(await readRequest(client,"request.id=$3",[requestId],true),"本次提取记录不存在。");
    if(row.status==="stale"&&row.attempt_status==="discarded")return receipt(row,true);
    if(row.status!=="running"||row.attempt_status!=="running"||!row.generated_output||!row.generated_execution)throw new NewDesignError("只有模型结果已保存、候选尚未入库的提取可以结束；已入库清单或未知模型回执不能由此操作改变。",409);
    if((await client.query("SELECT 1 FROM new_design.chapter_settlement_items WHERE source_task_id=$1 LIMIT 1",[row.ai_task_id])).rowCount)throw new NewDesignError("本次已有候选入库，请审阅清单或完成运行回执，不能结束已入库结果。",409);
    const refs={taskId:row.ai_task_id,stepId:row.step_id,attemptId:row.attempt_id},trace=row.generated_execution;
    await client.query("UPDATE new_design.chapter_proposal_extraction_requests SET status='stale',failure=NULL,error_summary='',updated_at=now() WHERE id=$1",[requestId]);
    await client.query("UPDATE new_design.ai_task_attempts SET status='discarded',result_kind=$2,result_stable_id=$3,result_version_id=$4,result_hash=$5,ended_at=now(),error_summary='作者保留模型结果并结束未入库提取；未修改正式事实' WHERE id=$1 AND status='running'",[row.attempt_id,SOURCE_KIND,requestId,row.prompt_recipe_version_id,stableHash(row.generated_output)]);
    const step=(await client.query("UPDATE new_design.ai_task_steps SET status='cancelled',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' AND current_attempt_id=$2 RETURNING revision",[row.step_id,row.attempt_id])).rows[0];
    const task=(await client.query("UPDATE new_design.ai_tasks SET status='cancelled',revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' RETURNING revision",[row.ai_task_id])).rows[0];
    if(!step||!task)throw new NewDesignError("运行状态已变化，结束操作未确认，请核对原回执。",409);
    for(const kind of ["attempt","step","task"]as const)await appendEvent(client,refs,kind,"running",kind==="attempt"?"discarded":"cancelled","saved_extraction_released",kind==="step"?Number(step.revision):kind==="task"?Number(task.revision):null);
    await client.query("INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,cached_input_tokens,duration_ms,estimated_cost,currency,fallback_count,budget_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,NULL,$10,$11)",[randomUUID(),refs.taskId,refs.stepId,refs.attemptId,typeof trace.provider==="string"?trace.provider:"not_invoked",typeof trace.model==="string"?trace.model:"not_invoked",count(trace.inputTokens),count(trace.outputTokens),count(trace.durationMs),count(trace.fallbackCount)??0,trace.budgetExceeded===true?"exceeded":count(trace.inputTokens)!==null&&count(trace.outputTokens)!==null?"within_budget":"unknown"]);
    return receipt({...row,status:"stale",attempt_status:"discarded",failure:null});
  });}catch(error){
    const failure=new ChapterSettlementAiError("结束本次未入库提取",error instanceof NewDesignError?error.message:"结束操作保存回执未确认，请只读核对原请求，不能再次提取。",error instanceof NewDesignError?error.status:503,error instanceof NewDesignError?"not_written":"unknown","completed");Object.assign(failure.recovery,{sourceRoute:route,actionLabel:route.includes("maintenance")?"打开运行维护":"返回章节结算",savedResult:"原正文、人工清单、模型结果和运行账本保留；结束操作是否保存须核对原请求，未修改正式事实。"});throw failure;
  }
}

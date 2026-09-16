import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChapterSettlementAiReceipt } from "../../../common/chapterSettlementAi";
import { assertFound,NewDesignError } from "../../domain/errors";
import { ChapterSettlementAiError } from "./errors";
import { database,lockBook } from "./database";
import { readRequest,receipt,appendEvent } from "./requests";

/** Explicit source action after the entire frozen runtime deadline; never a model retry. */
export async function endExpiredUnknownChapterSettlementAiExtraction(requestId:string):Promise<ChapterSettlementAiReceipt>{
  z.string().uuid().parse(requestId);let route="/new-design/structure/maintenance";
  try{return await database(async client=>{
    const initial=assertFound(await readRequest(client,"request.id=$3",[requestId]),"本次提取记录不存在。");route=receipt(initial).sourceRoute;
    await lockBook(client,String(initial.book_id));const row=assertFound(await readRequest(client,"request.id=$3",[requestId],true),"本次提取记录不存在。");
    if(row.status==="cancelled"&&row.attempt_status==="discarded"&&!row.generated_output)return receipt(row,true);
    if(row.status!=="running"||row.attempt_status!=="running"||row.generated_output||row.lease_expired!==true)throw new NewDesignError("只有全部调用时限已过、模型结果仍未知的领取可以明确结束。已保存结果请导入或保留结果后结束；未过期调用请先核对回执。",409);
    if((await client.query("SELECT 1 FROM new_design.chapter_settlement_items WHERE source_task_id=$1 LIMIT 1",[row.ai_task_id])).rowCount)throw new NewDesignError("本次已有候选入库，不能把已保存候选当作未知调用结束。",409);
    const refs={taskId:row.ai_task_id,stepId:row.step_id,attemptId:row.attempt_id};
    await client.query("UPDATE new_design.chapter_proposal_extraction_requests SET status='cancelled',failure=NULL,error_summary='作者结束过期领取；原模型调用是否完成与用量未知',updated_at=now() WHERE id=$1",[requestId]);
    await client.query("UPDATE new_design.ai_task_attempts SET status='discarded',ended_at=now(),error_summary='作者结束过期未知领取；不得据此认定原模型未发送或无用量' WHERE id=$1 AND status='running'",[row.attempt_id]);
    const step=(await client.query("UPDATE new_design.ai_task_steps SET status='cancelled',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' AND current_attempt_id=$2 RETURNING revision",[row.step_id,row.attempt_id])).rows[0];
    const task=(await client.query("UPDATE new_design.ai_tasks SET status='cancelled',revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' RETURNING revision",[row.ai_task_id])).rows[0];
    if(!step||!task)throw new NewDesignError("运行状态已变化，结束操作未确认，请核对原请求。",409);
    for(const kind of ["attempt","step","task"]as const)await appendEvent(client,refs,kind,"running",kind==="attempt"?"discarded":"cancelled","expired_unknown_extraction_ended",kind==="step"?Number(step.revision):kind==="task"?Number(task.revision):null);
    // A crash can occur before or after sending. Planned route is not proof of the provider actually invoked.
    await client.query("INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,cached_input_tokens,duration_ms,estimated_cost,currency,fallback_count,budget_decision) VALUES($1,$2,$3,$4,'unknown','unknown',NULL,NULL,NULL,NULL,NULL,NULL,0,'unknown')",[randomUUID(),refs.taskId,refs.stepId,refs.attemptId]);
    return receipt({...row,status:"cancelled",attempt_status:"discarded",failure:null});
  });}catch(error){
    const failure=new ChapterSettlementAiError("结束过期未知提取",error instanceof NewDesignError?error.message:"结束保存回执未确认，请只读核对原请求；不能自动重新提取。",error instanceof NewDesignError?error.status:503,error instanceof NewDesignError?"not_written":"unknown","sent_unknown");Object.assign(failure.recovery,{sourceRoute:route,actionLabel:route.includes("maintenance")?"打开运行维护":"返回章节结算",savedResult:"正文、人工清单、原冻结资料与记录保留；原模型调用是否完成和用量未知。本次结束保存结果须核对，未修改正式事实。"});throw failure;
  }
}

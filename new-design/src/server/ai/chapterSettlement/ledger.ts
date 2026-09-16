import { randomUUID } from "node:crypto";
import type { ChapterSettlementAiReceipt } from "../../../common/chapterSettlementAi";
import type { AiRuntimeRecovery } from "../../../common/aiRuntime";
import type { AiFailureCategory } from "../../../common/contracts";
import { stableHash } from "../../database/aiContracts";
import { assertFound,NewDesignError } from "../../domain/errors";
import type { SettlementAiClaim } from "./contracts";
import { database,lock,lockBook } from "./database";
import { appendEvent,readRequest,receipt,SOURCE_KIND } from "./requests";

const count=(value:unknown):number|null=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
export async function finishSettlementAiLedger(claim:SettlementAiClaim,failure:AiRuntimeRecovery|null,execution:Record<string,unknown>|null=null,errorCategory:AiFailureCategory="unknown"):Promise<ChapterSettlementAiReceipt>{
  return database(async client=>{
    await lock(client,`finish:${claim.requestId}`);
    await lockBook(client,claim.bookId);
    const row=assertFound(await readRequest(client,"request.id=$3",[claim.requestId],true),"本章提取运行记录不存在。");
    const attempt=assertFound((await client.query("SELECT * FROM new_design.ai_task_attempts WHERE id=$1 FOR UPDATE",[claim.attemptId])).rows[0],"本章提取尝试不存在。");
    if(row.ai_task_id!==claim.taskId||row.step_id!==claim.stepId||row.attempt_id!==claim.attemptId||attempt.lease_token_digest!==stableHash(claim.leaseToken)||row.frozen_input_hash!==attempt.input_hash||stableHash(row.frozen_plan)!==stableHash(claim.plan))throw new NewDesignError("本章提取尝试、冻结输入或领取凭据不一致，请核对原回执。",409);
    const status=failure?"failed":"succeeded",trace=execution??row.generated_execution??null;
    if(attempt.status!=="running"){
      if(attempt.status!==status)throw new NewDesignError("本章提取已有不同终止回执，已保存结果不能覆盖。",409);
      return receipt(row,true);
    }
    if(!failure&&row.status!=="succeeded")throw new NewDesignError("变化候选入库尚未确认，不能标记运行成功。",409);
    if(failure&&row.generated_output)throw new NewDesignError("模型结果已保存，请恢复候选导入，不能把已生成结果标记为模型失败。",409);
    if(failure)await client.query("UPDATE new_design.chapter_proposal_extraction_requests SET status='failed',failure=$2::jsonb,generated_execution=$3::jsonb,error_summary=$4,updated_at=now() WHERE id=$1",[claim.requestId,JSON.stringify(failure),trace?JSON.stringify(trace):null,failure.summary.slice(0,2000)]);
    await client.query("UPDATE new_design.ai_task_attempts SET status=$2,result_kind=$3,result_stable_id=$4,result_version_id=$5,result_hash=$6,error_category=$7,retry_eligibility=$8,error_summary=$9,ended_at=now() WHERE id=$1",[claim.attemptId,status,failure?null:SOURCE_KIND,failure?null:claim.requestId,failure?null:claim.promptRecipeVersionId,failure?null:stableHash(row.generated_output),failure?errorCategory:null,failure?"none":null,failure?.summary??""]);
    const step=(await client.query("UPDATE new_design.ai_task_steps SET status=$2,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' AND current_attempt_id=$3 RETURNING revision",[claim.stepId,status,claim.attemptId])).rows[0];
    const task=(await client.query("UPDATE new_design.ai_tasks SET status=$2,revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' RETURNING revision",[claim.taskId,status])).rows[0];
    if(!step||!task)throw new NewDesignError("本章提取运行状态冲突，终止回执未保存，请核对原请求。",409);
    for(const kind of ["attempt","step","task"]as const)await appendEvent(client,claim,kind,"running",status,failure?"settlement_extraction_failed":"settlement_candidates_saved",kind==="step"?Number(step.revision):kind==="task"?Number(task.revision):null);
    await client.query("INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,cached_input_tokens,duration_ms,estimated_cost,currency,fallback_count,budget_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,NULL,$10,$11)",[randomUUID(),claim.taskId,claim.stepId,claim.attemptId,typeof trace?.provider==="string"?trace.provider:"not_invoked",typeof trace?.model==="string"?trace.model:"not_invoked",count(trace?.inputTokens),count(trace?.outputTokens),count(trace?.durationMs),count(trace?.fallbackCount)??0,trace?.budgetExceeded===true?"exceeded":count(trace?.inputTokens)!==null&&count(trace?.outputTokens)!==null?"within_budget":"unknown"]);
    return receipt({...row,status,attempt_status:status,failure:failure??row.failure,generated_execution:trace});
  });
}

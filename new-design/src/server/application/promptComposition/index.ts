import {z} from "zod";
import {COMPOSITION_ROUTE,type CompositionDebugResult} from "../../../common/promptComposition";
import {AiExecutionError,executeManagedPrompt} from "../../ai";
import {replayDebugPrompt} from "../../ai/composition";
import {claimDebugRun,finishDebugRun,type DebugRunCompletion} from "../../database/promptComposition";
import {NewDesignError} from "../../domain/errors";

const trialInput=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160)}).strict();
function trialFailure(step:string,error:unknown,savedResult:string,previewId:string):AiExecutionError {
  if(error instanceof AiExecutionError)return error;
  const result=new AiExecutionError(step,error instanceof NewDesignError?error.message:error instanceof z.ZodError?"请核对预览版本与请求凭证。":"服务未确认本次操作结果，请保留原预览并先核对结果。",error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,error instanceof NewDesignError?error.issues:undefined);
  result.recovery.savedResult=savedResult;
  result.recovery.sourceRoute=`${COMPOSITION_ROUTE}?previewId=${previewId}`;
  result.recovery.actionLabel="返回提示词组合";
  return result;
}

/** The single trial executor; source pages reuse the original claim, frozen bundle and receipt. */
export async function runPromptCompositionTrial(previewId:string,input:{expectedRevision:number;idempotencyKey:string}):Promise<CompositionDebugResult> {
  const id=z.string().uuid().parse(previewId),request=trialInput.parse(input);
  const claim=await claimDebugRun(id,request.expectedRevision,request.idempotencyKey);
  if("priorResult" in claim)return claim.priorResult;
  let completion:DebugRunCompletion;
  try {
    let prepared;
    try {prepared=replayDebugPrompt(claim.frozenBundle);}catch(error){throw trialFailure("核对冻结请求",error,"冻结输入和旧运行记录保留。本次模型请求尚未发送，请返回组合页重新预览。",id);}
    const generated=await executeManagedPrompt(claim.preview.taskType,prepared,{routeResolver:async()=>claim.snapshot.route,snapshotWriter:async()=>claim.snapshot});
    completion={output:generated.output,modelSnapshot:generated.modelSnapshot};
  }catch(error){
    const problem=trialFailure("执行试运行",error,"冻结输入和小说资料保留，请先读取本次运行结果。",id);
    problem.recovery.savedResult="组合版本、冻结输入和小说资料保留；本次回复未确认为可用结果，也没有采用到小说中。请处理提示的问题，返回组合页生成新预览。";
    completion={failure:problem.recovery,modelSnapshot:problem.executionSnapshot??null,errorCategory:problem.category??(problem.recovery.failedStep==="核对冻结请求"?"data_integrity":problem.recovery.failedStep==="核对创作结果"?"structure_parse":"unknown")};
  }
  // A lost persistence receipt is never permission to invoke the provider again.
  try {return await finishDebugRun(claim,completion);}catch(error){throw trialFailure("保存试运行结果",error,"模型调用已经结束，但结果入库未确认。冻结输入与运行标识保留；请点击读取试运行结果核对，禁止直接重发这次模型请求。",id);}
}

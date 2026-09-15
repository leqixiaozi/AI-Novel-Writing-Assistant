import type { TransferOperationDetail } from "../../common/contracts";
import type { RegisteredBackgroundHandlerContext, RegisteredBackgroundHandlerResult, RegisteredBackgroundHandlers } from "../database/outbox";
import { NewDesignError } from "../domain/errors";
import { failTransferOperation, getTransferOperation, startTransferOperation } from "./store";

export interface TransferExecutionContext {
  operation:TransferOperationDetail;
  heartbeat():Promise<void>;
  checkpoint(key:string,data:Record<string,unknown>):Promise<void>;
}

export interface TransferExecutionAdapter {
  execute(context:TransferExecutionContext):Promise<{resultId:string;resultHash:string}>;
}

export function createTransferBackgroundHandlers(adapter?:TransferExecutionAdapter):RegisteredBackgroundHandlers{
  if(!adapter)return{};
  return{"backup.run":async(context)=>runTransfer(context,adapter)};
}

async function runTransfer(context:RegisteredBackgroundHandlerContext,adapter:TransferExecutionAdapter):Promise<RegisteredBackgroundHandlerResult>{
  const operation=await getTransferOperation(context.job.specializedRequestId);
  if(operation.status!=="queued")throw new NewDesignError("传输操作不是可启动的 queued 状态。",409);
  await startTransferOperation(operation.id,"runtime.backup-run");
  try{
    const result=await adapter.execute({
      operation:await getTransferOperation(operation.id),
      heartbeat:async()=>{await context.heartbeat();},
      checkpoint:context.checkpoint,
    });
    const completed=await getTransferOperation(operation.id);
    if(!["ready","imported","restored"].includes(completed.status))throw new NewDesignError("受控传输执行器返回前没有通过发布门禁。",409);
    return{outcome:"applied",specializedResultKind:"transfer_operation",specializedResultId:result.resultId,resultHash:result.resultHash,idempotencyKey:`transfer:${operation.id}:generation:${context.job.executionGeneration}`};
  }catch(error){
    await failTransferOperation(operation.id,{errorCode:"transfer_executor_failed",errorSummary:error instanceof Error?error.message:"受控传输执行器失败。",actor:"runtime.backup-run"}).catch(()=>undefined);
    throw error;
  }
}

import type { RegisteredBackgroundHandlerContext, RegisteredBackgroundHandlerResult, RegisteredBackgroundHandlers } from "../database/outbox";
import { getGraphProjectionBatch, getGraphProjectionState, processGraphProjectionRequest, rebuildGraphProjection, recoverInterruptedGraphRebuild } from "../database/graph";
import { getNewDesignPool } from "../database/runtime";
import { NewDesignError, assertFound } from "../domain/errors";

type RequestRow = { id:string; book_id:string; request_kind:string; status:string };

async function readRequest(id:string,bookId:string):Promise<RequestRow>{
  const pool=await getNewDesignPool();
  return assertFound((await pool.query<RequestRow>("SELECT id,book_id,request_kind,status FROM new_design.graph_projection_requests WHERE id=$1 AND book_id=$2",[id,bookId])).rows[0],"图投影请求与后台作业来源不一致。");
}

async function withHeartbeat<T>(context:RegisteredBackgroundHandlerContext,run:()=>Promise<T>):Promise<T>{
  let heartbeatError:unknown=null;
  const timer=setInterval(()=>{void context.heartbeat().catch(error=>{heartbeatError=error;});},30000);
  timer.unref();
  try{const result=await run();if(heartbeatError)throw heartbeatError;return result;}
  finally{clearInterval(timer);}
}

async function runGraphProjection(context:RegisteredBackgroundHandlerContext):Promise<RegisteredBackgroundHandlerResult>{
  const job=context.job,bookId=job.bookId;
  if(!bookId)throw new NewDesignError("图投影作业缺少书籍来源。",409);
  await context.heartbeat();
  let request=await readRequest(job.specializedRequestId,bookId);
  const pool=await getNewDesignPool();
  const book=(await pool.query<{status:string}>("SELECT status FROM new_design.books WHERE id=$1",[bookId])).rows[0];
  if(book?.status==="archived"&&request.status==="pending"){
    await pool.query("UPDATE new_design.graph_projection_requests SET status='superseded',completed_at=now() WHERE id=$1 AND status='pending'",[request.id]);
    request=await readRequest(request.id,bookId);
  }
  if(request.request_kind==="full_rebuild"&&request.status==="processing"){
    const interrupted=await recoverInterruptedGraphRebuild(bookId);
    request=await readRequest(request.id,bookId);
    if(interrupted>0&&request.status==="failed")await withHeartbeat(context,()=>rebuildGraphProjection(bookId,{
      idempotencyKey:`graph-recover-full:${bookId}:${job.id}:${job.executionGeneration}:${job.attemptCount}`,
      actor:"background-worker",
    }));
  }
  if(request.request_kind!=="full_rebuild"&&["pending","failed","processing"].includes(request.status)){
    let state=await getGraphProjectionState(bookId);
    if(!state.activeGenerationId){
      await recoverInterruptedGraphRebuild(bookId);
      state=await getGraphProjectionState(bookId);
      if(!state.activeGenerationId){
        await withHeartbeat(context,()=>rebuildGraphProjection(bookId,{
          idempotencyKey:`graph-bootstrap:${bookId}:${job.id}:${job.executionGeneration}:${job.attemptCount}`,
          actor:"background-worker",
        }));
      }
    }
    await context.heartbeat();
    await withHeartbeat(context,()=>processGraphProjectionRequest(request.id));
    request=await readRequest(request.id,bookId);
  }
  const idempotencyKey=`graph-projection:${request.id}:generation:${job.executionGeneration}`;
  if(request.status==="superseded")return{outcome:"rejected_stale",resultMetadata:{requestId:request.id,sourceStatus:request.status},idempotencyKey};
  if(request.status==="failed"&&request.request_kind==="full_rebuild")return{outcome:"business_rejected",resultMetadata:{requestId:request.id,sourceStatus:request.status},idempotencyKey};
  if(request.status!=="succeeded")throw new NewDesignError("图投影来源未结束，保留原作业等待核对。",409);
  const batch=await getGraphProjectionBatch(request.id);
  if(!batch||batch.status!=="succeeded"||!batch.checksum)throw new NewDesignError("图投影缺少成功批次校验和，不能确认后台结果。",409);
  return{outcome:"applied",specializedResultKind:"graph_projection_batch",specializedResultId:batch.id,resultHash:batch.checksum,resultMetadata:{requestId:request.id,generationId:batch.generationId},idempotencyKey};
}

export function createGraphProjectionBackgroundHandlers():RegisteredBackgroundHandlers{return{"graph.project":runGraphProjection};}

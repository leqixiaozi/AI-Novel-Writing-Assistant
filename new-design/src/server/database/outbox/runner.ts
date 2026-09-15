import type { BackgroundHandlerKey, BackgroundJob, BackgroundJobLease, BackgroundJobResult } from "../../../common/contracts";
import { acknowledgeBackgroundJobCancellation, claimBackgroundJob, completeBackgroundJob, deadLetterExhaustedBackgroundJobs, failBackgroundJob, getBackgroundJob, heartbeatBackgroundJob, recoverExpiredBackgroundJobs, releaseBackgroundJob, saveBackgroundJobCheckpoint, startBackgroundJob } from "./store";

export interface RegisteredBackgroundHandlerContext {
  job: BackgroundJob;
  heartbeat(): Promise<BackgroundJob>;
  checkpoint(key:string,data:Record<string,unknown>): Promise<void>;
}
export type RegisteredBackgroundHandlerResult =
  | {outcome:"applied";specializedResultKind:string;specializedResultId:string;resultHash:string;resultMetadata?:Record<string,unknown>;idempotencyKey:string}
  | {outcome:Exclude<BackgroundJobResult["outcome"],"applied">;specializedResultKind?:string|null;specializedResultId?:string|null;resultHash?:string|null;resultMetadata?:Record<string,unknown>;idempotencyKey:string};
export type RegisteredBackgroundHandler=(context:RegisteredBackgroundHandlerContext)=>Promise<RegisteredBackgroundHandlerResult>;
export type RegisteredBackgroundHandlers=Partial<Record<BackgroundHandlerKey,RegisteredBackgroundHandler>>;

export class BackgroundJobRunner {
  private accepting=false;
  private loopPromise:Promise<void>|null=null;
  private activeLease:BackgroundJobLease|null=null;

  constructor(private readonly consumerKey:string,private readonly owner:string,private readonly handlers:RegisteredBackgroundHandlers,private readonly pollMs=1000){}

  start():void {
    if(this.accepting)return;
    this.accepting=true;
    this.loopPromise=this.loop();
  }

  async stop(maxWaitMs=30000):Promise<void>{
    this.accepting=false;
    const loop=this.loopPromise;if(!loop)return;
    const completed=await Promise.race([loop.then(()=>true),new Promise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),Math.min(120000,Math.max(1000,maxWaitMs)));timer.unref();})]);
    if(!completed&&this.activeLease){await releaseBackgroundJob({...leaseRef(this.activeLease),reason:"运行器停止等待超时，归还租约并依赖 fencing 拒绝迟到结果。"}).catch(()=>undefined);this.activeLease=null;}
    this.loopPromise=null;
  }

  async runOnce():Promise<boolean>{
    await recoverExpiredBackgroundJobs(100);
    await deadLetterExhaustedBackgroundJobs(100);
    const claimed=await claimBackgroundJob({consumerKey:this.consumerKey,owner:this.owner});
    if(!claimed)return false;
    this.activeLease=claimed;
    try{
      this.activeLease=await startBackgroundJob(leaseRef(claimed));
    }catch(error){
      const latest=await getBackgroundJob(claimed.job.id).catch(()=>null);
      if(latest?.status==="cancel_requested"){
        await acknowledgeBackgroundJobCancellation({...leaseRef(claimed),consumerKey:this.consumerKey,reason:"作业在开始执行前收到取消请求。"});
        this.activeLease=null;
        return true;
      }
      this.activeLease=null;
      throw error;
    }
    const lease=this.activeLease;
    const handler=this.handlers[lease.job.handlerKey];
    if(!handler){
      await failBackgroundJob({...leaseRef(lease),consumerKey:this.consumerKey,failureKind:"technical",errorCode:"handler_not_loaded",errorSummary:`处理器 ${lease.job.handlerKey} 未在当前运行器注册。`,retryable:false});
      this.activeLease=null;
      return true;
    }
    try{
      const output=await handler({
        job:lease.job,
        heartbeat:async()=>{
          const job=await heartbeatBackgroundJob(leaseRef(lease));
          if(job.status==="cancel_requested")throw new BackgroundJobCancellationRequested();
          return job;
        },
        checkpoint:async(key,data)=>{await saveBackgroundJobCheckpoint({...leaseRef(lease),checkpointKey:key,checkpointData:data});},
      });
      await completeBackgroundJob({...leaseRef(lease),consumerKey:this.consumerKey,...output});
    }catch(error){
      const latest=await getBackgroundJob(lease.job.id).catch(()=>null);
      if(error instanceof BackgroundJobCancellationRequested||latest?.status==="cancel_requested"){
        await acknowledgeBackgroundJobCancellation({...leaseRef(lease),consumerKey:this.consumerKey,reason:error instanceof Error?error.message:"作业已收到取消请求。"});
      }else{
        await failBackgroundJob({...leaseRef(lease),consumerKey:this.consumerKey,failureKind:"technical",errorCode:"handler_failed",errorSummary:error instanceof Error?error.message:"后台处理器执行失败。",retryable:true});
      }
    }finally{
      this.activeLease=null;
    }
    return true;
  }

  private async loop():Promise<void>{
    while(this.accepting){
      const handled=await this.runOnce().catch(()=>false);
      if(!handled&&this.accepting)await new Promise<void>(resolve=>setTimeout(resolve,Math.min(30000,Math.max(100,this.pollMs))));
    }
    if(this.activeLease){
      await releaseBackgroundJob({...leaseRef(this.activeLease),reason:"运行器正在优雅停止，归还尚未执行的租约。"}).catch(()=>undefined);
      this.activeLease=null;
    }
  }
}

export class BackgroundJobCancellationRequested extends Error {
  constructor(){super("作业已收到取消请求。");this.name="BackgroundJobCancellationRequested";}
}

function leaseRef(lease:BackgroundJobLease):{jobId:string;attemptId:string;fencingToken:number;leaseToken:string}{return{jobId:lease.job.id,attemptId:lease.attempt.id,fencingToken:lease.attempt.fencingToken,leaseToken:lease.leaseToken};}

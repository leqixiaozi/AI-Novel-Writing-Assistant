import type {PoolClient} from "pg";
import {getCreationPool as getNewDesignPool} from "../bookCreationStore";
import {NewDesignError} from "../../domain/errors";
import type {CreationPreparationFailure} from "../../../common/creationReviewAi";
export class CreationPreparationError extends NewDesignError {
 readonly recovery:CreationPreparationFailure["recovery"]&{failedStep:string;summary:string};
 constructor(readonly failure:CreationPreparationFailure,status=503){super(failure.message,status,failure.issues);this.recovery={...failure.recovery,failedStep:failure.failedStep,summary:failure.message};}
}
export function preparationFailure(sessionId:string,batchId:string|null,failedStep:string,message:string,mutationOutcome:CreationPreparationFailure["mutationOutcome"],modelRequestState:CreationPreparationFailure["modelRequestState"]):CreationPreparationFailure {
 return {failedStep,message,mutationOutcome,modelRequestState,recovery:{source:{kind:"book_creation",sessionId,batchId,route:`/new-design/books/new?session=${encodeURIComponent(sessionId)}`,label:"返回本次开书"},mutationOutcome,savedResult:modelRequestState==="not_sent"?"尚未发送模型请求；已经保存的开书表单和候选保留。":modelRequestState==="completed"?"模型已返回；不要重新发送。先核对本批结果是否保存，已有表单保留。":"模型请求和用量尚未确认；原冻结来源和已有表单保留，不自动重发。",nextAction:mutationOutcome==="not_written"&&modelRequestState==="not_sent"?"检查模型设置或运行维护后，在开书来源页明确重新准备。":"在开书来源页读取原请求；有保存结果则采用旧结果，过期未知运行可明确结束。"}};
}
// Preparation/control and candidate adoption have separate rollback semantics. Model/output saving has no such proof.
export async function directorTransaction<T>(sessionId:string,action:(db:PoolClient)=>Promise<T>,preparationOnly=false,requestKey?:string,adoptionOnly=false):Promise<T>{
 const db=await(await getNewDesignPool()).connect();let commitStarted=false;
 try{await db.query("BEGIN");if(requestKey)await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_write:${sessionId}:${requestKey}`]);await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_session:${sessionId}`]);const result=await action(db);commitStarted=true;await db.query("COMMIT");return result;}
 catch(error){let rollbackAcknowledged=false;try{await db.query("ROLLBACK");rollbackAcknowledged=true;}catch{/* No acknowledged rollback is not proof of no write. */}
  if(adoptionOnly){
   const outcome=!commitStarted&&rollbackAcknowledged?"not_written":"unknown",message=outcome==="not_written"?(error instanceof NewDesignError?error.message:"本次勾选候选尚未填入表单，采用事务已经确认回滚。请保留原模型结果，修复服务后明确再次采用旧结果。"):"本次候选采用的提交回执尚未确认，请核对原采用请求，暂不要重复采用。";
   const failure=preparationFailure(sessionId,null,"采用勾选候选到开书表单",message,outcome,"completed");failure.recovery.savedResult="原模型输出与累计候选已经保存，未重新调用模型；已有人工表单和字段来源保留。";failure.recovery.nextAction=outcome==="not_written"?"修正勾选或服务问题后，在同批候选继续采用旧结果，不重新生成。":"只读核对原采用请求；有成功回执则读取同一表单，不再次采用。";
   if(error instanceof NewDesignError&&error.issues)failure.issues=error.issues;
   throw new CreationPreparationError(failure,error instanceof NewDesignError?error.status:503);
  }
  if(!preparationOnly)throw error;
  if(!commitStarted&&rollbackAcknowledged){if(error instanceof NewDesignError)throw error;throw new CreationPreparationError(preparationFailure(sessionId,null,"准备开书请求","本次准备未写入，模型请求尚未发送。请检查运行维护后返回开书来源页重新准备。","not_written","not_sent"));}
  throw new CreationPreparationError(preparationFailure(sessionId,null,"核对开书准备回执","准备事务的提交结果尚未确认，请读取原请求回执，暂不要重复准备。","unknown","not_sent"));
 }finally{db.release();}
}

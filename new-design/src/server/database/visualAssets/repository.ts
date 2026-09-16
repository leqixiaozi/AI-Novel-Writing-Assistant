import {AsyncLocalStorage} from "node:async_hooks";
import type {Pool,PoolClient} from "pg";
import {getNewDesignPool} from "../runtime";
import {NewDesignError} from "../../domain/errors";
import {visualRoute} from "../../../common/visualAssets";
import type {AiRuntimeRecovery} from '../../../common/aiRuntime';
const context=new AsyncLocalStorage<Pool>();
export const visualPool=async()=>context.getStore()??await getNewDesignPool();
export function withVisualAssetsPool<T>(value:Pool,work:()=>Promise<T>){return context.run(value,work);}
export class VisualSourceError extends NewDesignError{readonly recovery:AiRuntimeRecovery & {requestKey:string|null};constructor(message:string,status:number,bookId:string,requestKey:string|null,outcome:"not_written"|"unknown",step:string,issues?:Record<string,string>){super(message,status,issues);this.recovery={failedStep:step,summary:message,savedResult:"原图片、不可变版本、原引用与当前人工说明保留；按原凭证核对，不重复生成或保存。",sourceRoute:visualRoute(bookId),actionLabel:"返回本书视觉资产",mutationOutcome:outcome,requestKey};}}
export async function visualTransaction<T>(bookId:string,requestKey:string,step:string,work:(client:PoolClient)=>Promise<T>):Promise<T>{let client:PoolClient;try{client=await(await visualPool()).connect();}catch{throw new VisualSourceError("数据库连接尚未建立，图片操作未提交。",503,bookId,requestKey,"not_written",step);}let commitStarted=false;try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`visual:${bookId}:${requestKey}`]);const result=await work(client);commitStarted=true;await client.query("COMMIT");return result;}catch(error){let rollbackAck=false;try{await client.query("ROLLBACK");rollbackAck=true;}catch{/* Missing ACK is unknown. */}throw new VisualSourceError(error instanceof NewDesignError?error.message:!commitStarted&&rollbackAck?"本次图片数据库操作已确认回滚；受控文件与原版本保留。":"图片保存或引用回执未确认；保留原凭证先核对，不新建请求。",error instanceof NewDesignError?error.status:503,bookId,requestKey,!commitStarted&&rollbackAck?"not_written":"unknown",step,error instanceof NewDesignError?error.issues:undefined);}finally{client.release();}}

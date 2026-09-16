import {AsyncLocalStorage} from "node:async_hooks";
import type {Pool,PoolClient} from "pg";
import {getNewDesignPool} from "../runtime";
import {NewDesignError} from "../../domain/errors";
import type {BookCreationProductionReceipt} from "../../../common/bookCreationProduction";

const poolScope=new AsyncLocalStorage<Pool>();
export async function getCreationPool():Promise<Pool>{return poolScope.getStore()??getNewDesignPool();}
/** Infrastructure only; HTTP cannot select a connection or schema. */
export function withBookCreationProductionPool<T>(pool:Pool,action:()=>Promise<T>):Promise<T>{return poolScope.run(pool,action);}
export async function lockCreationSession(client:PoolClient,id:string){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_session:${id}`]);const row=(await client.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!row)throw new NewDesignError("开书流程不存在。",404);return row;}
export async function lockCreationRequest(client:PoolClient,id:string,key:string):Promise<void>{if(!key||key.length<8||key.length>160)throw new NewDesignError("请保留有效的原保存请求标识。",422);await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_write:${id}:${key}`]);}
export async function priorCreationReceipt<T=BookCreationProductionReceipt>(client:PoolClient,id:string,key:string):Promise<{inputHash:string;receipt:T}|null>{const row=(await client.query("SELECT entry FROM new_design.book_creation_sessions session CROSS JOIN LATERAL jsonb_array_elements(session.production_receipts) entry WHERE session.id=$1 AND entry->'receipt'->>'requestKey'=$2",[id,key])).rows[0];return row?row.entry as {inputHash:string;receipt:T}:null;}
export async function appendCreationReceipt(client:PoolClient,id:string,inputHash:string,receipt:{requestKey:string}):Promise<void>{await client.query("UPDATE new_design.book_creation_sessions SET production_receipts=production_receipts||$2::jsonb WHERE id=$1",[id,JSON.stringify([{inputHash,receipt}])]);}
export class BookCreationProductionError extends NewDesignError{
 readonly recovery:{failedStep:string;summary:string;savedResult:string;actionLabel:string;sourceRoute:string;mutationOutcome:"not_written"|"unknown"};
 constructor(sessionId:string|null,message:string,status=503,outcome:"not_written"|"unknown"="unknown",issues?:Record<string,string>,step="核对开书写入结果"){
  super(message,status,issues);this.recovery={failedStep:step,summary:message,savedResult:outcome==="not_written"?"本次操作已确认回滚；已保存的开书资料、关系和规划草稿保留。":"开书结果尚未确认；原资料、草稿与请求标识保留，请先只读核对。",actionLabel:"返回开书准备",sourceRoute:sessionId?`/new-design/books/new?session=${sessionId}`:"/new-design/books/new",mutationOutcome:outcome};
 }
}
export function reportCreationFailure(id:string,error:unknown,rollback:boolean,committing:boolean,step="核对开书写入结果"):never{
 if(rollback&&!committing)throw new BookCreationProductionError(id,error instanceof NewDesignError?error.message:"开书保存未完成，已确认回滚；请保留输入，修复服务后明确重新准备。",error instanceof NewDesignError?error.status:503,"not_written",error instanceof NewDesignError?error.issues:undefined,step);
 throw new BookCreationProductionError(id,"服务未确认开书结果，请按原请求核对回执，不能重复创建书籍。",503,"unknown",undefined,`核对结果：${step}`);
}

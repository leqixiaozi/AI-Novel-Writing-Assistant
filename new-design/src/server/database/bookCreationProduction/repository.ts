import {AsyncLocalStorage} from "node:async_hooks";
import type {Pool,PoolClient} from "pg";
import {getNewDesignPool} from "../runtime";
import {NewDesignError} from "../../domain/errors";
import type {BookCreationProductionReceipt} from "../../../common/bookCreationProduction";
import {createRecordCard,findRecordCard,replaceRecordCard,type RecordCardRow} from '../recordCards';
import {randomUUID} from 'node:crypto';

const poolScope=new AsyncLocalStorage<Pool>();
export async function getCreationPool():Promise<Pool>{return poolScope.getStore()??getNewDesignPool();}
/** Infrastructure only; HTTP cannot select a connection or schema. */
export function withBookCreationProductionPool<T>(pool:Pool,action:()=>Promise<T>):Promise<T>{return poolScope.run(pool,action);}
export async function lockCreationSession(client:PoolClient,id:string){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_session:${id}`]);const row=await findRecordCard(client,id,'book_creation_session',{lock:true});if(!row)throw new NewDesignError("开书流程不存在。",404);return row;}
export async function lockCreationRequest(client:PoolClient,id:string,key:string):Promise<void>{if(!key||key.length<8||key.length>160)throw new NewDesignError("请保留有效的原保存请求标识。",422);await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_write:${id}:${key}`]);}
export async function priorCreationReceipt<T=BookCreationProductionReceipt>(client:PoolClient,id:string,key:string):Promise<{inputHash:string;receipt:T}|null>{const row=await findRecordCard(client,id,'book_creation_session');return (row?.production_receipts??[]).find((entry:any)=>entry.receipt?.requestKey===key)??null;}
export async function appendCreationReceipt(client:PoolClient,id:string,inputHash:string,receipt:{requestKey:string}):Promise<void>{const row=await lockCreationSession(client,id);await replaceRecordCard(client,{id,spaceId:row.recordSpaceId,typeKey:'book_creation_session',values:{...row,production_receipts:[...(row.production_receipts??[]),{inputHash,receipt}]}});}
export async function updateCreationSession(client:PoolClient,row:RecordCardRow,patch:Record<string,unknown>):Promise<RecordCardRow>{return replaceRecordCard(client,{id:row.id,spaceId:row.recordSpaceId,typeKey:'book_creation_session',values:{...row,...patch,revision:row.revision+1,updated_at:new Date().toISOString()}});}
export async function createGenerationBatch(client:PoolClient,spaceId:string,values:Record<string,unknown>):Promise<RecordCardRow>{const id=String(values.id??randomUUID()),now=new Date().toISOString();return createRecordCard(client,{id,spaceId,typeKey:'ai_generation_batch',title:String(values.operation??'AI 创作请求'),values:{id,session_id:null,book_id:null,card_id:null,form_key:null,progress:0,revision:1,instruction:'',input_payload:{},output_payload:{},base_revision:null,prompt_id:null,prompt_version:null,error_message:null,completed_at:null,created_at:now,updated_at:now,...values}});}
export async function updateGenerationBatch(client:PoolClient,id:string,patch:Record<string,unknown>):Promise<RecordCardRow>{const row=await findRecordCard(client,id,'ai_generation_batch',{lock:true});if(!row)throw new NewDesignError('AI 批次不存在。',404);return replaceRecordCard(client,{id,spaceId:row.recordSpaceId,typeKey:'ai_generation_batch',values:{...row,...patch,updated_at:new Date().toISOString()}});}
export async function creationTransaction<T>(action:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await(await getCreationPool()).connect();try{await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
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

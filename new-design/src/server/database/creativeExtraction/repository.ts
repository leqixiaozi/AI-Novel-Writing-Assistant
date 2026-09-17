import {AsyncLocalStorage} from 'node:async_hooks';
import type {Pool,PoolClient} from 'pg';
import {getNewDesignPool} from '../runtime';
import {NewDesignError} from '../../domain/errors';
import {CREATIVE_EXTRACTION_ROUTE} from '../../../common/creativeExtraction';
import type {AiRuntimeRecovery} from '../../../common/aiRuntime';
const scope=new AsyncLocalStorage<Pool>();
export const creativePool=async()=>scope.getStore()??await getNewDesignPool();
export function withCreativeExtractionPool<T>(pool:Pool,work:()=>Promise<T>){return scope.run(pool,work);}
export class CreativeExtractionError extends NewDesignError {
 readonly recovery:AiRuntimeRecovery;
 constructor(message:string,status:number,step:string,outcome:'not_written'|'unknown',bookId?:string,issues?:Record<string,string>){super(message,status,issues);this.recovery={failedStep:step,summary:message,savedResult:outcome==='not_written'?'本次数据库写入确认未完成；原参考、人工填写、资源历史、书名及正文保留。':'本次结果尚未核对；原输入、请求凭证与已保存候选保留，不重复调用模型或采用。',sourceRoute:bookId?`${CREATIVE_EXTRACTION_ROUTE}?bookId=${bookId}`:'/new-design/structure/maintenance',actionLabel:bookId?'返回创作提炼':'打开运行维护',mutationOutcome:outcome};}
}
export async function creativeTransaction<T>(step:string,bookScope:string|undefined|(()=>string|undefined),work:(client:PoolClient,priorConflict:()=>void)=>Promise<T>):Promise<T>{
 const bookId=()=>typeof bookScope==='function'?bookScope():bookScope;
 let client:PoolClient;try{client=await(await creativePool()).connect();}catch{throw new CreativeExtractionError('数据库连接未建立，输入保留，请检查运行维护。',503,step,'not_written',bookId());}
 let committing=false,priorMismatch=false;
 try{await client.query('BEGIN');const result=await work(client,()=>{priorMismatch=true;});committing=true;await client.query('COMMIT');return result;}
 catch(error){let rollback=false;try{await client.query('ROLLBACK');rollback=true;}catch{}const proven=!committing&&rollback&&!priorMismatch;throw new CreativeExtractionError(error instanceof NewDesignError?error.message:proven?'本次数据库操作确认回滚；输入保留，检查底座后可明确重新准备。':'保存结果尚未确认，请保留原请求凭证并只读核对。',error instanceof NewDesignError?error.status:503,step,proven?'not_written':'unknown',bookId(),error instanceof NewDesignError?error.issues:undefined);}
 finally{client.release();}
}
export async function creativeLock(client:PoolClient,key:string){await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`creative-extraction:${key}`]);}

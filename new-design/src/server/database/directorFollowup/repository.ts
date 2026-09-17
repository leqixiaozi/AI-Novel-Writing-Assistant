import {AsyncLocalStorage} from 'node:async_hooks';
import type {Pool,PoolClient} from 'pg';
import {getNewDesignPool} from '../runtime';
import {withAuthorTasksPool} from '../authorTasks';
import {NewDesignError} from '../../domain/errors';
import type {AiRuntimeRecovery} from '../../../common/aiRuntime';
import {DIRECTOR_FOLLOWUP_ROUTE} from '../../../common/directorFollowup';
const scope=new AsyncLocalStorage<Pool>();
export function withDirectorFollowupPool<T>(pool:Pool,work:()=>Promise<T>){return scope.run(pool,work);}
export class DirectorFollowupReadError extends NewDesignError {readonly recovery:AiRuntimeRecovery;constructor(step:string,message:string,status=503,issues?:Record<string,string>){super(message,status,issues);this.recovery={failedStep:step,summary:message,savedResult:'原书籍、任务、候选、问题及原回执保留；本次只读查询没有执行恢复或模型调用。',sourceRoute:DIRECTOR_FOLLOWUP_ROUTE,actionLabel:'返回导演总控台'};}}
export async function readDirectorFollowup<T>(step:string,work:(client:PoolClient,readOriginal:<R>(action:()=>Promise<R>)=>Promise<R>)=>Promise<T>):Promise<T>{
 let client:PoolClient,pool:Pool;try{pool=scope.getStore()??await getNewDesignPool();client=await pool.connect();}catch{throw new DirectorFollowupReadError(step,'总控台只读连接尚未读取；原结果保留，请刷新本页核对。');}
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const scopedPool=new Proxy(pool,{get(target,property,receiver){if(property==='query')return client.query.bind(client);return Reflect.get(target,property,receiver);}});const result=await work(client,action=>withAuthorTasksPool(scopedPool,action));await client.query('COMMIT');return result;}catch(error){try{await client.query('ROLLBACK');}catch{}throw new DirectorFollowupReadError(step,error instanceof NewDesignError?error.message:'只读汇总或详情尚未完整读取，旧视图及来源结果保留；可刷新核对，不重发任务。',error instanceof NewDesignError?error.status:503,error instanceof NewDesignError?error.issues:undefined);}finally{client.release();}
}

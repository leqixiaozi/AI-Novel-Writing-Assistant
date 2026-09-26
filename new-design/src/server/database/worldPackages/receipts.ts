import type {PoolClient} from 'pg';
import {getNewDesignPool} from '../runtime';
import {formHash} from '../formAssist';
import {NewDesignError} from '../../domain/errors';
import {findRecordCardByValue} from '../recordCards';

export class WorldPackageWriteError extends NewDesignError {constructor(message:string,status:number,public readonly mutationOutcome:'not_written'|'unknown',issues?:Record<string,string>){super(message,status,issues);}}
export async function worldOriginal<T>(db:PoolClient,scope:string,input:unknown):Promise<T|null>{
 const raw=input as {requestKey?:string;input?:{requestKey:string}},requestKey=raw.requestKey??raw.input?.requestKey;
 const rows=scope==='public'?[await findRecordCardByValue(db,'world_package_snapshot','request_key',String(requestKey))].filter(Boolean):scope==='catalog'?[await findRecordCardByValue(db,'world_package_catalog_action','request_key',String(requestKey))].filter(Boolean):(await Promise.all(['world_package_installation','world_package_sync_command','world_library_command'].map(type=>findRecordCardByValue(db,type,'request_key',String(requestKey))))).filter(row=>row&&row.book_id===scope&&(row.origin===undefined||row.origin==='import'));
 if(rows.length>1)throw new WorldPackageWriteError('原键存在多个世界凭证，请保留完整输入核对，未选择或覆盖旧结果。',503,'unknown');const result=rows[0];
 if(!result)return null;
 if(result.input_hash!==formHash({scope,input}))throw new WorldPackageWriteError('原键对应的完整世界请求不同，保留原结果并只读核对。',409,'unknown');
 return{...result.receipt,repeated:true} as T;
}
export async function readWorldOriginal<T>(scope:string,input:unknown):Promise<T|null>{const db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN READ ONLY');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[worldLock(scope,input)]);const result=await worldOriginal<T>(db,scope,input);await db.query('COMMIT');return result;}catch(error){try{await db.query('ROLLBACK');}catch{}if(error instanceof WorldPackageWriteError)throw error;throw new WorldPackageWriteError('原世界结果尚未核对完整，请保留完整原请求。',503,'unknown');}finally{db.release();}}
function worldLock(scope:string,input:unknown){const raw=input as {requestKey?:string;input?:{requestKey:string}};return`world-package:${scope}:${raw.requestKey??raw.input?.requestKey}`;}
export async function writeWorldOriginal<T>(scope:string,input:unknown,operation:(db:PoolClient)=>Promise<T>):Promise<T>{
 const db=await(await getNewDesignPool()).connect().catch(()=>{throw new WorldPackageWriteError('世界保存连接未建立，尚未提交；完整填写保留。',503,'not_written');});let committing=false,originalChecked=false;
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[worldLock(scope,input)]);await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const saved=await worldOriginal<T>(db,scope,input);originalChecked=true;if(saved){await db.query('ROLLBACK');return saved;}
  const result=await operation(db);committing=true;await db.query('COMMIT');return result;
 }catch(error){let rollback=false;try{await db.query('ROLLBACK');rollback=true;}catch{}if(error instanceof WorldPackageWriteError&&error.mutationOutcome==='unknown')throw error;const problem=new WorldPackageWriteError(error instanceof NewDesignError?error.message:'世界请求结果未确认，请保留完整原键只读核对。',error instanceof NewDesignError?error.status:503,originalChecked&&!committing&&rollback?'not_written':'unknown',error instanceof NewDesignError?error.issues:undefined);problem.cause=error;throw problem;}
 finally{let discarded=false;try{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[worldLock(scope,input)]);}catch{db.release(true);discarded=true;}if(!discarded)db.release();}
}

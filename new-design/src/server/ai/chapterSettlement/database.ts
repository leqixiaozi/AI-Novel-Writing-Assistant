import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool,PoolClient } from "pg";
import { getNewDesignPool } from "../../database/runtime";
import { withSettlementDatabasePool } from "../../database/chapterSettlement";
import { NewDesignError } from "../../domain/errors";
import { ChapterSettlementAiError } from "./errors";
const databaseScope=new AsyncLocalStorage<Pool>();
export async function withChapterSettlementAiDatabasePool<T>(pool:Pool,run:()=>Promise<T>):Promise<T>{return databaseScope.run(pool,()=>withSettlementDatabasePool(pool,run));}
export async function database<T>(run:(client:PoolClient)=>Promise<T>):Promise<T>{
  return transaction(run,false);
}
/** Pure database preparation only: no model invocation or external result has occurred here. */
export async function preparationDatabase<T>(run:(client:PoolClient)=>Promise<T>):Promise<T>{
  return transaction(run,true);
}
async function transaction<T>(run:(client:PoolClient)=>Promise<T>,preparationOnly:boolean):Promise<T>{
  const client=await(databaseScope.getStore()??await getNewDesignPool()).connect();
  let committing=false;
  try{await client.query("BEGIN");const result=await run(client);committing=true;await client.query("COMMIT");return result;}
  catch(error){
    let rolledBack=false;
    try{await client.query("ROLLBACK");rolledBack=true;}catch(rollbackError){if(!preparationOnly)throw rollbackError;}
    if(!preparationOnly)throw error;
    if(!committing&&rolledBack){
      if(error instanceof NewDesignError)throw error;
      const safe=new ChapterSettlementAiError("保存本章提取准备","提取准备未能保存，事务已回滚，模型尚未发送。恢复服务后可重新准备；正文和人工清单保留。",503,"not_written","not_sent");
      safe.recovery.sourceRoute="/new-design/structure/maintenance";safe.recovery.actionLabel="打开运行维护";
      throw safe;
    }
    throw new ChapterSettlementAiError("核对提取准备保存回执","提取准备保存回执未确认，请只读核对原请求，不能重复准备；本次尚未调用模型。",503,"unknown","not_sent");
  }finally{client.release();}
}
export async function lock(client:PoolClient,key:string):Promise<void>{await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter-settlement-ai:${key}`]);}
export async function lockBook(client:PoolClient,bookId:string):Promise<void>{await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter_settlement_editing_book:${bookId}`]);}

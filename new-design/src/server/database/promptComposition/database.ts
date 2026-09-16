import type { PoolClient } from "pg";
import { getNewDesignPool } from "../runtime";
import { NewDesignError } from "../../domain/errors";
export interface CompositionDatabaseContext { client?:PoolClient; schema?:string }
export async function database<T>(context:CompositionDatabaseContext|undefined,work:(client:PoolClient)=>Promise<T>,transaction=false):Promise<T> {
  if(context?.schema&&(!context.client||!/^model_route_test_[a-z0-9_]+$/.test(context.schema)))throw new NewDesignError("提示词组合隔离范围无效。",422);
  if(context?.client){const schema=context.schema;const client=schema?new Proxy(context.client,{get(target,key){if(key==="query")return(sql:string,params?:unknown[])=>target.query(sql.replaceAll("new_design.",`${schema}.`),params);const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}}):context.client;return work(client);}
  const client=await(await getNewDesignPool()).connect();
  try{if(transaction)await client.query("BEGIN");const result=await work(client);if(transaction)await client.query("COMMIT");return result;}
  catch(error){if(transaction)await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
export async function lock(client:PoolClient,key:string):Promise<void>{await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`prompt-composition:${key}`]);}

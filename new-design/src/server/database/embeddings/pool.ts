import {AsyncLocalStorage} from "node:async_hooks";
import type {Pool} from "pg";
import {getNewDesignPool} from "../runtime";
const scope=new AsyncLocalStorage<Pool>();
export function withEmbeddingPool<T>(pool:Pool,action:()=>Promise<T>):Promise<T>{return scope.run(pool,action);}
export async function embeddingPool():Promise<Pool>{return scope.getStore()??getNewDesignPool();}

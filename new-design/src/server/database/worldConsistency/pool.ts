import {AsyncLocalStorage} from 'node:async_hooks';
import type {Pool} from 'pg';
import {getNewDesignPool} from '../runtime';
const poolContext=new AsyncLocalStorage<Pool>();
/** Infrastructure scope only. HTTP cannot select a pool or bypass any domain guard. */
export function withWorldConsistencyPool<T>(pool:Pool,work:()=>Promise<T>):Promise<T>{return poolContext.run(pool,work);}
export async function getWorldConsistencyPool():Promise<Pool>{return poolContext.getStore()??await getNewDesignPool();}

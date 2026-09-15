import { randomUUID } from "node:crypto";
import type { BackgroundHandlerKey } from "../../common/contracts";
import { BackgroundJobRunner, type RegisteredBackgroundHandlers } from "../database/outbox";
import { getNewDesignPool, stopNewDesignDatabase } from "../database/runtime";
import { NewDesignError } from "../domain/errors";
import { getPrivateRuntimeManager } from "./manager";

export interface PrivateRuntimeServices {
  readonly consumerKeys:string[];
  stop():Promise<void>;
}

export async function startNewDesignRuntimeServices(handlers:RegisteredBackgroundHandlers):Promise<PrivateRuntimeServices>{
  const loaded=(Object.keys(handlers) as BackgroundHandlerKey[]).filter(key=>Boolean(handlers[key]));
  if(!loaded.length)throw new NewDesignError("没有注册 030 后台处理器，拒绝把完整运行时标记为 ready。",503);
  await getNewDesignPool();
  const manager=getPrivateRuntimeManager(),owner=`desktop-${process.pid}-${randomUUID()}`,runners=loaded.map(key=>new BackgroundJobRunner(consumerKey(key),owner,handlers));
  await manager.setWorkerRuntime("starting");
  try{for(const runner of runners)runner.start();await manager.setWorkerRuntime("ready");}
  catch(error){await manager.setWorkerRuntime("failed").catch(()=>undefined);throw error;}
  let stopped=false;
  return{consumerKeys:loaded.map(consumerKey),stop:async()=>{if(stopped)return;stopped=true;await manager.setWorkerRuntime("draining").catch(()=>undefined);await Promise.allSettled(runners.map(runner=>runner.stop()));await stopNewDesignDatabase();}};
}

function consumerKey(handler:BackgroundHandlerKey):string{return`runtime.${handler.replaceAll(".","-")}`;}

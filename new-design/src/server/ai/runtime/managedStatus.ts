import type {IndependentModelStatus} from "../../../common/aiRuntime";
import {resolveManagedTaskRoute} from "../../database/modelManagement";
import {listPromptAssets} from "../prompts";
import {NewDesignError} from "../../domain/errors";
import {configurationForConnection} from "./managedExecution";
import {AiExecutionError} from "./errors";

// Configuration availability is not a successful network/model probe.
export async function getIndependentTaskAvailability(task:import("../../../common/modelRouting").ModelTaskKey):Promise<{configured:boolean;message:string}>{
  try{const route=await resolveManagedTaskRoute(task);await configurationForConnection(route.primary,route.policy);return {configured:true,message:'本任务模型路由已配置，生成仍需明确提交；结果只保存为候选。'};}
  catch(error){return {configured:false,message:error instanceof NewDesignError?error.message:'模型配置暂未读取，请打开模型设置核对；人工写稿仍可继续。'};}
}
export async function getIndependentModelStatus():Promise<IndependentModelStatus> {
  const tasks=listPromptAssets().map(({taskType,label,assetId,version})=>({taskType,label,assetId,version}));
  try {
    const route=await resolveManagedTaskRoute("directions");
    const config=await configurationForConnection(route.primary,route.policy);
    return {configured:true,provider:config.provider,model:config.model,endpoint:config.endpoint,hasCredential:Boolean(config.apiKey),timeoutMs:config.timeoutMs,maxTokens:config.maxTokens,recovery:null,tasks};
  }catch(error){
    const failure=error instanceof AiExecutionError?error:new AiExecutionError("读取任务模型路由",error instanceof NewDesignError?error.message:"模型配置暂未读取，请打开模型设置核对后重试。",error instanceof NewDesignError?error.status:503);
    return {configured:false,provider:"ollama",model:"",endpoint:"",hasCredential:false,timeoutMs:120000,maxTokens:8192,recovery:failure.recovery,tasks};
  }
}

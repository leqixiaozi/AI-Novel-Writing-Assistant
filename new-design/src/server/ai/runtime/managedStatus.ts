import type {IndependentModelStatus} from "../../../common/aiRuntime";
import {resolveManagedTaskRoute} from "../../database/modelManagement";
import {listPromptAssets,type PromptTaskType} from "../prompts";
import {configurationForConnection} from "./managedExecution";
import {AiExecutionError} from "./errors";

// Configuration availability is not a successful network/model probe.
export async function getIndependentTaskAvailability(task:PromptTaskType):Promise<{configured:boolean;message:string}>{
  try{const route=await resolveManagedTaskRoute(task);await configurationForConnection(route.primary,route.policy);return {configured:true,message:'本任务模型路由已配置，生成仍需明确提交；结果只保存为候选。'};}
  catch{return {configured:false,message:'本任务模型路由或凭据未配置，请在模型设置保存并启用；人工写稿仍可继续。'};}
}
export async function getIndependentModelStatus():Promise<IndependentModelStatus> {
  const tasks=listPromptAssets().map(({taskType,label,assetId,version})=>({taskType,label,assetId,version}));
  try {
    const route=await resolveManagedTaskRoute("directions");
    const config=await configurationForConnection(route.primary,route.policy);
    return {configured:true,provider:config.provider,model:config.model,endpoint:config.endpoint,hasCredential:Boolean(config.apiKey),timeoutMs:config.timeoutMs,maxTokens:config.maxTokens,recovery:null,tasks};
  }catch(error){
    const failure=error instanceof AiExecutionError?error:new AiExecutionError("读取任务模型路由","尚无可用的已生效模型设置。请打开模型设置，填写默认模型并点击“保存并启用”。",422);
    return {configured:false,provider:"ollama",model:"",endpoint:"",hasCredential:false,timeoutMs:120000,maxTokens:8192,recovery:failure.recovery,tasks};
  }
}

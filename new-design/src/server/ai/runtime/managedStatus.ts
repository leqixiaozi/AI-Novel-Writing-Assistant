import type {IndependentModelStatus} from "../../../common/aiRuntime";
import {resolveManagedTaskRoute} from "../../database/modelManagement";
import {listPromptAssets} from "../prompts";
import {configurationForConnection} from "./managedExecution";
import {AiExecutionError} from "./errors";

// Configuration availability is not a successful network/model probe.
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

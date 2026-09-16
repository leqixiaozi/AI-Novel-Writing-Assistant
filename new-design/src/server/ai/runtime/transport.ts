import type { PreparedPrompt } from "../prompts";
import type { ModelConfiguration } from "./configuration";
import { AiExecutionError } from "./errors";

function destination(config:ModelConfiguration,suffix:string):string {return `${config.endpoint}${suffix}`;}
async function receive(config:ModelConfiguration,url:string,init:RequestInit,step:string,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),config.timeoutMs);
  try {
    const response=await fetcher(url,{...init,signal:controller.signal,redirect:"error",headers:{"Content-Type":"application/json",...(config.apiKey?{Authorization:`Bearer ${config.apiKey}`}:{})}});
    if(!response.ok){const message=response.status===401||response.status===403?"模型服务拒绝凭据，请打开模型设置检查授权。":response.status===429?"模型服务调用额度或频率受限，请稍后在来源页重试。":response.status===413?"模型服务拒绝过长输入，请检查任务资料范围。":"模型服务未完成请求，请检查模型服务连接和模型名称。";const category=response.status===401||response.status===403?"authentication":response.status===429?"rate_limit":response.status===413?"context_limit":response.status>=500||response.status===404?"provider_unavailable":null;throw new AiExecutionError(step,message,502,category);}
    const value:unknown=await response.json();
    if(value===null||typeof value!=="object"||Array.isArray(value))throw new AiExecutionError(step,"模型服务回执格式无效，请检查接口兼容性。");
    return value as Record<string,unknown>;
  }catch(error){if(error instanceof AiExecutionError)throw error;throw new AiExecutionError(step,controller.signal.aborted?"等待模型回复超时。模型服务可能仍在处理，请回来源页核对状态后再重试。":"无法取得模型服务回执，请打开模型设置检查连接。已发送请求可能仍在处理。",502,controller.signal.aborted?"timeout":"transport");}
  finally {clearTimeout(timer);}
}

export async function probeModelConnection(config:ModelConfiguration,fetcher:typeof fetch=fetch,allowEmptyModel=false):Promise<{available:boolean;modelFound:boolean;models:string[]}> {
  const data=await receive(config,destination(config,config.provider==="ollama"?"/api/tags":"/models"),{method:"GET"},"检查模型连接",fetcher);
  const items=config.provider==="ollama"?data.models:data.data;
  if(!Array.isArray(items))throw new AiExecutionError("读取模型列表","模型服务未返回有效的模型列表，请检查接口地址。");
  const models=items.flatMap(item=>{if(item===null||typeof item!=="object")return [];const value=config.provider==="ollama"?(item as Record<string,unknown>).name:(item as Record<string,unknown>).id;return typeof value==="string"?[value]:[];});
  const modelFound=models.includes(config.model);
  if(!modelFound&&!(allowEmptyModel&&!config.model))throw new AiExecutionError("核对创作模型","连接成功，但配置的模型不在服务返回列表中。请检查模型名称或在模型服务中准备该模型。",422);
  return {available:true,modelFound,models};
}

export async function invokeStructuredModel(config:ModelConfiguration,prompt:PreparedPrompt,fetcher:typeof fetch=fetch):Promise<{value:unknown;usedTokens:number;usageReported:boolean}> {
  const maxTokens=Math.min(config.maxTokens,prompt.maxTokens);
  const payload=config.provider==="ollama"?{model:config.model,messages:prompt.messages,stream:false,format:prompt.outputSchema,options:{temperature:prompt.temperature,num_predict:maxTokens}}:{model:config.model,messages:prompt.messages,stream:false,temperature:prompt.temperature,max_tokens:maxTokens,response_format:{type:"json_schema",json_schema:{name:prompt.taskType,strict:false,schema:prompt.outputSchema}}};
  const data=await receive(config,destination(config,config.provider==="ollama"?"/api/chat":"/chat/completions"),{method:"POST",body:JSON.stringify(payload)},"生成创作候选",fetcher);
  const message=config.provider==="ollama"?data.message:Array.isArray(data.choices)?(data.choices[0] as {message?:unknown}|undefined)?.message:undefined;
  const content=message&&typeof message==="object"?(message as Record<string,unknown>).content:undefined;
  if(typeof content!=="string")throw new AiExecutionError("读取模型输出","模型未返回可核对的创作内容，请检查模型是否支持结构化输出。");
  let value:unknown;
  try {value=JSON.parse(content);}catch{throw new AiExecutionError("解析创作结果","模型回复不是有效的结构化结果。本次回复未采用，请在来源页重新生成或切换支持结构化输出的模型。");}
  const usage=data.usage&&typeof data.usage==="object"?(data.usage as Record<string,unknown>).total_tokens:undefined;
  const ollamaUsage=typeof data.prompt_eval_count==="number"&&typeof data.eval_count==="number"?data.prompt_eval_count+data.eval_count:undefined;
  const tokens=config.provider==="ollama"?ollamaUsage:usage;
  const usageReported=typeof tokens==="number"&&Number.isInteger(tokens)&&tokens>=0;
  return {value,usedTokens:usageReported?tokens as number:0,usageReported};
}

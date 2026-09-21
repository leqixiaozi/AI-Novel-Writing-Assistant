import type { PreparedPrompt } from "../prompts";
import type { ModelConfiguration } from "./configuration";
import { AiExecutionError } from "./errors";

export interface UnifiedModelRequest {model:string;messages:PreparedPrompt["messages"];outputSchema:PreparedPrompt["outputSchema"];taskType:PreparedPrompt["taskType"];temperature:number;maxOutputTokens:number;}
export interface UnifiedModelResponse {content:string|null;inputTokens:number|null;outputTokens:number|null;usedTokens:number;usageReported:boolean;}
export interface UnifiedModelCatalog {models:string[];hasMore:boolean;}

export function createModelRequest(config:Pick<ModelConfiguration,"model"|"maxTokens">,prompt:Pick<PreparedPrompt,"messages"|"outputSchema"|"taskType"|"temperature"|"maxTokens">):UnifiedModelRequest {
  return {model:config.model,messages:prompt.messages,outputSchema:prompt.outputSchema,taskType:prompt.taskType,temperature:prompt.temperature,maxOutputTokens:Math.min(config.maxTokens,prompt.maxTokens)};
}

function anthropicOutputSchema(source:Record<string,unknown>):Record<string,unknown>|null {
  // Claude's grammar supports a JSON Schema subset. Keep the full contract for local validation.
  const convert=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(convert);
    if(!value||typeof value!=="object")return value;
    const input=value as Record<string,unknown>,output:Record<string,unknown>={};
    if(input.additionalProperties!==undefined&&input.additionalProperties!==false||input.oneOf||input.patternProperties||typeof input.$ref==="string"&&!input.$ref.startsWith("#"))throw new Error("unsupported schema shape");
    for(const [key,item] of Object.entries(input)){
      if(["type","description","default","const","enum","required","$ref"].includes(key))output[key]=item;
      else if(["properties","$defs","definitions"].includes(key)&&item&&typeof item==="object"&&!Array.isArray(item))output[key]=Object.fromEntries(Object.entries(item).map(([name,child])=>[name,convert(child)]));
      else if(["items","anyOf","allOf"].includes(key))output[key]=convert(item);
      else if(key==="minItems"&&(item===0||item===1))output[key]=item;
      else if(key==="format"&&["date-time","time","date","duration","email","hostname","uri","ipv4","ipv6","uuid"].includes(String(item)))output[key]=item;
    }
    if(input.type==="object"){
      if(!input.properties)throw new Error("dynamic object schema");
      output.additionalProperties=false;
    }
    return output;
  };
  try{
    const schema=convert(source) as Record<string,unknown>;
    let optional=0,unions=0;
    const count=(value:unknown):void=>{
      if(Array.isArray(value)){value.forEach(count);return;}
      if(!value||typeof value!=="object")return;
      const node=value as Record<string,unknown>;
      if(node.properties&&typeof node.properties==="object"&&!Array.isArray(node.properties))optional+=Object.keys(node.properties).filter(key=>!Array.isArray(node.required)||!node.required.includes(key)).length;
      if(node.anyOf||Array.isArray(node.type))unions++;
      Object.values(node).forEach(count);
    };
    count(schema);
    return optional>24||unions>16?null:schema;
  }catch{return null;}
}

function disablesDeepSeekThinking(endpoint:string,model:string):boolean {
  const hostname=new URL(endpoint).hostname.toLowerCase();
  if(hostname!=="api.deepseek.com"&&hostname!=="deepseek.com")return false;
  const normalized=model.trim().toLowerCase();
  return normalized==="deepseek-reasoner"
    ||normalized.startsWith("deepseek-flash")
    ||normalized.startsWith("deepseek-pro")
    ||normalized.startsWith("deepseek-v4-flash")
    ||normalized.startsWith("deepseek-v4-pro");
}

function protocolRequest(config:ModelConfiguration,request:UnifiedModelRequest):{path:string;body:Record<string,unknown>} {
  const {model,messages,outputSchema,taskType,temperature,maxOutputTokens}=request;
  if(config.provider==="ollama")return {path:"/api/chat",body:{model,messages,stream:false,format:outputSchema,options:{temperature,num_predict:maxOutputTokens}}};
  if(config.provider==="anthropic-compatible"){
    const schema=new URL(config.endpoint).hostname==="api.anthropic.com"?anthropicOutputSchema(outputSchema):null;
    return {path:"/messages",body:{model,system:messages.filter(message=>message.role==="system").map(message=>message.content).join("\n\n"),messages:messages.filter(message=>message.role!=="system"),max_tokens:maxOutputTokens,temperature,...(schema?{output_config:{format:{type:"json_schema",schema}}}:{})}};
  }
  const base={model,messages,stream:false,temperature,max_tokens:maxOutputTokens};
  const hostname=new URL(config.endpoint).hostname;
  // MiniMax M3 can spend the entire bounded output on thinking, leaving no JSON reply.
  if(["api.minimax.cn","api.minimax.io"].includes(hostname))return {path:"/chat/completions",body:{...base,reasoning_split:true,...(model==="MiniMax-M3"?{thinking:{type:"disabled"}}:{})}};
  return {path:"/chat/completions",body:{...base,response_format:{type:"json_schema",json_schema:{name:taskType,strict:false,schema:outputSchema}},...(disablesDeepSeekThinking(config.endpoint,model)?{thinking:{type:"disabled"}}:{}),...(hostname==="openrouter.ai"?{provider:{require_parameters:true}}:{})}};
}

export function normalizeModelResponse(provider:ModelConfiguration["provider"],data:Record<string,unknown>):UnifiedModelResponse {
  const usage=data.usage&&typeof data.usage==="object"&&!Array.isArray(data.usage)?data.usage as Record<string,unknown>:{};
  const measured=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
  const inputTokens=measured(provider==="ollama"?data.prompt_eval_count:provider==="anthropic-compatible"?usage.input_tokens:usage.prompt_tokens);
  const outputTokens=measured(provider==="ollama"?data.eval_count:provider==="anthropic-compatible"?usage.output_tokens:usage.completion_tokens);
  const total=provider==="openai-compatible"?measured(usage.total_tokens):null;
  const tokens=total??(inputTokens!==null&&outputTokens!==null?inputTokens+outputTokens:null);
  const message=provider==="ollama"?data.message:Array.isArray(data.choices)?(data.choices[0] as {message?:unknown}|undefined)?.message:undefined;
  const rawContent=provider==="anthropic-compatible"?Array.isArray(data.content)?data.content.filter(block=>block&&typeof block==="object"&&(block as Record<string,unknown>).type==="text"&&typeof (block as Record<string,unknown>).text==="string").map(block=>(block as Record<string,string>).text).join(""):null:message&&typeof message==="object"?(message as Record<string,unknown>).content:null;
  return {content:typeof rawContent==="string"?rawContent:null,inputTokens,outputTokens,usedTokens:tokens??0,usageReported:tokens!==null};
}

export function normalizeModelCatalog(provider:ModelConfiguration["provider"],data:Record<string,unknown>):UnifiedModelCatalog {
  const items=provider==="ollama"?data.models:data.data;
  if(!Array.isArray(items))throw new AiExecutionError("读取模型列表","模型服务未返回有效的模型列表，请检查接口地址。");
  const models=items.flatMap(item=>{if(item===null||typeof item!=="object")return [];const value=provider==="ollama"?(item as Record<string,unknown>).name:(item as Record<string,unknown>).id;return typeof value==="string"?[value]:[];});
  return {models,hasMore:provider==="anthropic-compatible"&&data.has_more===true};
}

function destination(config:ModelConfiguration,suffix:string):string {return `${config.endpoint}${config.provider==="anthropic-compatible"&&config.endpoint.endsWith("/anthropic")?"/v1":""}${suffix}`;}
async function receive(config:ModelConfiguration,url:string,init:RequestInit,step:string,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),config.timeoutMs);
  try {
    const bearer=config.provider!=="anthropic-compatible"||new URL(config.endpoint).hostname==="openrouter.ai";
    const response=await fetcher(url,{...init,signal:controller.signal,redirect:"error",headers:{"Content-Type":"application/json",...(config.provider==="anthropic-compatible"?{"anthropic-version":"2023-06-01"}:{}),...(config.apiKey?(bearer?{Authorization:`Bearer ${config.apiKey}`}:{"x-api-key":config.apiKey}):{})}});
    if(!response.ok){const message=response.status===401||response.status===403?"模型服务拒绝凭据，请打开模型设置检查授权。":response.status===429?"模型服务调用额度或频率受限，请稍后在来源页重试。":response.status===413?"模型服务拒绝过长输入，请检查任务资料范围。":"模型服务未完成请求，请检查模型服务连接和模型名称。";const category=response.status===401||response.status===403?"authentication":response.status===429?"rate_limit":response.status===413?"context_limit":response.status>=500||response.status===404?"provider_unavailable":null;throw new AiExecutionError(step,message,502,category);}
    const value:unknown=await response.json();
    if(value===null||typeof value!=="object"||Array.isArray(value))throw new AiExecutionError(step,"模型服务回执格式无效，请检查接口兼容性。");
    return value as Record<string,unknown>;
  }catch(error){if(error instanceof AiExecutionError)throw error;throw new AiExecutionError(step,controller.signal.aborted?"等待模型回复超时。模型服务可能仍在处理，请回来源页核对状态后再重试。":"无法取得模型服务回执，请打开模型设置检查连接。已发送请求可能仍在处理。",502,controller.signal.aborted?"timeout":"transport");}
  finally {clearTimeout(timer);}
}

export async function probeModelConnection(config:ModelConfiguration,fetcher:typeof fetch=fetch,allowEmptyModel=false):Promise<{available:boolean;modelFound:boolean;models:string[]}> {
  const data=await receive(config,destination(config,config.provider==="ollama"?"/api/tags":"/models"),{method:"GET"},"检查模型连接",fetcher);
  const {models,hasMore}=normalizeModelCatalog(config.provider,data);
  let modelFound=models.includes(config.model);
  if(!modelFound&&config.model&&config.provider==="anthropic-compatible"&&new URL(config.endpoint).hostname==="api.anthropic.com"&&hasMore){
    const exact=await receive(config,destination(config,`/models/${encodeURIComponent(config.model)}`),{method:"GET"},"核对创作模型",fetcher);
    modelFound=exact.id===config.model;
    if(modelFound)models.push(config.model);
  }
  if(!modelFound&&!(allowEmptyModel&&!config.model))throw new AiExecutionError("核对创作模型","连接成功，但配置的模型不在服务返回列表中。请检查模型名称或在模型服务中准备该模型。",422);
  return {available:true,modelFound,models};
}

export async function invokeStructuredModel(config:ModelConfiguration,prompt:PreparedPrompt,fetcher:typeof fetch=fetch):Promise<{value:unknown;usedTokens:number;usageReported:boolean;inputTokens:number|null;outputTokens:number|null}> {
  const wire=protocolRequest(config,createModelRequest(config,prompt));
  const data=await receive(config,destination(config,wire.path),{method:"POST",body:JSON.stringify(wire.body)},"生成创作候选",fetcher);
  const reply=normalizeModelResponse(config.provider,data);
  const receipt={responseReceived:true as const,usedTokens:reply.usedTokens,usageReported:reply.usageReported,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens};
  const outputFailure=(message:string,step:string)=>{const failure=new AiExecutionError(step,message);failure.transportReceipt=receipt;return failure;};
  if(reply.content===null)throw outputFailure("模型未返回可核对的创作内容，请检查模型是否支持结构化输出。","读取模型输出");
  let value:unknown;
  try {value=JSON.parse(reply.content);}catch{throw outputFailure("模型回复不是有效的结构化结果。本次回复未采用，请在来源页重新生成或切换支持结构化输出的模型。","解析创作结果");}
  return {value,usedTokens:reply.usedTokens,usageReported:reply.usageReported,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens};
}

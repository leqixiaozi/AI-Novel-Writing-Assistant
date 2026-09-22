import type { PreparedPrompt } from "../prompts";
import type { ModelConfiguration } from "./configuration";
import { AiExecutionError, type FailedModelResponseEvidence } from "./errors";
import {createHash} from "node:crypto";

export interface UnifiedModelRequest {model:string;messages:PreparedPrompt["messages"];outputSchema:PreparedPrompt["outputSchema"];taskType:PreparedPrompt["taskType"];temperature:number;maxOutputTokens:number;}
export type ModelFinishReason="completed"|"output_limit"|"tool_calls"|"refused"|"other"|"unknown";
/** Protocol fields stop here; execution and diagnostics consume this same object. */
export interface UnifiedModelResponse {content:string|null;inputTokens:number|null;outputTokens:number|null;usedTokens:number;usageReported:boolean;responseId:string|null;responseModel:string|null;finishReason:ModelFinishReason;rawFinishReason:string|null;}
export interface UnifiedModelCatalog {models:string[];hasMore:boolean;}
const RESULT_TOOL="submit_creative_result";

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

function protocolRequest(config:ModelConfiguration,request:UnifiedModelRequest):{path:string;body:Record<string,unknown>;resultTool?:string} {
  const {model,messages,outputSchema,taskType,temperature,maxOutputTokens}=request;
  const miniMax=["api.minimax.cn","api.minimax.io"].includes(new URL(config.endpoint).hostname);
  const description="Return the complete result object matching this schema for author review. This only submits candidate data; it does not execute actions or adopt content.";
  if(config.provider==="ollama")return {path:"/api/chat",body:{model,messages,stream:false,format:outputSchema,options:{temperature,num_predict:maxOutputTokens}}};
  if(config.provider==="anthropic-compatible"){
    const schema=new URL(config.endpoint).hostname==="api.anthropic.com"?anthropicOutputSchema(outputSchema):null;
    return {path:"/messages",...(miniMax?{resultTool:RESULT_TOOL}:{}),body:{model,system:messages.filter(message=>message.role==="system").map(message=>message.content).join("\n\n"),messages:messages.filter(message=>message.role!=="system"),max_tokens:maxOutputTokens,temperature,...(schema?{output_config:{format:{type:"json_schema",schema}}}:{}),...(miniMax?{tools:[{name:RESULT_TOOL,description,input_schema:outputSchema}],tool_choice:{type:"tool",name:RESULT_TOOL}}:{})}};
  }
  const base={model,messages,stream:false,temperature,max_tokens:maxOutputTokens};
  const hostname=new URL(config.endpoint).hostname;
  // MiniMax M3 can spend the entire bounded output on thinking, leaving no JSON reply.
  if(miniMax)return {path:"/chat/completions",resultTool:RESULT_TOOL,body:{...base,tools:[{type:"function",function:{name:RESULT_TOOL,description,parameters:outputSchema}}],tool_choice:{type:"function",function:{name:RESULT_TOOL}},reasoning_split:true,...(model==="MiniMax-M3"?{thinking:{type:"disabled"}}:{})}};
  return {path:"/chat/completions",body:{...base,response_format:{type:"json_schema",json_schema:{name:taskType,strict:false,schema:outputSchema}},...(disablesDeepSeekThinking(config.endpoint,model)?{thinking:{type:"disabled"}}:{}),...(hostname==="openrouter.ai"?{provider:{require_parameters:true}}:{})}};
}

export function normalizeModelResponse(provider:ModelConfiguration["provider"],data:Record<string,unknown>,resultTool?:string):UnifiedModelResponse {
  const usage=data.usage&&typeof data.usage==="object"&&!Array.isArray(data.usage)?data.usage as Record<string,unknown>:{};
  const measured=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
  const inputTokens=measured(provider==="ollama"?data.prompt_eval_count:provider==="anthropic-compatible"?usage.input_tokens:usage.prompt_tokens);
  const outputTokens=measured(provider==="ollama"?data.eval_count:provider==="anthropic-compatible"?usage.output_tokens:usage.completion_tokens);
  const total=provider==="openai-compatible"?measured(usage.total_tokens):null;
  const tokens=total??(inputTokens!==null&&outputTokens!==null?inputTokens+outputTokens:null);
  const first=Array.isArray(data.choices)&&data.choices[0]&&typeof data.choices[0]==="object"?data.choices[0] as Record<string,unknown>:null;
  const message=provider==="ollama"?data.message:first?.message;
  const blocks=Array.isArray(data.content)?data.content.filter(block=>block&&typeof block==="object"&&(block as Record<string,unknown>).type==="text"&&typeof (block as Record<string,unknown>).text==="string") as Array<{text:string}>:[];
  let rawContent=provider==="anthropic-compatible"?blocks.length?blocks.map(block=>block.text).join(""):null:message&&typeof message==="object"?(message as Record<string,unknown>).content:null;
  // Only the one result tool declared by this request is data. Never execute model tools.
  if(resultTool){
    const calls=provider==="anthropic-compatible"?(Array.isArray(data.content)?data.content.filter(block=>block&&typeof block==="object"&&(block as Record<string,unknown>).type==="tool_use"):[]):message&&typeof message==="object"?(message as Record<string,unknown>).tool_calls:undefined;
    const list=Array.isArray(calls)?calls:[];
    const call=list.length===1&&list[0]&&typeof list[0]==="object"?list[0] as Record<string,unknown>:null;
    if(provider==="anthropic-compatible")rawContent=call?.name===resultTool&&call.input&&typeof call.input==="object"&&!Array.isArray(call.input)?JSON.stringify(call.input):null;
    else {const fn=call?.type==="function"&&call.function&&typeof call.function==="object"?call.function as Record<string,unknown>:null;rawContent=fn?.name===resultTool&&typeof fn.arguments==="string"?fn.arguments:null;}
  }
  const metadata=(value:unknown)=>typeof value==="string"?value.slice(0,256):null;
  const rawFinishReason=metadata(provider==="anthropic-compatible"?data.stop_reason:provider==="ollama"?data.done_reason:first?.finish_reason);
  const reasons:Record<string,ModelFinishReason>=provider==="anthropic-compatible"
    ?{end_turn:"completed",stop_sequence:"completed",max_tokens:"output_limit",tool_use:"tool_calls",refusal:"refused"}
    :{stop:"completed",length:"output_limit",tool_calls:"tool_calls",content_filter:"refused"};
  const finishReason:ModelFinishReason=rawFinishReason===null?"unknown":Object.hasOwn(reasons,rawFinishReason)?reasons[rawFinishReason]!:"other";
  return {content:typeof rawContent==="string"?rawContent:null,inputTokens,outputTokens,usedTokens:tokens??0,usageReported:tokens!==null,responseId:metadata(data.id),responseModel:metadata(data.model),finishReason,rawFinishReason};
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

function captureResponseEvidence(reply:UnifiedModelResponse,maxOutputTokens:number):FailedModelResponseEvidence {
  // Only final text and allowlisted metadata. Exclude request headers, prompts and reasoning/tool blocks.
  const bytes=reply.content===null?null:Buffer.from(reply.content,"utf8"),limit=2*1024*1024;
  let content=reply.content;
  if(bytes&&bytes.length>limit){let end=limit;while(end>0&&(bytes[end]!&0xc0)===0x80)end--;content=bytes.subarray(0,end).toString("utf8");}
  return {content,contentSha256:bytes?createHash("sha256").update(bytes).digest("hex"):null,contentBytes:bytes?.length??0,retainedBytes:content===null?0:Buffer.byteLength(content,"utf8"),truncated:Boolean(bytes&&bytes.length>limit),finishReason:reply.rawFinishReason,responseId:reply.responseId,responseModel:reply.responseModel,maxOutputTokens,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens,usedTokens:reply.usedTokens,usageReported:reply.usageReported,capturedAt:new Date().toISOString()};
}

export async function invokeStructuredModel(config:ModelConfiguration,prompt:PreparedPrompt,fetcher:typeof fetch=fetch,retainFailedResponse=false):Promise<{value:unknown;usedTokens:number;usageReported:boolean;inputTokens:number|null;outputTokens:number|null;responseEvidence?:FailedModelResponseEvidence}> {
  const wire=protocolRequest(config,createModelRequest(config,prompt));
  const data=await receive(config,destination(config,wire.path),{method:"POST",body:JSON.stringify(wire.body)},"生成创作候选",fetcher);
  const reply=normalizeModelResponse(config.provider,data,wire.resultTool);
  const evidence=retainFailedResponse?{responseEvidence:captureResponseEvidence(reply,Math.min(config.maxTokens,prompt.maxTokens))}:{};
  const receipt={responseReceived:true as const,usedTokens:reply.usedTokens,usageReported:reply.usageReported,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens,...evidence};
  const outputFailure=(message:string,step:string)=>{const failure=new AiExecutionError(step,message);failure.transportReceipt=receipt;return failure;};
  if(reply.finishReason==="output_limit")throw outputFailure("模型输出达到长度上限，本次不接收不完整结果。请减少本次资料范围或调整输出预算。","读取模型输出");
  if(reply.finishReason==="refused")throw outputFailure("模型拒绝了本次生成，本次未产生可采用的候选。","读取模型输出");
  if(reply.content===null)throw outputFailure(wire.resultTool?"模型未返回唯一且匹配的结构化结果参数，本次回复未采用。":"模型未返回可核对的创作内容，请检查模型是否支持结构化输出。","读取模型输出");
  let value:unknown;
  try {value=JSON.parse(reply.content);}catch{throw outputFailure("模型回复不是有效的结构化结果。本次回复未采用，请在来源页重新生成或切换支持结构化输出的模型。","解析创作结果");}
  return {value,usedTokens:reply.usedTokens,usageReported:reply.usageReported,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens,...evidence};
}

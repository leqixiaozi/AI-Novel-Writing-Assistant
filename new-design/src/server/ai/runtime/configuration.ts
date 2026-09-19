import { createHash } from "node:crypto";
import type { IndependentModelStatus } from "../../../common/aiRuntime";
import { listPromptAssets } from "../prompts";
import { AiExecutionError } from "./errors";

export interface ModelConfiguration {provider:"ollama"|"openai-compatible"|"anthropic-compatible";endpoint:string;model:string;apiKey:string;timeoutMs:number;maxTokens:number;identity:string;}
function boundedInteger(value:string|undefined,fallback:number,min:number,max:number,label:string):number {
  const result=value===undefined?fallback:Number(value);
  if(!Number.isInteger(result)||result<min||result>max)throw new AiExecutionError("配置模型",`${label}必须在 ${min}–${max} 范围内。`,422);
  return result;
}

export function readModelConfiguration(environment:NodeJS.ProcessEnv=process.env):ModelConfiguration {
  const provider=environment.NEW_DESIGN_AI_PROVIDER??"ollama";
  if(provider!=="ollama"&&provider!=="openai-compatible"&&provider!=="anthropic-compatible")throw new AiExecutionError("配置模型","请选择 Ollama、OpenAI 兼容或 Anthropic 兼容接口。",422);
  let endpoint:URL;
  try {endpoint=new URL(environment.NEW_DESIGN_AI_BASE_URL??"http://127.0.0.1:11434");}catch{throw new AiExecutionError("配置模型","模型服务地址无效，请填写完整的 HTTP 或 HTTPS 地址。",422);}
  if(!["http:","https:"].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new AiExecutionError("配置模型","模型服务地址不能包含凭据、查询参数或片段。",422);
  const local=["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname);
  if(endpoint.protocol!=="https:"&&!local)throw new AiExecutionError("配置模型","远程模型服务必须使用 HTTPS，避免泄露输入和凭据。",422);
  const model=(environment.NEW_DESIGN_AI_MODEL??"").trim();
  const apiKey=environment.NEW_DESIGN_AI_API_KEY??"";
  const timeoutMs=boundedInteger(environment.NEW_DESIGN_AI_TIMEOUT_MS,120000,1000,600000,"等待时间");
  const maxTokens=boundedInteger(environment.NEW_DESIGN_AI_MAX_TOKENS,8192,256,32768,"输出上限");
  if(!model)throw new AiExecutionError("配置模型","尚未指定创作模型。打开“模型设置”，按配置说明选择模型后重启新设计服务。",422);
  if(provider!=="ollama"&&!apiKey&&!local)throw new AiExecutionError("配置模型","远程模型凭据未配置。请按“模型设置”的凭据说明配置后重启新设计服务。",422);
  const base=endpoint.href.replace(/\/$/,"");
  return {provider,endpoint:base,model,apiKey,timeoutMs,maxTokens,identity:createHash("sha256").update(JSON.stringify({provider,endpoint:base,model,timeoutMs,maxTokens})).digest("hex")};
}

export function getIndependentModelStatus():IndependentModelStatus {
  const tasks=listPromptAssets().map(({taskType,label,assetId,version})=>({taskType,label,assetId,version}));
  try {const config=readModelConfiguration();return {configured:true,provider:config.provider,model:config.model,endpoint:config.endpoint,hasCredential:Boolean(config.apiKey),timeoutMs:config.timeoutMs,maxTokens:config.maxTokens,recovery:null,tasks};}
  catch(error){const failure=error instanceof AiExecutionError?error:new AiExecutionError("配置模型","模型配置无法读取。",422);return {configured:false,provider:"ollama",model:"",endpoint:"",hasCredential:false,timeoutMs:120000,maxTokens:8192,recovery:failure.recovery,tasks};}
}

import type {TechnicalFallbackCategory} from "../../../common/contracts";
import type {ManagedModelConnection,ManagedModelSnapshot,ManagedTaskRoute,ModelTaskKey} from "../../../common/modelRouting";
import {DEFAULT_MODEL_POLICY} from "../../../common/modelRouting";
import {captureManagedModelSnapshot,getManagedCredentialEnvironment,resolveManagedTaskRoute} from "../../database/modelManagement";
import type {PreparedPrompt} from "../prompts";
import {readModelConfiguration,type ModelConfiguration} from "./configuration";
import {AiExecutionError} from "./errors";
import {invokeStructuredModel,probeModelConnection} from "./transport";

export interface ExecutionDependencies {
  fetcher?:typeof fetch;
  environment?:NodeJS.ProcessEnv;
  routeResolver?:(task:ModelTaskKey)=>Promise<ManagedTaskRoute>;
  snapshotWriter?:(task:ModelTaskKey,route:ManagedTaskRoute)=>Promise<ManagedModelSnapshot>;
  credentialResolver?:(id:string,provider:string)=>Promise<string|null>;
  /** Source workflows with an original unknown receipt must not issue a second provider request. */
  stopOnUnknownResponse?:boolean;
}
interface AttemptTrace {provider:string;model:string;kind:"primary"|"fallback";status:"succeeded"|"failed";category:TechnicalFallbackCategory|null;reservedTokens:number;usedTokens:number|null;durationMs:number;requestSent:boolean;responseReceived:boolean;}

export async function configurationForConnection(connection:ManagedModelConnection,policy=DEFAULT_MODEL_POLICY,dependencies:ExecutionDependencies={},allowEmptyModel=false):Promise<ModelConfiguration> {
  if(!connection||typeof connection.endpoint!=="string"||typeof connection.model!=="string"||!["ollama","openai-compatible"].includes(connection.provider)||!(connection.credentialId===null||typeof connection.credentialId==="string"))throw new AiExecutionError("检查模型连接设置","请选择服务类型并填写地址；指定创作模型后才能生成。",422);
  let apiKey="";
  if(connection.credentialId){
    let variable:string|null;
    try {variable=await(dependencies.credentialResolver??getManagedCredentialEnvironment)(connection.credentialId,connection.provider);}
    catch {throw new AiExecutionError("读取模型凭据","凭据引用无法读取、未配置或与服务不匹配，请在模型设置核对引用与专用环境变量。",422,"authentication");}
    if(!variable||!/^NEW_DESIGN_AI_[A-Z0-9_]+$/.test(variable))throw new AiExecutionError("读取模型凭据","此凭据引用不能由新设计使用，请在模型设置选择专用服务器凭据。",422,"authentication");
    apiKey=(dependencies.environment??process.env)[variable]??"";
    if(!apiKey)throw new AiExecutionError("读取模型凭据","配置已保存，但服务器未加载该凭据。请展开模型设置的凭据说明，配置后重启新设计服务。",422,"authentication");
  }
  const config=readModelConfiguration({NEW_DESIGN_AI_PROVIDER:connection.provider,NEW_DESIGN_AI_BASE_URL:connection.endpoint,NEW_DESIGN_AI_MODEL:allowEmptyModel&&!connection.model?"__list_models_only__":connection.model,NEW_DESIGN_AI_API_KEY:apiKey,NEW_DESIGN_AI_TIMEOUT_MS:String(policy.timeoutMs),NEW_DESIGN_AI_MAX_TOKENS:String(policy.maxOutputTokens)});
  return allowEmptyModel&&!connection.model?{...config,model:""}:config;
}

export async function probeManagedModelConnection(connection:ManagedModelConnection):Promise<{available:boolean;modelFound:boolean;models:string[]}> {
  return probeModelConnection(await configurationForConnection(connection,DEFAULT_MODEL_POLICY,{},true),fetch,true);
}

// UTF-8 bytes are a deliberately conservative scheduling estimate, not measured model token usage.
export function reserveAttemptBudget(prompt:PreparedPrompt,remaining:number,limit:number):{inputEstimate:number;maxOutputTokens:number;reservedTokens:number} {
  const inputEstimate=Buffer.byteLength(JSON.stringify({messages:prompt.messages,outputSchema:prompt.outputSchema}),"utf8")+256;
  const maxOutputTokens=Math.min(prompt.maxTokens,limit,remaining-inputEstimate);
  if(maxOutputTokens<256)throw new AiExecutionError("检查调用预算","剩余预算不足以发送下一次资料与输出。请在模型设置提高本次总预算，或回来源页减少参考资料；下一次请求尚未发送。",422);
  return {inputEstimate,maxOutputTokens,reservedTokens:inputEstimate+maxOutputTokens};
}

const RETRYABLE=new Set<TechnicalFallbackCategory>(["timeout","rate_limit","provider_unavailable","transport"]);
export function validateExecutionPolicy(route:ManagedTaskRoute):void {
  const policy=route.policy;
  const valid=(value:number,min:number,max:number)=>Number.isInteger(value)&&value>=min&&value<=max;
  if(!policy||!valid(policy.maxOutputTokens,256,32768)||!valid(policy.maxTotalTokens,policy.maxOutputTokens,2000000)||!valid(policy.timeoutMs,1000,600000)||!valid(policy.maxRetries,0,3)||!valid(policy.retryDelayMs,0,10000)||!Array.isArray(route.fallbacks)||route.fallbacks.length>4)throw new AiExecutionError("检查调用策略","模型预算、等待或备用设置超出可用范围，请打开模型设置修正后保存并生效；请求尚未发送。",422);
}
export async function executeManagedPrompt<T>(taskType:ModelTaskKey,prompt:PreparedPrompt,dependencies:ExecutionDependencies={}):Promise<{output:T;modelSnapshot:Record<string,unknown>;usedTokens:number}> {
  let route:ManagedTaskRoute;
  let fixtureConfig:ModelConfiguration|null=null;
  try {
    // Explicit injection exists only for contract fixtures. Production always resolves published PostgreSQL facts.
    if(dependencies.environment&&!dependencies.routeResolver){fixtureConfig=readModelConfiguration(dependencies.environment);route={primary:{provider:fixtureConfig.provider,endpoint:fixtureConfig.endpoint,model:fixtureConfig.model,credentialId:null},fallbacks:[],policy:{...DEFAULT_MODEL_POLICY,timeoutMs:fixtureConfig.timeoutMs,maxOutputTokens:fixtureConfig.maxTokens},sourceLayers:[]};}
    else route=await(dependencies.routeResolver??resolveManagedTaskRoute)(taskType);
  }catch(error){if(error instanceof AiExecutionError)throw error;throw new AiExecutionError("读取任务模型路由","此任务的已生效模型配置不可用，请打开模型设置，核对默认模型或此任务设置。",422);}
  validateExecutionPolicy(route);
  let snapshot:ManagedModelSnapshot|null=null;
  if(!fixtureConfig){try{snapshot=await(dependencies.snapshotWriter??captureManagedModelSnapshot)(taskType,route);}catch{const failure=new AiExecutionError("记录模型配置快照","本次模型配置快照未能保存，模型请求尚未发送。请检查运行维护，恢复后从来源页重新发起任务。");failure.recovery.sourceRoute="/new-design/structure/maintenance";failure.recovery.actionLabel="打开运行维护";failure.recovery.savedResult="已有资料和人工内容保留；本次尚未发送模型请求，没有已确认的生成结果。";throw failure;}}
  let remaining=route.policy.maxTotalTokens,retries=0,fallbackCount=0,knownUsage=0,unknownUsage=false,knownInput=0,knownOutput=0,breakdownUnknown=false;
  const traces:AttemptTrace[]=[],connections=[route.primary,...route.fallbacks];
  let current=0;
  const attemptedFallbacks=new Set<number>();
  const failureSnapshot=(failure:AiExecutionError)=>{const lastSent=[...traces].reverse().find(trace=>trace.requestSent);failure.executionSnapshot={provider:lastSent?.provider??"not_invoked",model:lastSent?.model??"not_invoked",routeSnapshotId:snapshot?.id??null,routeSnapshotHash:snapshot?.snapshotHash??fixtureConfig?.identity,sourceLayers:route.sourceLayers,maxTotalTokens:route.policy.maxTotalTokens,estimatedReservedTokens:route.policy.maxTotalTokens-remaining,budgetEstimateMethod:"utf8_bytes_plus_256",knownTokens:knownUsage,inputTokens:!lastSent||breakdownUnknown?null:knownInput,outputTokens:!lastSent||breakdownUnknown?null:knownOutput,usageReported:Boolean(lastSent)&&!unknownUsage,usageStatus:!lastSent?"not_invoked":unknownUsage?"partial_or_unavailable":"reported",retryCount:retries,fallbackCount,attempts:traces,independent:true};return failure;};
  for(;;){
    const connection=connections[current];
    let reservation:ReturnType<typeof reserveAttemptBudget>;
    try{reservation=reserveAttemptBudget(prompt,remaining,route.policy.maxOutputTokens);}catch(error){throw failureSnapshot(error as AiExecutionError);}
    // A lost response still consumes the reservation: retries never silently get a fresh full budget.
    remaining-=reservation.reservedTokens;
    const started=Date.now();
    let attemptUsage:number|null=null;
    let requestSent=false;
    let responseReceived=false;
    try {
      const configured=fixtureConfig??await configurationForConnection(connection,route.policy,dependencies);
      requestSent=true;
      const result=await invokeStructuredModel({...configured,maxTokens:reservation.maxOutputTokens},prompt,dependencies.fetcher);
      responseReceived=true;
      if(result.usageReported){knownUsage+=result.usedTokens;attemptUsage=result.usedTokens;}else unknownUsage=true;
      if(result.inputTokens!==null&&result.outputTokens!==null){knownInput+=result.inputTokens;knownOutput+=result.outputTokens;}else breakdownUnknown=true;
      let output:T;
      try{output=prompt.parseOutput(result.value) as T;}catch(error){if(error instanceof AiExecutionError)throw error;throw new AiExecutionError("核对创作结果","模型生成结果不符合此任务的表单规格。本次回复未采用，请在来源页调整输入或检查模型设置，不会因内容校验失败自动换模型。");}
      traces.push({provider:connection.provider,model:connection.model,kind:current===0?"primary":"fallback",status:"succeeded",category:null,reservedTokens:reservation.reservedTokens,usedTokens:result.usageReported?result.usedTokens:null,durationMs:Date.now()-started,requestSent,responseReceived});
      return {output,usedTokens:knownUsage,modelSnapshot:{provider:connection.provider,model:connection.model,routeSnapshotId:snapshot?.id??null,routeSnapshotHash:snapshot?.snapshotHash??fixtureConfig?.identity,sourceLayers:route.sourceLayers,timeoutMs:route.policy.timeoutMs,maxTokens:reservation.maxOutputTokens,maxTotalTokens:route.policy.maxTotalTokens,knownTokens:knownUsage,inputTokens:breakdownUnknown?null:knownInput,outputTokens:breakdownUnknown?null:knownOutput,estimatedReservedTokens:route.policy.maxTotalTokens-remaining,budgetEstimateMethod:"utf8_bytes_plus_256",budgetExceeded:knownUsage>route.policy.maxTotalTokens,usageReported:!unknownUsage,usageStatus:unknownUsage?"partial_or_unavailable":"reported",retryCount:retries,fallbackCount,attempts:traces,independent:true,fixture:Boolean(fixtureConfig)}};
    }catch(error){
      const failure=error instanceof AiExecutionError?error:new AiExecutionError("生成创作候选","模型执行未完成确认，请检查模型设置后回来源页核对结果。");
      if(!responseReceived&&failure.transportReceipt){const receipt=failure.transportReceipt;responseReceived=true;if(receipt.usageReported){knownUsage+=receipt.usedTokens;attemptUsage=receipt.usedTokens;}else unknownUsage=true;if(receipt.inputTokens!==null&&receipt.outputTokens!==null){knownInput+=receipt.inputTokens;knownOutput+=receipt.outputTokens;}else breakdownUnknown=true;}
      traces.push({provider:connection.provider,model:connection.model,kind:current===0?"primary":"fallback",status:"failed",category:failure.category,reservedTokens:reservation.reservedTokens,usedTokens:attemptUsage,durationMs:Date.now()-started,requestSent,responseReceived});
      if(requestSent&&attemptUsage===null){unknownUsage=true;breakdownUnknown=true;}
      if(dependencies.stopOnUnknownResponse&&requestSent&&!responseReceived)throw failureSnapshot(failure);
      if(!failure.category)throw failureSnapshot(failure);
      if(RETRYABLE.has(failure.category)&&retries<route.policy.maxRetries){retries++;await new Promise(resolve=>setTimeout(resolve,route.policy.retryDelayMs));continue;}
      const next=route.fallbacks.findIndex((fallback,index)=>!attemptedFallbacks.has(index+1)&&fallback.failureCategories.includes(failure.category!));
      if(next<0)throw failureSnapshot(failure);
      current=next+1;attemptedFallbacks.add(current);fallbackCount++;
    }
  }
}

import type {TechnicalFallbackCategory} from "../contracts";

export const MODEL_TASKS=[
  {key:"directions",label:"推荐开书方向"},{key:"initial_content",label:"准备开书资料"},
  {key:"form_assist",label:"资料表单建议"},{key:"market_analysis",label:"题材趋势分析"},
  {key:"book_analysis",label:"拆书与稿件诊断"},{key:"planning_candidate",label:"故事规划建议"},
  {key:"chapter_settlement",label:"整理章节变化"},
  {key:"chapter_generation",label:"生成章节正文"},
  {key:"world_consistency",label:"检查世界设定一致性"},
  {key:"creative_extraction",label:"提炼写法与生成标题"},
  {key:"character_dialogue",label:"人物对话模拟"},
] as const;
export type ModelTaskKey=(typeof MODEL_TASKS)[number]["key"];
export type ManagedProvider="ollama"|"openai-compatible";
export interface ManagedModelConnection {provider:ManagedProvider;endpoint:string;model:string;credentialId:string|null;}
/** Dedicated embedding versions are original model-route versions, never a text default route. */
export interface ManagedEmbeddingConnectionVersion extends ManagedModelConnection {id:string;connectionVersionId:string;configId:string;configRevision:number;version:number;label:string;connectionHash:string;timeoutMs:number;maxRetries:number;retryDelayMs:number;}
export interface ManagedEmbeddingCatalog {connections:ManagedEmbeddingConnectionVersion[];credentials:ManagedCredentialChoice[];environmentReferences:Array<{name:string;available:boolean}>;configurationIssue:string|null;}
export interface SaveManagedEmbeddingConnectionInput extends ManagedModelConnection {timeoutMs:number;maxRetries:number;retryDelayMs:number;expectedConfigId:string|null;expectedRevision:number|null;idempotencyKey:string;}
export interface ManagedEmbeddingSaveResult {connection:ManagedEmbeddingConnectionVersion;configRevision:number;savedVersionId:string;savedVersion:number;active:boolean;repeated:boolean;}
export interface ManagedModelFallback extends ManagedModelConnection {failureCategories:TechnicalFallbackCategory[];}
export interface ManagedModelPolicy {maxOutputTokens:number;maxTotalTokens:number;timeoutMs:number;maxRetries:number;retryDelayMs:number;}
export interface ManagedRouteSettings {primary:ManagedModelConnection;fallbacks:ManagedModelFallback[];policy:ManagedModelPolicy;}
export interface ManagedRouteVersion extends ManagedRouteSettings {id:string;version:number;}
export interface ManagedRouteSummary {
  id:string;scope:"system_default"|"task";taskType:ModelTaskKey|null;name:string;revision:number;
  current:ManagedRouteVersion;published:ManagedRouteVersion|null;editable:boolean;configurationIssue:string|null;
}
export interface ManagedCredentialChoice {id:string;label:string;provider:string;available:boolean;status:"active"|"disabled";}
export interface ModelRouteCenterCatalog {routes:ManagedRouteSummary[];credentials:ManagedCredentialChoice[];tasks:typeof MODEL_TASKS;environmentReferences:Array<{name:string;available:boolean}>;}
export interface SaveManagedModelRouteInput extends ManagedRouteSettings {
  scope:"system_default"|"task";taskType:ModelTaskKey|null;expectedConfigId:string|null;expectedRevision:number|null;idempotencyKey:string;
  replaceUnsupported?:boolean;
}
export interface SaveManagedModelRouteResult {route:ManagedRouteSummary;savedVersionId:string;savedVersion:number;active:boolean;repeated:boolean;}
export interface ManagedTaskRoute extends ManagedRouteSettings {sourceLayers:Array<{scope:"system_default"|"task";configId:string;versionId:string}>;}
export interface ManagedModelSnapshot {id:string;snapshotHash:string;taskType:ModelTaskKey;route:ManagedTaskRoute;}

export const DEFAULT_MODEL_POLICY:ManagedModelPolicy={maxOutputTokens:8192,maxTotalTokens:65536,timeoutMs:120000,maxRetries:0,retryDelayMs:1000};
export const FALLBACK_LABELS:Record<TechnicalFallbackCategory,string>={timeout:"等待超时",rate_limit:"频率或额度受限",authentication:"授权失败",provider_unavailable:"服务不可用",transport:"连接失败",context_limit:"输入长度超限"};

export function sameManagedSettings(a:ManagedRouteSettings,b:ManagedRouteSettings):boolean {
  const normalize=(value:ManagedRouteSettings)=>[value.primary.provider,value.primary.endpoint.replace(/\/$/,""),value.primary.model,value.primary.credentialId,value.fallbacks.map(item=>[item.provider,item.endpoint.replace(/\/$/,""),item.model,item.credentialId,[...item.failureCategories].sort()]),value.policy.maxOutputTokens,value.policy.maxTotalTokens,value.policy.timeoutMs,value.policy.maxRetries,value.policy.retryDelayMs];
  return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}

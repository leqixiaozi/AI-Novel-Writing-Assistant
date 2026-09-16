export interface AiRuntimeRecovery {
  failedStep:string;
  summary:string;
  savedResult:string;
  actionLabel:string;
  sourceRoute:string;
}
export interface IndependentModelStatus {
  configured:boolean;
  provider:"ollama"|"openai-compatible";
  model:string;
  endpoint:string;
  hasCredential:boolean;
  timeoutMs:number;
  maxTokens:number;
  recovery:AiRuntimeRecovery|null;
  tasks:Array<{taskType:string;label:string;assetId:string;version:string}>;
}

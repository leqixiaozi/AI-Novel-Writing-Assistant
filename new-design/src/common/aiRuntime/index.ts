export interface AiRuntimeRecovery {
  failedStep:string;
  summary:string;
  savedResult:string;
  actionLabel:string;
  sourceRoute:string;
  /** Only an acknowledged transaction outcome may unlock a new write after a conflict. */
  mutationOutcome?:"not_written"|"unknown"|"committed";
}
export interface IndependentModelStatus {
  configured:boolean;
  provider:"ollama"|"openai-compatible"|"anthropic-compatible";
  model:string;
  endpoint:string;
  hasCredential:boolean;
  timeoutMs:number;
  maxTokens:number;
  recovery:AiRuntimeRecovery|null;
  tasks:Array<{taskType:string;label:string;assetId:string;version:string}>;
}

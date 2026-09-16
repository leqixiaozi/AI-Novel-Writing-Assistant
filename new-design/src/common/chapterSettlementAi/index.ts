import type { AiRuntimeRecovery } from "../aiRuntime";
export interface ChapterSettlementAiStatus {configured:boolean;taskType:"chapter_settlement";message:string;recovery:AiRuntimeRecovery|null}
export interface ChapterSettlementAiInput {expectedSessionRevision:number;requestKey:string;catalogHash:string}
export interface ChapterSettlementAiReceipt {
  id:string;sessionId:string;requestKey:string;taskId:string;status:"running"|"succeeded"|"failed"|"released"|"ended_unknown";
  modelResultSaved:boolean;proposalCount:number;proposalsSaved:boolean;notes:string[];
  failure:AiRuntimeRecovery|null;sourceRoute:string;canImportSavedResult:boolean;repeated:boolean;
  ledgerPending:boolean;
  canReleaseSavedResult:boolean;
  canEndExpiredUnknownRun:boolean;
}

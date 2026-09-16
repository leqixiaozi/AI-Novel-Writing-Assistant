import type { ManagedModelSnapshot } from "../../../common/modelRouting";
import type { PreparedPrompt } from "../prompts";
import type { ChapterSettlementPromptInput, ChapterSettlementPromptOutput } from "../prompts/chapterSettlement";
export interface SettlementFrozenPlan {
  format:1;input:ChapterSettlementPromptInput;assetId:string;assetVersion:string;
  outputSchema:Record<string,unknown>;messages:PreparedPrompt["messages"];contextPolicy:string;
  temperature:number;maxTokens:number;route:ManagedModelSnapshot["route"];snapshotHash:string;
}
export interface SettlementAiClaim {
  requestId:string;sessionId:string;bookId:string;chapterDocumentId:string;sourceRoute:string;
  taskId:string;stepId:string;attemptId:string;leaseToken:string;requestKey:string;
  expectedSessionRevision:number;contextManifestId:string;modelRouteSnapshotId:string;
  taskContractVersionId:string;promptRecipeVersionId:string;plan:SettlementFrozenPlan;
}
export type SettlementAiOutput=ChapterSettlementPromptOutput;

import type { CompositionRecipe, CompositionDebugPreview, CompositionDebugResult } from "../../../common/promptComposition";
import type { ManagedModelSnapshot, ManagedTaskRoute } from "../../../common/modelRouting";
import type { AiFailureCategory } from "../../../common/contracts";
import type { AiRuntimeRecovery } from "../../../common/aiRuntime";

export interface ExactCompositionComponent { cardId:string; versionId:string; title:string; enabled:boolean; content:string; componentType:string; taskFamilies:string[]; trustLevel:string }
export interface ExactCompositionSource { cardId:string; versionId:string; title:string; role:"formal"|"reference"; typeKey:string; values:Record<string,unknown> }
export interface LoadedCompositionRecipe { recipe:CompositionRecipe; components:ExactCompositionComponent[]; sources:ExactCompositionSource[] }
export interface DebugPreviewBundle extends LoadedCompositionRecipe {
  taskInput:Record<string,unknown>; inputSchema:Record<string,unknown>;
  messages:Array<{role:"system"|"user";content:string}>; outputSchema:Record<string,unknown>;
  assetId:string; assetVersion:string; contextPolicy:string; temperature:number; maxTokens:number;
  variables:Array<{label:string;value:string|number|boolean}>; estimatedInputUnits:number;
}
export interface DebugRunClaim {
  preview:CompositionDebugPreview; taskInput:Record<string,unknown>; snapshot:ManagedModelSnapshot;
  frozenBundle:DebugPreviewBundle;
  attemptId:string; taskId:string; stepId:string; leaseToken:string;
}
export type ClaimedDebugRun=DebugRunClaim|{priorResult:CompositionDebugResult};
export type DebugRunCompletion={output:unknown;modelSnapshot:Record<string,unknown>}|{failure:AiRuntimeRecovery;modelSnapshot?:Record<string,unknown>|null;errorCategory?:AiFailureCategory};
export interface DebugFrozenPlan extends DebugPreviewBundle { route:ManagedTaskRoute|null; recovery:AiRuntimeRecovery|null; blockers:string[]; taskContractVersionId:string; modelRouteSnapshotId:string|null; contextManifestId:string; recipeVersion:number }

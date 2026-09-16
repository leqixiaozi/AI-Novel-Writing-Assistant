import type {BookCreationReviewCard,BookCreationSession,BookDirectionCandidate} from "../contracts";
import type {ProductionRelationDraft,ProductionPlanningDraft,BookCreationProductionCatalog} from "../bookCreationProduction";
import type {CreationDirectorStage} from "../creationDirector";

export const CREATION_REVIEW_AI_MODES=["required","remaining","all"] as const;
export type CreationReviewAiMode=typeof CREATION_REVIEW_AI_MODES[number];
export function isBlankCreationReviewValue(value:unknown):boolean{return value===null||value===undefined||typeof value==="string"&&!value.trim()||Array.isArray(value)&&value.length===0;}
export interface CreationReviewAiInput {
 expectedSessionRevision:number;requestKey:string;mode:CreationReviewAiMode;reviewCardId?:string;
}
export interface CreationReviewAiCardCandidate {
 reviewCardId:string;typeKey:string;isNew:boolean;titleSuggestion:string|null;values:Record<string,unknown>;
}
export interface CreationPreparationOutput {
 candidates:CreationReviewAiCardCandidate[];directions:BookDirectionCandidate[];
 relations:ProductionRelationDraft[];plans:ProductionPlanningDraft[];notes:string[];
}
export interface CreationPreparationSelection {
 reviewCardId:string;title:boolean;fieldKeys:string[];
}
export interface AdoptCreationPreparationInput {
 expectedSessionRevision:number;requestKey:string;selections:CreationPreparationSelection[];
 relationIds:string[];planIds:string[];directionId?:string;
}
export interface CreationPreparationFailure {
 failedStep:string;message:string;mutationOutcome:"not_written"|"unknown"|"committed";
 modelRequestState:"not_sent"|"sent_unknown"|"completed";
 issues?:Record<string,string>;
 recovery:{source:{kind:"book_creation";sessionId:string;batchId:string|null;route:string;label:string};
  savedResult:string;nextAction:string;mutationOutcome:"not_written"|"unknown"|"committed"};
}
export interface CreationPreparationReceipt {
 sessionId:string;batchId:string;requestKey:string;stage:CreationDirectorStage|null;
 status:"running"|"review"|"applied"|"failed"|"released"|"ended_unknown";
 baseSessionRevision:number;currentSessionRevision:number;
 modelResultSaved:boolean;reviewSaved:boolean;canAdoptSavedResult:boolean;
 canReleaseSavedResult:boolean;canEndExpiredUnknownRun:boolean;
 canRecoverSavedResult:boolean;supersededByBatchId:string|null;
 leaseUntil:string|null;output:CreationPreparationOutput|null;failure:CreationPreparationFailure|null;
}
export interface CreationPreparationTarget {
 reviewCardId:string;typeKey:string;isNew:boolean;title:string;values:Record<string,unknown>;
 allowTitle:boolean;fieldKeys:string[];
}
export interface CreationPreparationFrozenContext {
 session:BookCreationSession;sourceText:string;templateSnapshot:unknown;
 catalog:BookCreationProductionCatalog;reviewCards:BookCreationReviewCard[];
 targets:CreationPreparationTarget[];specificationHash:string;
}
export interface CreationPreparationAdoptionReceipt {
 sessionId:string;batchId:string;requestKey:string;repeated:boolean;session:BookCreationSession;
 adopted:{reviewCardIds:string[];relationIds:string[];planIds:string[];directionId:string|null};
}

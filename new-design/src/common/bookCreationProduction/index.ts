import type {BookCreationSession,FieldDefinition,ForeshadowPlanAction,PlanningExecutionMode,PlanningLevel,PlanningReferenceRole} from "../contracts";

export interface ProductionRelationDraft {
 id:string;relationTypeSourceId:string;sourceReviewCardId:string;targetReviewCardId:string;
 properties:Record<string,unknown>;decision:"pending"|"include"|"exclude";
}
export interface ProductionPlanningContent {
 goal:string;storyTime:string;mustHappen:string[];mustPreserve:string[];forbiddenBoundaries:string[];
 expectedChanges:string[];characterArc:string;notes:string;
}
export interface ProductionPlanningDraft {
 id:string;parentDraftId:string|null;reviewCardId:string|null;level:PlanningLevel;title:string;sortOrder:number;
 content:ProductionPlanningContent;executionMode:PlanningExecutionMode;
 references:Array<{role:PlanningReferenceRole;reviewCardId:string;action:ForeshadowPlanAction|null;note:string;sortOrder:number}>;
 decision:"pending"|"draft"|"adopt"|"exclude";
}
export interface BookCreationFormalReview {
 revision:number;templateVersionId:string;reviewCardsHash:string;
 relations:ProductionRelationDraft[];plans:ProductionPlanningDraft[];
}
export interface BookCreationProductionCatalog {
 templateVersionId:string;reviewCardsHash:string;
 relationSpecs:Array<{sourceId:string;key:string;label:string;description:string;direction:"directed"|"undirected";sourceTypeKeys:string[];targetTypeKeys:string[];sourceMax:number|null;targetMax:number|null;fields:FieldDefinition[];editable:boolean;unavailableReason:string|null;specificationHash:string}>;
 planningLevels:Array<{key:PlanningLevel;label:string;parentLevel:PlanningLevel|null;cardTypeKey:string|null}>;
 dictionaries:Array<{id:string;label:string;nodes:Array<{id:string;parentId:string|null;label:string;path:string[]}>}>;
}
export interface SaveBookCreationFormalReviewInput {
 expectedSessionRevision:number;expectedFormalRevision:number|null;requestKey:string;
 templateVersionId:string;reviewCardsHash:string;relations:ProductionRelationDraft[];plans:ProductionPlanningDraft[];
}
export interface BookCreationProductionReceipt {
 sessionId:string;requestKey:string;operation:"create_session"|"save_review"|"save_formal_review"|"complete";
 repeated:boolean;session:BookCreationSession;
 installed?:{cards:Array<{reviewCardId:string;cardId:string;cardVersionId:string}>;relations:Array<{draftId:string;relationId:string;versionId:string}>;plans:Array<{draftId:string;objectId:string;versionId:string;adopted:boolean}>};
}
export interface BookCreationProductionWorkspace {session:BookCreationSession;catalog:BookCreationProductionCatalog;}

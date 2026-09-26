import type {FieldDefinition} from '../contracts';
import type {ProfessionalState,ProfessionalKnowledge} from '../worldCharacterMaintenance';
/** Explicit display mapping to an actual published relationship and state dimension. */
export interface ResourceLedgerSelection {relationTypeId:string;holdingDimensionKey:string;specificationHash:string;}
export interface ResourceLedgerChoice extends ResourceLedgerSelection {name:string;holdingLabel:string;relationTypeRevision:number;fields:FieldDefinition[];}
export interface CharacterResourceItem {
 relationId:string;relationVersionId:string|null;revision:number;resourceId:string;resourceVersionId:string|null;
 name:string;holderName:string;available:boolean;reason:string|null;holding:ProfessionalState|null;
 properties:Array<{key:string;label:string;display:string}>;states:ProfessionalState[];
 sourceRoute:string;
 planning:Array<{key:string;label:string;display:string}>;planningRoute:string;readerKnowledge:ProfessionalKnowledge[];holderKnowledge:ProfessionalKnowledge[];
}
export interface ResourceBackfillChapter {
 documentId:string;chapterCardId:string;title:string;logicalOrder:number;bodyVersionId:string;bodyContentHash:string;
 sessionId:string|null;sessionRevision:number|null;sessionStatus:string|null;sourceRoute:string;
 anchors:Array<{id:string;subjectCardId:string|null;start:number;end:number;excerpt:string}>;
 unavailableReason:string|null;
}
export interface CharacterResourceLedger {
 bookId:string;characterId:string;characterVersionId:string;characterRevision:number;characterName:string;
 choices:ResourceLedgerChoice[];selection:ResourceLedgerSelection|null;items:CharacterResourceItem[];
 pendingCount:number;recentChapters:ResourceBackfillChapter[];truncated:boolean;
}
export interface ResourceBackfillScope extends ResourceLedgerSelection {
 characterId:string;characterVersionId:string;characterRevision:number;resourceIds:string[];relationIds:string[];
}
export interface ResourceBackfillFrozenScope extends ResourceBackfillScope {
 resources:Array<{id:string;versionId:string|null;relationId:string;relationVersionId:string|null}>;
 anchors:ResourceBackfillChapter['anchors'];
}

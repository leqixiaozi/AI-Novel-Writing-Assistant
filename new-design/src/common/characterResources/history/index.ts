import type {ResourceLedgerSelection} from '..';
import type {ProfessionalState} from '../../worldCharacterMaintenance';
import type {StableResourceSupplementBasis} from '../../resourceSupplements';
export {resourceHistoryEvidenceSources,resourceHistoryFocusSchemaFor,resourceHistoryFocusOutputSchema} from './focus';
export type {ResourceHistoryEvidenceSource,ResourceHistoryFocusOutput} from './focus';
export interface ResourceHistoryChange {
 id:string;subjectKind:'card'|'relation';subjectId:string;stateKey:string;before:unknown;after:unknown;reason:string;
 fieldLabel:string;fieldAvailable:boolean;beforeDisplay:string;afterDisplay:string;
 checkpointId:string|null;chapterDocumentId:string;bodyVersionId:string;chapterOrder:number;available:boolean;unavailableReason:string|null;
 original:{change:Record<string,unknown>;relationVersion:Record<string,unknown>|null;resourceVersion:Record<string,unknown>|null;characterVersion:Record<string,unknown>|null;anchor:Record<string,unknown>|null;editingContract:Record<string,unknown>|null};
 sourceRoute:string;
}
export interface ResourceHistoryItem {
 relationId:string;resourceId:string;name:string;relationStatus:string;resourceStatus:string;
 currentHolding:ProfessionalState|null;changes:ResourceHistoryChange[];
}
export interface CharacterResourceHistory {
 contract:'character_resource_history_v1';bookId:string;characterId:string;selection:ResourceLedgerSelection;
 items:ResourceHistoryItem[];chapters:Array<{checkpointId:string;basis:StableResourceSupplementBasis|null;unavailableReason:string|null}>;
 truncated:boolean;sourceHash:string;
}

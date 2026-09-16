import type {BookSummary,CardTypeCapability,FieldDefinition} from "../contracts";

export type WorldCharacterMode="world"|"character";
export interface WorldCharacterQuery {mode:WorldCharacterMode;focusCardId?:string;}
export interface ProfessionalSourceAction {label:string;route:string;}
export interface ProfessionalField {field:FieldDefinition;versionId:string;origin:"type"|"book"|"local";}
export interface ProfessionalObject {
 id:string;title:string;typeId:string;typeKey:string;typeLabel:string;versionId:string|null;revision:number;
 capabilities:CardTypeCapability[];fields:ProfessionalField[];values:Record<string,unknown>;unavailableReason:string|null;
}
export interface ProfessionalRelation {
 id:string;versionId:string|null;revision:number;typeId:string;typeLabel:string;
 sourceId:string;targetId:string;sourceLabel:string;targetLabel:string;direction:"directed"|"undirected";
 properties:Array<{key:string;label:string;display:string}>;
 settlementLabel:string;dimensions:Array<{label:string;modeLabel:string;policyLabel:string}>;
 available:boolean;reason:string|null;action:ProfessionalSourceAction;
}
export interface ProfessionalState {
 id:string;subjectId:string;subjectKind:"card"|"relation";subjectLabel:string;fieldLabel:string;display:string;
 available:boolean;reason:string|null;projectionRevision:number;sourceKind:"initial"|"settlement"|"unknown";
 sourceId:string|null;bodyVersionId:string|null;action:ProfessionalSourceAction;
}
export interface ProfessionalKnowledge {
 id:string;subjectId:string|null;holderId:string|null;holderLabel:string;predicateLabel:string;display:string;
 stanceLabel:string;truthLabel:string;available:boolean;reason:string|null;bodyVersionId:string|null;
 projectionRevision:number;action:ProfessionalSourceAction;
}
export interface ProfessionalMilestone {id:string;label:string;statusLabel:string;createdAt:string;bodyVersionId:string|null;available:boolean;action:ProfessionalSourceAction;}
export interface ProfessionalConsistencyIssue {id:string;label:string;summary:string;objectIds:string[];action:ProfessionalSourceAction;}
export interface WorldCharacterMaintenanceWorkspace {
 book:BookSummary;mode:WorldCharacterMode;focusCardId:string|null;objects:ProfessionalObject[];
 relations:ProfessionalRelation[];states:ProfessionalState[];knowledge:ProfessionalKnowledge[];
 milestones:ProfessionalMilestone[];issues:ProfessionalConsistencyIssue[];truncated:boolean;
 notes:string[];
}

/** Domain categories use explicit installed type identities, never field-name keyword guessing. */
export const WORLD_PROFESSIONAL_TYPE_KEYS=["world_setting","world_overview","world_rule","time_rule","location","faction","organization","prop","power_system","race","culture","religion"] as const;
export function professionalObjectsForMode(objects:ProfessionalObject[],mode:WorldCharacterMode){return objects.filter(object=>mode==="character"?object.typeKey==="character":(WORLD_PROFESSIONAL_TYPE_KEYS as readonly string[]).includes(object.typeKey));}

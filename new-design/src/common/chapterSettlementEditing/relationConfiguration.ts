import type {FieldDefinition} from "../contracts";

export interface SettlementRelationDefinition {
  name:string;description:string;direction:"directed"|"undirected";
  sourceTypeKeys:string[];targetTypeKeys:string[];
  sourceMax:number|null;targetMax:number|null;
  fields:FieldDefinition[];
  capability:"disabled"|"optional"|"required";
  mode:"none"|"relation_state"|"lifecycle";
  dimensions:Array<{fieldKey:string;label:string;direction:"forward"|"inverse"|"bidirectional";policy:"tracked"|"derived"|"lifecycle_only";mode:"absolute"|"delta"|"derived"|"lifecycle"}>;
}
export interface SettlementRelationDraft {
  id:string;bookId:string;revision:number;versionId:string;version:number;status:"draft"|"published";
  relationTypeId:string|null;sourceRelationTypeId:string|null;expectedRelationTypeRevision:number|null;
  definition:SettlementRelationDefinition;
}
export interface SettlementPublishedRelation {
  id:string;key:string;name:string;revision:number;scope:"system"|"template"|"book";
  ownerSpaceId:string|null;editable:boolean;definition:SettlementRelationDefinition;
  instanceIds:string[];unavailableReason:string|null;
}
export interface SettlementRelationConfigurationWorkspace {
  bookId:string;bookName:string;spaceId:string;
  types:Array<{key:string;label:string}>;
  objects:Array<{id:string;label:string;typeKey:string}>;
  relations:Array<{id:string;label:string;revision:number;relationTypeId:string}>;
  published:SettlementPublishedRelation[];drafts:SettlementRelationDraft[];
}
export interface SettlementRelationDraftInput {
  requestKey:string;actor?:string;draftId?:string;expectedRevision?:number;
  relationTypeId?:string|null;sourceRelationTypeId?:string|null;
  expectedRelationTypeRevision:number|null;
  definition:SettlementRelationDefinition;
}
export interface SettlementRelationPublishInput {
  requestKey:string;actor?:string;draftId:string;expectedRevision:number;
  confirmPublish:boolean;
  confirmInstanceRebind:boolean;
  rebindRelations:Array<{id:string;expectedRevision:number}>;
  createRelations?:Array<{sourceCardId:string;targetCardId:string}>;
}
export interface SettlementRelationConfigurationReceipt {
  bookId:string;requestKey:string;operation:"save_draft"|"publish";
  draftId:string;versionId:string;relationTypeId:string|null;repeated:boolean;
  workspace:SettlementRelationConfigurationWorkspace;
}

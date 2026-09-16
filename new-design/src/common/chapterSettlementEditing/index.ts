import type { ChapterSettlementDraft, ChapterSettlementWorkspace, FieldDefinition } from "../contracts";
export * from "./relationConfiguration";

export interface SettlementBaseline {
  known: boolean;
  value: unknown;
  display: string;
  revision: number | null;
  sourceKind: "initial_state" | "state_change" | "unknown";
  sourceId: string | null;
  hash: string;
  stale: boolean;
}
export interface SettlementFieldChoice {
  key: string;
  label: string;
  field: FieldDefinition;
  mode: "absolute" | "delta" | "lifecycle";
  specificationHash: string;
  typeVersionId: string | null;
  relationTypeId: string | null;
  relationTypeRevision: number | null;
  capabilityRevision: number | null;
  dimensionRevision: number | null;
  dictionaryNodes: Array<{id:string;parentId:string|null;label:string;path:string[];versionId:string;status:"active"|"archived"}>;
  baseline: SettlementBaseline;
}
export interface SettlementSubjectChoice {
  id: string;
  subjectKind: "card" | "relation";
  label: string;
  typeKey: string;
  currentVersionId: string | null;
  categories: ChapterSettlementDraft["category"][];
  fields: SettlementFieldChoice[];
  unavailableReason: string | null;
}
export interface SettlementEditingCatalog {
  sessionId: string;
  bodyVersionId: string;
  bodyContentHash: string;
  sessionRevision: number;
  subjects: SettlementSubjectChoice[];
  objectChoices: Array<{id:string;label:string;typeKey:string}>;
  holderChoices: Array<{id:string;label:string}>;
  specificationHash: string;
}
export interface SettlementItemEditingMetadata {
  itemId: string;
  editable: boolean;
  unavailableReason: string | null;
  specificationHash: string | null;
  fieldLabel: string;
  beforeDisplay: string;
  afterDisplay: string;
  baseline: SettlementBaseline | null;
  domainRevision: number | null;
  knowledge?: {holderKind:"character"|"reader";holderCardId:string|null;holderKey:string;stance:ChapterSettlementDraft["stance"];acquisitionMethod:ChapterSettlementDraft["acquisitionMethod"]};
}
export interface ChapterSettlementEditingWorkspace extends ChapterSettlementWorkspace {
  blockedReason?:string|null;
  catalog: SettlementEditingCatalog;
  itemSpecifications: SettlementItemEditingMetadata[];
  aiDisabled: {reason:string;sourceRoute:string;actionLabel:string} | null;
}
export interface SettlementEditingDraft extends ChapterSettlementDraft {
  specificationHash: string;
  baselineHash: string;
}
export interface SettlementEditingMutation {
  expectedSessionRevision: number;
  requestKey: string;
  actor?: string;
}
export interface SettlementEditingCreateInput extends SettlementEditingMutation {draft:SettlementEditingDraft}
export interface SettlementEditingUpdateInput extends SettlementEditingCreateInput {expectedRevision:number;note?:string}
export interface SettlementEditingDecisionsInput extends SettlementEditingMutation {
  decisions:Array<{itemId:string;expectedRevision:number;decision:"confirm"|"reject"|"defer";note?:string}>;
}
export interface SettlementEditingCommitInput extends SettlementEditingMutation {note?:string}
export interface SettlementEditingInitialInput extends SettlementEditingMutation {
  subjectId:string;subjectKind:"card"|"relation";stateKey:string;specificationHash:string;value:unknown;note?:string;
}
export interface SettlementEditingReceipt {
  sessionId:string;
  requestKey:string;
  operation:"create"|"update"|"decide"|"commit"|"initial";
  itemId:string|null;
  workspace:ChapterSettlementEditingWorkspace;
  repeated:boolean;
}
export interface SettlementEditingAiImportInput extends SettlementEditingMutation {
  items:SettlementEditingDraft[];taskId:string;attemptId:string;bodyVersionId:string;catalogHash:string;contextManifestId:string;modelRouteSnapshotId:string;
}

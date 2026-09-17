import { z } from "zod";
import type { ResourceBackfillScope, ResourceBackfillFrozenScope } from "../characterResources";
import type { SettlementEditingCatalog } from "../chapterSettlementEditing";

/** Stable-chapter supplementation retains the original confirmed sources. */
export interface StableResourceSupplementBasis {
  contract: "stable_resource_supplement_basis_v1";
  bookId: string;
  chapterDocumentId: string;
  chapterCardId: string;
  chapterOrder: number;
  documentRevision: number;
  checkpointId: string;
  checkpointCreatedAt: string;
  sessionId: string;
  settlementId: string;
  adoptionId: string;
  preparationId: string;
  bodyVersionId: string;
  bodyContent: string;
  bodyContentHash: string;
  planningObjectId: string;
  planningVersionId: string;
  contextManifestId: string | null;
  policyVersionId: string;
  confirmed: { facts: string[]; knowledge: string[]; states: string[] };
  /** Complete immutable origin, including the unmodified checkpoint summary. */
  original: Record<string, unknown>;
  sourceHash: string;
}

export interface ResourceSupplementStateInput {
  bookId: string;
  checkpointId: string;
  subjectKind: "card" | "relation";
  subjectId: string;
  stateKey: string;
}

export interface ResourceSupplementHistoricalState {
  contract: "resource_supplement_historical_state_v1";
  bookId: string;
  checkpointId: string;
  chapterOrder: number;
  subjectKind: "card" | "relation";
  subjectId: string;
  stateKey: string;
  known: boolean;
  value: unknown;
  sourceKind: "state_change" | "initial_state" | "unknown";
  sourceId: string | null;
  /** Actual source record; no synthetic state or cache projection is created. */
  source: Record<string, unknown> | null;
  hash: string;
}

const ids = z.array(z.string().uuid()).min(1).max(200).refine(values => new Set(values).size === values.length);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = z.object({ relationTypeId: z.string().uuid(), holdingDimensionKey: z.string().min(1).max(100),
  specificationHash: hash, characterId: z.string().uuid(), characterVersionId: z.string().uuid(),
  characterRevision: z.number().int().positive(), resourceIds: ids, relationIds: ids }).strict();
export const resourceSupplementPreviewInputSchema = z.object({ checkpointId: z.string().uuid(), resourceScope: scope }).strict();
export const resourceSupplementStartInputSchema = resourceSupplementPreviewInputSchema.extend({
  requestKey: z.string().uuid(), expectedSourceHash: hash,
});
export interface ResourceSupplementPreviewInput { checkpointId: string; resourceScope: ResourceBackfillScope; }
export interface ResourceSupplementStartInput extends ResourceSupplementPreviewInput { requestKey: string; expectedSourceHash: string; }
export interface ResourceSupplementPreview {
  contract: "stable_resource_supplement_preview_v1";
  bookId: string;
  input: ResourceSupplementPreviewInput;
  basis: StableResourceSupplementBasis;
  resourceScope: ResourceBackfillFrozenScope;
  catalog: SettlementEditingCatalog;
  sourceHash: string;
}
export interface ResourceSupplementStartReceipt {
  contract: "stable_resource_supplement_start_v1";
  bookId: string;
  chapterDocumentId: string;
  sessionId: string;
  preparationId: string;
  baseCheckpointId: string;
  bodyVersionId: string;
  requestKey: string;
  input: ResourceSupplementStartInput;
  inputHash: string;
  sourceHash: string;
  sourceRoute: string;
  repeated: boolean;
}
export const resourceSupplementStartReceiptSchema = z.object({
  contract: z.literal("stable_resource_supplement_start_v1"), bookId: z.string().uuid(), chapterDocumentId: z.string().uuid(), sessionId: z.string().uuid(),
  preparationId: z.string().uuid(), baseCheckpointId: z.string().uuid(), bodyVersionId: z.string().uuid(),
  requestKey: z.string().uuid(), input: resourceSupplementStartInputSchema, inputHash: hash, sourceHash: hash,
  sourceRoute: z.string(), repeated: z.boolean(),
}).strict().refine(value => value.requestKey === value.input.requestKey
  && value.baseCheckpointId === value.input.checkpointId && value.sourceHash === value.input.expectedSourceHash
  && value.sourceRoute === `/new-design/books/${value.bookId}/writing?chapterDocument=${value.chapterDocumentId}&session=${value.sessionId}`);

/** Deterministic exclusion of recorded changes; never infers a new state. */
export function resourceSupplementChangeAlreadyConfirmed(states:Record<string,unknown>[],draft:{subjectKind?:string;subjectId?:string;stateKey?:string;beforeValue?:unknown;afterValue?:unknown}):boolean {
  const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
  return same(draft.beforeValue,draft.afterValue)||states.some(row=>row.subject_kind===draft.subjectKind
    &&row.subject_id===draft.subjectId&&row.state_key===draft.stateKey
    &&same(row.before_json,draft.beforeValue)&&same(row.after_json,draft.afterValue));
}

export interface ResourceSupplementStateChainImpact {
  chapterDocumentId:string;bodyVersionId:string;chapterOrder:number;stateChangeId:string;
  subjectKind:'card'|'relation';subjectId:string;stateKey:string;
  expectedBefore:unknown;recordedBefore:unknown;recordedAfter:unknown;
  effectiveStoryOrder:number|null;reason:'compatible'|'before_conflict'|'backdated_source';
}
export interface ResourceSupplementSettlementImpact {
  contract:'resource_supplement_settlement_impact_v1';bookId:string;sessionId:string;sessionRevision:number;
  baseCheckpointId:string;bodyVersionId:string;sourceHash:string;
  changes:Array<{itemId:string;proposalId:string;subjectKind:'card'|'relation';subjectId:string;stateKey:string;before:unknown;after:unknown}>;
  stateChain:ResourceSupplementStateChainImpact[];
  /** Full actual future document/body/plan/checkpoint and selected state-source records. */
  downstreamSource:{chapters:Record<string,unknown>[];states:Record<string,unknown>[];planningReferences:Record<string,unknown>[]};
  inputSnapshot:Record<string,unknown>;impactHash:string;
}

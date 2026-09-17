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

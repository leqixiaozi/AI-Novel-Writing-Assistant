/** Optional author controls. Absence of this contract always selects the legacy workflow. */
export type WritingControlKey = "pace" | "tension" | "suspicionTarget" | "dialogueDirectness" | "characterProminence";
export interface WritingControlValue {
  mode: "set" | "inherit" | "disabled";
  value?: number;
  subjectId?: string;
  objectId?: string;
  matter?: string;
  speakerId?: string;
  listenerId?: string;
  characterId?: string;
}
export type WritingControls = Partial<Record<WritingControlKey, WritingControlValue>>;
export interface WritingAdjustmentScope {
  kind: "novel" | "chapter" | "chapters" | "scene" | "selection";
  chapterId?: string;
  chapterIds?: string[];
  sceneId?: string;
  selection?: { from: number; to: number; text: string };
}
export interface WritingSettingsPayload {
  enabled: boolean;
  controls: WritingControls;
  preserve: string[];
}
export interface WritingControlDefinition {
  key: WritingControlKey;
  label: string;
  description: string;
  bands: string[];
  objects: string[];
}
export interface WritingSettingsResponse {
  revision: number;
  scopeKey: string;
  settings: WritingSettingsPayload;
  effective: WritingSettingsPayload;
  sources: Partial<Record<WritingControlKey, string>>;
  definitions: WritingControlDefinition[];
  presets: Array<{ id: string; name: string; revision: number; settings: WritingSettingsPayload }>;
}
export interface ResolvedWritingRequirements {
  id: string;
  novelId: string;
  chapterIds: string[];
  scope: WritingAdjustmentScope;
  controls: WritingControls;
  preserve: string[];
  summary: string;
  chapterRequirements?: Record<string, { controls: WritingControls; preserve: string[]; promptText: string }>;
  definitionVersion: string;
  baseRevisions: Record<string, string>;
  dependencyRevision: string;
  createdAt: string;
  expiresAt: string;
}
export interface WritingEditVersion {
  id: string;
  sessionId: string;
  chapterId: string;
  kind: string;
  baseRevision: string;
  content: string;
  contentHash: string;
  requirementsId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface WritingEvidence {
  id: string;
  sourceKind: "accepted_prose" | "plan" | "setting" | "candidate";
  sourceId: string;
  sourceRevision: string;
  chapterId: string | null;
  title: string;
  excerpt: string;
  locator: { from: number; to: number } | null;
  storyDayIndex?: number | null;
  participantIds?: string[];
}
export interface WritingEvidenceResponse {
  items: WritingEvidence[];
  searchedScope: string;
  missingEvidence: string[];
  nextCursor: string | null;
}
export interface WritingAdjustmentIssue {
  id: string;
  category: "continuity" | "character" | "expression" | "planning";
  description: string;
  evidenceIds: string[];
  suggestion: string;
  status: "open" | "dismissed" | "accepted_deviation" | "fixed";
  reason?: string;
}
export interface WritingReview {
  id: string;
  editVersionId: string;
  contentHash: string;
  dependencyRevision: string;
  issues: WritingAdjustmentIssue[];
  summary: string;
}
export interface WritingAcceptanceReceipt {
  id: string;
  chapterId: string;
  editVersionId: string;
  acceptedRevision: string;
  reviewState: "checked" | "accepted_deviation" | "not_reviewed";
  canonicalSyncStatus: "pending" | "running" | "succeeded" | "failed" | "superseded";
  error?: string;
  nextActions: string[];
}
export interface ManualWritingSession {
  id: string;
  chapterIds: string[];
  status: "active" | "completed";
  taskId?: string | null;
  runtimeId?: string | null;
}
export interface WritingAdjustmentWorkspace {
  chapters: Array<{ id: string; title: string; order: number; revision: string; content: string; expectation: string | null }>;
  characters: Array<{ id: string; name: string }>;
  scenes?: Array<{ id: string; chapterId: string; title: string; sortOrder: number }>;
  versions: WritingEditVersion[];
  /** Frozen, recoverable planning/event candidates; omitted by older servers. */
  planningVersions?: WritingEditVersion[];
  /** Reviews remain attached to their exact saved content version. */
  reviews?: WritingReview[];
  manualSessions: ManualWritingSession[];
  acceptances: WritingAcceptanceReceipt[];
  decisions: Array<{ id: string; content: string; status: string; chapterIds: string[]; revision: string; preserve: string[] }>;
}
export interface OptionalWritingAdjustment {
  contractVersion: 2;
  requirementsId: string;
  outputMode: "candidate" | "original";
}

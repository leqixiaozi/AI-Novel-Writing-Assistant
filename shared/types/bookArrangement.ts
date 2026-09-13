import type { WritingControls, WritingSettingsPayload } from "./writingAdjustments";

/** Only explicitly applied arrangements enter the optional writing contract. */
export interface BookArrangementChapterEdit {
  chapterId: string;
  note: string;
  controls: WritingControls;
  locked: boolean;
}
export interface BookArrangementCharacterSpan {
  id: string;
  characterId: string;
  chapterIds: string[];
  mode: "must" | "suggested" | "indirect" | "forbidden";
  weight: number | null;
  note: string;
}
export interface DraftPayload {
  baseRevision: string;
  chapterEdits: BookArrangementChapterEdit[];
  characterSpans: BookArrangementCharacterSpan[];
  pinnedTracks: string[];
}
export interface DraftRecord {
  revision: number;
  payload: DraftPayload;
  updatedAt: string | null;
}
export interface Preview {
  id: string;
  chapterIds: string[];
  excludedChapterIds: string[];
  changes: Array<{ chapterId: string; before: WritingSettingsPayload; after: WritingSettingsPayload }>;
  impact: string[];
  baseRevision: string;
}
export interface BookArrangementApplyReceipt {
  id: string;
  status: "applied";
  chapterIds: string[];
  appliedSettings: Record<string, { revision: number; settings: WritingSettingsPayload }>;
}
export interface BookArrangementEvent {
  id: string;
  title: string;
  summary: string;
  revision: string;
  chapterId: string | null;
  chapterOrder: number | null;
  storyDayIndex: number | null;
  storyTimeLabel: string | null;
  participantIds: string[];
  status: string;
  visibility: string;
}
/** Persisted records are not automatically verified facts; read evidenceLabel. */
export interface BookArrangementTrackRecord {
  id: string;
  sourceId: string;
  sourceEntity: string;
  chapterIds: string[];
  title: string;
  summary: string;
  status: string;
  basis: "plan" | "record" | "setting" | "unknown";
  evidenceLabel: string;
}
export interface BookArrangementRelation extends BookArrangementTrackRecord {
  sourceEntity: "CharacterRelationStage";
  sourceCharacterId: string;
  targetCharacterId: string;
  sourceType: string;
  chapterId: string | null;
  volumeId: string | null;
  isCurrent: boolean;
}
export interface BookArrangementClue extends BookArrangementTrackRecord {
  sourceEntity: "TimelineHook" | "ForeshadowState";
  setupChapterId: string | null;
  payoffChapterId: string | null;
  /** Original planned chapter number, not a verified stable chapter reference. */
  expectedPayoffChapterOrder: number | null;
  sourceSnapshotId: string | null;
}
export interface BookArrangementCheck extends BookArrangementTrackRecord {
  sourceEntity: "AuditIssue" | "OpenConflict";
  chapterId: string | null;
  severity: string;
  category: string;
  evidence: string | null;
  fixSuggestion: string | null;
  reportId: string | null;
  /** Null means the original source does not bind its result to a content hash. */
  sourceRevision: string | null;
}
export interface BookArrangementWorkspace {
  novelId: string;
  title: string;
  baseRevision: string;
  chapters: Array<{ id: string; title: string; order: number; revision: string; outline: string; hasContent: boolean; wordCount: number }>;
  characters: Array<{ id: string; name: string; role: string | null }>;
  events: BookArrangementEvent[];
  scenes: Array<{ id: string; chapterId: string; title: string; objective: string | null; sortOrder: number }>;
  volumes: Array<{ id: string; title: string; order: number; chapterIds: string[]; startChapterOrder: number | null; endChapterOrder: number | null }>;
  appliedSettings: Record<string, { revision: number; settings: WritingSettingsPayload }>;
  draft: DraftRecord;
  previews: Preview[];
  relations?: BookArrangementRelation[];
  clues?: BookArrangementClue[];
  checks?: BookArrangementCheck[];
  coverUrl?: string | null;
  genre?: { id: string; name: string } | null;
}
export interface BookArrangementSaveDraftRequest { expectedRevision: number; payload: DraftPayload }
export interface BookArrangementPreviewRequest { draftRevision: number; chapterIds: string[] }
export interface BookArrangementApplyRequest { chapterIds: string[] }
export type BookArrangementDraftPayload = DraftPayload;
export type BookArrangementDraftRecord = DraftRecord;
export type BookArrangementPreview = Preview;

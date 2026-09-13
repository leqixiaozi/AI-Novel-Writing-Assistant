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
  volumeEdits?: BookArrangementVolumeEdit[];
}
export interface BookArrangementVolumeEdit {
  volumeId: string;
  title: string;
  summary: string;
  mainPromise: string;
  protagonistChange: string;
  climax: string;
  nextVolumeHook: string;
  chapterIds: string[];
}
export interface BookArrangementVolume {
  id: string; title: string; order: number; chapterIds: string[];
  startChapterOrder: number | null; endChapterOrder: number | null;
  summary?: string; mainPromise?: string; protagonistChange?: string; climax?: string; nextVolumeHook?: string;
  revision?: string;
}
export interface BookArrangementVolumePreview {
  id: string; baseRevision: string; draftRevision: number; volumeIds: string[];
  changes: Array<{ volumeId: string; before: BookArrangementVolumeEdit; after: BookArrangementVolumeEdit; addedChapterIds: string[]; removedChapterIds: string[] }>;
  affectedChapterIds: string[]; writtenChapterIds: string[];
  neighboringVolumeIds: string[];
  conflicts: Array<{ code: string; message: string; volumeIds: string[]; chapterIds: string[] }>;
  references: Array<{ sourceEntity: string; sourceId: string; chapterIds: string[]; volumeId: string | null; label: string }>;
  impact: string[]; unchecked: string[];
  canApply: boolean;
}
export interface BookArrangementVolumeApplyReceipt {
  id: string; status: "applied"; volumeVersionId: string; volumeIds: string[]; affectedChapterIds: string[];
}
export interface BookArrangementVolumePreviewRequest { draftRevision: number; volumeIds: string[] }
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
export type BookArrangementHookStage = "setup" | "reinforce" | "misdirect" | "reveal" | "payoff" | "aftermath";
export interface BookArrangementHookNode extends BookArrangementTrackRecord {
  sourceEntity: "TimelineHookLifecycleNode";
  hookId: string;
  chapterId: string;
  chapterOrder: number;
  stage: BookArrangementHookStage;
  nodeBasis: "plan" | "record";
  note: string;
  evidence: string | null;
  evidenceStatus: "planned" | "matched" | "mismatch" | "missing";
  relatedEventId: string | null;
  relatedSceneId: string | null;
  position: number;
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
  chapters: Array<{ id: string; title: string; order: number; revision: string; outline: string; hasContent: boolean; wordCount: number; targetWordCount: number | null }>;
  characters: Array<{ id: string; name: string; role: string | null }>;
  events: BookArrangementEvent[];
  scenes: BookArrangementScene[];
  volumes: BookArrangementVolume[];
  appliedSettings: Record<string, { revision: number; settings: WritingSettingsPayload }>;
  draft: DraftRecord;
  previews: Preview[];
  relations?: BookArrangementRelation[];
  clues?: BookArrangementClue[];
  hookNodes?: BookArrangementHookNode[];
  checks?: BookArrangementCheck[];
  coverUrl?: string | null;
  genre?: { id: string; name: string } | null;
  volumePreviews?: BookArrangementVolumePreview[];
  objectPreviews?: BookArrangementObjectPreview[];
  scenePreviews?: BookArrangementScenePreview[];
}
export interface BookArrangementSaveDraftRequest { expectedRevision: number; payload: DraftPayload }
export interface BookArrangementPreviewRequest { draftRevision: number; chapterIds: string[] }
export interface BookArrangementApplyRequest { chapterIds: string[] }
export type BookArrangementDraftPayload = DraftPayload;
export type BookArrangementDraftRecord = DraftRecord;
export type BookArrangementPreview = Preview;

export type BookArrangementObjectKind = "event" | "scene" | "relation" | "hook" | "hookNode" | "foreshadow";
export type BookArrangementObjectValue = string | number | boolean | null | string[];
export interface BookArrangementObjectField {
  key: string; label: string;
  type: "text" | "textarea" | "number" | "boolean" | "chapter" | "character" | "characters" | "volume" | "hook" | "event" | "scene" | "events" | "select";
  required?: boolean; readOnly?: boolean; options?: Array<{ value: string; label: string }>;
}
export interface BookArrangementObjectDetail {
  kind: BookArrangementObjectKind; id: string; sourceEntity: string; revision: string;
  title: string; chapterIds: string[]; basis: "plan" | "record" | "setting" | "unknown";
  fields: Record<string, BookArrangementObjectValue>; fieldDefinitions: BookArrangementObjectField[];
  editable: boolean; deletable: boolean; evidenceLabel: string;
  /** Complete original entity, read-only; original status and evidence are retained. */
  record: Record<string, unknown>;
}
export interface BookArrangementObjectPreviewRequest {
  kind: BookArrangementObjectKind; action: "create" | "update" | "delete";
  objectId?: string; expectedRevision?: string;
  patch: Record<string, BookArrangementObjectValue>;
}
export interface BookArrangementObjectPreview {
  applied?: BookArrangementObjectApplyReceipt;
  id: string; kind: BookArrangementObjectKind; action: "create" | "update" | "delete"; objectId: string;
  before: BookArrangementObjectDetail | null; after: BookArrangementObjectDetail | null;
  affectedChapterIds: string[]; writtenChapterIds: string[];
  references: Array<{ sourceEntity: string; sourceId: string; chapterIds: string[]; label: string }>;
  impact: string[]; unchecked: string[]; baseRevision: string;
  conflicts: Array<{ code: string; message: string; chapterIds: string[] }>; canApply: boolean;
}
export interface BookArrangementObjectApplyReceipt {
  id: string; status: "applied"; kind: BookArrangementObjectKind; objectId: string; affectedChapterIds: string[];
}

export interface BookArrangementScene {
  id: string; revision: string; chapterId: string; sortOrder: number;
  title: string; objective: string; conflict: string; reveal: string; emotionBeat: string;
  targetWordCount: number; mustAdvance: string[]; mustPreserve: string[];
  entryState: string; exitState: string; forbiddenExpansion: string[];
  resistance: string; turn: string; emotionalShift: string; readerValue: string;
}
export interface BookArrangementScenePreviewRequest {
  chapterId: string; expectedChapterRevision: string; scenes: BookArrangementScene[];
}
export interface BookArrangementScenePreview {
  applied?: BookArrangementSceneApplyReceipt;
  id: string; chapterId: string; before: BookArrangementScene[]; after: BookArrangementScene[];
  affectedChapterIds: string[]; writtenChapterIds: string[]; baseRevision: string;
  impact: string[]; unchecked: string[];
  conflicts: Array<{ code: string; message: string; chapterIds: string[] }>; canApply: boolean;
}
export interface BookArrangementSceneApplyReceipt {
  id: string; status: "applied"; chapterId: string; sceneIds: string[];
}

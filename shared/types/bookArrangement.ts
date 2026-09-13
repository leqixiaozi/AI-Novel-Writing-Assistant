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
}
export interface BookArrangementSaveDraftRequest { expectedRevision: number; payload: DraftPayload }
export interface BookArrangementPreviewRequest { draftRevision: number; chapterIds: string[] }
export interface BookArrangementApplyRequest { chapterIds: string[] }
export type BookArrangementDraftPayload = DraftPayload;
export type BookArrangementDraftRecord = DraftRecord;
export type BookArrangementPreview = Preview;

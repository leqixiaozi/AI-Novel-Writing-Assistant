import type { BookArrangementChapterEdit, BookArrangementCheck, BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import type { WritingControlKey, WritingControls } from "@ai-novel/shared/types/writingAdjustments";

export const arrangementTracks: Array<{ key: WritingControlKey; label: string; color: string }> = [
  { key: "pace", label: "叙述节奏", color: "#3b82f6" },
  { key: "tension", label: "紧张感表达", color: "#ea764b" },
  { key: "suspicionTarget", label: "疑点显著程度", color: "#9964d9" },
  { key: "dialogueDirectness", label: "对话直接程度", color: "#159c92" },
  { key: "characterProminence", label: "人物存在感", color: "#d45892" },
];
export const presenceLabels = { must: "必须出场", suggested: "建议参与", indirect: "间接影响", forbidden: "禁止出场" };
export const eventStatusLabels: Record<string, string> = { planned: "规划", occurred: "已发生", foreshadowed: "已铺垫", resolved: "已解决", cancelled: "已取消", superseded: "已替代" };

export const auditDimensions = [
  { key: "ai", label: "AI味" },
  { key: "logic", label: "逻辑性" },
  { key: "character", label: "人物一致性" },
  { key: "pace", label: "节奏偏差" },
] as const;
export type AuditDimensionKey = typeof auditDimensions[number]["key"];
export type AuditHeatState = "empty" | "handled" | "low" | "medium" | "high" | "critical";

/** Convert backend audit categories into four stable labels that authors can scan. */
export function auditDimension(check: Pick<BookArrangementCheck, "title" | "category">): AuditDimensionKey {
  const title = check.title.toLocaleLowerCase();
  const category = check.category.toLocaleLowerCase();
  if (/(pace|rhythm|tension|ending_hook|info_drop|repetition|overshoot)/u.test(title)) return "pace";
  if (/(logic|chain|continuity|causal|plot)/u.test(title)) return "logic";
  if (/(character|persona|motivation|goal_shift)/u.test(title)) return "character";
  if (category === "mode_fit" || category.includes("style") || category.includes("voice")) return "ai";
  if (category.includes("character")) return "character";
  return "logic";
}

/** A heat cell represents the highest unresolved severity; resolved-only cells remain visible. */
export function auditHeatState(checks: Array<Pick<BookArrangementCheck, "status" | "severity">>): AuditHeatState {
  if (!checks.length) return "empty";
  const handled = new Set(["resolved", "ignored", "closed"]);
  const open = checks.filter(check => !handled.has(check.status.toLocaleLowerCase()));
  if (!open.length) return "handled";
  const weights: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const states: AuditHeatState[] = ["empty", "low", "medium", "high", "critical"];
  const highest = open.reduce((result, check) => Math.max(result, weights[check.severity.toLocaleLowerCase()] ?? weights.medium), 0);
  return states[highest] ?? "medium";
}

/** Window coordinates are array indices, never chapter order numbers. */
export function chapterWindow<T>(chapters: T[], requestedStart: number, size = 8) {
  const start = Math.max(0, Math.min(Math.floor(requestedStart) || 0, Math.max(0, chapters.length - size)));
  return { start, chapters: chapters.slice(start, start + size) };
}

export type ChapterWindowEdge = "start" | "end";

/** Boundary is an exclusive chapter-array index, matching a range selection frame. */
export function resizeChapterWindow(total: number, start: number, size: number, edge: ChapterWindowEdge, boundary: number) {
  if (total <= 0) return { start: 0, size: 0 };
  const minimum = Math.min(4, total), maximum = Math.min(16, total);
  const safeStart = Math.max(0, Math.min(Math.floor(start), total - minimum));
  const safeSize = Math.max(minimum, Math.min(maximum, Math.floor(size), total - safeStart));
  if (edge === "start") {
    const end = safeStart + safeSize;
    const nextStart = Math.max(0, Math.min(Math.round(boundary), end - minimum));
    const boundedStart = Math.max(end - maximum, nextStart);
    return { start: boundedStart, size: end - boundedStart };
  }
  const end = Math.max(safeStart + minimum, Math.min(Math.round(boundary), safeStart + maximum, total));
  return { start: safeStart, size: end - safeStart };
}

export function chapterOverviewSegments<T extends { id: string; title: string; chapterIds: string[] }>(chapters: Array<{ id: string }>, volumes: T[]) {
  const positions = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  return volumes.flatMap(volume => {
    const included = new Set(volume.chapterIds.flatMap(id => positions.has(id) ? [positions.get(id)!] : []));
    const segments: Array<{ id: string; volume: T; start: number; end: number }> = [];
    let start = -1;
    for (let index = 0; index <= chapters.length; index++) {
      if (included.has(index)) { if (start < 0) start = index; continue; }
      if (start >= 0) { segments.push({ id: `${volume.id}:${start}`, volume, start, end: index - 1 }); start = -1; }
    }
    return segments;
  });
}

export interface ChapterLaneSegment<T> {
  source: T;
  segmentId: string;
  chapterIds: string[];
  start: number;
  end: number;
  lane: number;
}

/** Split gaps before packing; lane placement depends on stable IDs, never names or input order. */
export function packChapterLanes<T extends { id: string; chapterIds: string[] }>(chapters: Array<{ id: string }>, entries: T[]): ChapterLaneSegment<T>[] {
  const segments: ChapterLaneSegment<T>[] = [];
  for (const source of entries) {
    const included = new Set(source.chapterIds);
    let start = -1;
    const finish = (end: number) => {
      if (start < 0) return;
      const chapterIds = chapters.slice(start, end + 1).map(chapter => chapter.id);
      segments.push({ source, segmentId: `${source.id}:${chapterIds[0]}`, chapterIds, start, end, lane: 0 });
      start = -1;
    };
    chapters.forEach((chapter, index) => {
      if (included.has(chapter.id)) { if (start < 0) start = index; }
      else finish(index - 1);
    });
    finish(chapters.length - 1);
  }
  segments.sort((left, right) => left.start - right.start || right.end - left.end || left.source.id.localeCompare(right.source.id));
  const laneEnds: number[] = [];
  return segments.map(segment => {
    let lane = laneEnds.findIndex(end => end < segment.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = segment.end;
    return { ...segment, lane };
  });
}

export interface CharacterPresenceEntry {
  id: string;
  characterId: string;
  name: string;
  chapterIds: string[];
  kind: "record" | "plan";
  spanId?: string;
  mode?: keyof typeof presenceLabels;
  weight: number | null;
  note: string;
}

/** Participation from occurred/resolved events is evidence; draft spans remain author plans. */
export function characterPresenceEntries(workspace: BookArrangementWorkspace, draft: BookArrangementDraftPayload): CharacterPresenceEntry[] {
  const entries: CharacterPresenceEntry[] = [];
  const chapterIds = new Set(workspace.chapters.map(chapter => chapter.id));
  for (const character of workspace.characters) {
    const recordedIds = new Set(workspace.events.filter(event => event.chapterId && chapterIds.has(event.chapterId) && (event.status === "occurred" || event.status === "resolved") && event.participantIds.includes(character.id)).map(event => event.chapterId!));
    if (recordedIds.size) entries.push({ id: `record:${character.id}`, characterId: character.id, name: character.name, chapterIds: workspace.chapters.filter(chapter => recordedIds.has(chapter.id)).map(chapter => chapter.id), kind: "record", weight: null, note: "来自已有事件参与记录" });
  }
  for (const span of draft.characterSpans) {
    const character = workspace.characters.find(person => person.id === span.characterId);
    if (!character) continue;
    entries.push({ id: `plan:${span.id}`, spanId: span.id, characterId: character.id, name: character.name, chapterIds: span.chapterIds.filter(id => chapterIds.has(id)), kind: "plan", mode: span.mode, weight: span.weight, note: span.note });
  }
  return entries;
}

export function characterTrackColor(characterId: string): string {
  const colors = ["#3b82f6", "#e75a9d", "#18a68a", "#9964d9", "#dc873b", "#568aa7"];
  let hash = 0;
  for (const character of characterId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}
export function chapterRange(chapters: Array<{ id: string }>, first: string, last: string): string[] {
  const from = chapters.findIndex(chapter => chapter.id === first);
  const to = chapters.findIndex(chapter => chapter.id === last);
  if (from < 0 || to < 0) return [];
  return chapters.slice(Math.min(from, to), Math.max(from, to) + 1).map(chapter => chapter.id);
}
export function editableChapterIds(draft: BookArrangementDraftPayload, selected: string[]): string[] {
  const locked = new Set(draft.chapterEdits.filter(edit => edit.locked).map(edit => edit.chapterId));
  return [...new Set(selected)].filter(id => !locked.has(id));
}
export function controlValue(controls: WritingControls | undefined, key: WritingControlKey): number | null {
  const control = controls?.[key];
  return control?.mode === "set" && typeof control.value === "number" ? control.value : null;
}
/** Null points split a curve; an explicit zero is still a visible point. */
export function curveSegments(values: Array<number | null>): Array<Array<{ x: number; y: number }>> {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value === null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push({ x: index * 100 + 50, y: 50 - value * 0.4 });
  });
  if (segment.length) segments.push(segment);
  return segments;
}
export function chapterEdit(draft: BookArrangementDraftPayload, chapterId: string): BookArrangementChapterEdit {
  return draft.chapterEdits.find(edit => edit.chapterId === chapterId) ?? { chapterId, note: "", controls: {}, locked: false };
}
export function updateChapterEdit(draft: BookArrangementDraftPayload, chapterId: string, patch: Partial<BookArrangementChapterEdit>): BookArrangementDraftPayload {
  return { ...draft, chapterEdits: [...draft.chapterEdits.filter(edit => edit.chapterId !== chapterId), { ...chapterEdit(draft, chapterId), ...patch, chapterId }] };
}
export function draftDirty(draft: BookArrangementDraftPayload, saved: BookArrangementDraftPayload): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}
export function buildArrangementPlanInput(workspace: BookArrangementWorkspace, draft: BookArrangementDraftPayload, selected: string[], instruction: string, preserve: string[]) {
  const chapterIds = editableChapterIds(draft, selected).filter(id => workspace.chapters.some(chapter => chapter.id === id));
  const chapters = chapterIds.map(chapterId => ({ title: workspace.chapters.find(chapter => chapter.id === chapterId)?.title, ...chapterEdit(draft, chapterId),
    characterSpans: draft.characterSpans.filter(span => span.chapterIds.includes(chapterId)).map(span => ({ characterId: span.characterId, characterName: workspace.characters.find(person => person.id === span.characterId)?.name, mode: span.mode, weight: span.weight, note: span.note })) }));
  return { chapterIds, instruction: `${instruction.trim() || "依据已保存编排要求调整所选章节大纲，保持已有因果及未授权范围。"}\n\n作者已保存的本次编排要求（仅应用在所选章节；人物参与规则属于规划，不是已发生事实；以本次草稿为准，已移除的旧区段要求不继续沿用）：\n${JSON.stringify(chapters)}`,
    preserve: [...preserve, "保留所选范围外（包括锁定章节）的章节规划与编排；保留历史正文。"] };
}

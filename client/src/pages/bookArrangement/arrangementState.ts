import type { BookArrangementChapterEdit, BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
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

/** Window coordinates are array indices, never chapter order numbers. */
export function chapterWindow<T>(chapters: T[], requestedStart: number, size = 10) {
  const start = Math.max(0, Math.min(Math.floor(requestedStart) || 0, Math.max(0, chapters.length - size)));
  return { start, chapters: chapters.slice(start, start + size) };
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

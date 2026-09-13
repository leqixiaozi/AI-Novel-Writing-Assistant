import type { BookArrangementCharacterSpan, BookArrangementDraftPayload } from "@ai-novel/shared/types/bookArrangement";
import { changeVolumeRange, type VolumeRangeAction } from "../volume/volumeState.ts";

export function characterSpanError(draft: BookArrangementDraftPayload, span: BookArrangementCharacterSpan): string | null {
  if (!span.chapterIds.length) return "人物区段至少包含一章。";
  if (draft.characterSpans.some(item => item.id !== span.id && item.characterId === span.characterId && item.chapterIds.some(id => span.chapterIds.includes(id)))) return "同一人物的区段不能重叠，请选择空闲章节或合并相邻区段。";
  if (span.chapterIds.some(id => draft.chapterEdits.some(edit => edit.chapterId === id && edit.locked))) return "调整范围包含锁定章节。";
  return null;
}

export function moveCharacterSpan(draft: BookArrangementDraftPayload, id: string, chapters: Array<{ id: string }>, action: VolumeRangeAction, delta: number): BookArrangementDraftPayload {
  const span = draft.characterSpans.find(item => item.id === id);
  if (!span) return draft;
  const chapterIds = changeVolumeRange(chapters, span.chapterIds, action, delta);
  const locked = new Set(draft.chapterEdits.filter(edit => edit.locked).map(edit => edit.chapterId));
  if ([...span.chapterIds, ...chapterIds].some(chapterId => locked.has(chapterId))) return draft;
  if (characterSpanError(draft, { ...span, chapterIds }) || JSON.stringify(chapterIds) === JSON.stringify(span.chapterIds)) return draft;
  return { ...draft, characterSpans: draft.characterSpans.map(item => item.id === id ? { ...item, chapterIds } : item) };
}

export function splitCharacterSpan(span: BookArrangementCharacterSpan, chapters: Array<{ id: string }>, splitAtId: string, newId: string): BookArrangementCharacterSpan[] | null {
  const ordered = chapters.filter(chapter => span.chapterIds.includes(chapter.id)).map(chapter => chapter.id);
  const split = ordered.indexOf(splitAtId);
  if (split <= 0 || !newId || newId === span.id) return null;
  return [{ ...span, chapterIds: ordered.slice(0, split) }, { ...span, id: newId, chapterIds: ordered.slice(split) }];
}

export function mergeCharacterSpans(first: BookArrangementCharacterSpan, second: BookArrangementCharacterSpan, chapters: Array<{ id: string }>): BookArrangementCharacterSpan | null {
  if (first.id === second.id || first.characterId !== second.characterId || first.mode !== second.mode || first.weight !== second.weight || first.note !== second.note) return null;
  const ids = new Set([...first.chapterIds, ...second.chapterIds]);
  const indexes = chapters.flatMap((chapter, index) => ids.has(chapter.id) ? [index] : []);
  if (!indexes.length || indexes.at(-1)! - indexes[0] + 1 !== indexes.length) return null;
  return { ...first, chapterIds: indexes.map(index => chapters[index].id) };
}

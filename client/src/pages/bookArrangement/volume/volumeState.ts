import type { BookArrangementVolumeEdit, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";

export type VolumeRangeAction = "move" | "resize-start" | "resize-end";
export interface VolumeRangeUndo { volumeId: string; before: string[]; after: string[] }
export interface VolumeVisibleSegment { chapterIds: string[]; start: number; end: number; canResizeStart: boolean; canResizeEnd: boolean }

export function snapChapterDelta(originX: number, currentX: number, columnWidth: number, windowShift = 0): number {
  if (!Number.isFinite(columnWidth) || columnWidth <= 0) return 0;
  const value = (currentX - originX) / columnWidth + windowShift;
  if (!Number.isFinite(value)) return 0;
  return (Math.sign(value) * Math.floor(Math.abs(value) + 0.5)) || 0;
}

/** Geometry is measured in sorted array positions; chapter order numbers may have gaps. */
export function changeVolumeRange(chapters: Array<{ id: string }>, chapterIds: string[], action: VolumeRangeAction, requestedDelta: number): string[] {
  const included = new Set(chapterIds);
  const indices = chapters.flatMap((chapter, index) => included.has(chapter.id) ? [index] : []);
  if (!indices.length) return [];
  const start = indices[0], end = indices[indices.length - 1];
  const delta = Number.isFinite(requestedDelta) ? Math.trunc(requestedDelta) : 0;
  if (action === "move") {
    const offset = Math.max(-start, Math.min(delta, chapters.length - end - 1));
    return indices.map(index => chapters[index + offset].id);
  }
  const changedBoundary = action === "resize-start"
    ? Math.max(0, Math.min(start + delta, end))
    : Math.max(start, Math.min(end + delta, chapters.length - 1));
  const nextIndices = new Set(indices.filter(index => action === "resize-start" ? index >= changedBoundary : index <= changedBoundary));
  nextIndices.add(changedBoundary);
  if (action === "resize-start") for (let index = changedBoundary; index < start; index += 1) nextIndices.add(index);
  else for (let index = end + 1; index <= changedBoundary; index += 1) nextIndices.add(index);
  return [...nextIndices].sort((a, b) => a - b).map(index => chapters[index].id);
}

export function clipVolumeSegments(visibleChapters: Array<{ id: string }>, chapterIds: string[], allChapters: Array<{ id: string }>): VolumeVisibleSegment[] {
  const included = new Set(chapterIds);
  const allIds = allChapters.filter(chapter => included.has(chapter.id)).map(chapter => chapter.id);
  const result: VolumeVisibleSegment[] = [];
  let start = -1;
  const finish = (end: number) => {
    if (start < 0) return;
    const ids = visibleChapters.slice(start, end + 1).map(chapter => chapter.id);
    result.push({ chapterIds: ids, start, end, canResizeStart: ids[0] === allIds[0], canResizeEnd: ids[ids.length - 1] === allIds[allIds.length - 1] });
    start = -1;
  };
  visibleChapters.forEach((chapter, index) => {
    if (included.has(chapter.id)) { if (start < 0) start = index; }
    else finish(index - 1);
  });
  finish(visibleChapters.length - 1);
  return result;
}

export function makeVolumeEdit(volume: BookArrangementWorkspace["volumes"][number], draft?: BookArrangementVolumeEdit): BookArrangementVolumeEdit {
  if (draft?.volumeId === volume.id) return { ...draft, chapterIds: [...draft.chapterIds] };
  return { volumeId: volume.id, title: volume.title, summary: volume.summary ?? "", mainPromise: volume.mainPromise ?? "", protagonistChange: volume.protagonistChange ?? "", climax: volume.climax ?? "", nextVolumeHook: volume.nextVolumeHook ?? "", chapterIds: [...volume.chapterIds] };
}

/** Undo only a still-current range; later title/summary edits remain untouched. */
export function undoVolumeRange(current: BookArrangementVolumeEdit, undo: VolumeRangeUndo): BookArrangementVolumeEdit | null {
  if (current.volumeId !== undo.volumeId || JSON.stringify(current.chapterIds) !== JSON.stringify(undo.after)) return null;
  return { ...current, chapterIds: [...undo.before] };
}

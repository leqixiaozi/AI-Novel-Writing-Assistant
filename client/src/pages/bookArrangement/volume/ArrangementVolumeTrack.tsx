import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, GripVertical, Undo2 } from "lucide-react";
import type { BookArrangementDraftPayload, BookArrangementVolumeEdit, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { packChapterLanes } from "../arrangementState";
import { changeVolumeRange, clipVolumeSegments, makeVolumeEdit, snapChapterDelta, undoVolumeRange, type VolumeRangeAction, type VolumeRangeUndo } from "./volumeState";

interface Props {
  workspace: BookArrangementWorkspace;
  draft: BookArrangementDraftPayload;
  chapters: BookArrangementWorkspace["chapters"];
  selectedChapterId?: string;
  selectedVolumeId?: string;
  onVolume?: (id: string) => void;
  onVolumeEdit?: (edit: BookArrangementVolumeEdit) => void;
  windowStart?: number;
  onWindowStart?: (index: number) => void;
}
interface DragSession {
  pointerId: number;
  action: VolumeRangeAction;
  original: BookArrangementVolumeEdit;
  originX: number;
  currentX: number;
  originWindowStart: number;
  currentWindowStart: number;
  columnWidth: number;
  originLane: number;
  dragging: boolean;
  chapterIds: string[];
}
const actionLabels: Record<VolumeRangeAction, string> = { move: "移动", "resize-start": "调整起点", "resize-end": "调整终点" };

/** A local pointer preview commits one range edit on release, without rearranging chapters or neighbors. */
export function ArrangementVolumeTrack({ workspace, draft, chapters, selectedChapterId, selectedVolumeId, onVolume, onVolumeEdit, windowStart, onWindowStart }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [undo, setUndo] = useState<VolumeRangeUndo | null>(null);
  const [notice, setNotice] = useState("");
  const sourceEdits = workspace.volumes.map(volume => makeVolumeEdit(volume, draft.volumeEdits?.find(edit => edit.volumeId === volume.id)));
  const startIndex = windowStart ?? Math.max(0, workspace.chapters.findIndex(chapter => chapter.id === chapters[0]?.id));
  const latest = useRef({ workspace, chapters, sourceEdits, onVolumeEdit, onVolume, onWindowStart, startIndex });
  latest.current = { workspace, chapters, sourceEdits, onVolumeEdit, onVolume, onWindowStart, startIndex };
  const visibleEdits = sourceEdits.map(edit => ({ ...edit, id: edit.volumeId, chapterIds: drag?.dragging && drag.original.volumeId === edit.volumeId ? drag.chapterIds : edit.chapterIds }));
  const segments = packChapterLanes(chapters, visibleEdits);
  const ghostSegments = drag?.dragging ? clipVolumeSegments(chapters, drag.original.chapterIds, workspace.chapters) : [];
  const lanes = Math.max(1, ...segments.map(segment => segment.lane + 1), ghostSegments.length && drag ? drag.originLane + 1 : 0);
  const rangeText = (ids: string[]) => {
    const included = new Set(ids);
    const ordered = workspace.chapters.filter(chapter => included.has(chapter.id));
    return ordered.length ? `第 ${ordered[0].order}—${ordered[ordered.length - 1].order} 章 · ${ordered.length} 章` : "未指定章节";
  };
  const color = (volumeId: string) => workspace.volumes.findIndex(volume => volume.id === volumeId) % 2 ? "#f47936" : "#3b82f6";
  const style = (segment: { start: number; end: number; lane: number }, volumeId: string): CSSProperties => ({ gridColumn: `${segment.start + 1} / span ${segment.end - segment.start + 1}`, gridRow: segment.lane + 1, "--ba-color": color(volumeId) } as CSSProperties);

  const endCapture = (session: DragSession) => {
    dragRef.current = null; setDrag(null);
    if (trackRef.current?.hasPointerCapture(session.pointerId)) trackRef.current.releasePointerCapture(session.pointerId);
  };
  const cancelDrag = () => {
    const session = dragRef.current;
    if (!session) return;
    endCapture(session); setNotice("已取消卷段范围调整。");
  };
  const previewAt = (x: number, visibleStart = dragRef.current?.currentWindowStart ?? latest.current.startIndex) => {
    const session = dragRef.current;
    if (!session) return;
    if (trackRef.current?.closest("fieldset[disabled]")) { cancelDrag(); return; }
    const dragging = session.dragging || Math.abs(x - session.originX) >= 5;
    const delta = snapChapterDelta(session.originX, x, session.columnWidth, visibleStart - session.originWindowStart);
    const next = { ...session, currentX: x, currentWindowStart: visibleStart, dragging, chapterIds: dragging ? changeVolumeRange(latest.current.workspace.chapters, session.original.chapterIds, session.action, delta) : session.original.chapterIds };
    dragRef.current = next; setDrag(next);
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, edit: BookArrangementVolumeEdit, action: VolumeRangeAction, lane: number) => {
    if (event.button !== 0 || !event.isPrimary || event.currentTarget.matches(":disabled")) return;
    event.stopPropagation();
    if (!onVolumeEdit || !trackRef.current || !edit.chapterIds.length) return;
    const box = trackRef.current.getBoundingClientRect();
    if (!box.width || !chapters.length) return;
    event.preventDefault();
    event.currentTarget.focus();
    const session: DragSession = { pointerId: event.pointerId, action, original: { ...edit, chapterIds: [...edit.chapterIds] }, originX: event.clientX, currentX: event.clientX, originWindowStart: startIndex, currentWindowStart: startIndex, columnWidth: box.width / chapters.length, originLane: lane, dragging: false, chapterIds: [...edit.chapterIds] };
    dragRef.current = session; setDrag(session); setNotice("");
    trackRef.current.setPointerCapture(event.pointerId);
  };
  const commit = (edit: BookArrangementVolumeEdit, ids: string[]) => {
    if (!ids.length || JSON.stringify(ids) === JSON.stringify(edit.chapterIds)) return;
    setUndo({ volumeId: edit.volumeId, before: [...edit.chapterIds], after: [...ids] });
    latest.current.onVolumeEdit?.({ ...edit, chapterIds: ids });
    setNotice(`${edit.title}的范围已调整为${rangeText(ids)}。保存草稿后可预览卷规划。`);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const session = dragRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    // Pointerup can carry a final position after the last pointermove.
    previewAt(event.clientX, session.currentWindowStart);
    const finalSession = dragRef.current;
    if (!finalSession) return;
    endCapture(finalSession);
    if (finalSession.dragging) commit(finalSession.original, finalSession.chapterIds);
    else latest.current.onVolume?.(finalSession.original.volumeId);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, edit: BookArrangementVolumeEdit, action: VolumeRangeAction) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (!onVolumeEdit || event.currentTarget.matches(":disabled")) return;
    event.preventDefault(); event.stopPropagation();
    const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1);
    const ids = changeVolumeRange(workspace.chapters, edit.chapterIds, action, delta);
    commit(edit, ids);
    const firstIndex = workspace.chapters.findIndex(chapter => chapter.id === ids[0]);
    const lastIndex = workspace.chapters.findIndex(chapter => chapter.id === ids[ids.length - 1]);
    const edge = action === "resize-end" ? lastIndex : firstIndex;
    if (action !== "move" || !ids.some(id => chapters.some(chapter => chapter.id === id))) {
      if (edge < startIndex) onWindowStart?.(Math.max(0, edge));
      else if (edge >= startIndex + chapters.length) onWindowStart?.(Math.min(workspace.chapters.length - chapters.length, edge - chapters.length + 1));
    }
  };

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
    };
    document.addEventListener("keydown", escape, true);
    globalThis.addEventListener("blur", cancelDrag);
    return () => { document.removeEventListener("keydown", escape, true); globalThis.removeEventListener("blur", cancelDrag); dragRef.current = null; };
  }, []);
  useEffect(() => {
    if (!drag) return;
    const timer = globalThis.setInterval(() => {
      const session = dragRef.current;
      const current = latest.current;
      if (!session?.dragging || !current.onWindowStart || !trackRef.current) return;
      if (trackRef.current.closest("fieldset[disabled]")) { cancelDrag(); return; }
      const box = trackRef.current.getBoundingClientRect();
      const scroller = trackRef.current.closest(".book-arrangement-scroll")?.getBoundingClientRect();
      const left = Math.max(box.left, scroller?.left ?? box.left), right = Math.min(box.right, scroller?.right ?? box.right);
      const edge = Math.min(28, session.columnWidth / 3);
      const direction = session.currentX < left + edge ? -1 : session.currentX > right - edge ? 1 : 0;
      if (!direction) return;
      const nextStart = Math.max(0, Math.min(session.currentWindowStart + direction, current.workspace.chapters.length - current.chapters.length));
      if (nextStart === session.currentWindowStart) return;
      current.onWindowStart(nextStart);
      previewAt(session.currentX, nextStart);
    }, 350);
    return () => globalThis.clearInterval(timer);
  }, [Boolean(drag)]);

  const undoSource = undo && sourceEdits.find(edit => edit.volumeId === undo.volumeId);
  const undoEdit = undo && undoSource ? undoVolumeRange(undoSource, undo) : null;
  return <div className="ba-volume-track">
    <div ref={trackRef} className={`ba-packed-plot ba-volume-plot ba-volume-editable ${drag?.dragging ? "is-dragging" : ""}`} style={{ "--ba-lanes": lanes, "--ba-count": chapters.length } as CSSProperties}
      onPointerMove={event => { if (dragRef.current?.pointerId === event.pointerId) { event.preventDefault(); previewAt(event.clientX); } }} onPointerUp={release} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (dragRef.current) cancelDrag(); }}>
      <div className="ba-plot-guides" aria-hidden="true">{chapters.map(chapter => <span key={chapter.id} data-chapter-id={chapter.id} className={chapter.id === selectedChapterId ? "is-selected" : ""} />)}</div>
      {ghostSegments.map(segment => <div key={`ghost:${segment.chapterIds[0]}`} className="ba-volume-block ba-volume-ghost" aria-hidden="true" style={style({ ...segment, lane: drag!.originLane }, drag!.original.volumeId)}>原范围</div>)}
      {segments.map(segment => {
        const edit = sourceEdits.find(item => item.volumeId === segment.source.volumeId)!;
        const clipping = clipVolumeSegments(chapters, segment.source.chapterIds, workspace.chapters).find(item => item.start === segment.start && item.end === segment.end)!;
        const segmentIndex = segments.filter(item => item.source.volumeId === edit.volumeId).findIndex(item => item.segmentId === segment.segmentId);
        return <div key={`${edit.volumeId}:${segmentIndex}`} className={`ba-volume-block ba-volume-drag-block ${edit.volumeId === selectedVolumeId ? "is-selected" : ""} ${drag?.dragging && drag.original.volumeId === edit.volumeId ? "is-drag-preview" : ""}`} data-volume-id={edit.volumeId} data-chapter-ids={segment.chapterIds.join(",")} style={style(segment, edit.volumeId)}>
          {clipping.canResizeStart && <button type="button" className="ba-volume-handle ba-volume-handle-start" style={{ touchAction: "none" }} aria-label={`调整${edit.title}起点`} title="拖动调整起点；左右键调整一章，Shift 加速" disabled={!onVolumeEdit} onPointerDown={event => begin(event, edit, "resize-start", segment.lane)} onKeyDown={event => keyboard(event, edit, "resize-start")}><ChevronLeft size={12} /></button>}
          <button type="button" className="ba-volume-move" style={{ touchAction: "none" }} aria-label={`移动卷段${edit.title}`} title={`${edit.title} · ${rangeText(edit.chapterIds)}\n拖动移动整卷范围；左右键移动一章，Shift 加速`} onPointerDown={event => begin(event, edit, "move", segment.lane)} onKeyDown={event => keyboard(event, edit, "move")} onClick={event => { event.stopPropagation(); if (event.detail === 0) onVolume?.(edit.volumeId); }}><GripVertical size={12} /><span>{edit.title}</span></button>
          {clipping.canResizeEnd && <button type="button" className="ba-volume-handle ba-volume-handle-end" style={{ touchAction: "none" }} aria-label={`调整${edit.title}终点`} title="拖动调整终点；左右键调整一章，Shift 加速" disabled={!onVolumeEdit} onPointerDown={event => begin(event, edit, "resize-end", segment.lane)} onKeyDown={event => keyboard(event, edit, "resize-end")}><ChevronRight size={12} /></button>}
        </div>;
      })}
      {!segments.length && <p className="ba-track-empty" style={{ gridColumn: "1 / -1" }}>当前章节尚未分卷</p>}
    </div>
    <div className="ba-volume-range-hint" role="status">{drag?.dragging ? `${actionLabels[drag.action]}${drag.original.title}：${rangeText(drag.chapterIds)} · 松开更新草稿，Esc 取消` : notice}</div>
    {undo && <button type="button" className="ba-volume-undo" disabled={!undoEdit || !onVolumeEdit || Boolean(drag)} onClick={() => { if (undoEdit) { onVolumeEdit?.(undoEdit); setUndo(null); setNotice("已撤销上次卷段范围调整，其他详情保持原样。"); } }}><Undo2 size={13} />撤销上次范围调整</button>}
  </div>;
}

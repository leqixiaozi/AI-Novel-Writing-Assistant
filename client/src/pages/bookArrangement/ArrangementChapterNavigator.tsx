import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { chapterOverviewSegments, resizeChapterWindow, type ChapterWindowEdge } from "./arrangementState";

type NavigatorVolume = { id: string; title: string; chapterIds: string[] };
type WindowValue = { start: number; size: number };
type DragSession = { pointerId: number; mode: "move" | ChapterWindowEdge; offset: number; start: number; size: number };

/** The frame moves and resizes directly on the complete chapter axis. */
export function ArrangementChapterNavigator({ chapters, volumes = [], start, visibleCount, selectedId, onStart, onWindow, onSelect, disabled = false }: {
  chapters: Array<{ id: string; order: number; title: string }>;
  volumes?: NavigatorVolume[];
  start: number; visibleCount: number; selectedId: string; onStart: (value: number) => void;
  onWindow?: (start: number, size: number) => void;
  onSelect: (id: string) => void; disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<DragSession | null>(null);
  const [preview, setPreview] = useState<WindowValue | null>(null);
  const maximum = Math.max(0, chapters.length - visibleCount);
  const clampStart = (value: number, size = visibleCount) => Math.max(0, Math.min(Math.max(0, chapters.length - size), Math.floor(value)));
  const publish = (value: WindowValue) => { setPreview(value); if (onWindow) onWindow(value.start, value.size); else onStart(value.start); };
  const pointerBoundary = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = track.current?.getBoundingClientRect();
    return bounds?.width ? Math.max(0, Math.min(chapters.length, (event.clientX - bounds.left) / bounds.width * chapters.length)) : 0;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const session = drag.current;
    if (disabled || !session || session.pointerId !== event.pointerId) return;
    const boundary = pointerBoundary(event);
    if (session.mode === "move") publish({ start: clampStart(boundary - session.offset, session.size), size: session.size });
    else publish(resizeChapterWindow(chapters.length, session.start, session.size, session.mode, boundary));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboardResize = (event: KeyboardEvent<HTMLButtonElement>, edge: ChapterWindowEdge) => {
    if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault(); event.stopPropagation();
    const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 4 : 1);
    const boundary = edge === "start" ? start + delta : start + visibleCount + delta;
    const next = resizeChapterWindow(chapters.length, start, visibleCount, edge, boundary);
    if (onWindow) onWindow(next.start, next.size); else onStart(next.start);
  };
  if (!chapters.length) return null;
  const displayed = preview ?? { start, size: visibleCount };
  const volumeSegments = chapterOverviewSegments(chapters, volumes);
  return <div className="ba-chapter-navigator">
    <div className="ba-navigator-volumes" aria-label="卷段缩略导航">{volumeSegments.map(segment => { const volumeIndex = Math.max(0, volumes.findIndex(volume => volume.id === segment.volume.id)); return <button type="button" key={segment.id} className="ba-navigator-volume" style={{ left: `${segment.start / chapters.length * 100}%`, width: `${(segment.end - segment.start + 1) / chapters.length * 100}%`, "--ba-color": volumeIndex % 2 ? "#f47936" : "#3b82f6" } as CSSProperties} title={`${segment.volume.title} · 第${chapters[segment.start].order}—${chapters[segment.end].order}章`} disabled={disabled} onClick={() => {
      onStart(clampStart(segment.start, visibleCount)); onSelect(chapters[segment.start].id);
    }}><span>{segment.volume.title}</span></button>; })}</div>
    <div className="ba-navigator-track" ref={track} onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      const target = event.target as HTMLElement;
      const mode: DragSession["mode"] = target.closest(".ba-navigator-resize-start") ? "start" : target.closest(".ba-navigator-resize-end") ? "end" : "move";
      const boundary = pointerBoundary(event), isFrame = Boolean(target.closest(".ba-navigator-thumb"));
      const offset = mode === "move" ? isFrame ? boundary - start : visibleCount / 2 : 0;
      drag.current = { pointerId: event.pointerId, mode, offset, start, size: visibleCount };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); move(event);
    }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setPreview(null); }}>
      <div className="ba-navigator-ticks" aria-hidden="true">{chapters.map(chapter => <span key={chapter.id} className={chapter.id === selectedId ? "is-selected" : ""} />)}</div>
      <div className="ba-navigator-thumb" role="scrollbar" aria-label="章节导航窗口" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={start} aria-valuetext={`第${chapters[start]?.order}—${chapters[Math.min(start + visibleCount - 1, chapters.length - 1)]?.order}章，共${visibleCount}章`} aria-controls="ba-chapter-matrix" aria-disabled={disabled} tabIndex={disabled ? -1 : 0} style={{ left: `${displayed.start / chapters.length * 100}%`, width: `${displayed.size / chapters.length * 100}%` }} onKeyDown={event => {
        if (disabled || event.target !== event.currentTarget) return;
        const next = event.key === "ArrowLeft" ? start - 1 : event.key === "ArrowRight" ? start + 1 : event.key === "Home" ? 0 : event.key === "End" ? maximum : null;
        if (next === null) return;
        event.preventDefault(); onStart(clampStart(next));
      }}>
        <button type="button" className="ba-navigator-resize-handle ba-navigator-resize-start" aria-label="调整章节窗口起点" title="拖动扩大或缩小显示范围；方向键微调" onKeyDown={event => keyboardResize(event, "start")} />
        <span aria-hidden="true">拖动窗口 · 两端调范围</span>
        <button type="button" className="ba-navigator-resize-handle ba-navigator-resize-end" aria-label="调整章节窗口终点" title="拖动扩大或缩小显示范围；方向键微调" onKeyDown={event => keyboardResize(event, "end")} />
      </div>
    </div>
    <div className="ba-navigator-labels">{chapters.map((chapter, index) => (index === 0 || index === chapters.length - 1 || (index + 1) % 5 === 0) && <button type="button" key={chapter.id} aria-label={`概览第${chapter.order}章`} disabled={disabled} style={{ left: `${(index + 0.5) / chapters.length * 100}%` }} onClick={() => onSelect(chapter.id)}>{chapter.order}</button>)}</div>
  </div>;
}

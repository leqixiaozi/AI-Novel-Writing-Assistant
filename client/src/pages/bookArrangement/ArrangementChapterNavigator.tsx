import { useRef, useState, type PointerEvent } from "react";

/** The handle can move continuously; chapter projection changes one column at a time. */
export function ArrangementChapterNavigator({ chapters, start, visibleCount, selectedId, onStart, onSelect, disabled = false }: {
  chapters: Array<{ id: string; order: number; title: string }>;
  start: number; visibleCount: number; selectedId: string; onStart: (value: number) => void;
  onSelect: (id: string) => void; disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const maximum = Math.max(0, chapters.length - visibleCount);
  const clamp = (value: number) => Math.max(0, Math.min(maximum, value));
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !drag.current || drag.current.pointerId !== event.pointerId || !track.current) return;
    const bounds = track.current.getBoundingClientRect();
    if (!bounds.width) return;
    const value = clamp((event.clientX - bounds.left - drag.current.offset) / bounds.width * chapters.length);
    setDragStart(value); onStart(Math.floor(value));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDragStart(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!chapters.length) return null;
  const displayedStart = dragStart ?? start;
  return <div className="ba-chapter-navigator">
    <div className="ba-navigator-track" ref={track} onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width) return;
      const isHandle = (event.target as HTMLElement).closest(".ba-navigator-thumb");
      event.currentTarget.querySelector<HTMLElement>(".ba-navigator-thumb")?.focus();
      const offset = isHandle ? event.clientX - bounds.left - start / chapters.length * bounds.width : visibleCount / chapters.length * bounds.width / 2;
      drag.current = { pointerId: event.pointerId, offset };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); move(event);
    }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setDragStart(null); }}>
      <div className="ba-navigator-ticks" aria-hidden="true">{chapters.map(chapter => <span key={chapter.id} className={chapter.id === selectedId ? "is-selected" : ""} />)}</div>
      <div className="ba-navigator-thumb" role="scrollbar" aria-label="章节导航窗口" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={start} aria-valuetext={`第${chapters[start]?.order}—${chapters[Math.min(start + visibleCount - 1, chapters.length - 1)]?.order}章`} aria-controls="ba-chapter-matrix" aria-disabled={disabled || maximum === 0} tabIndex={disabled ? -1 : 0} style={{ left: `${displayedStart / chapters.length * 100}%`, width: `${visibleCount / chapters.length * 100}%` }} onKeyDown={event => {
        if (disabled) return;
        const next = event.key === "ArrowLeft" ? start - 1 : event.key === "ArrowRight" ? start + 1 : event.key === "Home" ? 0 : event.key === "End" ? maximum : null;
        if (next === null) return;
        event.preventDefault(); onStart(clamp(next));
      }} />
    </div>
    <div className="ba-navigator-labels">{chapters.map((chapter, index) => (index === 0 || index === chapters.length - 1 || (index + 1) % 5 === 0) && <button type="button" key={chapter.id} aria-label={`概览第${chapter.order}章`} disabled={disabled} style={{ left: `${(index + 0.5) / chapters.length * 100}%` }} onClick={() => onSelect(chapter.id)}>{chapter.order}</button>)}</div>
  </div>;
}

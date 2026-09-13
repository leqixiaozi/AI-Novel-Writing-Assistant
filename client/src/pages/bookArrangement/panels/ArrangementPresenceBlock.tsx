import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import type { BookArrangementCharacterSpan, BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { moveCharacterSpan } from "./characterEditing";
import { snapChapterDelta, type VolumeRangeAction } from "../volume/volumeState";

export function ArrangementPresenceBlock({ span, draft, workspace, visibleIds, style, name, onDraft, onSelect }: {
  span: BookArrangementCharacterSpan; draft: BookArrangementDraftPayload; workspace: BookArrangementWorkspace; visibleIds: string[]; style: CSSProperties; name: string;
  onDraft: (value: BookArrangementDraftPayload) => void; onSelect: (id: string, chapterId?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const session = useRef<{ id: number; x: number; width: number; action: VolumeRangeAction; moved: boolean; chapterId: string } | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const locked = span.chapterIds.some(id => draft.chapterEdits.some(edit => edit.chapterId === id && edit.locked));
  const ordered = workspace.chapters.filter(chapter => span.chapterIds.includes(chapter.id)).map(chapter => chapter.id);
  const preview = delta === null ? draft : moveCharacterSpan(draft, span.id, workspace.chapters, session.current?.action ?? "move", delta);
  const proposed = preview.characterSpans.find(item => item.id === span.id)!;
  const changed = proposed !== span;
  const cancel = () => { const current = session.current; session.current = null; setDelta(null); if (current && ref.current?.hasPointerCapture(current.id)) ref.current.releasePointerCapture(current.id); };
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && session.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }; document.addEventListener("keydown", escape, true); globalThis.addEventListener("blur", cancel); return () => { document.removeEventListener("keydown", escape, true); globalThis.removeEventListener("blur", cancel); }; }, []);
  const begin = (event: PointerEvent<HTMLButtonElement>, action: VolumeRangeAction) => {
    if (event.button !== 0 || event.currentTarget.matches(":disabled") || ref.current?.closest("fieldset[disabled]")) return;
    if (locked) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    const box = ref.current!.getBoundingClientRect();
    session.current = { id: event.pointerId, x: event.clientX, width: box.width / visibleIds.length, action, moved: false, chapterId: visibleIds[Math.max(0, Math.min(visibleIds.length - 1, Math.floor((event.clientX - box.left) / box.width * visibleIds.length)))] };
    ref.current!.setPointerCapture(event.pointerId);
  };
  const button = (action: VolumeRangeAction, label: string, content: React.ReactNode) => <button type="button" className={action === "move" ? "ba-presence-move" : "ba-presence-handle"} aria-label={`${label}${name}人物区段`} title={`${label}区段；左右键调整，Esc 取消拖动`} disabled={locked && action !== "move"} onPointerDown={event => begin(event, action)} onClick={event => { if (event.detail === 0 || locked) onSelect(span.id, visibleIds[0]); }} onKeyDown={event => {
    if (locked || event.currentTarget.matches(":disabled") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); onDraft(moveCharacterSpan(draft, span.id, workspace.chapters, action, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1)));
  }}>{content}</button>;
  return <div ref={ref} style={style} className={`ba-presence-block ba-presence-editable is-plan ${span.mode === "forbidden" ? "is-forbidden" : ""} ${delta !== null ? "is-drag-preview" : ""}`} data-kind="plan" data-span-id={span.id} data-character-id={span.characterId} data-chapter-ids={visibleIds.join(",")} onPointerMove={event => {
    const current = session.current; if (!current || event.pointerId !== current.id) return;
    if (ref.current?.closest("fieldset[disabled]")) { cancel(); return; }
    current.moved ||= Math.abs(event.clientX - current.x) >= 5;
    if (current.moved) setDelta(snapChapterDelta(current.x, event.clientX, current.width));
  }} onPointerUp={event => {
    const current = session.current; if (!current || current.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    current.moved ||= Math.abs(event.clientX - current.x) >= 5;
    const blocked = ref.current?.closest("fieldset[disabled]");
    const next = moveCharacterSpan(draft, span.id, workspace.chapters, current.action, snapChapterDelta(current.x, event.clientX, current.width));
    cancel(); if (blocked) return;
    if (current.moved) { if (next === draft) setNotice("范围未变更：请避开锁定章节与同一人物的其他区段。"); else { setNotice(""); onDraft(next); } } else onSelect(span.id, current.chapterId);
  }} onPointerCancel={cancel} onLostPointerCapture={() => { if (session.current) cancel(); }}>
    {visibleIds[0] === ordered[0] && button("resize-start", "调整起点", <ChevronLeft size={12} />)}
    {button("move", "移动", <><GripVertical size={12} /><span>{name}{span.mode === "forbidden" ? " · 不出场" : ""}</span></>)}
    {visibleIds.at(-1) === ordered.at(-1) && button("resize-end", "调整终点", <ChevronRight size={12} />)}
    {delta !== null && <span role="status" className="ba-drag-tooltip">{changed ? proposed.chapterIds.map(id => workspace.chapters.find(chapter => chapter.id === id)?.order).join("、") + " 章 · 松开更新草稿" : "边界或锁定章节限制，范围保持原样"}</span>}
    {notice && <span role="status" className="ba-drag-tooltip">{notice}<button type="button" aria-label="关闭范围提示" onClick={() => setNotice("")}>关闭</button></span>}
  </div>;
}

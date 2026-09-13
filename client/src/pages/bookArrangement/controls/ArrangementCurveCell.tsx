import { useEffect, useRef, useState } from "react";
import type { BookArrangementDraftPayload } from "@ai-novel/shared/types/bookArrangement";
import type { WritingControlKey } from "@ai-novel/shared/types/writingAdjustments";
import { validateWritingControls } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import { chapterEdit, updateChapterEdit } from "../arrangementState";
import { controlBandAtY } from "./controlDrag";

export function ArrangementCurveCell({ chapterId, order, label, controlKey, value, selected, draft, onDraft, onOpen }: {
  chapterId: string; order: number; label: string; controlKey: WritingControlKey; value: number | null; selected: boolean; draft: BookArrangementDraftPayload; onDraft: (draft: BookArrangementDraftPayload) => void; onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const session = useRef<{ id: number; y: number; moved: boolean } | null>(null);
  const [proposed, setProposed] = useState<number | null>(null);
  const edit = chapterEdit(draft, chapterId);
  const cancel = () => { const current = session.current; session.current = null; setProposed(null); if (current && ref.current?.hasPointerCapture(current.id)) ref.current.releasePointerCapture(current.id); };
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && session.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }; document.addEventListener("keydown", escape, true); globalThis.addEventListener("blur", cancel); return () => { document.removeEventListener("keydown", escape, true); globalThis.removeEventListener("blur", cancel); }; }, []);
  const apply = (band: number) => {
    if (edit.locked || ref.current?.matches(":disabled")) return;
    const control = { ...edit.controls[controlKey], mode: "set" as const, value: band };
    if (validateWritingControls({ [controlKey]: control })) { onOpen(); return; }
    onDraft(updateChapterEdit(draft, chapterId, { controls: { ...edit.controls, [controlKey]: control } }));
  };
  return <button ref={ref} data-chapter-id={chapterId} type="button" className={`ba-curve-cell ${selected ? "is-selected" : ""}`} style={{ touchAction: "none" }} aria-label={`第${order}章${label}${value === null ? "未设置" : value}`} title={`${label}：点击编辑，拖动调整档位；上下键调整，Esc 取消`} onClick={event => { if (event.detail === 0) onOpen(); }} onPointerDown={event => {
    if (event.button !== 0 || event.currentTarget.matches(":disabled")) return;
    event.preventDefault(); event.currentTarget.focus(); session.current = { id: event.pointerId, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    const current = session.current; if (!current || current.id !== event.pointerId || edit.locked) return;
    current.moved ||= Math.abs(event.clientY - current.y) >= 5;
    if (current.moved) { const box = event.currentTarget.getBoundingClientRect(); setProposed(controlBandAtY(event.clientY, box.top + 5, box.height - 20)); }
  }} onPointerUp={event => {
    const current = session.current; if (!current || current.id !== event.pointerId) return;
    current.moved ||= !edit.locked && Math.abs(event.clientY - current.y) >= 5;
    event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); cancel();
    if (current.moved) apply(controlBandAtY(event.clientY, box.top + 5, box.height - 20)); else onOpen();
  }} onPointerCancel={cancel} onLostPointerCapture={() => { if (session.current) cancel(); }} onKeyDown={event => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); apply(Math.max(0, Math.min(100, (value ?? 50) + (event.key === "ArrowUp" ? 25 : -25))));
  }}><span>{proposed ?? (value === null ? edit.controls[controlKey]?.mode === "disabled" ? "已停用" : "未设置" : value)}</span>{proposed !== null && <span className="ba-curve-drag-dot" style={{ bottom: `${20 + proposed * .6}%` }} aria-hidden="true" />}</button>;
}

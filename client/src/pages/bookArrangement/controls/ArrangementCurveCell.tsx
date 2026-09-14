import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BookArrangementScene } from "@ai-novel/shared/types/bookArrangement";
import type { SceneExpressionDimensionDefinition, SceneExpressionLevel } from "@ai-novel/shared/types/sceneExpressionTracks";
import { expressionLevelAtY } from "./sceneExpressionState";

export function ArrangementCurveCell({ chapterOrder, sceneOrder, sceneIndex, sceneCount, scene, dimension, level, note, selected, onSelect, onChange, onOpen }: {
  chapterOrder: number; sceneOrder: number; sceneIndex: number; sceneCount: number; scene: BookArrangementScene; dimension: SceneExpressionDimensionDefinition;
  level: SceneExpressionLevel | null; note: string | null; selected: boolean;
  onSelect: () => void; onChange: (level: SceneExpressionLevel) => void; onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const session = useRef<{ id: number; y: number; moved: boolean } | null>(null);
  const [proposed, setProposed] = useState<SceneExpressionLevel | null>(null);
  const cancel = () => { const current = session.current; session.current = null; setProposed(null); if (current && ref.current?.hasPointerCapture(current.id)) ref.current.releasePointerCapture(current.id); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && session.current) { event.preventDefault(); cancel(); } };
    document.addEventListener("keydown", escape, true); globalThis.addEventListener("blur", cancel);
    return () => { document.removeEventListener("keydown", escape, true); globalThis.removeEventListener("blur", cancel); };
  }, []);
  const shown = proposed ?? level;
  const band = shown ? dimension.bands.find(item => item.level === shown) : undefined;
  const title = `第${chapterOrder}章 · S${sceneOrder} ${scene.title}\n${dimension.label}：${band ? `L${band.level} ${band.name}` : "未设置"}${note ? `\n备注：${note}` : ""}`;
  const trackBounds = (button: HTMLButtonElement) => {
    const parent = button.closest<HTMLElement>(".ba-curve-chapter");
    const box = parent?.getBoundingClientRect() ?? button.getBoundingClientRect();
    return { top: box.top + 12, height: 40 };
  };
  return <button ref={ref} type="button" data-scene-id={scene.id} data-dimension-key={dimension.key}
    className={`ba-curve-cell ${selected ? "is-selected" : ""} ${level === null ? "is-unset" : "is-set"}`}
    style={{ touchAction: "none", left: `${((sceneIndex + 0.5) / Math.max(1, sceneCount)) * 100}%`, bottom: `${20 + ((shown ?? 3) - 1) * 10}px`, "--ba-track-color": `var(--ba-${dimension.color})`, "--ba-level-fill": `${shown ? (shown - 1) * 25 : 0}%` } as CSSProperties} aria-label={title.replaceAll("\n", "，")} title={`${title}\n上下拖动或方向键调整；右键查看详细设置`}
    onClick={onSelect} onContextMenu={event => { event.preventDefault(); onSelect(); onOpen(); }}
    onPointerDown={event => { if (event.button !== 0 || event.currentTarget.matches(":disabled")) return; event.preventDefault(); event.currentTarget.focus(); onSelect(); session.current = { id: event.pointerId, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { const current = session.current; if (!current || current.id !== event.pointerId) return; current.moved ||= Math.abs(event.clientY - current.y) >= 5; if (current.moved) { const box = trackBounds(event.currentTarget); setProposed(expressionLevelAtY(event.clientY, box.top, box.height)); } }}
    onPointerUp={event => { const current = session.current; if (!current || current.id !== event.pointerId) return; const moved = current.moved || Math.abs(event.clientY - current.y) >= 5; const box = trackBounds(event.currentTarget); cancel(); if (moved) onChange(expressionLevelAtY(event.clientY, box.top, box.height)); }}
    onPointerCancel={cancel} onLostPointerCapture={() => { if (session.current) cancel(); }}
    onKeyDown={event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); onOpen(); return; } if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); onChange(Math.max(1, Math.min(5, (level ?? 3) + (event.key === "ArrowUp" ? 1 : -1))) as SceneExpressionLevel); }}>
    <span className="sr-only">S{sceneOrder}，{shown ? `L${shown}` : "未设置"}</span>
  </button>;
}

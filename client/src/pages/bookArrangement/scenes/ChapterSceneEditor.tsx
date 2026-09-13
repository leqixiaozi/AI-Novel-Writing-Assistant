import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, GripVertical, LockKeyhole, Plus, RotateCcw, Split, Trash2 } from "lucide-react";
import type { BookArrangementScene, BookArrangementScenePreview, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { createBookArrangementApi } from "@/api/bookArrangement";
import type { ArrangementRun } from "../ArrangementPlanning";
import type { ArrangementObjectSelection } from "../objects/ArrangementObjectPanel";
import { moveScene, resizeSceneBoundary, sceneBudgetPercent } from "./sceneEditorState";
import "./chapterSceneEditor.css";

type EditableScene = BookArrangementScene & { locked?: boolean };
type Props = { workspace: BookArrangementWorkspace; chapterId: string; initialSceneId?: string; busy: boolean; run: ArrangementRun; reload: () => Promise<void>; onBack: () => void; onDirty: (chapterId: string, dirty: boolean) => void; onObject: (selection: ArrangementObjectSelection) => void };
const colors = ["blue", "violet", "mint", "peach", "rose", "cyan", "amber", "indigo"];
const joinLines = (items: string[]) => items.join("\n");
const splitLines = (value: string) => value.split(/\r?\n|[,，;；、]/).map(item => item.trim()).filter(Boolean);
const clean = (scenes: EditableScene[]): BookArrangementScene[] => scenes.map(({ locked: _locked, ...scene }) => scene);
const starterScenes = (chapterId: string, total: number): EditableScene[] => {
  const safeTotal = Math.max(600, total || 3000), first = Math.floor(safeTotal * .25), second = Math.floor(safeTotal * .5);
  return [
    { title: "建立场景", objective: "建立本章处境并提出当前问题", entryState: "人物进入本章处境", exitState: "问题变得明确", targetWordCount: first },
    { title: "推进冲突", objective: "通过行动或对话推进本章核心任务", entryState: "人物开始处理当前问题", exitState: "冲突产生新的变化", targetWordCount: second },
    { title: "形成转折", objective: "收束本章推进并留下下一步动力", entryState: "人物面对变化后的局面", exitState: "本章任务完成并指向后续", targetWordCount: safeTotal - first - second },
  ].map((item, index) => ({ id: crypto.randomUUID(), revision: "new", chapterId, sortOrder: index + 1, conflict: "", reveal: "", emotionBeat: "", mustAdvance: [], mustPreserve: [], forbiddenExpansion: [], resistance: "", turn: "", emotionalShift: "", readerValue: "", ...item }));
};
const sceneChangeSummary = (preview: BookArrangementScenePreview) => {
  const before = new Map(preview.before.map(scene => [scene.id, scene]));
  const afterIds = new Set(preview.after.map(scene => scene.id));
  const rows = preview.after.flatMap((scene, index) => {
    const old = before.get(scene.id);
    if (!old) return [`新增 S${index + 1}「${scene.title}」· ${scene.targetWordCount} 字`];
    const changes = [];
    if (old.sortOrder !== scene.sortOrder) changes.push(`顺序 S${old.sortOrder}→S${scene.sortOrder}`);
    if (old.targetWordCount !== scene.targetWordCount) changes.push(`篇幅 ${old.targetWordCount}→${scene.targetWordCount} 字`);
    if (old.title !== scene.title) changes.push(`名称「${old.title}」→「${scene.title}」`);
    if (["objective", "conflict", "reveal", "emotionBeat", "entryState", "exitState", "resistance", "turn", "emotionalShift", "readerValue", "mustAdvance", "mustPreserve", "forbiddenExpansion"].some(key => JSON.stringify(old[key as keyof BookArrangementScene]) !== JSON.stringify(scene[key as keyof BookArrangementScene]))) changes.push("内容或边界已修改");
    return changes.length ? [`S${scene.sortOrder}「${scene.title}」：${changes.join("；")}`] : [];
  });
  preview.before.filter(scene => !afterIds.has(scene.id)).forEach(scene => rows.push(`删除 S${scene.sortOrder}「${scene.title}」`));
  return rows;
};

export function ChapterSceneEditor({ workspace, chapterId, initialSceneId, busy, run, reload, onBack, onDirty, onObject }: Props) {
  const chapter = workspace.chapters.find(item => item.id === chapterId)!;
  const source = useMemo(() => workspace.scenes.filter(scene => scene.chapterId === chapterId).sort((a, b) => a.sortOrder - b.sortOrder), [workspace.scenes, chapterId]);
  const initial = useMemo(() => source.length ? source : starterScenes(chapterId, chapter.targetWordCount ?? 3000), [source, chapterId, chapter.targetWordCount]);
  const cacheKey = `book-arrangement-scenes:${workspace.novelId}:${chapterId}`;
  const [scenes, setScenes] = useState<EditableScene[]>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null"); if (saved?.chapterRevision === chapter.revision && Array.isArray(saved.scenes)) return saved.scenes; } catch { /* optional recovery */ }
    return initial;
  });
  const [selectedId, setSelectedId] = useState(initialSceneId && scenes.some(scene => scene.id === initialSceneId) ? initialSceneId : scenes[0]?.id ?? "");
  const [tab, setTab] = useState<"story" | "expression" | "people">("story");
  const [preview, setPreview] = useState<BookArrangementScenePreview | null>(null);
  const [notice, setNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const boundary = useRef<{ index: number; x: number; width: number; base: EditableScene[] } | null>(null);
  const dirty = source.length === 0 || JSON.stringify(clean(scenes)) !== JSON.stringify(source);
  const totalWords = scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0);
  const selected = scenes.find(scene => scene.id === selectedId) ?? scenes[0];
  useEffect(() => onDirty(chapterId, dirty), [chapterId, dirty, onDirty]);
  useEffect(() => { try { if (dirty) sessionStorage.setItem(cacheKey, JSON.stringify({ chapterRevision: chapter.revision, scenes })); else sessionStorage.removeItem(cacheKey); } catch { /* before-unload protection remains */ } }, [cacheKey, chapter.revision, dirty, scenes]);
  const change = (next: EditableScene[]) => { setScenes(next); setPreview(null); setNotice(""); setLocalError(""); };
  const update = (patch: Partial<EditableScene>) => selected && change(scenes.map(scene => scene.id === selected.id ? { ...scene, ...patch } : scene));
  const shift = (id: string, delta: -1 | 1) => { const next = moveScene(scenes, id, delta); change(next); setSelectedId(id); };
  const dropAt = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return setDraggingId("");
    const from = scenes.findIndex(scene => scene.id === draggingId), to = scenes.findIndex(scene => scene.id === targetId);
    const next = [...scenes], [moving] = next.splice(from, 1); next.splice(to, 0, moving);
    change(next.map((scene, index) => ({ ...scene, sortOrder: index + 1 }))); setSelectedId(draggingId); setDraggingId("");
  };
  const add = () => {
    if (scenes.length >= 8) return setLocalError("一章最多编排 8 个场景。");
    const unlocked = scenes.filter(scene => !scene.locked), largest = unlocked.reduce<EditableScene | undefined>((best, scene) => !best || scene.targetWordCount > best.targetWordCount ? scene : best, undefined);
    const words = Math.max(150, Math.round(totalWords * .15));
    if (!largest || largest.targetWordCount - words < 150) return setLocalError("当前篇幅不足以拆出新场景，请先增加本章参考字数。");
    const id = crypto.randomUUID(), at = Math.max(0, scenes.findIndex(scene => scene.id === selectedId) + 1);
    const next = scenes.map(scene => scene.id === largest.id ? { ...scene, targetWordCount: scene.targetWordCount - words } : scene);
    next.splice(at, 0, { id, revision: "new", chapterId, sortOrder: at + 1, title: "新场景", objective: "", conflict: "", reveal: "", emotionBeat: "", targetWordCount: words, mustAdvance: [], mustPreserve: [], entryState: "进入新场景", exitState: "完成场景任务", forbiddenExpansion: [], resistance: "", turn: "", emotionalShift: "", readerValue: "" });
    change(next.map((scene, index) => ({ ...scene, sortOrder: index + 1 }))); setSelectedId(id);
  };
  const remove = (sceneId: string) => {
    const target = scenes.find(scene => scene.id === sceneId);
    if (!target || target.locked || scenes.length <= 3) return setLocalError(target?.locked ? "请先解除此场景的占比锁定。" : "底座要求每章保留 3 至 8 个场景。");
    const index = scenes.indexOf(target), receiver = (index > 0 ? [...scenes].slice(0, index).reverse() : scenes.slice(index + 1)).find(scene => !scene.locked);
    if (!receiver) return setLocalError("没有可接收篇幅的未锁定相邻场景。");
    const next = scenes.filter(scene => scene.id !== target.id).map(scene => scene.id === receiver.id ? { ...scene, targetWordCount: scene.targetWordCount + target.targetWordCount } : scene).map((scene, position) => ({ ...scene, sortOrder: position + 1 }));
    change(next); setSelectedId(next[Math.min(index, next.length - 1)].id);
  };
  const split = (sceneId: string) => {
    const target = scenes.find(scene => scene.id === sceneId);
    if (!target || target.locked || scenes.length >= 8 || target.targetWordCount < 300) return setLocalError(target?.locked ? "请先解除此场景的占比锁定。" : "需要至少 300 字且场景数少于 8 才能拆分。");
    const index = scenes.indexOf(target), first = Math.ceil(target.targetWordCount / 2), id = crypto.randomUUID();
    const next = [...scenes]; next[index] = { ...target, targetWordCount: first }; next.splice(index + 1, 0, { ...target, id, revision: "new", title: `${target.title}·后段`, targetWordCount: target.targetWordCount - first, locked: false });
    change(next.map((scene, position) => ({ ...scene, sortOrder: position + 1 }))); setSelectedId(id);
  };
  const merge = (sceneId: string, delta: -1 | 1) => {
    const target = scenes.find(scene => scene.id === sceneId);
    if (!target || scenes.length <= 3) return setLocalError("底座要求每章保留至少 3 个场景。");
    const index = scenes.indexOf(target), other = scenes[index + delta]; if (!other) return;
    if (target.locked || other.locked) return setLocalError("请先解除待合并场景的占比锁定。");
    const first = delta < 0 ? other : target, second = delta < 0 ? target : other;
    const merged = { ...first, title: `${first.title} / ${second.title}`, objective: [first.objective, second.objective].filter(Boolean).join("；"), conflict: [first.conflict, second.conflict].filter(Boolean).join("；"), reveal: [first.reveal, second.reveal].filter(Boolean).join("；"), emotionBeat: [first.emotionBeat, second.emotionBeat].filter(Boolean).join("；"), targetWordCount: first.targetWordCount + second.targetWordCount, mustAdvance: [...new Set([...first.mustAdvance, ...second.mustAdvance])], mustPreserve: [...new Set([...first.mustPreserve, ...second.mustPreserve])], forbiddenExpansion: [...new Set([...first.forbiddenExpansion, ...second.forbiddenExpansion])], exitState: second.exitState, turn: second.turn || first.turn, emotionalShift: second.emotionalShift || first.emotionalShift };
    const next = scenes.filter(scene => scene.id !== first.id && scene.id !== second.id); next.splice(Math.min(index, index + delta), 0, merged);
    change(next.map((scene, position) => ({ ...scene, sortOrder: position + 1 }))); setSelectedId(merged.id);
  };
  const beginBoundary = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => { const width = event.currentTarget.closest<HTMLElement>(".ba-scene-budget-track")?.scrollWidth ?? 1; boundary.current = { index, x: event.clientX, width, base: scenes }; event.currentTarget.setPointerCapture(event.pointerId); };
  const dragBoundary = (event: ReactPointerEvent<HTMLButtonElement>) => { const session = boundary.current; if (!session) return; change(resizeSceneBoundary(session.base, session.index, (event.clientX - session.x) / session.width * totalWords)); };
  const showPreview = async () => {
    if (!dirty) return setLocalError("请先调整场景再预览。");
    const empty = scenes.find(scene => !scene.title.trim() || !scene.entryState.trim() || !scene.exitState.trim()); if (empty) return setLocalError("每个场景都需要名称、进入状态和结束状态。");
    const input = { chapterId, expectedChapterRevision: chapter.revision, scenes: clean(scenes) };
    const result = await run("预览场景调整", input, key => createBookArrangementApi(workspace.novelId).previewScenes(input, key));
    if (result) { setPreview(result); setNotice("已生成本章场景影响预览，确认后再应用。"); }
  };
  const apply = async () => {
    if (!preview) return;
    const result = await run("应用场景调整", { candidateId: preview.id }, key => createBookArrangementApi(workspace.novelId).applyScenes(preview.id, key));
    if (result) { try { sessionStorage.removeItem(cacheKey); } catch {} await reload(); onDirty(chapterId, false); onBack(); }
  };
  const cancel = () => {
    try { sessionStorage.removeItem(cacheKey); } catch {}
    if (!source.length) { onDirty(chapterId, false); onBack(); return; }
    change(source); setSelectedId(source[0]?.id ?? "");
  };
  const chapterPeople = [...new Set(workspace.events.filter(event => event.chapterId === chapterId).flatMap(event => event.participantIds))].map(id => workspace.characters.find(person => person.id === id)).filter(Boolean);

  return <section className="ba-scene-editor" aria-label={`第${chapter.order}章场景编排`}>
    <header className="ba-scene-page-head"><div><p>全书编排台&nbsp; / &nbsp;第{chapter.order}章</p><h1>第{chapter.order}章 · {chapter.title}</h1><span>本章目标：{chapter.outline || "按场景推进章节任务。"}</span></div><Button variant="outline" onClick={onBack}><ArrowLeft size={16} />返回全书</Button></header>
    <section className="ba-scene-budget"><header><div><h2>场景篇幅分配 <em>必须补</em></h2><p>左右拖动分界线调整相邻场景占比，参考字数会自动更新。</p></div><div className="ba-scene-budget-total">本章参考字数 <strong>{totalWords}</strong> 字 <Button variant="outline" size="sm" disabled={scenes.length >= 8} onClick={add}><Plus size={16} />添加场景</Button></div></header>
      <div className="ba-scene-budget-track">{scenes.map((scene, index) => <div key={scene.id} className={`ba-scene-budget-segment is-${colors[index % colors.length]} ${selected?.id === scene.id ? "is-selected" : ""}`} style={{ width: `${sceneBudgetPercent(scene, scenes)}%` }} onClick={() => setSelectedId(scene.id)}><header><b>S{index + 1}</b><span title={scene.title}>{scene.title}</span></header><strong>{sceneBudgetPercent(scene, scenes)}%</strong><small>约{scene.targetWordCount}字</small>{index < scenes.length - 1 && <button type="button" className="ba-scene-boundary" aria-label={`调整场景 S${index + 1} 与 S${index + 2} 的篇幅`} onPointerDown={event => beginBoundary(event, index)} onPointerMove={dragBoundary} onPointerUp={() => { boundary.current = null; }} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); change(resizeSceneBoundary(scenes, index, event.key === "ArrowRight" ? 30 : -30)); } }}><span aria-hidden="true">Ⅱ</span></button>}</div>)}</div>
      <footer><span>合计 100% · 约{totalWords}字</span><Button size="sm" variant="ghost" disabled={!dirty} onClick={cancel}><RotateCcw size={14} />撤销调整</Button></footer>
    </section>
      <div className="ba-scene-workspace"><main><header className="ba-scene-list-head"><h2>场景编排</h2><span className="ba-scene-foundation">{source.length ? "场景卡 · 有基础" : "场景卡 · 待建立"}</span></header><div className="ba-scene-list">{scenes.map((scene, index) => <article key={scene.id} className={`ba-scene-row ${selected?.id === scene.id ? "is-selected" : ""}`} draggable onDragStart={() => setDraggingId(scene.id)} onDragOver={event => event.preventDefault()} onDrop={() => dropAt(scene.id)} onClick={() => setSelectedId(scene.id)}><button type="button" className="ba-scene-grip" aria-label={`拖动场景 S${index + 1}`}><GripVertical size={18} /></button><span className="ba-scene-index">S{index + 1}</span><div className="ba-scene-summary"><header><h3>{scene.title}</h3><span>{scene.revision === "new" ? "新增" : selected?.id === scene.id && dirty ? "正在调整" : "计划"}</span></header><p><b>任务</b>{scene.objective || "尚未填写场景任务"}</p><p><b>冲突</b>{scene.conflict || "尚未填写场景冲突"}</p><p><b>结束时</b>{scene.exitState}</p><footer>{sceneBudgetPercent(scene, scenes)}% · 约{scene.targetWordCount}字{scene.resistance && <em>{scene.resistance}</em>}</footer></div><div className="ba-scene-row-actions"><Button size="sm" variant="outline" onClick={event => { event.stopPropagation(); change(scenes.map(item => item.id === scene.id ? { ...item, locked: !item.locked } : item)); }}><LockKeyhole size={14} />{scene.locked ? "解除占比" : "锁定占比"}</Button><details onClick={event => event.stopPropagation()}><summary aria-label="场景操作" onClick={() => setSelectedId(scene.id)}><ChevronDown size={16} /></summary><div><button onClick={() => shift(scene.id, -1)} disabled={index === 0}><ArrowUp size={14} />上移</button><button onClick={() => shift(scene.id, 1)} disabled={index === scenes.length - 1}><ArrowDown size={14} />下移</button><button onClick={() => split(scene.id)} disabled={scene.locked}><Split size={14} />拆分</button><button onClick={() => merge(scene.id, -1)} disabled={index === 0 || scene.locked || scenes[index - 1]?.locked}>合并上一场</button><button onClick={() => remove(scene.id)} disabled={scenes.length <= 3 || scene.locked}><Trash2 size={14} />删除</button></div></details></div></article>)}</div>{localError && <p role="alert" className="ba-scene-error">{localError}</p>}</main>
      <aside className="ba-scene-inspector">{selected ? <><header><div><h2>S{scenes.indexOf(selected) + 1} · {selected.title}</h2><p>当前调整仅作用于本场景</p></div><div><Button size="sm" variant="ghost" disabled={scenes.indexOf(selected) === 0} onClick={() => setSelectedId(scenes[scenes.indexOf(selected) - 1].id)}><ArrowLeft size={16} /></Button><Button size="sm" variant="ghost" disabled={scenes.indexOf(selected) === scenes.length - 1} onClick={() => setSelectedId(scenes[scenes.indexOf(selected) + 1].id)}><ArrowRight size={16} /></Button></div></header><nav aria-label="场景编辑分类"><button className={tab === "story" ? "is-active" : ""} onClick={() => setTab("story")}>故事安排</button><button className={tab === "expression" ? "is-active" : ""} onClick={() => setTab("expression")}>节奏与表达</button><button className={tab === "people" ? "is-active" : ""} onClick={() => setTab("people")}>人物与边界</button></nav>
        <div className="ba-scene-fields">{tab === "story" && <><label><span>场景名称</span><input value={selected.title} onChange={event => update({ title: event.target.value })} /></label><label><span>场景任务</span><textarea rows={3} value={selected.objective} onChange={event => update({ objective: event.target.value })} /></label><label><span>场景冲突</span><textarea rows={2} value={selected.conflict} onChange={event => update({ conflict: event.target.value })} /></label><label><span>进入状态</span><textarea rows={2} value={selected.entryState} onChange={event => update({ entryState: event.target.value })} /></label><label><span>结束状态</span><textarea rows={2} value={selected.exitState} onChange={event => update({ exitState: event.target.value })} /></label><label><span>揭示信息</span><textarea rows={2} value={selected.reveal} onChange={event => update({ reveal: event.target.value })} /></label><section><h3>本章关联事件</h3>{workspace.events.filter(event => event.chapterId === chapterId).map(event => <button key={event.id} className="ba-scene-event" onClick={() => onObject({ kind: "event", id: event.id, chapterId })}>{event.title}</button>)}<button className="ba-scene-event is-add" onClick={() => onObject({ kind: "event", id: "new", chapterId })}>+ 新增事件</button></section></>}
        {tab === "expression" && <><label><span>篇幅预算</span><input type="number" min={150} disabled={selected.locked} value={selected.targetWordCount} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 150) update({ targetWordCount: Math.round(value) }); }} /></label><label><span>推进阻力</span><textarea rows={2} value={selected.resistance} onChange={event => update({ resistance: event.target.value })} /></label><label><span>场景转折</span><textarea rows={2} value={selected.turn} onChange={event => update({ turn: event.target.value })} /></label><label><span>情绪变化</span><textarea rows={2} value={selected.emotionalShift} onChange={event => update({ emotionalShift: event.target.value })} /></label><label><span>读者获得</span><textarea rows={2} value={selected.readerValue} onChange={event => update({ readerValue: event.target.value })} /></label></>}
        {tab === "people" && <><section><h3>本章事件参与人物</h3><div className="ba-scene-people">{chapterPeople.length ? chapterPeople.map(person => <span key={person!.id}>{person!.name}</span>) : <p>本章事件尚未关联人物。</p>}</div></section><label><span>必须推进</span><textarea rows={3} value={joinLines(selected.mustAdvance)} onChange={event => update({ mustAdvance: splitLines(event.target.value) })} /></label><label><span>必须保留</span><textarea rows={3} value={joinLines(selected.mustPreserve)} onChange={event => update({ mustPreserve: splitLines(event.target.value) })} /></label><label><span>禁止扩写</span><textarea rows={3} value={joinLines(selected.forbiddenExpansion)} onChange={event => update({ forbiddenExpansion: splitLines(event.target.value) })} /></label></>}</div>
        <footer className="ba-scene-inspector-footer">{preview ? <section className="ba-scene-preview"><h3>调整预览</h3><ul>{sceneChangeSummary(preview).map(item => <li key={item}>{item}</li>)}</ul>{preview.conflicts.map(item => <p className="is-conflict" key={item.code}>{item.message}</p>)}{preview.impact.map(item => <p key={item}>{item}</p>)}{preview.writtenChapterIds.length > 0 && <p className="is-warning">本章已有正文，应用后需要重新核对。</p>}<Button disabled={busy || !preview.canApply || Boolean(preview.applied)} onClick={apply}>{preview.applied ? "已应用" : "应用到本章规划"}</Button></section> : <Button disabled={busy || !dirty} onClick={showPreview}>预览安排与写作指令</Button>}<Button variant="outline" disabled={busy || !dirty} onClick={cancel}>取消修改</Button>{notice && <p role="status">{notice}</p>}</footer></> : <p>本章没有可编辑场景。</p>}</aside></div>
  </section>;
}

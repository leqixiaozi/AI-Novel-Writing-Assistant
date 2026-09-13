import { useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Link2, Plus } from "lucide-react";
import type { BookArrangementHookStage, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import type { ArrangementObjectSelection } from "../objects/ArrangementObjectPanel";
import { canMoveHookNode, hookLifecycleRisks, hookStages, lifecycleEntries } from "./hookLifecycleState";

export function HookLifecyclePanel({ workspace, selectedChapterId, windowStart, windowSize, onWindowStart, onSelectChapter, onObject }: {
  workspace: BookArrangementWorkspace; selectedChapterId: string; windowStart: number; windowSize: number;
  onWindowStart: (start: number) => void; onSelectChapter: (id: string) => void; onObject: (selection: ArrangementObjectSelection) => void;
}) {
  const clues = workspace.clues ?? [];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedClueId, setSelectedClueId] = useState(clues[0]?.id ?? "");
  const selected = clues.find(clue => clue.id === selectedClueId) ?? clues[0];
  const filtered = clues.filter(clue => (!query.trim() || `${clue.title} ${clue.summary}`.includes(query.trim())) && (status === "all" || status === "plan" && clue.basis === "plan" || status === "record" && clue.basis === "record" || clue.status === status));
  const entries = useMemo(() => lifecycleEntries(workspace, selected), [workspace, selected]);
  const risks = useMemo(() => hookLifecycleRisks(workspace, selected, entries), [workspace, selected, entries]);
  const chapters = workspace.chapters.slice(windowStart, windowStart + windowSize);
  const editableHook = selected?.sourceEntity === "TimelineHook";
  const addNode = (stage: BookArrangementHookStage) => {
    if (!selected || !editableHook) return;
    onObject({ kind: "hookNode", id: "new", chapterId: selectedChapterId, defaults: { hookId: selected.sourceId, stage, chapterId: selectedChapterId, basis: "plan", note: "", position: 1 } });
  };
  return <section className="ba-hook-lifecycle" aria-label="线索与伏笔生命周期编排">
    <aside className="ba-hook-pool"><header><h3>线索池</h3><span>{filtered.length}/{clues.length}</span></header><input className="ba-input" aria-label="筛选线索" placeholder="搜索标题或说明" value={query} onChange={event => setQuery(event.target.value)} /><select className="ba-input" aria-label="筛选线索状态" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="plan">计划资料</option><option value="record">历史记录</option><option value="open">待处理</option><option value="resolved">已回收</option></select><div className="ba-hook-pool-list">{filtered.map(clue => <button type="button" key={clue.id} className={clue.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedClueId(clue.id)}><strong>{clue.title}</strong><small>{clue.basis === "plan" ? "计划" : "记录"} · {clue.status}</small><span>{clue.summary || "暂无说明"}</span></button>)}{!filtered.length && <p>没有符合条件的线索。</p>}</div></aside>
    <div className="ba-hook-workspace">{selected ? <><header className="ba-hook-heading"><div><h3>{selected.title}</h3><p>{selected.summary || selected.evidenceLabel}</p></div>{editableHook && <Button size="sm" variant="outline" onClick={() => onObject({ kind: "hook", id: selected.sourceId, chapterId: selected.setupChapterId ?? undefined })}>编辑线索</Button>}</header>
      <div className="ba-hook-stage-actions" aria-label="新增生命周期节点">{hookStages.map(stage => <Button key={stage.value} size="sm" variant="ghost" disabled={!editableHook} style={{ "--ba-hook-stage": stage.color } as CSSProperties} onClick={() => addNode(stage.value)}><Plus size={13} />{stage.label}</Button>)}</div>
      <div className="ba-hook-track-head"><div><strong>章节轴</strong><span>虚线为计划，实线为正文记录</span></div><span>第 {chapters[0]?.order ?? "—"}—{chapters.at(-1)?.order ?? "—"} 章</span><Button size="sm" variant="ghost" aria-label="线索轴上一窗口" disabled={windowStart === 0} onClick={() => onWindowStart(Math.max(0, windowStart - windowSize))}><ChevronLeft size={15} /></Button><Button size="sm" variant="ghost" aria-label="线索轴下一窗口" disabled={windowStart + windowSize >= workspace.chapters.length} onClick={() => onWindowStart(Math.min(Math.max(0, workspace.chapters.length - windowSize), windowStart + windowSize))}><ChevronRight size={15} /></Button></div>
      <div className="ba-hook-track-scroll"><div className="ba-hook-track" style={{ "--ba-count": chapters.length } as CSSProperties}>{chapters.map(chapter => <button type="button" className={`ba-hook-chapter ${chapter.id === selectedChapterId ? "is-selected" : ""}`} key={chapter.id} onClick={() => onSelectChapter(chapter.id)}><strong>{chapter.order}</strong><span>{chapter.title}</span><small>{chapter.hasContent ? "已写" : "待写"}</small></button>)}<div className="ba-hook-node-grid">{chapters.map(chapter => <div key={chapter.id} className="ba-hook-node-cell" onDragOver={event => { const id = event.dataTransfer.types.includes("text/hook-node"); if (id) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/hook-node"); const entry = entries.find(item => item.id === id); if (entry && canMoveHookNode(workspace, entry, chapter.id)) onObject({ kind: "hookNode", id: entry.sourceId!, chapterId: entry.chapterId, defaults: { chapterId: chapter.id } }); }}>
          {entries.filter(entry => entry.chapterId === chapter.id).map(entry => { const stage = hookStages.find(item => item.value === entry.stage)!; const linkedEvent = workspace.events.find(item => item.id === entry.relatedEventId); const scene = workspace.scenes.find(item => item.id === entry.relatedSceneId); return <button type="button" draggable={entry.editable && entry.basis === "plan"} onDragStart={event => event.dataTransfer.setData("text/hook-node", entry.id)} onClick={() => entry.editable && onObject({ kind: "hookNode", id: entry.sourceId!, chapterId: entry.chapterId })} key={entry.id} className={`ba-hook-node is-${entry.basis} is-${entry.evidenceStatus}`} style={{ "--ba-hook-stage": stage.color } as CSSProperties}><strong>{stage.label}</strong><span>{entry.note}</span>{(linkedEvent || scene) && <small><Link2 size={10} />{[linkedEvent?.title, scene?.title].filter(Boolean).join(" · ")}</small>}</button>; })}
        </div>)}</div></div></div>
      <section className={`ba-hook-risks ${risks.length ? "has-risk" : ""}`}><header><AlertTriangle size={15} /><strong>风险诊断</strong><span>{risks.length ? `${risks.length} 项` : "未发现明显风险"}</span></header>{risks.map(risk => <p key={risk}>{risk}</p>)}</section></> : <p className="ba-empty-state">这本书还没有线索或伏笔资料。可从“更多”中新建伏笔。</p>}</div>
  </section>;
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BookArrangementCharacterSpan, BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { WritingControlsForm } from "@/pages/novels/components/writingAdjustments/WritingControlsForm";
import { chapterEdit, presenceLabels, updateChapterEdit, eventStatusLabels } from "./arrangementState";
import { ArrangementRequirements } from "./ArrangementPreview";

const checkStatusLabels: Record<string, string> = { resolved: "已解决", ignored: "已忽略", closed: "已关闭", open: "待处理" };

export function ArrangementInspector({ workspace, draft, selectedId, scope, spanId, spanSelection, onSpan, onDraft, busy,
  characterId, historySelection, onSelectChapter, onAddAppearance, onScope, onPreview, previewDisabled, dirty }: {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; selectedId: string; scope: string[];
  spanId: string; spanSelection: number; onSpan: (id: string, chapterId?: string) => void; onDraft: (draft: BookArrangementDraftPayload) => void; busy: boolean;
  characterId?: string; historySelection?: number; onSelectChapter?: (id: string) => void; onAddAppearance?: () => void;
  onScope?: (ids: string[]) => void; onPreview?: () => void; previewDisabled?: boolean; dirty?: boolean;
}) {
  const [tab, setTab] = useState<"arrangement" | "history">("arrangement");
  useEffect(() => { if (spanId) setTab("arrangement"); }, [spanId, spanSelection]);
  useEffect(() => { if (historySelection) setTab("history"); }, [historySelection]);
  const chapter = workspace.chapters.find(item => item.id === selectedId);
  const span = draft.characterSpans.find(item => item.id === spanId);
  const person = workspace.characters.find(item => item.id === (span?.characterId ?? characterId));
  const edit = chapterEdit(draft, selectedId);
  const position = workspace.chapters.findIndex(item => item.id === selectedId);
  const updateSpan = (patch: Partial<BookArrangementCharacterSpan>) => {
    if (span) onDraft({ ...draft, characterSpans: draft.characterSpans.map(item => item.id === span.id ? { ...item, ...patch } : item) });
  };
  if (!chapter) return <aside className="ba-inspector"><p>选择章节查看编排。</p></aside>;
  const sourceUrl = `/novels/${encodeURIComponent(workspace.novelId)}/edit?stage=structured&chapterId=${encodeURIComponent(chapter.id)}`;
  const events = workspace.events.filter(event => event.chapterId === chapter.id && (!person || event.participantIds.includes(person.id)));
  const projections = [...(workspace.relations ?? []), ...(workspace.clues ?? []), ...(workspace.checks ?? [])].filter(item => item.chapterIds.includes(chapter.id));
  const spanLocked = span?.chapterIds.some(id => chapterEdit(draft, id).locked) ?? false;
  const addAppearance = () => {
    if (onAddAppearance) { onAddAppearance(); return; }
    const target = person ?? workspace.characters[0];
    const chapterIds = (scope.length ? scope : [selectedId]).filter(id => !chapterEdit(draft, id).locked);
    if (!target || !chapterIds.length) return;
    const id = crypto.randomUUID();
    onDraft({ ...draft, characterSpans: [...draft.characterSpans, { id, characterId: target.id, chapterIds, mode: "suggested", weight: null, note: "" }] }); onSpan(id);
  };
  return <aside className="ba-inspector">
    <header className="ba-inspector-heading"><div><h2>{person ? `${person.name} · ` : ""}第 {chapter.order} 章</h2><p>{span ? "计划出场" : person ? "人物记录" : chapter.title} · {dirty ? "尚未保存修改" : "编排草稿"}</p></div><div className="ba-inspector-navigation"><Button size="sm" variant="ghost" aria-label="上一章安排" disabled={!onSelectChapter || position <= 0 || busy} onClick={() => onSelectChapter?.(workspace.chapters[position - 1].id)}><ChevronLeft size={16} aria-hidden="true" /></Button><Button size="sm" variant="ghost" aria-label="下一章安排" disabled={!onSelectChapter || position >= workspace.chapters.length - 1 || busy} onClick={() => onSelectChapter?.(workspace.chapters[position + 1].id)}><ChevronRight size={16} aria-hidden="true" /></Button></div></header>
    <div className="ba-inspector-tabs" role="tablist" aria-label="编排编辑"><button type="button" role="tab" aria-selected={tab === "arrangement"} onClick={() => setTab("arrangement")}>出场安排</button><button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>历史依据</button></div>
    <fieldset disabled={busy} className="ba-inspector-body">
      {tab === "arrangement" ? <>
        <section className="ba-inspector-card"><header className="ba-card-heading"><span className="ba-status-dot" />{span ? "人物参与计划" : "出场安排"}</header>
          <div className="ba-card-content">
            <select aria-label="选择人物区段" className="ba-input" value={spanId} onChange={event => onSpan(event.target.value)}><option value="">选择已有出场安排</option>{draft.characterSpans.map(item => <option key={item.id} value={item.id}>{workspace.characters.find(character => character.id === item.characterId)?.name || "人物"} · {item.chapterIds.length} 章 · {presenceLabels[item.mode]}</option>)}</select>
            {!span && <div className="ba-empty-state"><p>{person ? `${person.name}在当前选择中没有待编辑的出场安排。` : "点击人物出场，或添加一条新的参与安排。"}</p><Button size="sm" variant="secondary" disabled={!workspace.characters.length || edit.locked} onClick={addAppearance}>新增人物区段</Button></div>}
            {span && <><fieldset disabled={spanLocked} className="ba-span-fields">
              <label className="ba-field"><span>人物</span><select aria-label="区段人物" className="ba-input" value={span.characterId} onChange={event => updateSpan({ characterId: event.target.value })}>{workspace.characters.map(character => <option key={character.id} value={character.id}>{character.name}{character.role ? ` · ${character.role}` : ""}</option>)}</select></label>
              <label className="ba-field"><span>参与方式</span><select aria-label="区段参与方式" className="ba-input" value={span.mode} onChange={event => updateSpan({ mode: event.target.value as BookArrangementCharacterSpan["mode"] })}>{Object.entries(presenceLabels).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>
              <div className="ba-field"><span>计划出场</span><div className="ba-chapter-chips">{workspace.chapters.filter(item => span.chapterIds.includes(item.id)).map(item => <button type="button" className={item.id === selectedId ? "is-selected" : ""} key={item.id} onClick={() => onSelectChapter?.(item.id)}>第{item.order}章</button>)}</div></div>
              <label className="ba-field"><span>当前目标</span><textarea aria-label="区段备注" rows={2} className="ba-input" placeholder="这段出场要推动什么？" value={span.note} onChange={event => updateSpan({ note: event.target.value })} /></label>
              <details className="ba-detail"><summary>权重与出场章节</summary><label className="ba-field"><span>权重（留空为未设置）</span><input aria-label="区段权重" className="ba-input" type="number" min={0} max={100} step={1} value={span.weight ?? ""} onChange={event => updateSpan({ weight: event.target.value === "" ? null : Number(event.target.value) })} /></label><Button size="sm" variant="ghost" disabled={!scope.length} onClick={() => updateSpan({ chapterIds: scope.filter(id => !chapterEdit(draft, id).locked) })}>使用勾选的调整范围</Button><div className="ba-span-chapter-list">{workspace.chapters.map(item => <label key={item.id}><input type="checkbox" disabled={chapterEdit(draft, item.id).locked} aria-label={`区段包含第${item.order}章`} checked={span.chapterIds.includes(item.id)} onChange={event => updateSpan({ chapterIds: event.target.checked ? [...span.chapterIds, item.id] : span.chapterIds.filter(id => id !== item.id) })} />第 {item.order} 章 · {item.title}</label>)}</div><Button size="sm" variant="ghost" onClick={() => { onDraft({ ...draft, characterSpans: draft.characterSpans.filter(item => item.id !== span.id) }); onSpan(""); }}>移除这个人物区段</Button></details>
            </fieldset>{spanLocked && <p className="ba-help">此安排包含锁定章节，请先在章节设置中解除锁定后编辑。</p>}<button type="button" className="ba-evidence-link" onClick={() => setTab("history")}>查看相关依据<ChevronRight size={14} aria-hidden="true" /></button></>}
          </div>
        </section>
        <details className="ba-detail ba-chapter-settings"><summary>本章备注与表达参数</summary><label className="ba-lock-control"><input type="checkbox" aria-label="锁定本章编排" checked={edit.locked} onChange={event => onDraft(updateChapterEdit(draft, chapter.id, { locked: event.target.checked }))} />锁定本章编排</label><fieldset disabled={edit.locked} className="ba-span-fields"><label className="ba-field"><span>编排备注</span><textarea aria-label="编排备注" rows={3} className="ba-input" value={edit.note} onChange={event => onDraft(updateChapterEdit(draft, chapter.id, { note: event.target.value }))} /></label><details className="ba-detail"><summary>本章五种表达参数</summary><WritingControlsForm controls={edit.controls} characters={workspace.characters} definitions={[]} onChange={controls => onDraft(updateChapterEdit(draft, chapter.id, { controls }))} /></details></fieldset><details className="ba-detail"><summary>已应用的后续要求</summary>{workspace.appliedSettings[chapter.id] ? <ArrangementRequirements settings={workspace.appliedSettings[chapter.id].settings} workspace={workspace} /> : <p>尚未应用编排要求。</p>}</details></details>
      </> : <section className="ba-inspector-card ba-history-card">
        <header className="ba-card-heading">章节与人物依据</header>
        <div className="ba-card-content">
          <p className="ba-help">以下为已有资料；计划事件单独标注，不代表已经发生。</p>
          {events.length === 0 && <p className="ba-empty-state">本章暂无{person ? "该人物的" : ""}事件记录。</p>}
          {events.map(event => <article key={event.id} className="ba-evidence-item">
            <div><span className="ba-evidence-status">{eventStatusLabels[event.status] ?? event.status}</span><span>{event.storyTimeLabel ?? (event.storyDayIndex === null ? "发生时间未记录" : `故事第 ${event.storyDayIndex} 天`)}</span></div>
            <h3>{event.title}</h3><p>{event.summary}</p><Link to={sourceUrl}>打开来源章节<ChevronRight size={14} aria-hidden="true" /></Link>
          </article>)}
          {projections.map(item => <article className="ba-evidence-item" key={item.id}><span className="ba-evidence-status">{item.evidenceLabel}</span>{(item.sourceEntity === "AuditIssue" || item.sourceEntity === "OpenConflict") && <span className="ba-check-status">状态：{checkStatusLabels[item.status] ?? item.status}</span>}<h3>{item.title}</h3><p>{item.summary}</p></article>)}
          <article className="ba-evidence-item"><h3>章节规划</h3><p>{chapter.outline || "尚无章节规划。"}</p><Link to={sourceUrl}>打开章节规划与正文<ChevronRight size={14} aria-hidden="true" /></Link></article>
          {workspace.scenes.filter(scene => scene.chapterId === chapter.id).map(scene => <article className="ba-evidence-item" key={scene.id}><h3>{scene.title}</h3><p>{scene.objective || "未记录场景目标。"}</p></article>)}
        </div>
      </section>}
    </fieldset>
    <footer className="ba-inspector-footer"><section className="ba-inspector-card"><header className="ba-card-heading">本次调整</header><div className="ba-card-content"><label className="ba-field"><span>作用范围</span><select aria-label="本次调整范围" className="ba-input" disabled={busy || !onScope} value={scope.length === 1 && scope[0] === selectedId ? "chapter" : "selected"} onChange={event => { if (event.target.value === "chapter") onScope?.([selectedId]); }}><option value="selected">勾选范围 · {scope.length} 章</option><option value="chapter">仅第 {chapter.order} 章</option></select></label><p className="ba-help">保存安排后，预览其对后续写作的要求。已写正文保持原样。</p>{dirty && <p className="ba-help">还有未保存的编排，请先保存草稿。</p>}<Button size="sm" disabled={busy || previewDisabled || !onPreview} onClick={onPreview}>预览后续要求</Button></div></section></footer>
  </aside>;
}

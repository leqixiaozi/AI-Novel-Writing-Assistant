import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BookArrangementCharacterSpan, BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { WritingControlsForm } from "@/pages/novels/components/writingAdjustments/WritingControlsForm";
import { chapterEdit, presenceLabels, updateChapterEdit } from "./arrangementState";
import { ArrangementRequirements } from "./ArrangementPreview";

export function ArrangementInspector({ workspace, draft, selectedId, scope, spanId, spanSelection, onSpan, onDraft, busy }: {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; selectedId: string; scope: string[];
  spanId: string; spanSelection: number; onSpan: (id: string) => void; onDraft: (draft: BookArrangementDraftPayload) => void; busy: boolean;
}) {
  const [tab, setTab] = useState<"chapter" | "span">("chapter");
  useEffect(() => { if (spanId) setTab("span"); }, [spanId, spanSelection]);
  const chapter = workspace.chapters.find(item => item.id === selectedId);
  const span = draft.characterSpans.find(item => item.id === spanId);
  const edit = chapterEdit(draft, selectedId);
  const updateSpan = (patch: Partial<BookArrangementCharacterSpan>) => {
    if (span) onDraft({ ...draft, characterSpans: draft.characterSpans.map(item => item.id === span.id ? { ...item, ...patch } : item) });
  };
  if (!chapter) return <aside className="ba-inspector"><p className="text-sm">选择章节查看编排。</p></aside>;
  const sourceUrl = `/novels/${encodeURIComponent(workspace.novelId)}/edit?stage=structured&chapterId=${encodeURIComponent(chapter.id)}`;
  return <aside className="ba-inspector space-y-4">
    <div><h2 className="text-base">第 {chapter.order} 章 · {chapter.title}</h2><p className="mt-1 text-xs text-muted-foreground">{chapter.wordCount.toLocaleString()} 字 · {chapter.hasContent ? "已有正文" : "待写"}</p></div>
    <div className="flex gap-2" role="tablist" aria-label="编排编辑"><Button size="sm" variant={tab === "chapter" ? "secondary" : "ghost"} role="tab" aria-selected={tab === "chapter"} onClick={() => setTab("chapter")}>章信息</Button><Button size="sm" variant={tab === "span" ? "secondary" : "ghost"} role="tab" aria-selected={tab === "span"} onClick={() => setTab("span")}>人物区段</Button></div>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      {tab === "chapter" ? <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="锁定本章编排" checked={edit.locked} onChange={event => onDraft(updateChapterEdit(draft, chapter.id, { locked: event.target.checked }))} />锁定本章编排</label>
        <p className="text-xs text-muted-foreground">锁定章会从编排预览与大纲调整中排除，章节原有写作流程可继续使用。</p>
        <fieldset disabled={edit.locked} className="min-w-0 space-y-4">
          <label className="block space-y-1 text-sm"><span>编排备注</span><textarea aria-label="编排备注" rows={3} className="ba-input" placeholder="这一章要保留什么、突出什么？" value={edit.note} onChange={event => onDraft(updateChapterEdit(draft, chapter.id, { note: event.target.value }))} /></label>
          <details><summary className="cursor-pointer text-sm">本章五种表达参数</summary><div className="pt-3"><WritingControlsForm controls={edit.controls} characters={workspace.characters} definitions={[]} onChange={controls => onDraft(updateChapterEdit(draft, chapter.id, { controls }))} /></div></details>
        </fieldset>
        <details><summary className="cursor-pointer text-sm">已应用的后续要求</summary><div className="space-y-2 pt-2 text-xs">{workspace.appliedSettings[chapter.id] ? <ArrangementRequirements settings={workspace.appliedSettings[chapter.id].settings} workspace={workspace} /> : <p className="text-muted-foreground">尚未应用编排要求。</p>}</div></details>
        <section className="space-y-2 text-xs"><h3 className="text-sm">原规划与资料</h3><p className="whitespace-pre-wrap text-muted-foreground">{chapter.outline || "尚无章节规划。"}</p><Link className="text-primary underline" to={sourceUrl}>打开章节规划与正文</Link>
          {workspace.events.filter(event => event.chapterId === chapter.id).map(event => <div key={event.id} className="space-y-1 py-2"><p>{event.title}</p><p className="whitespace-pre-wrap text-muted-foreground">{event.summary}</p></div>)}
          {workspace.scenes.filter(scene => scene.chapterId === chapter.id).map(scene => <div key={scene.id}><p>{scene.title}</p><p className="text-muted-foreground">{scene.objective}</p></div>)}
        </section>
      </> : <>
        <p className="text-xs text-muted-foreground">为人物指定参与区段，应用后作为所选章节的可选写作要求。角色是否已经出场，以正文和历史资料为准。</p>
        <select aria-label="选择人物区段" className="ba-input" value={spanId} onChange={event => onSpan(event.target.value)}><option value="">选择已有区段</option>{draft.characterSpans.map(item => <option key={item.id} value={item.id}>{workspace.characters.find(person => person.id === item.characterId)?.name || "人物"} · {item.chapterIds.length} 章 · {presenceLabels[item.mode]}</option>)}</select>
        <Button size="sm" variant="secondary" disabled={!workspace.characters.length} onClick={() => { const id = crypto.randomUUID(); onDraft({ ...draft, characterSpans: [...draft.characterSpans, { id, characterId: workspace.characters[0].id, chapterIds: scope.length ? [...scope] : [selectedId], mode: "suggested", weight: null, note: "" }] }); onSpan(id); }}>新增人物区段</Button>
        {span && <>
          <label className="block space-y-1 text-sm"><span>人物</span><select aria-label="区段人物" className="ba-input" value={span.characterId} onChange={event => updateSpan({ characterId: event.target.value })}>{workspace.characters.map(person => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ""}</option>)}</select></label>
          <label className="block space-y-1 text-sm"><span>参与方式</span><select aria-label="区段参与方式" className="ba-input" value={span.mode} onChange={event => updateSpan({ mode: event.target.value as BookArrangementCharacterSpan["mode"] })}>{Object.entries(presenceLabels).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>
          <label className="block space-y-1 text-sm"><span>权重（留空为未设置）</span><input aria-label="区段权重" className="ba-input" type="number" min={0} max={100} step={1} value={span.weight ?? ""} onChange={event => updateSpan({ weight: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          <label className="block space-y-1 text-sm"><span>区段备注</span><textarea aria-label="区段备注" rows={3} className="ba-input" value={span.note} onChange={event => updateSpan({ note: event.target.value })} /></label>
          <details open><summary className="cursor-pointer text-sm">区段章节 · {span.chapterIds.length} 章</summary><Button size="sm" variant="ghost" disabled={!scope.length} onClick={() => updateSpan({ chapterIds: [...scope] })}>使用勾选的调整范围</Button><div className="max-h-48 space-y-2 overflow-y-auto py-2">{workspace.chapters.map(item => <label key={item.id} className="flex gap-2 text-xs"><input type="checkbox" aria-label={`区段包含第${item.order}章`} checked={span.chapterIds.includes(item.id)} onChange={event => updateSpan({ chapterIds: event.target.checked ? [...span.chapterIds, item.id] : span.chapterIds.filter(id => id !== item.id) })} />第 {item.order} 章 · {item.title}</label>)}</div></details>
          <Button size="sm" variant="ghost" onClick={() => { onDraft({ ...draft, characterSpans: draft.characterSpans.filter(item => item.id !== span.id) }); onSpan(""); }}>移除这个人物区段</Button>
        </>}
      </>}
    </fieldset>
  </aside>;
}

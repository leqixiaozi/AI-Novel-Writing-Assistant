import { useEffect, useMemo, useState } from "react";
import type { BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { createWritingAdjustmentApi, type WritingPlanPreview } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { preserveLines, recoverPlanPreview } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import { buildArrangementPlanInput, editableChapterIds } from "./arrangementState";

export type ArrangementRun = <T>(operation: string, input: unknown, action: (key: string) => Promise<T>) => Promise<T | undefined>;
function readPlanning(novelId: string): { instruction: string; preserve: string; preview: WritingPlanPreview | null; identity: string; selected: string[] } | null {
  try { const value = JSON.parse(sessionStorage.getItem(`arrangement-planning:${novelId}`) || "null"); return value && typeof value.instruction === "string" && typeof value.preserve === "string" && Array.isArray(value.selected) ? value : null; } catch { return null; }
}

export function ArrangementPlanning({ workspace, draft, scope, busy, dirty, run, reload }: {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; scope: string[]; busy: boolean; dirty: boolean; run: ArrangementRun; reload: () => Promise<void>;
}) {
  const api = useMemo(() => createWritingAdjustmentApi(workspace.novelId), [workspace.novelId]);
  const [recovered] = useState(() => readPlanning(workspace.novelId));
  const [instruction, setInstruction] = useState(recovered?.instruction ?? "");
  const [preserve, setPreserve] = useState(recovered?.preserve ?? "");
  const [preview, setPreview] = useState<WritingPlanPreview | null>(() => recovered && recovered.identity === JSON.stringify([draft, scope, recovered.instruction, recovered.preserve]) ? recovered.preview : null);
  const [selected, setSelected] = useState<string[]>(recovered?.selected ?? []);
  const [history, setHistory] = useState<WritingPlanPreview[]>([]);
  const [applied, setApplied] = useState(false);
  const allowed = editableChapterIds(draft, scope);
  const planInput = buildArrangementPlanInput(workspace, draft, scope, instruction, preserveLines(preserve));
  const inputTooLarge = planInput.instruction.length > 10000 || planInput.preserve.length > 50 || planInput.preserve.some(line => line.length > 2000) || allowed.length > 100;
  const identity = JSON.stringify([draft, scope, instruction, preserve]);
  const [lastIdentity, setLastIdentity] = useState(identity);
  useEffect(() => { if (lastIdentity !== identity) { setPreview(null); setSelected([]); setApplied(false); setLastIdentity(identity); } }, [identity, lastIdentity]);
  useEffect(() => { try { sessionStorage.setItem(`arrangement-planning:${workspace.novelId}`, JSON.stringify({ instruction, preserve, preview, identity, selected })); } catch { /* model candidates remain available in saved history */ } }, [workspace.novelId, instruction, preserve, preview, identity, selected]);
  const stale = preview?.changes.some(change => preview.baseRevisions[change.chapterId] !== workspace.chapters.find(chapter => chapter.id === change.chapterId)?.revision) ?? false;
  return <section className="ba-planning-content space-y-3 pt-3">
    <p className="text-sm text-muted-foreground">让 AI 参考已保存的章节备注、人物区段和表达参数，重编排勾选且未锁定章节的大纲。采纳会修改这些章节的规划，历史正文保持原样。</p>
    <label className="block space-y-1 text-sm"><span>补充大纲调整目标（可选）</span><textarea aria-label="大纲调整目标" rows={3} className="ba-input" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="留空即按保存的配置调整。也可补充：加强对立，保留结盟。" /></label>
    <label className="block space-y-1 text-sm"><span>需要保留的安排（每行一项）</span><textarea aria-label="大纲保留要求" rows={2} className="ba-input" value={preserve} onChange={event => setPreserve(event.target.value)} /></label>
    {dirty && <p className="text-xs text-muted-foreground">先保存编排草稿，再以这份安排生成大纲候选。</p>}
    {inputTooLarge && <p role="alert" className="text-sm text-amber-700">所选范围的编排要求过多，请缩小章节范围或精简备注与保留要求后再预览。</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || dirty || inputTooLarge || !allowed.length} onClick={() => void (async () => {
      const input = planInput;
      const result = await run("预览大纲调整", input, key => api.plan(input, key));
      if (result) { setPreview(result); setSelected(result.changes.map(change => change.chapterId).filter(id => allowed.includes(id))); setApplied(false); }
    })()}>预览大纲调整</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => { const result = await run("读取大纲候选", {}, () => api.workspace()); if (result) setHistory((result.planningVersions ?? []).map(recoverPlanPreview).filter((item): item is WritingPlanPreview => item !== null)); })()}>查找已保存的大纲候选</Button>
    </div>
    {history.length > 0 && <select aria-label="恢复大纲候选" className="ba-input" value="" onChange={event => { const item = history.find(entry => entry.id === event.target.value); if (item) { setPreview(item); setSelected(item.changes.map(change => change.chapterId).filter(id => allowed.includes(id))); setApplied(false); } }}><option value="">选择要恢复的大纲候选</option>{history.map(item => <option key={item.id} value={item.id}>{item.changes.map(change => workspace.chapters.find(chapter => chapter.id === change.chapterId)?.title ?? change.chapterId).join("、")}</option>)}</select>}
    {preview && <div className="ba-plan-candidate space-y-3">
      <p className="text-sm">本次候选范围：{preview.changes.map(change => workspace.chapters.find(chapter => chapter.id === change.chapterId)?.title ?? change.chapterId).join("、")}</p>
      {stale && <p className="text-sm text-amber-700">相关章节已变化，请重新预览。</p>}
      {preview.changes.map(change => <div key={change.chapterId} className="space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" aria-label={`采纳大纲${change.chapterId}`} disabled={busy || applied || !allowed.includes(change.chapterId)} checked={selected.includes(change.chapterId)} onChange={event => setSelected(event.target.checked ? [...selected, change.chapterId] : selected.filter(id => id !== change.chapterId))} />{workspace.chapters.find(chapter => chapter.id === change.chapterId)?.title ?? change.chapterId}{!allowed.includes(change.chapterId) ? "（不在未锁定调整范围内）" : ""}</label><div className="grid gap-3 md:grid-cols-2"><div><p className="text-xs text-muted-foreground">原大纲</p><p className="whitespace-pre-wrap text-sm">{change.before}</p></div><div><p className="text-xs text-muted-foreground">候选大纲</p><p className="whitespace-pre-wrap text-sm">{change.after}</p></div></div></div>)}
      {preview.impact.map((item, index) => <p key={index} className="text-xs text-muted-foreground">{item}</p>)}
      <Button size="sm" disabled={busy || dirty || stale || applied || !selected.length} onClick={() => void (async () => { const result = await run("采纳所选大纲", { id: preview.id, selected }, key => api.acceptPlan(preview.id, selected, key)); if (result) { setApplied(true); await run("刷新已采纳大纲", {}, async () => { await reload(); return true; }); } })()}>采纳所选大纲</Button>
      {applied && <p className="text-sm">所选大纲已采纳。</p>}
    </div>}
  </section>;
}

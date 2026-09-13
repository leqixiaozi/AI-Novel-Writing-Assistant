import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { WritingAdjustmentWorkspace } from "@ai-novel/shared/types/writingAdjustments";
import type { WritingAdjustmentApi, WritingPlanPreview } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { adjustmentInputClass } from "./WritingControlsForm";
import type { AdjustmentRun } from "./WritingEvidencePanel";
import { recoverPlanPreview } from "./adjustmentState";

export function WritingPlanPanel({ novelId, chapterIds, preserve, workspace, api, run, busy, reload }: {
  novelId: string; chapterIds: string[]; preserve: string[]; workspace: WritingAdjustmentWorkspace; api: WritingAdjustmentApi; run: AdjustmentRun; busy: boolean; reload: () => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<WritingPlanPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [adopted, setAdopted] = useState(false);
  const recoverable = (workspace.planningVersions ?? []).map(version => ({ version, preview: recoverPlanPreview(version) })).filter(item => item.preview !== null);
  const stalePreview = preview?.changes.some(change => preview.baseRevisions[change.chapterId] !== workspace.chapters.find(chapter => chapter.id === change.chapterId)?.revision) ?? false;
  const scopeIdentity = JSON.stringify([chapterIds, preserve]);
  useEffect(() => { setPreview(null); setSelected([]); }, [scopeIdentity]);
  const makePreview = async () => {
    const input = { chapterIds, instruction, preserve };
    const result = await run("预览规划调整", input, (key) => api.plan(input, key));
    if (result) { setPreview(result); setSelected(result.changes.map((item) => item.chapterId)); setAdopted(false); }
  };
  const saveDecision = async () => {
    const input = { category: "manual_adjustment" as const, content: instruction, adjustment: { chapterIds, preserve, status: "active" as const } };
    const result = await run("保存后续要求", input, (key) => api.decision(input, key));
    if (result !== undefined) await reload();
  };
  return <section className="space-y-3">
    <h4 className="text-sm">调整后续规划</h4>
    <p className="text-xs text-muted-foreground">选择上方章节范围，预览规划变化和相关影响，再决定采纳哪些章节。</p>
    {recoverable.length > 0 && <select aria-label="恢复已保存规划候选" className={adjustmentInputClass} value="" disabled={busy} onChange={(event) => {
      const item = recoverable.find(entry => entry.version.id === event.target.value);
      if (!item?.preview) return;
      setPreview(item.preview); setSelected(item.preview.changes.map(change => change.chapterId)); setAdopted(false);
      if (typeof item.version.metadata.instruction === "string") setInstruction(item.version.metadata.instruction);
    }}><option value="">恢复已保存的规划候选</option>{recoverable.map(item => <option key={item.version.id} value={item.version.id}>{new Date(item.version.createdAt).toLocaleString()} · {item.preview!.changes.map(change => workspace.chapters.find(chapter => chapter.id === change.chapterId)?.title ?? "章节").join("、")}</option>)}</select>}
    <textarea aria-label="规划调整目标" className={adjustmentInputClass} rows={3} value={instruction} onChange={(event) => { setInstruction(event.target.value); setPreview(null); setSelected([]); }} placeholder="例如：第 4—5 章加强对立，保留第 8 章结盟。" />
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={busy || !instruction.trim() || !chapterIds.length} onClick={() => void makePreview()}>预览规划调整</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy || !instruction.trim() || !chapterIds.length} onClick={() => void saveDecision()}>保存为所选章节的后续要求</Button>
    </div>
    {preview && <div className="space-y-3 bg-muted/30 p-3">
      <p className="text-sm">{adopted ? "规划已采纳，可打开对应章节继续调整。" : "规划候选：选择要采纳的章节"}</p>
      {stalePreview && !adopted && <p className="text-sm text-amber-700">此候选对应的章节已变化。可以查看差异，请选择范围后重新预览再采纳。</p>}
      {preview.changes.map((item) => <div key={item.chapterId} className="space-y-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy || adopted} checked={selected.includes(item.chapterId)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.chapterId] : selected.filter((id) => id !== item.chapterId))} />{workspace.chapters.find((chapter) => chapter.id === item.chapterId)?.title ?? item.chapterId}</label>
        <div className="grid gap-3 md:grid-cols-2"><div><p className="text-xs text-muted-foreground">原规划</p><p className="whitespace-pre-wrap text-sm">{item.before}</p></div><div><p className="text-xs text-muted-foreground">拟调整为</p><p className="whitespace-pre-wrap text-sm">{item.after}</p></div></div>
        <Link className="text-sm text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/edit?tab=structured&chapterId=${encodeURIComponent(item.chapterId)}`}>打开对应规划</Link>
      </div>)}
      <p className="text-sm">影响说明</p>{preview.impact.map((item, index) => <p key={index} className="text-sm text-muted-foreground">{item}</p>)}
      <Button type="button" size="sm" disabled={busy || !selected.length || adopted || stalePreview} onClick={() => void (async () => {
        const result = await run("采纳规划", { id: preview.id, selected }, (key) => api.acceptPlan(preview.id, selected, key));
        if (result) { setAdopted(true); await reload(); }
      })()}>采纳所选规划</Button>
    </div>}
    <h4 className="text-sm">已保存的干预要求</h4>
    {workspace.decisions.length === 0 && <p className="text-xs text-muted-foreground">尚未保存干预要求。</p>}
    {workspace.decisions.map((decision) => <div key={decision.id} className="space-y-1 bg-muted/30 p-3">
      <p className="whitespace-pre-wrap text-sm">{decision.content}</p>
      <p className="text-xs text-muted-foreground">{decision.status === "active" ? "生效中" : "已停用"} · {decision.chapterIds.map((id) => workspace.chapters.find((chapter) => chapter.id === id)?.title ?? id).join("、") || "未限定章节"}</p>
      {decision.preserve.length > 0 && <p className="text-xs">保留：{decision.preserve.join("；")}</p>}
      {decision.status === "active" && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => {
        const adjustment = { chapterIds: decision.chapterIds, preserve: decision.preserve, status: "disabled" as const, expectedRevision: decision.revision };
        const result = await run("停用干预要求", { id: decision.id, adjustment }, (key) => api.disableDecision(decision.id, adjustment, key));
        if (result !== undefined) await reload();
      })()}>停用</Button>}
    </div>)}
  </section>;
}

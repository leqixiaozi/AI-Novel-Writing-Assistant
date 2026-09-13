import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ResolvedWritingRequirements, WritingAcceptanceReceipt, WritingAdjustmentWorkspace, WritingEditVersion, WritingReview } from "@ai-novel/shared/types/writingAdjustments";
import type { WritingAdjustmentApi } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { adjustmentInputClass } from "./WritingControlsForm";
import type { AdjustmentRun } from "./WritingEvidencePanel";
import { recoverVersionReview, reviewMatchesDraft } from "./adjustmentState";

const syncLabels = { pending: "等待同步", running: "同步中", succeeded: "同步完成", failed: "同步待重试", superseded: "已由更新稿替代，无需同步此版本" };
interface LocalWritingDraft { content: string; baseline: string; versionId: string | null }
function readLocalWritingDraft(key?: string): LocalWritingDraft | null {
  if (!key || typeof sessionStorage === "undefined") return null;
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as LocalWritingDraft | null; return value && typeof value.content === "string" && typeof value.baseline === "string" && (value.versionId === null || typeof value.versionId === "string") ? value : null; } catch { return null; }
}

export function WritingChapterPanel({ novelId, chapterId, directorTaskId, currentContent, workspace, requirements, api, run, busy, reload, onAccepted, onDirtyChange, draftRecoveryKey }: {
  novelId: string; chapterId: string; directorTaskId?: string; currentContent?: string; workspace: WritingAdjustmentWorkspace; requirements: ResolvedWritingRequirements | null;
  api: WritingAdjustmentApi; run: AdjustmentRun; busy: boolean; reload: () => Promise<void>; onAccepted?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void; draftRecoveryKey?: string;
}) {
  const chapter = workspace.chapters.find((item) => item.id === chapterId);
  const [content, setContent] = useState(currentContent ?? chapter?.content ?? "");
  const [sourceContent, setSourceContent] = useState(currentContent);
  const [baseline, setBaseline] = useState(chapter?.revision ?? "");
  const [version, setVersion] = useState<WritingEditVersion | null>(null);
  const [candidates, setCandidates] = useState<WritingEditVersion[]>([]);
  const [review, setReview] = useState<WritingReview | null>(null);
  const [instruction, setInstruction] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<WritingAcceptanceReceipt | null>(() => workspace.acceptances.find((item) => item.chapterId === chapterId) ?? null);
  const [directorResumeSent, setDirectorResumeSent] = useState(false);
  const [localRecovery, setLocalRecovery] = useState(() => readLocalWritingDraft(draftRecoveryKey));
  const dirty = content !== (version?.content ?? currentContent ?? chapter?.content ?? "");
  const checked = reviewMatchesDraft(review, version, content);
  const sourceChanged = currentContent !== sourceContent;
  const baselineChanged = Boolean(version && version.baseRevision !== chapter?.revision);
  const nextChapter = chapter ? workspace.chapters.find(item => item.order > chapter.order) : undefined;
  const activeSession = workspace.manualSessions.find((item) => item.status === "active" && item.chapterIds.includes(chapterId));
  const matchingDirectorSession = Boolean(directorTaskId && activeSession?.taskId === directorTaskId);
  const history = workspace.versions.filter((item) => item.chapterId === chapterId);
  useEffect(() => { onDirtyChange?.(dirty || Boolean(localRecovery)); return () => onDirtyChange?.(false); }, [dirty, localRecovery, onDirtyChange]);
  useEffect(() => {
    if (!draftRecoveryKey || localRecovery || typeof sessionStorage === "undefined") return;
    try {
      if (dirty) sessionStorage.setItem(draftRecoveryKey, JSON.stringify({ content, baseline, versionId: version?.id ?? null } satisfies LocalWritingDraft));
      else sessionStorage.removeItem(draftRecoveryKey);
    } catch { /* Local recovery never changes the chapter persistence contract. */ }
  }, [draftRecoveryKey, localRecovery, dirty, content, baseline, version?.id]);
  useEffect(() => {
    setReceipt(workspace.acceptances.find(item => item.chapterId === chapterId) ?? null);
  }, [workspace.acceptances, chapterId]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  if (!chapter) return <p className="text-sm">未找到当前章节，请刷新调整资料。</p>;
  const choose = (item: WritingEditVersion) => { setVersion(item); setContent(item.content); setBaseline(item.baseRevision); setReview(recoverVersionReview(item, workspace.reviews)); };
  const generate = async (operation: "write" | "rewrite") => {
    if (!requirements) return;
    const input = { requirementsId: requirements.id, operation, ...(operation === "rewrite" || requirements.scope.kind === "scene" || requirements.scope.kind === "selection" ? { content, instruction } : {}) };
    const result = await run("生成调整候选", input, (key) => api.preview(chapterId, input, key));
    if (result) { setCandidates(result); await reload(); }
  };
  const saveDraft = async () => {
    const input = { content, expectedRevision: baseline, requirementsId: version?.requirementsId ?? requirements?.id, sourceCandidateId: version?.id };
    const result = await run("保存调整稿", input, (key) => api.draft(chapterId, input, key));
    if (result) { choose(result); await reload(); }
  };
  const accept = async () => {
    if (!version) return;
    const input = { editVersionId: version.id, expectedRevision: version.baseRevision, ...(checked && review ? { reviewId: review.id, acceptedDeviationIds: review.issues.filter((item) => item.status === "accepted_deviation").map((item) => item.id) } : {}) };
    const result = await run("正式采纳调整稿", input, (key) => api.accept(chapterId, input, key));
    if (result) { setReceipt(result); await reload(); await onAccepted?.(); }
  };
  return <section className="space-y-4">
    {localRecovery && <div role="status" className="space-y-2 rounded-md bg-muted p-3 text-sm"><p>找到本章尚未保存的修复编辑，可以恢复后继续核对。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={() => {
      const recoveredVersion = history.find(item => item.id === localRecovery.versionId) ?? null;
      setContent(localRecovery.content); setBaseline(localRecovery.baseline); setVersion(recoveredVersion); setReview(recoveredVersion ? recoverVersionReview(recoveredVersion, workspace.reviews) : null); setLocalRecovery(null);
    }}>恢复未保存修复稿</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setLocalRecovery(null); if (draftRecoveryKey) { try { sessionStorage.removeItem(draftRecoveryKey); } catch { /* Optional storage. */ } } }}>使用已保存正文</Button></div></div>}
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="text-sm">本章调整稿</h4>
      {activeSession ? <><span className="text-xs text-amber-700">人工接管中</span><Button type="button" size="sm" variant="secondary" disabled={busy || Boolean(activeSession.taskId && !matchingDirectorSession)} onClick={() => void (async () => {
        const input = { action: "complete" as const, manualEditSessionId: activeSession.id };
        const result = matchingDirectorSession
          ? await run("提交导演继续请求", { directorTaskId, sessionId: activeSession.id }, (key) => api.completeDirectorManual(directorTaskId!, activeSession.id, key))
          : await run("结束人工接管", input, (key) => api.manual(chapterId, input, key));
        if (result !== undefined) { if (matchingDirectorSession) setDirectorResumeSent(true); await reload(); }
      })()}>{matchingDirectorSession ? "结束调整并继续导演" : "结束交接"}</Button></> : <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => {
        const input = { action: "begin" as const, scope: { kind: "chapter" as const, chapterId } };
        const result = directorTaskId
          ? await run("接管导演中的本章", { directorTaskId, chapterIds: [chapterId] }, (key) => api.beginDirectorManual(directorTaskId, [chapterId], key))
          : await run("接管本章", input, (key) => api.manual(chapterId, input, key));
        if (result) { setDirectorResumeSent(false); await reload(); }
      })()}>{directorTaskId ? "接管导演中的本章" : "接管本章调整"}</Button>}
    </div>
    {activeSession?.taskId && !matchingDirectorSession && <Link className="text-sm text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/edit?tab=chapter&directorTaskId=${encodeURIComponent(activeSession.taskId)}`}>回到所属导演任务结束调整</Link>}
    {directorResumeSent && directorTaskId && <p role="status" className="text-sm">继续请求已提交。<Link className="text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/edit?tab=chapter&directorTaskId=${encodeURIComponent(directorTaskId)}`}>查看导演进度</Link></p>}
    <p className="text-xs text-muted-foreground">调整稿可单独保存和比较，正式采纳后用于后续创作。接管本章可保护调整期间的正文。</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={busy || !requirements} onClick={() => void generate("write")}>{requirements?.scope.kind === "scene" ? "调整所选场景" : "按要求生成候选"}</Button>
      {history[0] && <Button type="button" size="sm" variant="secondary" disabled={busy || dirty} onClick={() => choose(history[0])}>恢复最近调整稿及核对</Button>}
      <Button type="button" size="sm" variant="ghost" disabled={busy || dirty} onClick={() => { setContent(currentContent ?? chapter.content); setSourceContent(currentContent); setVersion(null); setBaseline(chapter.revision); setReview(null); }}>载入编辑器正文</Button>
    </div>
    {!requirements && <p className="text-xs text-muted-foreground">先在上方预览本次要求，再生成或润色。</p>}
    {(candidates.length > 0 || history.length > 0) && <details className="space-y-2"><summary className="cursor-pointer text-sm">比较候选与已保存调整稿</summary>
      <div className="grid max-h-96 gap-3 overflow-auto md:grid-cols-2">{[...new Map([...candidates, ...history].map((item) => [item.id, item])).values()].map((item, index) => <article key={item.id} className="space-y-2 bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">{item.kind === "draft" ? "调整稿" : "候选"} {index + 1} · {new Date(item.createdAt).toLocaleString()}</p>
        <p className="max-h-52 overflow-auto whitespace-pre-wrap text-sm">{item.content}</p>
        <Button type="button" size="sm" variant="secondary" disabled={busy || dirty} onClick={() => choose(item)}>载入此版本</Button>
      </article>)}</div>
      {dirty && <p className="text-xs text-muted-foreground">先保存正在编辑的调整稿，再切换候选。</p>}
    </details>}
    <textarea aria-label="本章调整稿正文" className={`${adjustmentInputClass} min-h-52 leading-7`} rows={10} value={content} disabled={busy} onChange={(event) => setContent(event.target.value)} />
    <input aria-label="本次润色目标" className={adjustmentInputClass} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="本次润色目标，例如保留事件、压缩重复描写" />
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={busy || !requirements || !content.trim()} onClick={() => void generate("rewrite")}>生成润色候选</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy || !content.trim()} onClick={() => void saveDraft()}>保存调整稿</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy || !version || dirty} onClick={() => void (async () => {
        if (!version) return;
        const result = await run("核对调整稿", { editVersionId: version.id }, (key) => api.review(chapterId, version.id, key));
        if (result) setReview(result);
      })()}>核对已保存稿</Button>
    </div>
    {review && <div className="space-y-3 bg-muted/30 p-3">
      <p className="text-sm">{review.summary}</p>
      {!checked && <p className="text-sm text-amber-700">正文已变动，请保存后重新核对。</p>}
      {review.issues.map((issue) => <div key={issue.id} className="space-y-2">
        <p className="text-sm">{issue.description}</p><p className="text-xs text-muted-foreground">建议：{issue.suggestion}</p>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">依据：{issue.evidenceIds.length === 0 ? "待补充" : issue.evidenceIds.map(evidenceId => {
          const source = workspace.chapters.find(item => evidenceId.startsWith(`accepted_prose:${item.id}:`) || evidenceId.startsWith(`plan:${item.id}:`));
          return source ? <Link key={evidenceId} className="text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(source.id)}`}>第 {source.order} 章</Link> : <span key={evidenceId}>事件依据（可在历史查询中查看）</span>;
        })} · {issue.status === "open" ? "待处理" : issue.status === "accepted_deviation" ? "作者保留此偏离" : issue.status === "dismissed" ? "已说明忽略理由" : "已修复"}</div>
        {issue.status === "open" && <>
          <input aria-label={`问题处理理由 ${issue.id}`} className={adjustmentInputClass} placeholder="保留偏离或忽略问题时，写明理由" value={reasons[issue.id] ?? ""} onChange={(event) => setReasons({ ...reasons, [issue.id]: event.target.value })} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setInstruction(issue.suggestion)}>用于润色目标</Button>
            {(["dismissed", "accepted_deviation"] as const).map((action) => <Button type="button" key={action} size="sm" variant="ghost" disabled={busy || !checked || !reasons[issue.id]?.trim()} onClick={() => void (async () => {
              const input = { reviewId: review.id, action, reason: reasons[issue.id] };
              const result = await run("记录问题处理", { id: issue.id, ...input }, (key) => api.issue(chapterId, issue.id, input, key));
              if (result) setReview(result);
            })()}>{action === "dismissed" ? "说明并忽略" : "作者保留偏离"}</Button>)}
          </div>
        </>}
      </div>)}
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={busy || !version || dirty || sourceChanged || baselineChanged || Boolean(review && !checked)} onClick={() => void accept()}>正式采纳此稿</Button>
      <span className="text-xs text-muted-foreground">{checked ? "采纳时附带本稿核对结果" : "尚未核对；采纳将保留未核对标记"}</span>
    </div>
    {sourceChanged && <p role="status" className="text-sm text-amber-700">编辑器正文已变化。请保留当前调整稿，再载入编辑器正文进行比较，避免覆盖新的人工修改。</p>}
    {baselineChanged && receipt?.editVersionId !== version?.id && <p role="status" className="text-sm text-amber-700">此调整稿基于较早的正文版本。请查看差异，载入最新正文后重新调整。</p>}
    {receipt && <div role="status" className="space-y-2 bg-muted/30 p-3">
      <p className="text-sm">{receipt.canonicalSyncStatus === "superseded" ? syncLabels.superseded : `正文已采纳 · ${syncLabels[receipt.canonicalSyncStatus]}`}</p>
      {receipt.error && receipt.canonicalSyncStatus !== "superseded" && <p className="text-sm text-destructive">{receipt.error}</p>}
      {receipt.canonicalSyncStatus !== "superseded" && receipt.nextActions.map((item) => <p key={item} className="text-xs text-muted-foreground">{item === "continue" ? "可以继续下一章创作。" : item === "inspect_sync" ? "查看同步结果，待历史依据就绪后继续。" : "请查看当前稿件和同步结果。"}</p>)}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => {
        const result = await run("刷新采纳状态", { id: receipt.id }, () => api.receipt(chapterId, receipt.id)); if (result) setReceipt(result);
      })()}>刷新同步状态</Button>
        {receipt.canonicalSyncStatus === "failed" && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void (async () => {
          const result = await run("重试剩余同步", { id: receipt.id }, (key) => api.retrySync(chapterId, receipt.id, key)); if (result) setReceipt(result);
        })()}>重试剩余同步</Button>}
      </div>
      {receipt.canonicalSyncStatus === "succeeded" && nextChapter && <Link className="inline-block text-sm text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(nextChapter.id)}`}>打开下一章：{nextChapter.title}</Link>}
    </div>}
  </section>;
}

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BookArrangementCheck, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import type { ResolvedWritingRequirements, WritingAdjustmentWorkspace } from "@ai-novel/shared/types/writingAdjustments";
import type { ReviewIssue } from "@ai-novel/shared/types/novel";
import { auditNovelChapter } from "@/api/novel/planning";
import { createWritingAdjustmentApi } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { WritingChapterPanel } from "@/pages/novels/components/writingAdjustments/WritingChapterPanel";
import { explicitDirectorTaskId } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import type { ArrangementRun } from "../ArrangementPlanning";
import { auditIssueTitle } from "../arrangementState";

const statusLabels: Record<string, string> = { open: "待处理", resolved: "已解决", ignored: "已忽略", closed: "已关闭", dismissed: "已忽略" };

export function ArrangementCheckPanel({ issue, chapterId: selectedChapterId, workspace, busy, run, reload, onDirtyChange }: {
  issue?: BookArrangementCheck; chapterId?: string; workspace: BookArrangementWorkspace; busy: boolean; run: ArrangementRun; reload: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [searchParams] = useSearchParams();
  const directorTaskId = explicitDirectorTaskId(searchParams.toString());
  const api = useMemo(() => createWritingAdjustmentApi(workspace.novelId), [workspace.novelId]);
  const [writingWorkspace, setWritingWorkspace] = useState<WritingAdjustmentWorkspace | null>(null);
  const [requirements, setRequirements] = useState<ResolvedWritingRequirements | null>(null);
  const [auditSummary, setAuditSummary] = useState("");
  const [auditIssues, setAuditIssues] = useState<ReviewIssue[]>([]);
  const [repairTarget, setRepairTarget] = useState<Pick<BookArrangementCheck, "sourceId" | "title" | "summary" | "evidence" | "fixSuggestion"> | null>(issue ? { sourceId: issue.sourceId, title: auditIssueTitle(issue), summary: issue.summary, evidence: issue.evidence, fixSuggestion: issue.fixSuggestion } : null);
  const [candidateNotice, setCandidateNotice] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const updateDraftDirty = useCallback((dirty: boolean) => { setDraftDirty(dirty); onDirtyChange?.(dirty); }, [onDirtyChange]);
  const chapterId = issue?.chapterId ?? selectedChapterId ?? issue?.chapterIds[0] ?? "";
  const chapter = workspace.chapters.find(item => item.id === chapterId);
  const contentChapter = writingWorkspace?.chapters.find(item => item.id === chapterId);
  const loadWritingWorkspace = async () => {
    const result = await api.workspace(); setWritingWorkspace(result); return result;
  };
  const repair = async () => {
    if (!chapterId || !contentChapter?.content.trim() || !repairTarget) return;
    const input = {
      scope: { kind: "chapter" as const, chapterId }, overrides: {},
      preserve: ["只修复本次核对问题，保留既有事件、人物动机、结局与其余段落。", `核对指出的问题：${repairTarget.summary || repairTarget.title}`.slice(0, 2000), `原始依据：${repairTarget.evidence || "原记录未附正文依据，需以当前正文和历史资料核对。"}`.slice(0, 2000), `建议：${repairTarget.fixSuggestion || "先核对问题是否仍存在，再做必要的最小修改。"}`.slice(0, 2000)],
    };
    const resolved = await run("准备问题修复要求", { issueId: repairTarget.sourceId, ...input }, key => api.resolve(input, key));
    if (!resolved) return;
    setRequirements(resolved);
    const request = { requirementsId: resolved.id, operation: "rewrite" as const, content: contentChapter.content, instruction: `修复核对问题：${repairTarget.summary || repairTarget.title}\n${repairTarget.fixSuggestion || "保留原剧情，仅作必要修复。"}`.slice(0, 4000) };
    const candidates = await run("生成问题修复候选", { issueId: repairTarget.sourceId, ...request }, key => api.preview(chapterId, request, key));
    if (candidates) { setCandidateNotice("修复候选已保存。下方载入最近调整稿或展开比较，核对后再采纳。"); await run("刷新问题修复候选", { chapterId }, loadWritingWorkspace); }
  };
  return <div className="min-w-0 space-y-5">
    {issue ? <section className="space-y-3 bg-muted/20 p-3">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{issue.evidenceLabel}</span><span>状态：{statusLabels[issue.status] ?? issue.status}</span><span>{chapter ? `第${chapter.order}章 · ${chapter.title}` : "尚未定位到章节"}</span></div>
      <h3 className="text-base">{auditIssueTitle(issue)}</h3><p className="whitespace-pre-wrap text-sm">{issue.summary}</p>
      <div className="space-y-1"><h4 className="text-sm">原文依据</h4><p className="whitespace-pre-wrap text-sm text-muted-foreground">{issue.evidence || "此问题记录未附原文片段。"}</p></div>
      <div className="space-y-1"><h4 className="text-sm">修复建议</h4><p className="whitespace-pre-wrap text-sm text-muted-foreground">{issue.fixSuggestion || "未提供修复建议，可先重新核对当前正文。"}</p></div>
      <p className="text-xs text-muted-foreground">{!issue.sourceRevision ? "原报告未绑定正文版本，不能据此认定当前稿仍有同一问题。" : "原报告保存了来源版本标识；是否仍适用于当前正文，需要重新核对。"}</p>
    </section> : <section className="space-y-2"><h3 className="text-base">{chapter ? `第${chapter.order}章 · ${chapter.title}` : "章节核对"}</h3><p className="text-sm text-muted-foreground">可先核对当前正文，再从实际返回的问题中选择修复目标。</p></section>}
    {chapter ? <>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy || !chapter.hasContent} onClick={() => void (async () => {
        const result = await run("重新核对本章", { chapterId }, async () => { const response = await auditNovelChapter(workspace.novelId, chapterId, "full"); if (!response.data) throw new Error(response.message || "未能读取章节核对结果。"); return response.data; });
        if (result) { setAuditIssues(result.issues); setAuditSummary(`本次核对返回 ${result.issues.length} 项问题。历史问题记录保留，修复后需核对实际稿件。`); await reload(); }
      })()}>{issue ? "重新核对本章" : "核对本章"}</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void run("读取正文与修复资料", { chapterId }, loadWritingWorkspace)}>{writingWorkspace ? "刷新正文与修复资料" : "读取正文与修复工具"}</Button></div>
      {auditSummary && <p role="status" className="text-sm">{auditSummary}</p>}
      {auditIssues.length > 0 && <div className="divide-y divide-border">{auditIssues.map((item, index) => <article key={index} className="space-y-2 py-4 text-sm"><h4>本次核对问题 {index + 1}</h4><p className="whitespace-pre-wrap">依据：{item.evidence}</p><p className="whitespace-pre-wrap text-muted-foreground">建议：{item.fixSuggestion}</p><Button size="sm" variant="secondary" disabled={busy} onClick={() => { setRepairTarget({ sourceId: `current-audit:${chapterId}:${index}`, title: `本次核对问题 ${index + 1}`, summary: item.evidence, evidence: item.evidence, fixSuggestion: item.fixSuggestion }); setRequirements(null); setCandidateNotice(""); }}>选择此问题修复</Button></article>)}</div>}
      {writingWorkspace && <>
        <p className="text-xs text-muted-foreground">{repairTarget ? `当前修复目标：${repairTarget.title}` : "先从核对结果中选择一个实际问题，再生成修复候选。"}</p>
        <Button size="sm" disabled={busy || draftDirty || !repairTarget || !contentChapter?.content.trim()} onClick={() => void repair()}>生成本问题修复候选</Button>
        {draftDirty && <p className="text-xs text-muted-foreground">请先恢复或保存正在编辑的修复稿，再生成新的候选。</p>}
        {candidateNotice && <p role="status" className="text-sm">{candidateNotice}</p>}
        {!contentChapter?.content.trim() && <p className="text-xs text-muted-foreground">本章暂无正文，先完善章节规划与正文后再修复。</p>}
        <WritingChapterPanel key={chapterId} novelId={workspace.novelId} chapterId={chapterId} directorTaskId={directorTaskId} workspace={writingWorkspace} requirements={requirements} api={api} run={run} busy={busy} reload={async () => { await loadWritingWorkspace(); }} onAccepted={reload} draftRecoveryKey={`book-arrangement-check-draft:${workspace.novelId}:${chapterId}`} onDirtyChange={updateDraftDirty} />
      </>}
    </> : <p className="text-sm text-muted-foreground">此问题缺少有效章节引用，请先在原规划中核对来源。</p>}
  </div>;
}

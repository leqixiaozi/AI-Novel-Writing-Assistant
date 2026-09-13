import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { WritingAdjustmentWorkspace, WritingEvidence, WritingEvidenceResponse } from "@ai-novel/shared/types/writingAdjustments";
import type { WritingAdjustmentApi } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { adjustmentInputClass } from "./WritingControlsForm";

export type AdjustmentRun = <T>(name: string, input: unknown, operation: (key: string) => Promise<T>) => Promise<T | undefined>;
const kindLabels: Record<WritingEvidence["sourceKind"], string> = { accepted_prose: "正式正文", plan: "规划", setting: "设定", candidate: "候选" };

export function WritingEvidencePanel({ novelId, chapterId, workspace, api, run, busy }: {
  novelId: string; chapterId?: string; workspace: WritingAdjustmentWorkspace; api: WritingAdjustmentApi; run: AdjustmentRun; busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [result, setResult] = useState<WritingEvidenceResponse | null>(null);
  const [order, setOrder] = useState<"reading" | "story">("reading");
  useEffect(() => { setResult(null); }, [query, characterId, sourceKind, chapterId]);
  const search = async (cursor?: string) => {
    const input = { chapterId, query: query.trim() || undefined, characterIds: characterId ? [characterId] : undefined, sourceKinds: sourceKind ? [sourceKind] : undefined, cursor, limit: 30 };
    const response = await run("查阅历史", input, (key) => api.evidence(input, key));
    if (response) setResult(cursor ? { ...response, items: [...(result?.items ?? []), ...response.items] } : response);
  };
  const items = [...(result?.items ?? [])].sort((a, b) => order === "story"
    ? (a.storyDayIndex ?? Number.MAX_SAFE_INTEGER) - (b.storyDayIndex ?? Number.MAX_SAFE_INTEGER)
    : (workspace.chapters.find((item) => item.id === a.chapterId)?.order ?? Number.MAX_SAFE_INTEGER) - (workspace.chapters.find((item) => item.id === b.chapterId)?.order ?? Number.MAX_SAFE_INTEGER));
  return <section className="space-y-3">
    <h4 className="text-sm">历史依据、人物线与时间线</h4>
    <input aria-label="要回顾的事情" className={adjustmentInputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：两人上次见面时知道了什么？" />
    <div className="grid gap-2 sm:grid-cols-3">
      <select aria-label="按人物查阅" className={adjustmentInputClass} value={characterId} onChange={(event) => setCharacterId(event.target.value)}><option value="">全部人物</option>{workspace.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="依据类型" className={adjustmentInputClass} value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="">全部依据类型</option>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="时间线顺序" className={adjustmentInputClass} value={order} onChange={(event) => setOrder(event.target.value as "reading" | "story")}><option value="reading">按章节阅读顺序</option><option value="story">按故事发生时间</option></select>
    </div>
    <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void search()}>查询依据</Button>
    {result && <>
      <p className="text-xs text-muted-foreground">已查范围：{result.searchedScope}</p>
      {result.missingEvidence.map((item) => <p key={item} className="text-sm text-amber-700">{item}</p>)}
      {items.length === 0 && <p className="text-sm text-muted-foreground">此范围尚未找到依据，可以补充问题或更换人物。</p>}
      <div className="max-h-96 space-y-3 overflow-auto">{items.map((item) => <article key={`${item.id}-${item.sourceRevision}`} className="space-y-1 bg-muted/30 p-3">
        <p className="text-sm">{kindLabels[item.sourceKind]} · {item.title} · {item.storyDayIndex == null ? "发生时间未标注" : `故事第 ${item.storyDayIndex} 天`}</p>
        <p className="whitespace-pre-wrap text-sm">{item.excerpt}</p>
        <p className="text-xs text-muted-foreground">版本：{item.sourceRevision}{item.locator ? ` · 文字位置 ${item.locator.from}—${item.locator.to}` : ""}</p>
        {item.chapterId && <Link className="text-sm text-primary underline" to={item.sourceKind === "plan" ? `/novels/${encodeURIComponent(novelId)}/edit?tab=structured&chapterId=${encodeURIComponent(item.chapterId)}` : `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(item.chapterId)}`}>{item.sourceKind === "plan" ? "打开对应规划" : "打开原章节"}</Link>}
      </article>)}</div>
      {result.nextCursor && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void search(result.nextCursor!)}>继续查阅</Button>}
    </>}
  </section>;
}

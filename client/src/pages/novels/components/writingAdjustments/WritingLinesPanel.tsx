import { useState } from "react";
import { Link } from "react-router-dom";
import type { WritingAdjustmentWorkspace } from "@ai-novel/shared/types/writingAdjustments";
import type { WritingAdjustmentApi, WritingLineEvent, WritingLinePreview, WritingLineWorkspace } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { adjustmentInputClass } from "./WritingControlsForm";
import type { AdjustmentRun } from "./WritingEvidencePanel";
import { recoverLinePreview } from "./adjustmentState";

export function WritingLinesPanel({ novelId, chapterId, workspace, api, run, busy, reload }: {
  novelId: string; chapterId?: string; workspace: WritingAdjustmentWorkspace; api: WritingAdjustmentApi;
  run: AdjustmentRun; busy: boolean; reload: () => Promise<void>;
}) {
  const [lines, setLines] = useState<WritingLineWorkspace | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [order, setOrder] = useState<"reading" | "story">("reading");
  const [editing, setEditing] = useState<WritingLineEvent | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [day, setDay] = useState("");
  const [timeLabel, setTimeLabel] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [preview, setPreview] = useState<WritingLinePreview | null>(null);
  const [applied, setApplied] = useState(false);
  const [validationError, setValidationError] = useState("");
  const recoverable = (workspace.planningVersions ?? []).map(recoverLinePreview).filter(item => item !== null && (!chapterId || item.before.chapterId === chapterId));
  const load = async () => {
    const params = { chapterId, characterId: characterId || undefined };
    const result = await run("读取可调整事件", params, () => api.lines(params));
    if (result) setLines(result);
  };
  const begin = (event: WritingLineEvent) => {
    setEditing(event); setTitle(event.title); setSummary(event.summary); setDay(event.storyDayIndex == null ? "" : String(event.storyDayIndex));
    setTimeLabel(event.storyTimeLabel ?? ""); setParticipants([...event.participantIds]); setPreview(null); setApplied(false); setValidationError("");
  };
  const clearPreview = () => { setPreview(null); setValidationError(""); };
  const createPreview = async () => {
    if (!editing) return;
    if (!title.trim() || !summary.trim()) { setValidationError("请填写事件标题和经过。"); return; }
    const parsedDay = day.trim() ? Number(day) : null;
    if (parsedDay !== null && !Number.isSafeInteger(parsedDay)) { setValidationError("故事发生日请填整数，未确定时留空。"); return; }
    const patch = { title: title.trim(), summary: summary.trim(), storyDayIndex: parsedDay, storyTimeLabel: timeLabel.trim() || null, participantIds: participants };
    const input = { expectedRevision: editing.revision, patch };
    const result = await run("预览事件调整影响", { eventId: editing.id, ...input }, (key) => api.previewLine(editing.id, input, key));
    if (result) { setPreview(result); setApplied(false); }
  };
  const events = [...(lines?.events ?? [])].sort((a, b) => order === "story"
    ? (a.storyDayIndex ?? Number.MAX_SAFE_INTEGER) - (b.storyDayIndex ?? Number.MAX_SAFE_INTEGER)
    : (a.chapterOrder ?? Number.MAX_SAFE_INTEGER) - (b.chapterOrder ?? Number.MAX_SAFE_INTEGER));
  const characters = lines?.characters ?? workspace.characters;
  return <section className="space-y-3">
    <h4 className="text-sm">调整事件、时间与参与人物</h4>
    <p className="text-xs text-muted-foreground">在同一条故事事件上调整时间和人物，预览关联章节，再采纳修改。已写正文需要另行复核。</p>
    {recoverable.length > 0 && <select aria-label="恢复事件调整候选" className={adjustmentInputClass} value="" disabled={busy || Boolean(editing)} onChange={(event) => {
      const candidate = recoverable.find(item => item!.id === event.target.value);
      if (candidate) { begin(candidate.before); setTitle(candidate.after.title); setSummary(candidate.after.summary); setDay(candidate.after.storyDayIndex == null ? "" : String(candidate.after.storyDayIndex)); setTimeLabel(candidate.after.storyTimeLabel ?? ""); setParticipants([...candidate.after.participantIds]); setPreview(candidate); }
    }}><option value="">恢复已保存的事件调整候选</option>{recoverable.map(candidate => <option key={candidate!.id} value={candidate!.id}>{candidate!.before.title} → {candidate!.after.title}</option>)}</select>}
    <div className="grid gap-2 sm:grid-cols-2">
      <select aria-label="事件人物筛选" className={adjustmentInputClass} disabled={busy || Boolean(editing)} value={characterId} onChange={(event) => { setCharacterId(event.target.value); setLines(null); }}><option value="">全部人物</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="事件排序" className={adjustmentInputClass} value={order} onChange={(event) => setOrder(event.target.value as "reading" | "story")}><option value="reading">按章节阅读顺序</option><option value="story">按故事发生时间</option></select>
    </div>
    <Button type="button" size="sm" variant="secondary" disabled={busy || Boolean(editing)} onClick={() => void load()}>{lines ? "刷新事件列表" : "载入可调整事件"}</Button>
    {lines && events.length === 0 && <p className="text-xs text-muted-foreground">此范围尚无已保存事件；可先在时间线中建立事件。</p>}
    {lines && <div className="max-h-64 space-y-3 overflow-auto">{events.map(event => <article key={event.id} className="space-y-2 bg-muted/30 p-3">
      <p className="text-sm">{event.title} · {event.chapterOrder == null ? "未关联章节" : `第 ${event.chapterOrder} 章`} · {event.storyDayIndex == null ? "发生日未定" : `故事第 ${event.storyDayIndex} 天`}{event.storyTimeLabel ? ` ${event.storyTimeLabel}` : ""}</p>
      <p className="whitespace-pre-wrap text-sm">{event.summary}</p>
      <p className="text-xs text-muted-foreground">参与人物：{event.participantIds.map(id => characters.find(item => item.id === id)?.name ?? "未找到人物").join("、") || "未指定"} · {event.status === "planned" ? "规划事件" : event.status === "confirmed" ? "已确认事件" : "事件记录"}</p>
      <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="ghost" disabled={busy || Boolean(editing)} onClick={() => begin(event)}>编辑此事件</Button>{event.chapterId && <Link className="text-sm text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(event.chapterId)}`}>打开关联章节</Link>}</div>
    </article>)}</div>}
    {editing && <div className="space-y-3 bg-muted/20 p-3">
      <h4 className="text-sm">编辑：{editing.title}</h4>
      <label className="block space-y-1 text-sm"><span>事件标题</span><input aria-label="事件标题" className={adjustmentInputClass} value={title} onChange={(event) => { setTitle(event.target.value); clearPreview(); }} /></label>
      <label className="block space-y-1 text-sm"><span>事件经过</span><textarea aria-label="事件经过" rows={4} className={adjustmentInputClass} value={summary} onChange={(event) => { setSummary(event.target.value); clearPreview(); }} /></label>
      <div className="grid gap-2 sm:grid-cols-2"><label className="block space-y-1 text-sm"><span>故事发生日</span><input aria-label="故事发生日" type="number" step={1} className={adjustmentInputClass} value={day} onChange={(event) => { setDay(event.target.value); clearPreview(); }} placeholder="未确定时留空" /></label><label className="block space-y-1 text-sm"><span>时间说明</span><input aria-label="事件时间说明" className={adjustmentInputClass} value={timeLabel} onChange={(event) => { setTimeLabel(event.target.value); clearPreview(); }} placeholder="例如：傍晚、三个月后" /></label></div>
      <fieldset className="space-y-2"><legend className="text-sm">参与人物</legend><div className="flex flex-wrap gap-3">{characters.map(item => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={participants.includes(item.id)} onChange={(event) => { setParticipants(event.target.checked ? [...participants, item.id] : participants.filter(id => id !== item.id)); clearPreview(); }} />{item.name}</label>)}</div></fieldset>
      {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void createPreview()}>预览事件调整影响</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setPreview(null); setValidationError(""); }}>取消本次编辑</Button></div>
    </div>}
    {preview && <div className="space-y-3 bg-muted/30 p-3">
      <p className="text-sm">{applied ? "事件修改已采纳" : "事件修改预览"}</p>
      <div className="grid gap-3 sm:grid-cols-2">{([{ label: "修改前", event: preview.before }, { label: "修改后", event: preview.after }]).map(item => <div key={item.label} className="space-y-1"><p className="text-xs text-muted-foreground">{item.label}</p><p className="text-sm">{item.event.title}</p><p className="whitespace-pre-wrap text-sm">{item.event.summary}</p><p className="text-xs">{item.event.storyDayIndex == null ? "发生日未定" : `故事第 ${item.event.storyDayIndex} 天`} {item.event.storyTimeLabel ?? ""}</p><p className="text-xs">{item.event.participantIds.map(id => characters.find(character => character.id === id)?.name ?? "未找到人物").join("、") || "未指定参与人物"}</p></div>)}</div>
      {preview.impact.map((item, index) => <p key={index} className="text-sm text-muted-foreground">{item}</p>)}
      <div className="flex flex-wrap gap-3">{preview.affectedChapterIds.map(id => <Link key={id} className="text-sm text-primary underline" to={`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(id)}`}>复核{workspace.chapters.find(chapter => chapter.id === id)?.title ?? "关联章节"}</Link>)}</div>
      <Button type="button" size="sm" disabled={busy || applied} onClick={() => void (async () => {
        const result = await run("采纳事件调整", { id: preview.id }, (key) => api.acceptLine(preview.id, key));
        if (result) { setApplied(true); setEditing(null); await reload(); await load(); }
      })()}>采纳事件调整</Button>
    </div>}
  </section>;
}

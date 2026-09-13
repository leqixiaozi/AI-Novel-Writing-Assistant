import { Link } from "react-router-dom";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import type { BookArrangementVolumeEdit, BookArrangementVolumePreview, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { VolumeChapterList, volumeTextFields } from "./ArrangementVolumeInspector";

export interface ArrangementVolumePreviewProps {
  workspace: BookArrangementWorkspace;
  preview: BookArrangementVolumePreview;
  currentDraftRevision: number;
  busy?: boolean;
  disabled?: boolean;
  applied?: boolean;
  onApply: () => void;
  onVolume?: (volumeId: string) => void;
  onChapter?: (chapterId: string) => void;
}

function VolumeSnapshot({ workspace, value, label }: { workspace: BookArrangementWorkspace; value: BookArrangementVolumeEdit; label: string }) {
  return <section className="ba-volume-snapshot" aria-label={`${label} · ${value.title}`}><h4>{label}</h4><dl className="ba-volume-fields">{volumeTextFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd className="whitespace-pre-wrap">{value[field.key] || "未填写"}</dd></div>)}</dl><VolumeChapterList workspace={workspace} chapterIds={value.chapterIds} label="章节范围" /></section>;
}

/** Only server-produced impact is presented as checked; previews never apply themselves. */
export function ArrangementVolumePreview({ workspace, preview, currentDraftRevision, busy = false, disabled = false, applied = false, onApply, onVolume, onChapter }: ArrangementVolumePreviewProps) {
  const stale = preview.baseRevision !== workspace.baseRevision || preview.draftRevision !== currentDraftRevision;
  const volumeNames = (volumeIds: string[]) => volumeIds.map(id => workspace.volumes.find(volume => volume.id === id)?.title ?? "无法定位的卷段").join("、");
  const mayApply = preview.canApply && preview.conflicts.length === 0 && !stale && !disabled && !busy && !applied;
  return <section className="ba-requirements-preview ba-volume-preview" aria-label="卷段调整预览">
    <header className="ba-volume-preview-heading"><h2>卷段调整预览</h2><p className="ba-help">核对卷目标与章节归属的变化后，再应用到原规划。正文生成仍由原写作流程执行。</p></header>
    {stale && !applied && <p role="alert" className="ba-help">相关资料或编排草稿已变化，请重新预览后应用。</p>}
    {preview.changes.map(change => <article className="ba-volume-change" key={change.volumeId}>
      <h3>{change.before.title || change.after.title}</h3>
      {onVolume && <Button size="sm" variant="outline" onClick={() => onVolume(change.volumeId)}>返回此卷调整</Button>}
      <div className="ba-volume-diff grid gap-4 md:grid-cols-2"><VolumeSnapshot workspace={workspace} value={change.before} label="调整前" /><VolumeSnapshot workspace={workspace} value={change.after} label="调整后" /></div>
      <div className="ba-volume-movement"><VolumeChapterList workspace={workspace} chapterIds={change.addedChapterIds} label="移入本卷" /><VolumeChapterList workspace={workspace} chapterIds={change.removedChapterIds} label="移出本卷" /></div>
    </article>)}
    <section className="ba-volume-impact"><h3>影响范围</h3><VolumeChapterList workspace={workspace} chapterIds={preview.affectedChapterIds} label="相关章节" /><VolumeChapterList workspace={workspace} chapterIds={preview.writtenChapterIds} label="其中已写章节" /><p>相邻卷段：{preview.neighboringVolumeIds.length ? volumeNames(preview.neighboringVolumeIds) : "无"}</p>{preview.impact.map((item, index) => <p key={index}>{item}</p>)}</section>
    <section className="ba-volume-conflicts"><h3>范围与归属冲突</h3>{preview.conflicts.length ? preview.conflicts.map((conflict, index) => <article className="ba-evidence-item" key={`${conflict.code}-${index}`}><p><TriangleAlert size={15} aria-hidden="true" />{conflict.message}</p>{conflict.volumeIds.length > 0 && <p>卷段：{volumeNames(conflict.volumeIds)}</p>}{conflict.chapterIds.length > 0 && <VolumeChapterList workspace={workspace} chapterIds={conflict.chapterIds} label="章节" />}<div className="flex flex-wrap gap-2">{conflict.volumeIds.map(id => <Button key={id} size="sm" variant="outline" onClick={() => onVolume?.(id)}>调整{volumeNames([id])}</Button>)}{conflict.chapterIds.map(id => <Button key={id} size="sm" variant="ghost" onClick={() => onChapter?.(id)}>查看第 {workspace.chapters.find(chapter => chapter.id === id)?.order} 章</Button>)}</div></article>) : <p className="ba-help">本次检查未发现范围与归属冲突。</p>}</section>
    <section className="ba-volume-references"><h3>关联资料</h3>{preview.references.length ? preview.references.map((reference, index) => <article className="ba-evidence-item" key={`${reference.sourceEntity}-${reference.sourceId}-${index}`}><p>{reference.label}</p>{reference.volumeId && <p>所属卷段：{volumeNames([reference.volumeId])}</p>}{reference.chapterIds.length > 0 && <VolumeChapterList workspace={workspace} chapterIds={reference.chapterIds} label="相关章节" />}</article>) : <p className="ba-help">本次检查没有返回关联资料。</p>}</section>
    <section className="ba-volume-unchecked"><h3>未检查范围</h3>{preview.unchecked.length ? preview.unchecked.map((item, index) => <p key={index}>{item}</p>) : <p className="ba-help">本次预览未提供额外的未检查范围说明。</p>}</section>
    <footer className="ba-volume-preview-actions"><Button size="sm" disabled={!mayApply} onClick={onApply}>应用卷段调整</Button>{!preview.canApply && !applied && <p role="status" className="ba-help">当前预览不可应用，请处理冲突或补全规划后重新预览。</p>}{applied && <p role="status">卷段规划已应用，已有正文保持原样。</p>}{applied && preview.volumeIds.map(id => <Link key={id} className="ba-evidence-link" to={`/novels/${encodeURIComponent(workspace.novelId)}/edit?stage=outline&volumeId=${encodeURIComponent(id)}`}>打开{volumeNames([id])}的原规划<ArrowUpRight size={14} aria-hidden="true" /></Link>)}</footer>
  </section>;
}

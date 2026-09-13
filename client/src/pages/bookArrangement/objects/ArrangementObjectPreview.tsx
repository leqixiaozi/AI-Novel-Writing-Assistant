import type { BookArrangementObjectPreview, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { VolumeChapterList } from "../volume/ArrangementVolumeInspector";
import { ArrangementObjectFields } from "./ArrangementObjectFields";
import { objectKindLabels, objectRemoval } from "./objectPanelState";

export function ArrangementObjectPreview({ preview, workspace, disabled, applied, onApply }: {
  preview: BookArrangementObjectPreview; workspace: BookArrangementWorkspace; disabled?: boolean; applied?: boolean; onApply: () => void;
}) {
  const stale = preview.baseRevision !== workspace.baseRevision;
  return <section className="min-w-0 space-y-4 rounded-lg border border-border p-3" aria-label="对象调整预览">
    <h3 className="text-base">{preview.action === "delete" ? objectRemoval[preview.kind].action : `${preview.action === "create" ? "新增" : "调整"}${objectKindLabels[preview.kind]}`}预览</h3>
    {preview.action === "delete" && <p className="text-sm text-muted-foreground">{objectRemoval[preview.kind].explanation}请核对引用与影响。</p>}
    {preview.before && <details className="space-y-3"><summary className="cursor-pointer text-sm">原有内容</summary><ArrangementObjectFields detail={preview.before} fields={preview.before.fields} workspace={workspace} /></details>}
    {preview.after && <div className="space-y-3"><h4 className="text-sm">拟应用内容</h4><ArrangementObjectFields detail={preview.after} fields={preview.after.fields} workspace={workspace} /></div>}
    <VolumeChapterList workspace={workspace} chapterIds={preview.affectedChapterIds} label="影响章节" />
    <VolumeChapterList workspace={workspace} chapterIds={preview.writtenChapterIds} label="其中已写章节" />
    {preview.impact.map((line, index) => <p key={index} className="text-sm">{line}</p>)}
    {preview.conflicts.length > 0 && <div role="alert" className="space-y-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{preview.conflicts.map((conflict, index) => <div key={`${conflict.code}:${index}`}><p>{conflict.message}</p><VolumeChapterList workspace={workspace} chapterIds={conflict.chapterIds} label="相关章节" /></div>)}</div>}
    <details className="space-y-2"><summary className="cursor-pointer text-sm">关联资料 · {preview.references.length} 项</summary>{preview.references.map((reference, index) => <div key={`${reference.sourceId}:${index}`} className="space-y-1 text-sm"><p>{reference.label}</p><VolumeChapterList workspace={workspace} chapterIds={reference.chapterIds} label="涉及章节" /></div>)}</details>
    <div className="space-y-1"><h4 className="text-sm">未检查范围</h4>{preview.unchecked.length ? preview.unchecked.map((line, index) => <p key={index} className="text-xs text-muted-foreground">{line}</p>) : <p className="text-xs text-muted-foreground">本次预览未提供额外说明。</p>}</div>
    {stale && !applied && <p role="status" className="text-sm text-destructive">相关资料已变化，请重新预览。</p>}
    <Button size="sm" disabled={disabled || applied || stale || !preview.canApply || preview.conflicts.length > 0} onClick={onApply}>{preview.action === "delete" ? `确认${objectRemoval[preview.kind].action}` : "应用此对象调整"}</Button>
    {applied && <p role="status" className="text-sm">对象调整已应用，正文保持原样。</p>}
  </section>;
}

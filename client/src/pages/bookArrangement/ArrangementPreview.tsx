import type { BookArrangementPreview, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import type { WritingSettingsPayload } from "@ai-novel/shared/types/writingAdjustments";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { arrangementTracks } from "./arrangementState";

export function ArrangementRequirements({ settings, workspace }: { settings: WritingSettingsPayload; workspace: BookArrangementWorkspace }) {
  return <div className="space-y-2 text-xs"><p className="text-muted-foreground">{settings.enabled ? "启用可选要求" : "未启用要求"}</p>{arrangementTracks.filter(track => settings.controls[track.key]).map(track => {
    const control = settings.controls[track.key]!;
    const objects = [control.characterId, control.subjectId, control.objectId, control.speakerId, control.listenerId].filter(Boolean).map(id => workspace.characters.find(person => person.id === id)?.name ?? id);
    return <p key={track.key}>{track.label}：{control.mode === "set" ? control.value : control.mode === "disabled" ? "停用" : "继承"}{objects.length ? ` · ${objects.join(" / ")}` : ""}{control.matter ? ` · ${control.matter}` : ""}</p>;
  })}{settings.preserve.map((line, index) => <p key={index} className="whitespace-pre-wrap">{line}</p>)}</div>;
}
export function ArrangementPreview({ preview, workspace, selected, onSelected, disabled, applied, onApply }: {
  preview: BookArrangementPreview; workspace: BookArrangementWorkspace; selected: string[]; onSelected: (ids: string[]) => void; disabled: boolean; applied: boolean; onApply: () => void;
}) {
  return <section aria-label="后续要求预览" className="space-y-3 bg-muted/25 p-4">
    <h2 className="text-base">后续要求预览</h2><p className="text-sm text-muted-foreground">应用后，在章节的“人工调整”中生成时沿用这些要求。历史正文、当前大纲和原有自动写作流程保持原样。</p>
    {preview.excludedChapterIds.length > 0 && <p className="text-xs">排除的锁定章节：{preview.excludedChapterIds.map(id => workspace.chapters.find(chapter => chapter.id === id)?.title ?? id).join("、")}</p>}
    {preview.changes.map(change => <div className="space-y-2 py-2" key={change.chapterId}><label className="flex gap-2 text-sm"><input type="checkbox" aria-label={`应用要求${change.chapterId}`} disabled={disabled || applied} checked={selected.includes(change.chapterId)} onChange={event => onSelected(event.target.checked ? [...selected, change.chapterId] : selected.filter(id => id !== change.chapterId))} />{workspace.chapters.find(chapter => chapter.id === change.chapterId)?.title ?? change.chapterId}</label><div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-xs text-muted-foreground">应用前</p><ArrangementRequirements settings={change.before} workspace={workspace} /></div><div><p className="mb-2 text-xs text-muted-foreground">拟应用</p><ArrangementRequirements settings={change.after} workspace={workspace} /></div></div></div>)}
    {preview.impact.map((item, index) => <p key={index} className="text-xs text-muted-foreground">{item}</p>)}
    <Button size="sm" disabled={disabled || applied || !selected.length} onClick={onApply}>应用所选章节要求</Button>{applied && <p className="text-sm">要求已应用，可从章节写作继续使用。</p>}
    {applied && selected.map(id => <Link key={id} className="mr-3 inline-block text-sm text-primary underline" to={`/novels/${encodeURIComponent(workspace.novelId)}/chapters/${encodeURIComponent(id)}`}>打开{workspace.chapters.find(chapter => chapter.id === id)?.title ?? "章节"}的人工调整</Link>)}
  </section>;
}

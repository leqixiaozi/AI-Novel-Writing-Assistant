import { useState } from "react";
import type { BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import type { WritingControls, WritingControlKey } from "@ai-novel/shared/types/writingAdjustments";
import { Button } from "@/components/ui/button";
import { WritingControlsForm } from "@/pages/novels/components/writingAdjustments/WritingControlsForm";
import { validateWritingControls } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import { chapterEdit, updateChapterEdit, editableChapterIds, arrangementTracks } from "../arrangementState";

export function ArrangementControlsPanel({ workspace, draft, chapterId, controlKey, scope, onDraft }: {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; chapterId: string; controlKey?: WritingControlKey; scope: string[]; onDraft: (draft: BookArrangementDraftPayload) => void;
}) {
  const [message, setMessage] = useState("");
  const edit = chapterEdit(draft, chapterId);
  const allowed = editableChapterIds(draft, scope);
  const apply = () => {
    const selected: WritingControls = controlKey ? { [controlKey]: edit.controls[controlKey] ?? { mode: "inherit" } } : Object.fromEntries(arrangementTracks.map(track => [track.key, edit.controls[track.key] ?? { mode: "inherit" }]));
    const error = validateWritingControls(selected);
    if (error) { setMessage(error); return; }
    onDraft(allowed.reduce((next, id) => updateChapterEdit(next, id, { controls: { ...chapterEdit(next, id).controls, ...selected } }), draft));
    setMessage(`已调整 ${allowed.length} 章的草稿要求。保存后可预览生效范围。`);
  };
  return <section className="space-y-4"><p className="text-sm text-muted-foreground">{workspace.chapters.find(chapter => chapter.id === chapterId)?.title} · {controlKey ? arrangementTracks.find(track => track.key === controlKey)?.label : "表达参数"}。调整用于后续人工调整写作，已有正文保持原样。</p>
    <fieldset disabled={edit.locked} className="space-y-4"><WritingControlsForm controls={edit.controls} characters={workspace.characters} definitions={[]} onChange={controls => onDraft(updateChapterEdit(draft, chapterId, { controls }))} onlyKeys={controlKey ? [controlKey] : undefined} />
    <Button variant="secondary" disabled={!allowed.length} onClick={apply}>复制{controlKey ? "此项" : "本章参数"}到勾选的 {allowed.length} 章</Button></fieldset>
    {edit.locked && <p className="text-sm">本章编排已锁定，请在章节设置中解除锁定。</p>}{message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

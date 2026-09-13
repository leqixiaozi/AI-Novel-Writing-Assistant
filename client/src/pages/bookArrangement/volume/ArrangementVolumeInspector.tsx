import { Link } from "react-router-dom";
import { ArrowUpRight, LockKeyhole, RotateCcw, X } from "lucide-react";
import type { BookArrangementVolumeEdit, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";

export const volumeTextFields = [
  { key: "title", label: "卷段名称" },
  { key: "summary", label: "摘要" },
  { key: "mainPromise", label: "卷目标" },
  { key: "protagonistChange", label: "主角变化" },
  { key: "climax", label: "高潮安排" },
  { key: "nextVolumeHook", label: "下卷衔接" },
] as const;

export function volumeChapterNames(workspace: BookArrangementWorkspace, chapterIds: string[]): string {
  if (!chapterIds.length) return "无";
  const selected = new Set(chapterIds);
  const ranges: Array<{ first: number; last: number }> = [];
  let previousIndex = -2;
  let known = 0;
  workspace.chapters.forEach((chapter, index) => {
    if (!selected.has(chapter.id)) return;
    known++;
    if (index === previousIndex + 1) ranges[ranges.length - 1].last = chapter.order;
    else ranges.push({ first: chapter.order, last: chapter.order });
    previousIndex = index;
  });
  const summary = ranges.slice(0, 3).map(range => range.first === range.last ? `第${range.first}章` : `第${range.first}—${range.last}章`).join("、");
  const unknown = selected.size - known;
  return `${summary}${ranges.length > 3 ? "等" : ""}${summary ? " · " : ""}${selected.size}章${unknown ? `（${unknown}章无法定位）` : ""}`;
}

export function VolumeChapterList({ workspace, chapterIds, label }: { workspace: BookArrangementWorkspace; chapterIds: string[]; label: string }) {
  if (!chapterIds.length) return <p className="ba-help">{label}：无</p>;
  return <details className="ba-detail ba-volume-chapter-details"><summary>{label}：{volumeChapterNames(workspace, chapterIds)}</summary><div className="ba-volume-chapter-list max-h-48 space-y-1 overflow-y-auto">{chapterIds.map(id => {
    const chapter = workspace.chapters.find(item => item.id === id);
    return <p className="break-words" key={id}>{chapter ? `第${chapter.order}章 · ${chapter.title}` : `无法定位的章节（${id}）`}</p>;
  })}</div></details>;
}

export interface ArrangementVolumeInspectorProps {
  workspace: BookArrangementWorkspace;
  volumeId: string;
  edit?: BookArrangementVolumeEdit;
  busy?: boolean;
  dirty?: boolean;
  previewDisabled?: boolean;
  onChange: (edit: BookArrangementVolumeEdit) => void;
  onRevert: () => void;
  onPreview: () => void;
  onSaveAndPreview: () => void;
  onClose?: () => void;
}

/** Edits remain controlled by the page; opening this panel does not create a draft. */
export function ArrangementVolumeInspector({ workspace, volumeId, edit, busy = false, dirty = false, previewDisabled = false, onChange, onRevert, onPreview, onSaveAndPreview, onClose }: ArrangementVolumeInspectorProps) {
  const volume = workspace.volumes.find(item => item.id === volumeId);
  if (!volume) return <aside className="ba-inspector ba-volume-inspector"><p role="status">所选卷段已不存在，请刷新资料后重新选择。</p>{onClose && <Button size="sm" variant="ghost" onClick={onClose}>返回章节安排</Button>}</aside>;
  const value: BookArrangementVolumeEdit = edit ?? {
    volumeId: volume.id, title: volume.title, summary: volume.summary ?? "", mainPromise: volume.mainPromise ?? "",
    protagonistChange: volume.protagonistChange ?? "", climax: volume.climax ?? "", nextVolumeHook: volume.nextVolumeHook ?? "", chapterIds: [...volume.chapterIds],
  };
  const selected = new Set(value.chapterIds);
  const orderedChapters = workspace.chapters.filter(chapter => selected.has(chapter.id));
  const startId = orderedChapters[0]?.id ?? "";
  const endId = orderedChapters.at(-1)?.id ?? "";
  const startIndex = workspace.chapters.findIndex(chapter => chapter.id === startId);
  const endIndex = workspace.chapters.findIndex(chapter => chapter.id === endId);
  const affectedIds = new Set([...volume.chapterIds, ...value.chapterIds]);
  const lockedIds = workspace.draft.payload.chapterEdits.filter(chapter => chapter.locked && affectedIds.has(chapter.chapterId)).map(chapter => chapter.chapterId);
  const missingChapterIds = value.chapterIds.filter(id => !workspace.chapters.some(chapter => chapter.id === id));
  const incomplete = !value.title.trim() || !value.chapterIds.length || missingChapterIds.length > 0;
  const change = (patch: Partial<BookArrangementVolumeEdit>) => onChange({ ...value, ...patch, volumeId: volume.id });
  const setRange = (first: string, last: string) => {
    const from = workspace.chapters.findIndex(chapter => chapter.id === first);
    const to = workspace.chapters.findIndex(chapter => chapter.id === last);
    if (from < 0 || to < from) return;
    change({ chapterIds: workspace.chapters.slice(from, to + 1).map(chapter => chapter.id) });
  };
  const sourceUrl = `/novels/${encodeURIComponent(workspace.novelId)}/edit?stage=outline&volumeId=${encodeURIComponent(volume.id)}`;
  return <aside className="ba-inspector ba-volume-inspector" aria-label="卷段详情">
    <header className="ba-inspector-heading"><div><h2>{volume.title}</h2><p>卷段规划 · {edit ? dirty ? "尚未保存修改" : "已保存调整草稿" : "原有安排"}</p></div>{onClose && <Button size="sm" variant="ghost" aria-label="关闭卷段详情" disabled={busy} onClick={onClose}><X size={16} aria-hidden="true" /></Button>}</header>
    <fieldset disabled={busy} className="ba-inspector-body">
      <section className="ba-inspector-card"><header className="ba-card-heading">本卷安排</header><div className="ba-card-content">
        {volumeTextFields.map(field => <label className="ba-field" key={field.key}><span>{field.label}</span>{field.key === "title"
          ? <input aria-label={field.label} className="ba-input" value={value[field.key]} onChange={event => change({ [field.key]: event.target.value })} />
          : <textarea aria-label={field.label} className="ba-input" rows={field.key === "summary" ? 3 : 2} placeholder="尚未填写" value={value[field.key]} onChange={event => change({ [field.key]: event.target.value })} />}</label>)}
      </div></section>
      <section className="ba-inspector-card"><header className="ba-card-heading">章节范围</header><div className="ba-card-content">
        <div className="ba-volume-range"><label className="ba-field"><span>起始章节</span><select className="ba-input" aria-label="卷段起始章节" value={startId} onChange={event => setRange(event.target.value, endId || event.target.value)}><option value="" disabled>选择章节</option>{workspace.chapters.map((chapter, index) => <option key={chapter.id} value={chapter.id} disabled={endIndex >= 0 && index > endIndex}>第{chapter.order}章 · {chapter.title}</option>)}</select></label>
          <label className="ba-field"><span>结束章节</span><select className="ba-input" aria-label="卷段结束章节" value={endId} onChange={event => setRange(startId || event.target.value, event.target.value)}><option value="" disabled>选择章节</option>{workspace.chapters.map((chapter, index) => <option key={chapter.id} value={chapter.id} disabled={startIndex >= 0 && index < startIndex}>第{chapter.order}章 · {chapter.title}</option>)}</select></label></div>
        <VolumeChapterList workspace={workspace} chapterIds={volume.chapterIds} label="原范围" />
        <VolumeChapterList workspace={workspace} chapterIds={value.chapterIds} label="调整后范围" />
        <p className="ba-help">起止之间的章节将连续归入本卷。相邻卷的归属变化会在预览中列出。</p>
        {lockedIds.length > 0 && <p className="ba-help ba-volume-lock-notice"><LockKeyhole size={14} aria-hidden="true" />涉及锁定章节：{volumeChapterNames(workspace, lockedIds)}。预览将核对冲突，通过后才能应用。</p>}
        {missingChapterIds.length > 0 && <p role="alert">草稿中有无法定位的章节，请刷新资料后重新选择范围。</p>}
      </div></section>
      <Link className="ba-evidence-link" to={sourceUrl}>打开原卷规划<ArrowUpRight size={14} aria-hidden="true" /></Link>
      <Button size="sm" variant="ghost" disabled={!edit} onClick={onRevert}><RotateCcw size={14} aria-hidden="true" />撤销本卷草稿</Button>
    </fieldset>
    <footer className="ba-inspector-footer"><p className="ba-help">应用只更新卷段规划与章节归属；已有正文不会自动改写。</p>{!value.title.trim() && <p role="status" className="ba-help">请填写卷段名称。</p>}{!value.chapterIds.length && <p role="status" className="ba-help">请先选择本卷的章节范围。</p>}<Button size="sm" disabled={busy || previewDisabled || incomplete} onClick={dirty ? onSaveAndPreview : onPreview}>{dirty ? "保存并预览卷段" : "预览卷段调整"}</Button></footer>
  </aside>;
}

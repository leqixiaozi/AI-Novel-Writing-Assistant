import type { BookArrangementObjectDetail, BookArrangementObjectField, BookArrangementObjectValue, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { adjustmentInputClass } from "@/pages/novels/components/writingAdjustments/WritingControlsForm";

const recordStatusLabels: Record<string, string> = { planned: "规划", occurred: "已发生", open: "待处理", resolved: "已解决", cancelled: "已取消", dropped: "已放弃", active: "启用", closed: "已关闭", ignored: "已忽略" };

function optionsFor(field: BookArrangementObjectField, workspace: BookArrangementWorkspace) {
  if (field.options) return field.options;
  if (field.type === "chapter") return workspace.chapters.map(chapter => ({ value: chapter.id, label: `第${chapter.order}章 · ${chapter.title}` }));
  if (field.type === "character" || field.type === "characters") return workspace.characters.map(character => ({ value: character.id, label: `${character.name}${character.role ? ` · ${character.role}` : ""}` }));
  if (field.type === "volume") return workspace.volumes.map(volume => ({ value: volume.id, label: volume.title }));
  if (field.type === "hook") return (workspace.clues ?? []).filter(clue => clue.sourceEntity === "TimelineHook").map(clue => ({ value: clue.sourceId, label: clue.title }));
  if (field.type === "event") return workspace.events.map(event => ({ value: event.id, label: `${event.title}${event.chapterOrder != null ? ` · 第${event.chapterOrder}章` : ""}` }));
  if (field.type === "scene") return workspace.scenes.map(scene => ({ value: scene.id, label: `${scene.title} · 第${workspace.chapters.find(chapter => chapter.id === scene.chapterId)?.order ?? "—"}章` }));
  if (field.type === "events") return workspace.events.map(event => ({ value: event.id, label: `${event.title}${event.chapterOrder != null ? ` · 第${event.chapterOrder}章` : ""}` }));
  return [];
}

export function objectFieldText(field: BookArrangementObjectField, value: BookArrangementObjectValue | undefined, workspace: BookArrangementWorkspace): string {
  if (value == null || value === "") return "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (field.key === "status" && typeof value === "string") return recordStatusLabels[value] ?? value;
  const options = optionsFor(field, workspace);
  if (Array.isArray(value)) return value.length ? value.map(id => options.find(option => option.value === id)?.label ?? id).join("、") : "无";
  return options.find(option => option.value === String(value))?.label ?? String(value);
}

export function ArrangementObjectFields({ detail, fields, workspace, disabled, onChange }: {
  detail: BookArrangementObjectDetail; fields: Record<string, BookArrangementObjectValue>; workspace: BookArrangementWorkspace;
  disabled?: boolean; onChange?: (key: string, value: BookArrangementObjectValue) => void;
}) {
  return <div className="min-w-0 space-y-4">{detail.fieldDefinitions.map(field => {
    const value = fields[field.key];
    const options = optionsFor(field, workspace);
    if (!onChange || field.readOnly || !detail.editable) return <div key={field.key} className="min-w-0 space-y-1"><p className="text-xs text-muted-foreground">{field.label}</p><p className="break-words whitespace-pre-wrap text-sm">{objectFieldText(field, value, workspace)}</p></div>;
    const update = (next: BookArrangementObjectValue) => onChange(field.key, next);
    if (field.type === "boolean") return <label key={field.key} className="flex items-center gap-2 text-sm"><input aria-label={field.label} type="checkbox" checked={value === true} disabled={disabled} onChange={event => update(event.target.checked)} />{field.label}</label>;
    if (field.type === "characters" || field.type === "events") {
      const selected = Array.isArray(value) ? value : [];
      return <fieldset className="min-w-0 space-y-2" disabled={disabled} key={field.key}><legend className="text-sm">{field.label}</legend><div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-input p-2">{options.map(option => <label key={option.value} className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`${field.label}：${option.label}`} checked={selected.includes(option.value)} onChange={event => update(event.target.checked ? [...selected, option.value] : selected.filter(id => id !== option.value))} /><span>{option.label}</span></label>)}{!options.length && <p className="text-xs text-muted-foreground">暂无可选资料。</p>}{selected.filter(id => !options.some(option => option.value === id)).map(id => <label key={id} className="flex items-start gap-2 break-all text-xs text-destructive"><input type="checkbox" checked aria-label={`移除无法定位的引用 ${id}`} onChange={() => update(selected.filter(item => item !== id))} />无法定位的引用：{id}（取消勾选可移除）</label>)}</div></fieldset>;
    }
    return <label key={field.key} className="block min-w-0 space-y-1 text-sm"><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea"
      ? <textarea aria-label={field.label} className={adjustmentInputClass} rows={3} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={event => update(event.target.value)} />
      : ["chapter", "character", "volume", "hook", "event", "scene", "select"].includes(field.type)
        ? <select aria-label={field.label} className={adjustmentInputClass} disabled={disabled} value={value == null ? "" : String(value)} onChange={event => update(event.target.value || null)}><option value="">{field.required ? "请选择" : "未设置"}</option>{value != null && value !== "" && !options.some(option => option.value === String(value)) && <option value={String(value)}>{String(value)}（当前值）</option>}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input aria-label={field.label} className={adjustmentInputClass} type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} disabled={disabled} value={value == null ? "" : String(value)} onChange={event => update(field.type === "number" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value)} />}</label>;
  })}
    {detail.record && <div className="space-y-1 text-xs text-muted-foreground">
      {typeof detail.record.status === "string" && !detail.fieldDefinitions.some(field => field.key === "status") && <p>原记录状态：{recordStatusLabels[detail.record.status] ?? detail.record.status}</p>}
      {typeof detail.record.isCurrent === "boolean" && <p>原关系安排：{detail.record.isCurrent ? "当前启用" : "已停用"}</p>}
      {typeof detail.record.resolvedInChapterId === "string" && <p>原记录回收位置：{workspace.chapters.find(chapter => chapter.id === detail.record.resolvedInChapterId)?.title ?? "章节引用暂不可定位"}</p>}
    </div>}
  </div>;
}

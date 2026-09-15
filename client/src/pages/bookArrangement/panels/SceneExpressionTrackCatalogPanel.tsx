import { useState, type CSSProperties } from "react";
import { Plus, RotateCcw, Settings2 } from "lucide-react";
import type { BookArrangementDraftPayload } from "@ai-novel/shared/types/bookArrangement";
import { SCENE_EXPRESSION_DIMENSIONS, cloneSceneExpressionDefinitions, type SceneExpressionColor, type SceneExpressionDimensionDefinition, type SceneExpressionDimensionKey } from "@ai-novel/shared/types/sceneExpressionTracks";
import { Button } from "@/components/ui/button";

interface Props {
  draft: BookArrangementDraftPayload;
  onDraft: (draft: BookArrangementDraftPayload) => void;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  definitions: SceneExpressionDimensionDefinition[];
  onDefinitions: (definitions: SceneExpressionDimensionDefinition[]) => void;
}

const colors: Array<{ value: SceneExpressionColor; label: string }> = [
  { value: "blue", label: "蓝色" }, { value: "orange", label: "橙色" }, { value: "violet", label: "紫色" }, { value: "teal", label: "青色" }, { value: "rose", label: "玫红" },
];

function newDefinition(sortOrder: number): SceneExpressionDimensionDefinition {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  return {
    key: `custom_${suffix}`,
    origin: "custom",
    label: "新表达轨道",
    description: "说明这条轨道控制场景的哪一种写法，不改变剧情内容。",
    color: "blue",
    enabled: true,
    sortOrder,
    bands: [1, 2, 3, 4, 5].map(level => ({ level: level as 1 | 2 | 3 | 4 | 5, name: ["充分克制", "略作强调", "均衡表达", "明显强调", "集中表达"][level - 1], instruction: "" })),
    invariants: ["不得新增、删除或改变剧情事实"],
    promptAssetKey: "novel.scene.expression_controls",
  };
}

export function SceneExpressionTrackCatalogPanel({ draft, onDraft, enabled, onEnabled, definitions, onDefinitions }: Props) {
  const [editing, setEditing] = useState<SceneExpressionDimensionDefinition | null>(null);
  const ordered = [...definitions].sort((a, b) => a.sortOrder - b.sortOrder);
  const definitionKeys = new Set(definitions.map(item => item.key));
  const configured = draft.pinnedTracks.filter((key): key is SceneExpressionDimensionKey => definitionKeys.has(key));
  const active = ordered.filter(item => item.enabled);
  const visible = configured.length ? configured.filter(key => definitions.some(item => item.key === key && item.enabled)) : active.map(item => item.key);
  const setVisible = (keys: SceneExpressionDimensionKey[]) => {
    const unrelated = draft.pinnedTracks.filter(key => !definitionKeys.has(key));
    onDraft({ ...draft, pinnedTracks: [...new Set([...unrelated, ...keys])] });
  };
  const commit = (definition: SceneExpressionDimensionDefinition) => {
    const exists = ordered.some(item => item.key === definition.key);
    onDefinitions(exists ? ordered.map(item => item.key === definition.key ? definition : item) : [...ordered, definition]);
    if (!exists) setVisible([...visible, definition.key]);
    setEditing(null);
  };
  const add = () => {
    if (definitions.length >= 12) return;
    setEditing(newDefinition(Math.max(0, ...definitions.map(item => item.sortOrder)) + 1));
  };
  const restore = (key: string) => {
    const original = SCENE_EXPRESSION_DIMENSIONS.find(item => item.key === key);
    if (!original) return;
    onDefinitions(ordered.map(item => item.key === key ? cloneSceneExpressionDefinitions([original])[0] : item));
    setEditing(null);
  };
  const toggleDefinition = (key: string, next: boolean) => {
    if (!next && definitions.filter(item => item.enabled).length === 1) return;
    onDefinitions(ordered.map(item => item.key === key ? { ...item, enabled: next } : item));
    if (!next) setVisible(visible.filter(item => item !== key));
  };

  return <section className="ba-expression-track-panel">
    <header><div><h3>场景表达轨道</h3><p>内置 5 条轨道可修改提示词，也可新增本书专用轨道。所有轨道只控制场景写法。</p></div><span>{active.length} / {definitions.length} 条已启用</span></header>
    <label className="ba-expression-runtime-switch"><input type="checkbox" checked={enabled} onChange={event => onEnabled(event.target.checked)} /><span><strong>用于后续写作</strong><small>{enabled ? "已启用：生成本书后续章节时读取对应场景点。" : "未启用：轨道和点位仍可编辑，生成暂不读取。"}</small></span></label>
    <div className="ba-expression-track-actions"><Button size="sm" variant="outline" onClick={() => setVisible(active.map(track => track.key))}>显示全部</Button><Button size="sm" variant="ghost" onClick={() => setVisible(active.slice(0, 3).map(track => track.key))}>精简显示</Button><Button size="sm" onClick={add} disabled={definitions.length >= 12}><Plus size={15} />新增轨道</Button></div>
    <div className="ba-expression-track-list">{ordered.map(track => { const shown = visible.includes(track.key); return <article key={track.key} style={{ "--ba-track-color": `var(--ba-${track.color})` } as CSSProperties}>
      <div className="ba-expression-track-summary"><label><input type="checkbox" checked={shown} disabled={!track.enabled || (shown && visible.length === 1)} onChange={event => setVisible(event.target.checked ? [...visible, track.key] : visible.filter(key => key !== track.key))} /><i aria-hidden="true" /><span><strong>{track.label}<em>{track.origin === "system" ? "内置" : "自定义"}</em></strong><small>{track.description}</small></span></label><div><label className="ba-expression-track-enable"><input type="checkbox" checked={track.enabled} onChange={event => toggleDefinition(track.key, event.target.checked)} />启用</label><Button size="sm" variant="ghost" onClick={() => setEditing(cloneSceneExpressionDefinitions([track])[0])}><Settings2 size={14} />修改</Button></div></div>
    </article>; })}</div>
    {editing && <form className="ba-expression-definition-editor" onSubmit={event => { event.preventDefault(); commit(editing); }}>
      <header><div><h4>{editing.origin === "system" ? `修改内置轨道 · ${editing.label}` : definitions.some(item => item.key === editing.key) ? `修改自定义轨道 · ${editing.label}` : "新增场景表达轨道"}</h4><p>这里的文字会进入生成提示，只描述写法强弱，不写剧情要求。</p></div>{editing.origin === "system" && <Button type="button" size="sm" variant="ghost" onClick={() => restore(editing.key)}><RotateCcw size={14} />恢复默认</Button>}</header>
      <div className="ba-expression-definition-grid"><label><span>轨道名称</span><input className="ba-input" maxLength={30} required value={editing.label} onChange={event => setEditing({ ...editing, label: event.target.value })} /></label><label><span>颜色</span><select className="ba-input" value={editing.color} onChange={event => setEditing({ ...editing, color: event.target.value as SceneExpressionColor })}>{colors.map(color => <option key={color.value} value={color.value}>{color.label}</option>)}</select></label><label className="is-wide"><span>用途说明</span><textarea className="ba-input" rows={2} maxLength={200} required value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label></div>
      <div className="ba-expression-band-editor"><strong>表达方式与对应提示词</strong>{editing.bands.map((band, index) => <div key={band.level}><input className="ba-input" maxLength={30} required aria-label={`表达方式${index + 1}名称`} value={band.name} onChange={event => setEditing({ ...editing, bands: editing.bands.map((item, position) => position === index ? { ...item, name: event.target.value } : item) })} /><textarea className="ba-input" rows={2} maxLength={300} required aria-label={`表达方式${index + 1}提示词`} placeholder="填写具体执行要求，无需写级别或数值" value={band.instruction} onChange={event => setEditing({ ...editing, bands: editing.bands.map((item, position) => position === index ? { ...item, instruction: event.target.value } : item) })} /></div>)}</div>
      <label className="ba-expression-invariants"><span>内容保护规则（每行一条，最多 6 条）</span><textarea className="ba-input" rows={4} required value={editing.invariants.join("\n")} onChange={event => setEditing({ ...editing, invariants: event.target.value.split("\n").map(item => item.trim()).filter(Boolean).slice(0, 6) })} /></label>
      <div className="ba-expression-definition-actions"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button type="submit">{definitions.some(item => item.key === editing.key) ? "保存本次修改" : "添加到本书"}</Button></div>
    </form>}
    <p className="ba-panel-note">矩阵左键上下拖动场景点调整表达方式，右键查看具体写作要求。未设置点继续使用本书底座写法。</p>
  </section>;
}

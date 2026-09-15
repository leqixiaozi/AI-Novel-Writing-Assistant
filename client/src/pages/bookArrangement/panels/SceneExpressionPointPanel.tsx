import type { BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import type { SceneExpressionDimensionDefinition, SceneExpressionDimensionKey, SceneExpressionLevel, SceneExpressionPointInput } from "@ai-novel/shared/types/sceneExpressionTracks";
import { Button } from "@/components/ui/button";
import { expressionPoint, setExpressionPoint } from "../controls/sceneExpressionState";

export function SceneExpressionPointPanel({ workspace, sceneId, dimensionKey, definitions, points, onPoints }: {
  workspace: BookArrangementWorkspace; sceneId: string; dimensionKey: SceneExpressionDimensionKey;
  definitions: SceneExpressionDimensionDefinition[];
  points: SceneExpressionPointInput[]; onPoints: (points: SceneExpressionPointInput[]) => void;
}) {
  const scene = workspace.scenes.find(item => item.id === sceneId);
  const chapter = workspace.chapters.find(item => item.id === scene?.chapterId);
  const dimension = definitions.find(item => item.key === dimensionKey);
  const point = expressionPoint(points, sceneId, dimensionKey);
  if (!scene || !chapter) return <p className="ba-empty-state">这个场景已不存在，请刷新全书编排。</p>;
  if (!dimension) return <p className="ba-empty-state">这个表达轨道已不存在，请关闭面板后重新选择。</p>;
  const update = (level: SceneExpressionLevel, note = point?.note ?? null) => onPoints(setExpressionPoint(points, { sceneId, dimensionKey, level, note }));
  return <section className="ba-expression-point-panel">
    <header><div><span>第 {chapter.order} 章 · S{scene.sortOrder}</span><h3>{scene.title}</h3><p>{dimension.description}</p></div><strong className={`is-${dimension.color}`}>{point ? dimension.bands.find(band => band.level === point.level)?.name : "底座写法"}</strong></header>
    <div className="ba-expression-band-list" role="radiogroup" aria-label={`${dimension.label}档位`}>
      {dimension.bands.map(band => <button key={band.level} type="button" role="radio" aria-checked={point?.level === band.level} onClick={() => update(band.level)}><span><strong>{band.name}</strong><small>{band.instruction}</small></span></button>)}
    </div>
    <label className="ba-expression-note"><span>这个场景的补充说明</span><textarea className="ba-input" rows={4} maxLength={500} placeholder="可留空。这里只说明写法，不新增剧情要求。" value={point?.note ?? ""} onChange={event => update(point?.level ?? 3, event.target.value || null)} /><small>{point?.note?.length ?? 0} / 500</small></label>
    <section className="ba-expression-boundary"><h4>内容保护</h4><ul>{dimension.invariants.map(rule => <li key={rule}>{rule}</li>)}</ul><p>只改变表达，不改变事件、人物行动、知情、关系、线索、因果和场景结果。</p></section>
    <section className="ba-expression-scene-summary"><h4>场景依据</h4><dl><div><dt>任务</dt><dd>{scene.objective || "未设置"}</dd></div><div><dt>阻力</dt><dd>{scene.resistance || scene.conflict || "未设置"}</dd></div><div><dt>结束状态</dt><dd>{scene.exitState || "未设置"}</dd></div></dl></section>
    <div className="ba-expression-point-actions"><Button variant="outline" disabled={!point} onClick={() => onPoints(setExpressionPoint(points, null, { sceneId, dimensionKey }))}>恢复底座写法</Button><span>调整先进入全书编排草稿，点击页面“保存草稿”后用于后续场景写作。</span></div>
  </section>;
}

import { SCENE_EXPRESSION_DIMENSIONS, sceneExpressionBand, sceneExpressionDefinition, type SceneExpressionDimensionDefinition, type SceneExpressionPointInput } from "@ai-novel/shared/types/sceneExpressionTracks";

export const SCENE_EXPRESSION_PROMPT_ASSET_KEY = "novel.scene.expression_controls" as const;
export const SCENE_EXPRESSION_PROMPT_VERSION = "1.1.0";

export function renderSceneExpressionControls(
  scenes: Array<{ id: string; sortOrder: number; title: string }>,
  points: SceneExpressionPointInput[],
  definitions: readonly SceneExpressionDimensionDefinition[] = SCENE_EXPRESSION_DIMENSIONS,
): string {
  if (!points.length) return "";
  const pointsByScene = new Map<string, SceneExpressionPointInput[]>();
  for (const point of points) pointsByScene.set(point.sceneId, [...(pointsByScene.get(point.sceneId) ?? []), point]);
  const blocks = [...scenes].sort((left, right) => left.sortOrder - right.sortOrder).flatMap(scene => {
    const scenePoints = pointsByScene.get(scene.id) ?? [];
    if (!scenePoints.length) return [];
    const lines = scenePoints.flatMap(point => {
      const definition = sceneExpressionDefinition(point.dimensionKey, definitions);
      const band = sceneExpressionBand(point.dimensionKey, point.level, definitions);
      if (!definition?.enabled || !band) return [];
      return [`- ${definition.label}：L${band.level}／${band.name}。${band.instruction}${point.note?.trim() ? ` 作者写法备注：${point.note.trim()}` : ""}`, ...definition.invariants.map(rule => `  - 保护：${rule}`)];
    });
    return lines.length ? [[`【场景 S${scene.sortOrder}：${scene.title}】`, ...lines].join("\n")] : [];
  });
  if (!blocks.length) return "";
  return [
    "【场景表达轨道】",
    "只改变表达，不改变故事。不得新增、删除、合并或调换事件；不得改变人物出场、行动、决定、知情、关系、线索、因果和场景结果；不得补充未提供的姓名、日期、地点、身份、物证内容或结论。无法在事实边界内达到档位时，以事实为准并降低表现强度。",
    ...blocks,
  ].join("\n\n");
}

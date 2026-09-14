import type { SceneExpressionDimensionKey, SceneExpressionLevel, SceneExpressionPointInput } from "@ai-novel/shared/types/sceneExpressionTracks";

export function expressionPointKey(sceneId: string, dimensionKey: SceneExpressionDimensionKey) {
  return `${sceneId}:${dimensionKey}`;
}

export function expressionLevelAtY(y: number, top: number, height: number): SceneExpressionLevel {
  if (!Number.isFinite(y) || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return 3;
  return Math.max(1, Math.min(5, Math.round((1 - (y - top) / height) * 4) + 1)) as SceneExpressionLevel;
}

export function orderedVisibleScenes<TChapter extends { id: string }, TScene extends { chapterId: string; sortOrder: number; id: string }>(chapters: TChapter[], scenes: TScene[]) {
  const order = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  return scenes.filter(scene => order.has(scene.chapterId)).sort((left, right) => (order.get(left.chapterId)! - order.get(right.chapterId)!) || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
}

export function chapterSceneGroups<TChapter extends { id: string }, TScene extends { chapterId: string; sortOrder: number; id: string }>(chapters: TChapter[], scenes: TScene[]) {
  const ordered = orderedVisibleScenes(chapters, scenes);
  return chapters.map((chapter, chapterIndex) => {
    const chapterScenes = ordered.filter(scene => scene.chapterId === chapter.id);
    return {
      chapter,
      scenes: chapterScenes.map((scene, sceneIndex) => ({
        ...scene,
        curveX: chapterIndex * 100 + ((sceneIndex + 0.5) / chapterScenes.length) * 100,
      })),
    };
  });
}

export function setExpressionPoint(
  points: SceneExpressionPointInput[],
  point: SceneExpressionPointInput | null,
  target?: { sceneId: string; dimensionKey: SceneExpressionDimensionKey },
) {
  const binding = point ?? target;
  if (!binding) return points;
  const remaining = points.filter(item => expressionPointKey(item.sceneId, item.dimensionKey) !== expressionPointKey(binding.sceneId, binding.dimensionKey));
  return point ? [...remaining, point] : remaining;
}

export function expressionPoint(points: SceneExpressionPointInput[], sceneId: string, dimensionKey: SceneExpressionDimensionKey) {
  return points.find(point => point.sceneId === sceneId && point.dimensionKey === dimensionKey);
}

export function sceneExpressionCurveSegments(points: Array<{ x: number; level: SceneExpressionLevel | null }>) {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];
  points.forEach(point => {
    if (point.level === null) { if (segment.length) segments.push(segment); segment = []; return; }
    segment.push({ x: point.x, y: 52 - (point.level - 1) * 10 });
  });
  if (segment.length) segments.push(segment);
  return segments;
}

export type SceneBudget = { id: string; sortOrder: number; targetWordCount: number; locked?: boolean };

export function resizeSceneBoundary<T extends SceneBudget>(scenes: T[], leftIndex: number, deltaWords: number): T[] {
  const left = scenes[leftIndex], right = scenes[leftIndex + 1];
  if (!left || !right || left.locked || right.locked || !Number.isFinite(deltaWords)) return scenes;
  const total = scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0);
  const minimum = Math.max(150, Math.round(total * 0.05));
  const delta = Math.max(minimum - left.targetWordCount, Math.min(right.targetWordCount - minimum, Math.round(deltaWords)));
  if (!delta) return scenes;
  return scenes.map((scene, index) => index === leftIndex
    ? { ...scene, targetWordCount: scene.targetWordCount + delta }
    : index === leftIndex + 1
      ? { ...scene, targetWordCount: scene.targetWordCount - delta }
      : scene);
}

export function moveScene<T extends SceneBudget>(scenes: T[], sceneId: string, delta: -1 | 1): T[] {
  const index = scenes.findIndex(scene => scene.id === sceneId), target = index + delta;
  if (index < 0 || target < 0 || target >= scenes.length) return scenes;
  const moved = [...scenes];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved.map((scene, position) => ({ ...scene, sortOrder: position + 1 }));
}

export function sceneBudgetPercent(scene: SceneBudget, scenes: SceneBudget[]): number {
  const total = scenes.reduce((sum, item) => sum + item.targetWordCount, 0);
  return total > 0 ? Math.round(scene.targetWordCount / total * 100) : 0;
}

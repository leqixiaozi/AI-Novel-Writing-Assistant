import test from "node:test";
import assert from "node:assert/strict";
import {
  moveScene,
  resizeSceneBoundary,
  sceneBudgetPercent,
} from "./sceneEditorState.ts";

const scenes = [
  { id: "s1", sortOrder: 1, targetWordCount: 600, locked: false },
  { id: "s2", sortOrder: 2, targetWordCount: 1500, locked: false },
  { id: "s3", sortOrder: 3, targetWordCount: 900, locked: false },
];

test("scene boundary drag keeps the chapter budget exact and changes only adjacent unlocked scenes", () => {
  const resized = resizeSceneBoundary(scenes, 0, 300);
  assert.deepEqual(resized.map(scene => scene.targetWordCount), [900, 1200, 900]);
  assert.equal(resized.reduce((sum, scene) => sum + scene.targetWordCount, 0), 3000);
  assert.deepEqual(resizeSceneBoundary([{ ...scenes[0], locked: true }, ...scenes.slice(1)], 0, 300), [{ ...scenes[0], locked: true }, ...scenes.slice(1)]);
});

test("scene boundary drag enforces a readable minimum instead of collapsing a scene", () => {
  assert.deepEqual(resizeSceneBoundary(scenes, 0, -1000).map(scene => scene.targetWordCount), [150, 1950, 900]);
  const compact = scenes.map(scene => ({ ...scene, targetWordCount: 200 }));
  assert.deepEqual(resizeSceneBoundary(compact, 0, -1000).map(scene => scene.targetWordCount), [150, 250, 200]);
});

test("moving a scene keeps stable ids and renumbers the chapter order", () => {
  const moved = moveScene(scenes, "s3", -1);
  assert.deepEqual(moved.map(scene => [scene.id, scene.sortOrder]), [["s1", 1], ["s3", 2], ["s2", 3]]);
});

test("budget percentage is derived from the actual chapter total", () => {
  assert.equal(sceneBudgetPercent(scenes[1], scenes), 50);
});

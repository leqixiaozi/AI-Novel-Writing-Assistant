import test from "node:test";
import assert from "node:assert/strict";
import { chapterSceneGroups, expressionLevelAtY, orderedVisibleScenes, sceneExpressionCurveSegments, setExpressionPoint } from "./sceneExpressionState.ts";

test("visible expression points follow chapter reading order and scene sort order", () => {
  const chapters = [{ id: "c2", order: 2 }, { id: "c1", order: 1 }];
  const scenes = [{ id: "s3", chapterId: "c2", sortOrder: 2 }, { id: "s1", chapterId: "c1", sortOrder: 1 }, { id: "s2", chapterId: "c2", sortOrder: 1 }];
  assert.deepEqual(orderedVisibleScenes(chapters, scenes).map(scene => scene.id), ["s2", "s3", "s1"]);
});

test("scene expression columns stay aligned to chapters and pack several scene buttons into one chapter cell", () => {
  const chapters = [{ id: "c1", order: 1 }, { id: "c2", order: 2 }];
  const scenes = [
    { id: "s2", chapterId: "c1", sortOrder: 2 },
    { id: "s3", chapterId: "c2", sortOrder: 1 },
    { id: "s1", chapterId: "c1", sortOrder: 1 },
  ];
  const groups = chapterSceneGroups(chapters, scenes);
  assert.deepEqual(groups.map(group => group.scenes.map(scene => scene.id)), [["s1", "s2"], ["s3"]]);
  assert.deepEqual(groups.flatMap(group => group.scenes.map(scene => scene.curveX)), [25, 75, 150]);
});

test("vertical pointer position snaps to L1 through L5", () => {
  assert.deepEqual([0, 25, 50, 75, 100].map(y => expressionLevelAtY(y, 0, 100)), [5, 4, 3, 2, 1]);
  assert.equal(expressionLevelAtY(-20, 0, 100), 5);
  assert.equal(expressionLevelAtY(120, 0, 100), 1);
});

test("setting and clearing a point preserves every other scene binding", () => {
  const points = [{ sceneId: "s1", dimensionKey: "scene_pace", level: 2, note: null }];
  const changed = setExpressionPoint(points, { sceneId: "s2", dimensionKey: "scene_pace", level: 4, note: null });
  assert.deepEqual(changed.map(point => [point.sceneId, point.level]), [["s1", 2], ["s2", 4]]);
  assert.deepEqual(setExpressionPoint(changed, null, { sceneId: "s2", dimensionKey: "scene_pace" }), points);
});

test("unset scene points split the expression curve while explicit L3 remains visible", () => {
  assert.deepEqual(sceneExpressionCurveSegments([{ x: 25, level: 1 }, { x: 75, level: 3 }, { x: 150, level: null }, { x: 250, level: 5 }]), [
    [{ x: 25, y: 52 }, { x: 75, y: 32 }],
    [{ x: 250, y: 12 }],
  ]);
});

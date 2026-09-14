import test from "node:test";
import assert from "node:assert/strict";
import { SCENE_EXPRESSION_DIMENSIONS, sceneExpressionBand, sceneExpressionDefinition } from "@ai-novel/shared/types/sceneExpressionTracks";

test("scene expression dictionary exposes exactly five universal writing dimensions", () => {
  assert.deepEqual(SCENE_EXPRESSION_DIMENSIONS.map(item => item.key), [
    "scene_pace", "sentence_cadence", "detail_expansion", "camera_distance", "language_ornament",
  ]);
  for (const dimension of SCENE_EXPRESSION_DIMENSIONS) {
    assert.deepEqual(dimension.bands.map(band => band.level), [1, 2, 3, 4, 5]);
    assert.equal(dimension.promptAssetKey, "novel.scene.expression_controls");
    assert.ok(dimension.invariants.length > 0);
  }
});

test("explicit level three resolves to a dictionary band and is distinct from unset", () => {
  assert.equal(sceneExpressionBand("scene_pace", 3)?.name, "均衡推进");
  assert.equal(sceneExpressionBand("scene_pace", undefined), undefined);
});

test("book definitions resolve custom track bands without changing the system dictionary", () => {
  const custom = {
    ...SCENE_EXPRESSION_DIMENSIONS[0],
    key: "custom_dialogue_density",
    origin: "custom",
    label: "对话密度",
    sortOrder: 6,
    bands: SCENE_EXPRESSION_DIMENSIONS[0].bands.map(band => ({ ...band, name: `对话 L${band.level}` })),
  };
  assert.equal(sceneExpressionDefinition("custom_dialogue_density", [...SCENE_EXPRESSION_DIMENSIONS, custom])?.label, "对话密度");
  assert.equal(sceneExpressionBand("custom_dialogue_density", 3, [...SCENE_EXPRESSION_DIMENSIONS, custom])?.name, "对话 L3");
  assert.equal(sceneExpressionDefinition("custom_dialogue_density"), undefined);
});

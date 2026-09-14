import test from "node:test";
import assert from "node:assert/strict";
import { SCENE_EXPRESSION_DIMENSIONS, sceneExpressionBand } from "@ai-novel/shared/types/sceneExpressionTracks";

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

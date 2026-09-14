import test from "node:test";
import assert from "node:assert/strict";
import { closeBaseLayer, closeObjectLayer, openObjectLayer, panelScopeLabel } from "./panelNavigation.ts";

test("opening object details keeps the originating panel mounted underneath", () => {
  assert.deepEqual(openObjectLayer({ base: "hooks", objectOpen: false }), { base: "hooks", objectOpen: true });
  assert.deepEqual(openObjectLayer({ base: "relations", objectOpen: false }), { base: "relations", objectOpen: true });
  assert.deepEqual(openObjectLayer({ base: null, objectOpen: false }), { base: null, objectOpen: true });
});

test("closing object details removes only the top layer", () => {
  assert.deepEqual(closeObjectLayer({ base: "hooks", objectOpen: true }), { base: "hooks", objectOpen: false });
  assert.deepEqual(closeObjectLayer({ base: "chapter", objectOpen: true }), { base: "chapter", objectOpen: false });
  assert.deepEqual(closeObjectLayer({ base: null, objectOpen: true }), { base: null, objectOpen: false });
});

test("closing the base panel always clears the visible base layer", () => {
  assert.deepEqual(closeBaseLayer({ base: "tracks", objectOpen: false }), { base: null, objectOpen: false });
  assert.deepEqual(closeBaseLayer({ base: "controls", objectOpen: true }), { base: null, objectOpen: true });
});

test("panel scope labels distinguish whole book, chapter batch, and scene operations", () => {
  assert.equal(panelScopeLabel("tracks", 3, 0), "全书");
  assert.equal(panelScopeLabel("chapter", 3, 0), "第 3 章");
  assert.equal(panelScopeLabel("controls", 3, 4), "批量 · 4 章");
  assert.equal(panelScopeLabel("expression-point", 3, 0), "单个场景");
});

import test from "node:test";
import assert from "node:assert/strict";
import { closeObjectLayer, openObjectLayer } from "./panelNavigation.ts";

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

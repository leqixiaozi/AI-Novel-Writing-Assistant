const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");
const source = (name) => path.resolve(__dirname, "../src", name);
const errors = loadRuntimeSource(source("middleware/errorHandler.ts"), { zod: require("zod") });
const contracts = loadRuntimeSource(source("modules/novel/adjustments/domain/contracts.ts"), {
  "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors,
});
const narrative = loadRuntimeSource(source("prompting/prompts/novel/chapterNarrativeControls.ts"), {});

test("writing controls distinguish no setting, inherited zero and explicit disable", () => {
  assert.deepEqual(contracts.controlsSchema.parse({}), {});
  const merged = contracts.mergeControls([
    { source: "book", controls: { pace: { mode: "set", value: 75 }, tension: { mode: "set", value: 50 } } },
    { source: "chapter", controls: { pace: { mode: "set", value: 0 }, tension: { mode: "disabled" } } },
    { source: "request", controls: { pace: { mode: "inherit" }, tension: { mode: "inherit" } } },
  ]);
  assert.deepEqual(merged.controls, { pace: { mode: "set", value: 0 }, tension: { mode: "disabled" } });
  assert.deepEqual(merged.sources, { pace: "chapter", tension: "chapter" });
  assert.throws(() => contracts.controlsSchema.parse({ pace: { mode: "set" } }));
  for (const value of [-1, 101, NaN, Infinity]) assert.throws(() => contracts.controlsSchema.parse({ pace: { mode: "set", value } }));
});

test("five narrative bands preserve legal zero and round midpoint toward the higher band", () => {
  const cases = [[0, 1], [12.49, 1], [12.5, 2], [37.5, 3], [50, 3], [62.5, 4], [75, 4], [87.5, 5], [100, 5]];
  for (const [rawValue, band] of cases) {
    const block = narrative.buildChapterNarrativeControlBlock({ pace: { rawValue } });
    assert.match(block, new RegExp(`L${band}`), `value ${rawValue}`);
  }
  assert.equal(narrative.buildChapterNarrativeControlBlock(undefined), "");
});

test("character-targeted controls reject foreign IDs and incomplete bindings", () => {
  const ids = new Set(["actor-1", "actor-2"]);
  const valid = {
    suspicionTarget: { mode: "set", value: 0, subjectId: "actor-1", objectId: "actor-2", matter: "letter origin" },
    dialogueDirectness: { mode: "set", value: 50, speakerId: "actor-1", listenerId: "actor-2" },
    characterProminence: { mode: "set", value: 75, characterId: "actor-2" },
  };
  assert.doesNotThrow(() => contracts.validateControlObjects(valid, ids));
  for (const controls of [
    { suspicionTarget: { ...valid.suspicionTarget, subjectId: "foreign-book-actor" } },
    { suspicionTarget: { ...valid.suspicionTarget, matter: " " } },
    { dialogueDirectness: { ...valid.dialogueDirectness, listenerId: undefined } },
    { characterProminence: { ...valid.characterProminence, characterId: "foreign-book-actor" } },
  ]) assert.throws(() => contracts.validateControlObjects(controls, ids), (e) => e.statusCode === 400);
  assert.doesNotThrow(() => contracts.validateControlObjects({ characterProminence: { mode: "disabled" } }, ids));
});

test("revision detects A to B to A edits and planning/order changes even when prose matches", () => {
  const a = { content: "same prose", expectation: "ask about letter", order: 4, updatedAt: new Date("2026-09-13T00:00:00.000Z") };
  const old = contracts.chapterRevision(a);
  assert.equal(old, contracts.chapterRevision({ ...a }));
  for (const changed of [
    { ...a, content: "changed prose" },
    { ...a, updatedAt: new Date("2026-09-13T00:00:01.000Z") },
    { ...a, expectation: "refuse cooperation" },
    { ...a, order: 5 },
  ]) assert.notEqual(old, contracts.chapterRevision(changed));
  assert.equal(contracts.digest("same prose"), contracts.digest(a.content));
});

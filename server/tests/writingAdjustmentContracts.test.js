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

test("resolved expression instructions contain the dialogue matter but no numeric bands", () => {
  for (const rawValue of [0, 25, 50, 75, 100]) {
    const text = narrative.buildChapterNarrativeControlBlock({ pace: { rawValue }, dialogueDirectness: { rawValue, speaker: "甲", listener: "乙", matter: "归还两份收据" } });
    assert.match(text, /归还两份收据/);
    assert.doesNotMatch(text, /原值|有效档|L[1-5]|\/ 100|档位/);
  }
});

test("legacy focus compilation preserves story numbers and only converts the owned control fragment", () => {
  const result = narrative.compileLegacyArrangementFocus("第三日，两联。表达关注权重：85/100（编排期望，不代表已写正文的实际戏份）。");
  assert.match(result, /第三日，两联/);
  assert.match(result, /优先从指定人物/);
  assert.doesNotMatch(result, /85\/100/);
});

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
    const fragments = ["充分展开", "多留一点观察", "均衡交替", "压缩重复说明", "更集中的段落"];
    assert.ok(block.includes(fragments[band - 1]), `value ${rawValue}`);
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

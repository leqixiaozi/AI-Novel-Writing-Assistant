const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareDraft } = require("../scripts/seed-book-arrangement-demo.cjs");
const chapters = Array.from({ length: 8 }, (_, order) => ({ id: `chapter-${order}`, order }));
const people = [{ id: "a" }, { id: "b" }, { id: "c" }];
const empty = () => ({ baseRevision: "base", chapterEdits: [], characterSpans: [], pinnedTracks: [] });
test("demo preparation is idempotent and retains user edits including zero", () => {
  const original = empty();
  original.chapterEdits.push({ chapterId: "chapter-0", controls: { tension: { mode: "set", value: 0 } }, note: "用户备注", locked: false });
  original.characterSpans.push({ id: "user-span", characterId: "a", chapterIds: ["chapter-1"], mode: "must", note: "user", weight: 0 });
  const before = structuredClone(original), first = prepareDraft(original, chapters, people, "novel");
  assert.deepEqual(original, before);
  assert.deepEqual(first.chapterEdits[0], before.chapterEdits[0]);
  assert.deepEqual(first.characterSpans[0], before.characterSpans[0]);
  assert.deepEqual(prepareDraft(first, chapters, people, "novel"), first);
  const bindings = first.characterSpans.flatMap(span => span.chapterIds.map(id => `${span.characterId}:${id}`));
  assert.equal(new Set(bindings).size, bindings.length);
});
test("demo covers explicit zero, inherited and disabled controls with stable person references", () => {
  const draft = prepareDraft(empty(), chapters, people, "novel");
  assert.equal(draft.chapterEdits[0].controls.pace.value, 0);
  assert.equal(draft.chapterEdits[5].controls.tension.mode, "disabled");
  assert.equal(draft.chapterEdits[6].controls.pace.mode, "inherit");
  assert.equal(draft.chapterEdits[7].locked, true);
  assert.equal(draft.chapterEdits[0].controls.characterProminence.characterId, "a");
  assert.equal(draft.pinnedTracks.length, 5);
});

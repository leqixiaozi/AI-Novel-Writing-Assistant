import test from "node:test";
import assert from "node:assert/strict";
import { buildArrangementPlanInput, chapterRange, chapterWindow, controlValue, curveSegments, draftDirty, editableChapterIds, updateChapterEdit } from "./arrangementState.ts";

const chapters = Array.from({ length: 23 }, (_, index) => ({ id: `id-${index}`, order: index * 3 + 2, title: `章${index}` }));
const emptyDraft = () => ({ baseRevision: "base1", chapterEdits: [], characterSpans: [], pinnedTracks: [] });

test("the same stable chapter window supports gaps, 23 chapter tail, short and empty books", () => {
  assert.deepEqual(chapterWindow(chapters, 20).chapters.map(chapter => chapter.id), chapters.slice(13).map(chapter => chapter.id));
  assert.equal(chapterWindow(chapters, 20).start, 13);
  assert.equal(chapterWindow(chapters, -5).start, 0);
  assert.deepEqual(chapterWindow(chapters.slice(0, 3), 10).chapters, chapters.slice(0, 3));
  assert.deepEqual(chapterWindow([], 20), { start: 0, chapters: [] });
});

test("range selection uses stable IDs and reading order, including reversed endpoints", () => {
  assert.deepEqual(chapterRange(chapters, "id-5", "id-3"), ["id-3", "id-4", "id-5"]);
  assert.deepEqual(chapterRange(chapters, "missing", "id-3"), []);
});

test("a missing or disabled control makes a curve gap while explicit zero remains a point", () => {
  assert.equal(controlValue({}, "tension"), null);
  assert.equal(controlValue({ tension: { mode: "disabled", value: 0 } }, "tension"), null);
  assert.equal(controlValue({ tension: { mode: "set", value: 0 } }, "tension"), 0);
  assert.deepEqual(curveSegments([0, null, 50, 100, null]), [[{ x: 50, y: 50 }], [{ x: 250, y: 30 }, { x: 350, y: 10 }]]);
});

test("editing a different selected chapter does not lose the first chapter draft or change the saved baseline", () => {
  const saved = emptyDraft();
  const first = updateChapterEdit(saved, "id-0", { note: "第一行\n第二行" });
  const second = updateChapterEdit(first, "id-3", { controls: { pace: { mode: "set", value: 0 } } });
  assert.equal(second.chapterEdits.find(edit => edit.chapterId === "id-0").note, "第一行\n第二行");
  assert.deepEqual(saved.chapterEdits, []);
  assert.equal(draftDirty(second, saved), true);
  assert.equal(draftDirty(second, structuredClone(second)), false);
});

test("locks remove only authorized candidate chapters without changing source data", () => {
  const draft = updateChapterEdit(emptyDraft(), "id-4", { locked: true });
  assert.deepEqual(editableChapterIds(draft, ["id-3", "id-4", "id-3"]), ["id-3"]);
  assert.equal(draft.chapterEdits[0].locked, true);
  assert.deepEqual(editableChapterIds(updateChapterEdit(draft, "id-4", { locked: false }), ["id-4"]), ["id-4"]);
});

test("AI planning receives saved zero controls and stable character rules with no handwritten prompt", () => {
  let draft = updateChapterEdit(emptyDraft(), "id-3", { note: "保留证词", controls: { tension: { mode: "set", value: 0 }, characterProminence: { mode: "set", value: 75, characterId: "p2" } } });
  draft = updateChapterEdit(draft, "id-4", { note: "结盟不能改变", locked: true });
  draft.characterSpans = [{ id: "span2", characterId: "p2", chapterIds: ["id-3", "id-4"], mode: "forbidden", weight: 0, note: "仅保留线索" }];
  const workspace = { chapters, characters: [{ id: "p1", name: "林舟" }, { id: "p2", name: "林舟" }], appliedSettings: { "id-3": { settings: { preserve: ["过期旧要求必须出场"] } } } };
  const result = buildArrangementPlanInput(workspace, draft, ["id-3", "id-4", "other-book-id"], "", ["保留结盟"]);
  assert.deepEqual(result.chapterIds, ["id-3"]);
  assert.match(result.instruction, /依据已保存编排要求/u);
  assert.match(result.instruction, /"tension":\{"mode":"set","value":0\}/u);
  assert.match(result.instruction, /"characterId":"p2"/u);
  assert.match(result.instruction, /"mode":"forbidden","weight":0/u);
  assert.doesNotMatch(result.instruction, /过期旧要求/u);
  assert.ok(result.preserve.includes("保留结盟"));
  assert.match(result.preserve.at(-1), /锁定章节/u);
});

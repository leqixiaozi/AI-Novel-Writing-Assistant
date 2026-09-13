import test from "node:test";
import assert from "node:assert/strict";
import { moveCharacterSpan, splitCharacterSpan, mergeCharacterSpans, characterSpanError } from "./characterEditing.ts";
const chapters = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, order: i * 3 }));
const span = { id: "s1", characterId: "p1", chapterIds: ["c1", "c3"], mode: "must", weight: 0, note: "保留" };
const draft = { baseRevision: "r1", chapterEdits: [], characterSpans: [span], pinnedTracks: [] };
test("moving gapped participation preserves gaps, identity, rules and explicit zero", () => {
 const moved = moveCharacterSpan(draft, "s1", chapters, "move", 2).characterSpans[0];
 assert.deepEqual(moved.chapterIds, ["c3", "c5"]); assert.equal(moved.weight, 0); assert.equal(moved.note, "保留");
 assert.deepEqual(moveCharacterSpan(draft, "s1", chapters, "resize-end", 2).characterSpans[0].chapterIds, ["c1", "c3", "c4", "c5"]);
});
test("dragging cannot cross locks or overlap another span of the same stable person", () => {
 const occupied = { ...draft, characterSpans: [span, { ...span, id: "s2", chapterIds: ["c5"] }] };
 assert.equal(moveCharacterSpan(occupied, "s1", chapters, "move", 2), occupied);
 const locked = { ...draft, chapterEdits: [{ chapterId: "c5", locked: true, controls: {}, note: "" }] };
 assert.equal(moveCharacterSpan(locked, "s1", chapters, "move", 2), locked);
 assert.equal(characterSpanError(draft, { ...span, id: "copy" })?.includes("重叠"), true);
});
test("split preserves exact chapter membership and cannot create empty leading pieces", () => {
 const pieces = splitCharacterSpan(span, chapters, "c3", "s2");
 assert.deepEqual(pieces.map(item => item.chapterIds), [["c1"], ["c3"]]);
 assert.equal(pieces[1].weight, 0); assert.equal(splitCharacterSpan(span, chapters, "c1", "s2"), null);
});
test("merge rejects distinct people, contradictory notes and gaps without silently replacing rules", () => {
 const first = { ...span, chapterIds: ["c1", "c2"] }; const second = { ...span, id: "s2", chapterIds: ["c3"] };
 assert.deepEqual(mergeCharacterSpans(first, second, chapters).chapterIds, ["c1", "c2", "c3"]);
 assert.equal(mergeCharacterSpans(first, { ...second, characterId: "p2" }, chapters), null);
 assert.equal(mergeCharacterSpans(first, { ...second, note: "不同" }, chapters), null);
 assert.equal(mergeCharacterSpans(first, { ...second, chapterIds: ["c4"] }, chapters), null);
});

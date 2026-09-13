import assert from "node:assert/strict";
import test from "node:test";
import { changeVolumeRange, clipVolumeSegments, makeVolumeEdit, snapChapterDelta, undoVolumeRange } from "./volumeState.ts";

const chapters = Array.from({ length: 12 }, (_, index) => ({ id: `c${index + 1}`, order: index * 3 + 4 }));
const volume = { id: "v1", title: "第一卷", chapterIds: ["c3", "c4", "c5"], summary: "原概要", climax: "原高潮" };

test("chapter snapping is symmetric and accounts for automatic window scrolling", () => {
  assert.equal(snapChapterDelta(100, 149, 100), 0);
  assert.equal(snapChapterDelta(100, 150, 100), 1);
  assert.equal(snapChapterDelta(100, 50, 100), -1);
  assert.equal(snapChapterDelta(100, 149, 100, 2), 2);
  assert.equal(snapChapterDelta(100, 150, 0), 0);
});

test("moving a volume clamps at book edges while retaining its chapter count and ID gaps", () => {
  assert.deepEqual(changeVolumeRange(chapters, volume.chapterIds, "move", -100), ["c1", "c2", "c3"]);
  assert.deepEqual(changeVolumeRange(chapters, volume.chapterIds, "move", 100), ["c10", "c11", "c12"]);
  assert.deepEqual(changeVolumeRange(chapters, ["c3", "c5"], "move", 2), ["c5", "c7"]);
  assert.deepEqual(changeVolumeRange(chapters.slice(0, 2), ["c1", "c2"], "move", 8), ["c1", "c2"]);
});

test("resizing changes only the chosen boundary and never produces an empty or foreign range", () => {
  assert.deepEqual(changeVolumeRange(chapters, volume.chapterIds, "resize-start", -2), ["c1", "c2", "c3", "c4", "c5"]);
  assert.deepEqual(changeVolumeRange(chapters, volume.chapterIds, "resize-start", 10), ["c5"]);
  assert.deepEqual(changeVolumeRange(chapters, volume.chapterIds, "resize-end", -20), ["c3"]);
  assert.deepEqual(changeVolumeRange(chapters, volume.chapterIds, "resize-end", 2), ["c3", "c4", "c5", "c6", "c7"]);
  assert.deepEqual(changeVolumeRange([], [], "resize-end", 1), []);
  assert.deepEqual(changeVolumeRange(chapters, ["foreign-id"], "move", 1), []);
});

test("clipped segments distinguish window boundaries from true resize handles and preserve holes", () => {
  assert.deepEqual(clipVolumeSegments(chapters.slice(3, 7), ["c2", "c3", "c4", "c6", "c7", "c8"], chapters), [
    { chapterIds: ["c4"], start: 0, end: 0, canResizeStart: false, canResizeEnd: false },
    { chapterIds: ["c6", "c7"], start: 2, end: 3, canResizeStart: false, canResizeEnd: false },
  ]);
  assert.deepEqual(clipVolumeSegments(chapters, volume.chapterIds, chapters), [{ chapterIds: ["c3", "c4", "c5"], start: 2, end: 4, canResizeStart: true, canResizeEnd: true }]);
});

test("range edits use a draft's details and never overwrite original volume data", () => {
  const original = structuredClone(volume);
  const draft = { volumeId: "v1", title: "作者改名", summary: "草稿概要", mainPromise: "承诺", protagonistChange: "成长", climax: "草稿高潮", nextVolumeHook: "悬念", chapterIds: ["c5", "c6"] };
  assert.deepEqual(makeVolumeEdit(volume, draft), draft);
  assert.equal(makeVolumeEdit(volume).mainPromise, "");
  assert.equal(makeVolumeEdit(volume).summary, "原概要");
  assert.deepEqual(volume, original);
});

test("undo restores only the matching last range and preserves later detail edits", () => {
  const edited = { ...makeVolumeEdit(volume), chapterIds: ["c4", "c5", "c6"], title: "之后改的标题" };
  const undo = { volumeId: "v1", before: ["c3", "c4", "c5"], after: edited.chapterIds };
  assert.deepEqual(undoVolumeRange(edited, undo), { ...edited, chapterIds: undo.before });
  assert.equal(undoVolumeRange({ ...edited, chapterIds: ["c7"] }, undo), null);
  assert.equal(undoVolumeRange({ ...edited, volumeId: "other" }, undo), null);
});

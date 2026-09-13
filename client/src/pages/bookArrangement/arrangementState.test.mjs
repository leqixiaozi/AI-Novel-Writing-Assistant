import test from "node:test";
import assert from "node:assert/strict";
import { auditDimension, auditHeatState, buildArrangementPlanInput, chapterOverviewSegments, chapterRange, chapterWindow, characterPresenceEntries, characterTrackColor, controlValue, curveSegments, draftDirty, editableChapterIds, packChapterLanes, resizeChapterWindow, updateChapterEdit } from "./arrangementState.ts";

const chapters = Array.from({ length: 23 }, (_, index) => ({ id: `id-${index}`, order: index * 3 + 2, title: `章${index}` }));
const emptyDraft = () => ({ baseRevision: "base1", chapterEdits: [], characterSpans: [], pinnedTracks: [] });

test("the same stable chapter window supports gaps, 23 chapter tail, short and empty books", () => {
  assert.deepEqual(chapterWindow(chapters, 20).chapters.map(chapter => chapter.id), chapters.slice(15).map(chapter => chapter.id));
  assert.equal(chapterWindow(chapters, 20).start, 15);
  assert.equal(chapterWindow(chapters, -5).start, 0);
  assert.deepEqual(chapterWindow(chapters.slice(0, 3), 10).chapters, chapters.slice(0, 3));
  assert.deepEqual(chapterWindow([], 20), { start: 0, chapters: [] });
});

test("chapter window edges resize directly while keeping a useful four to sixteen chapter range", () => {
  assert.deepEqual(resizeChapterWindow(23, 5, 8, "end", 15), { start: 5, size: 10 });
  assert.deepEqual(resizeChapterWindow(23, 5, 10, "start", 2), { start: 2, size: 13 });
  assert.deepEqual(resizeChapterWindow(23, 5, 8, "end", 6), { start: 5, size: 4 });
  assert.deepEqual(resizeChapterWindow(23, 5, 8, "end", 23), { start: 5, size: 16 });
  assert.deepEqual(resizeChapterWindow(3, 0, 3, "end", 1), { start: 0, size: 3 });
});

test("volume overview splits gaps and keeps positions on the complete chapter axis", () => {
  const segments = chapterOverviewSegments(chapters.slice(0, 10), [
    { id: "v1", title: "第一卷", chapterIds: ["id-0", "id-1", "id-2", "id-5"] },
    { id: "v2", title: "第二卷", chapterIds: ["id-6", "id-7"] },
  ]);
  assert.deepEqual(segments.map(item => [item.id, item.start, item.end]), [["v1:0", 0, 2], ["v1:5", 5, 5], ["v2:6", 6, 7]]);
});

test("packed lanes preserve chapter gaps, clip to the visible window and never overlap", () => {
  const entries = [{ id: "p2", chapterIds: ["id-3", "id-4", "id-6"] }, { id: "p1", chapterIds: ["id-2", "id-3", "id-4", "id-5"] }, { id: "outside", chapterIds: ["id-12"] }];
  const visible = chapters.slice(3, 8);
  const packed = packChapterLanes(visible, entries);
  assert.equal(packed.length, 3);
  assert.deepEqual(packed.filter(segment => segment.source.id === "p2").map(segment => segment.chapterIds), [["id-3", "id-4"], ["id-6"]]);
  assert.deepEqual(packed.find(segment => segment.source.id === "p1").chapterIds, ["id-3", "id-4", "id-5"]);
  for (const left of packed) for (const right of packed) if (left !== right && left.lane === right.lane) assert.ok(left.end < right.start || right.end < left.start);
  assert.deepEqual(packChapterLanes(visible, entries.toReversed()), packed);
  assert.equal(packed.find(segment => segment.chapterIds[0] === "id-6").lane, 0);
});

test("only recorded events create evidence blocks; same-name characters retain distinct IDs and plans retain zero", () => {
  const workspace = { chapters, characters: [{ id: "p1", name: "林舟" }, { id: "p2", name: "林舟" }, { id: "absent", name: "未出场" }], events: [
    { id: "event1", chapterId: "id-1", status: "occurred", participantIds: ["p1", "p1"] },
    { id: "event2", chapterId: "id-2", status: "resolved", participantIds: ["p1"] },
    { id: "event3", chapterId: "id-3", status: "planned", participantIds: ["p2"] },
    { id: "event4", chapterId: "id-4", status: "cancelled", participantIds: ["p2"] },
  ] };
  const draft = emptyDraft();
  draft.characterSpans.push({ id: "span", characterId: "p2", chapterIds: ["id-2", "id-3"], mode: "forbidden", weight: 0, note: "暂不出场" });
  const entries = characterPresenceEntries(workspace, draft);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.find(entry => entry.kind === "record").chapterIds, ["id-1", "id-2"]);
  assert.equal(entries.find(entry => entry.kind === "record").characterId, "p1");
  assert.equal(entries.find(entry => entry.kind === "plan").characterId, "p2");
  assert.equal(entries.find(entry => entry.kind === "plan").weight, 0);
  assert.equal(packChapterLanes(chapters.slice(10), entries).length, 0);
  assert.equal(characterTrackColor("p2"), characterTrackColor("p2"));
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

test("audit checks map to stable reader-facing dimensions before rendering", () => {
  assert.equal(auditDimension({ title: "ending_hook_soft", category: "mode_fit" }), "pace");
  assert.equal(auditDimension({ title: "mode_exposition_voice", category: "mode_fit" }), "ai");
  assert.equal(auditDimension({ title: "logic_chain_density", category: "mode_fit" }), "logic");
  assert.equal(auditDimension({ title: "角色目标漂移", category: "character_goal_shift" }), "character");
  assert.equal(auditDimension({ title: "未知检查", category: "unknown" }), "logic");
});

test("audit heat state keeps handled results distinct and uses the highest open severity", () => {
  assert.equal(auditHeatState([]), "empty");
  assert.equal(auditHeatState([{ status: "resolved", severity: "critical" }, { status: "ignored", severity: "high" }]), "handled");
  assert.equal(auditHeatState([{ status: "resolved", severity: "critical" }, { status: "open", severity: "medium" }]), "medium");
  assert.equal(auditHeatState([{ status: "open", severity: "low" }, { status: "open", severity: "critical" }]), "critical");
  assert.equal(auditHeatState([{ status: "open", severity: "unexpected" }]), "medium");
});

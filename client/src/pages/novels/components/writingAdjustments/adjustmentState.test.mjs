import test from "node:test";
import assert from "node:assert/strict";
import { AdjustmentOperationKeys, explicitDirectorTaskId, preserveLines, recoverLinePreview, recoverPlanPreview, recoverVersionReview, reviewMatchesDraft, validateWritingControls } from "./adjustmentState.ts";

test("disabled and inherited controls need no value; an explicit zero remains valid", () => {
  assert.equal(validateWritingControls({ pace: { mode: "set", value: 0 }, tension: { mode: "disabled" }, suspicionTarget: { mode: "inherit" } }), null);
  assert.match(validateWritingControls({ pace: { mode: "set", value: NaN } }), /强度/u);
  assert.match(validateWritingControls({ tension: { mode: "set", value: 101 } }), /强度/u);
});

test("only an explicit directorTaskId activates director handoff commands", () => {
  assert.equal(explicitDirectorTaskId("?directorTaskId=director1&workspaceTaskId=workspace1"), "director1");
  assert.equal(explicitDirectorTaskId("?workspaceTaskId=workspace1&taskId=legacy1"), undefined);
  assert.equal(explicitDirectorTaskId("?directorTaskId=%20%20&workspaceTaskId=workspace1"), undefined);
  assert.equal(explicitDirectorTaskId(""), undefined);
});

test("character-directed adjustments require stable objects and an explicit matter", () => {
  assert.match(validateWritingControls({ suspicionTarget: { mode: "set", value: 75, subjectId: "c1", objectId: "c2" } }), /事项/u);
  assert.equal(validateWritingControls({ suspicionTarget: { mode: "set", value: 75, subjectId: "c1", objectId: "c2", matter: "信件来源" } }), null);
  assert.match(validateWritingControls({ dialogueDirectness: { mode: "set", value: 0, speakerId: "c1", matter: "信件来源" } }), /双方/u);
  assert.match(validateWritingControls({ characterProminence: { mode: "set", value: 50 } }), /人物/u);
});

test("manual edits and changed version IDs invalidate review even if previously passed", () => {
  const version = { id: "draft1", contentHash: "hash1", content: "原稿" };
  const review = { editVersionId: "draft1", contentHash: "hash1" };
  assert.equal(reviewMatchesDraft(review, version, "原稿"), true);
  assert.equal(reviewMatchesDraft(review, version, "人工修改"), false);
  assert.equal(reviewMatchesDraft(review, { ...version, id: "draft2" }, "原稿"), false);
  assert.equal(reviewMatchesDraft({ ...review, contentHash: "hash0" }, version, "原稿"), false);
  assert.equal(reviewMatchesDraft(null, version, "原稿"), false);
});

test("uncertain requests retain retry identity; confirmed or changed requests get a fresh key", () => {
  const keys = new AdjustmentOperationKeys();
  const first = keys.get("accept", { editVersionId: "a" });
  assert.equal(keys.get("accept", { editVersionId: "a" }).key, first.key);
  assert.notEqual(keys.get("accept", { editVersionId: "b" }).key, first.key);
  assert.notEqual(keys.get("draft", { editVersionId: "a" }).key, first.key);
  keys.complete(first.identity);
  assert.notEqual(keys.get("accept", { editVersionId: "a" }).key, first.key);
});

test("preserved story requirements retain per-line meaning and internal punctuation", () => {
  assert.deepEqual(preserveLines(" 保留第八章结盟。\r\n\r\n信未找回；角色还不知道身份。 \n"), ["保留第八章结盟。", "信未找回；角色还不知道身份。"]);
});

test("refresh recovery never attaches another draft's review or a changed content hash", () => {
  const version = { id: "draft1", contentHash: "a" };
  const reviews = [{ id: "wrong-draft", editVersionId: "draft2", contentHash: "a" }, { id: "old-content", editVersionId: "draft1", contentHash: "b" }, { id: "matching", editVersionId: "draft1", contentHash: "a" }];
  assert.equal(recoverVersionReview(version, reviews)?.id, "matching");
  assert.equal(recoverVersionReview(version, reviews.slice(0, 2)), null);
  assert.equal(recoverVersionReview(version), null);
});

test("planning recovery preserves the frozen selection and excludes previously adopted candidates", () => {
  const version = { id: "plan1", kind: "plan", metadata: { changes: [{ chapterId: "c4", before: "old", after: "new" }], impact: ["复核第五章"], baseRevisions: { c4: "rev1" } } };
  assert.deepEqual(recoverPlanPreview(version), { id: "plan1", changes: version.metadata.changes, impact: version.metadata.impact, baseRevisions: { c4: "rev1" } });
  assert.equal(recoverPlanPreview({ ...version, metadata: { ...version.metadata, acceptedChapterIds: ["c4"] } }), null);
  assert.equal(recoverPlanPreview({ ...version, metadata: { ...version.metadata, baseRevisions: {} } }), null);
  assert.equal(recoverPlanPreview({ ...version, kind: "draft" }), null);
});

test("event recovery retains the original event identity and refuses malformed or adopted data", () => {
  const before = { id: "event1", title: "碰面", summary: "桥上碰面", participantIds: ["c1"] };
  const after = { ...before, summary: "码头碰面", participantIds: ["c1", "c2"] };
  const version = { id: "line1", kind: "line", content: JSON.stringify({ before, after }), metadata: { eventId: "event1", affectedChapterIds: ["chapter1"], impact: ["复核原文"] } };
  assert.equal(recoverLinePreview(version)?.after.summary, "码头碰面");
  assert.equal(recoverLinePreview({ ...version, content: "broken" }), null);
  assert.equal(recoverLinePreview({ ...version, content: JSON.stringify({ before, after: { ...after, id: "other-event" } }) }), null);
  assert.equal(recoverLinePreview({ ...version, metadata: { ...version.metadata, accepted: true } }), null);
});

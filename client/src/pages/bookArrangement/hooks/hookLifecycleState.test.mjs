import test from "node:test";
import assert from "node:assert/strict";
import { canMoveHookNode, hookLifecycleRisks, lifecycleEntries } from "./hookLifecycleState.ts";

const chapters = Array.from({ length: 8 }, (_, index) => ({ id: `c${index + 1}`, order: index + 1, title: `第${index + 1}章`, hasContent: index < 3 }));
const clue = { id: "TimelineHook:h1", sourceId: "h1", sourceEntity: "TimelineHook", title: "旧钥匙", summary: "门锁线索", status: "open", basis: "record", setupChapterId: "c1", payoffChapterId: null, expectedPayoffChapterOrder: 8 };

function workspace(hookNodes = []) {
  return { chapters, clues: [clue], hookNodes, events: [{ id: "e1", title: "发现钥匙" }], scenes: [{ id: "s1", title: "搜查", chapterId: "c4" }] };
}

test("lifecycle projects canonical setup and expected payoff around persisted nodes", () => {
  const entries = lifecycleEntries(workspace([{ id: "n1", sourceId: "n1", hookId: "h1", chapterId: "c4", stage: "reinforce", nodeBasis: "plan", note: "门锁再次出现", evidenceStatus: "planned", relatedEventId: "e1", relatedSceneId: "s1" }]), clue);
  assert.deepEqual(entries.map(entry => [entry.chapterId, entry.stage, entry.basis]), [["c1", "setup", "record"], ["c4", "reinforce", "plan"], ["c8", "payoff", "plan"]]);
});

test("risk diagnostics distinguish unverified prose records and plans left in written chapters", () => {
  const risks = hookLifecycleRisks(workspace([
    { id: "n1", sourceId: "n1", hookId: "h1", chapterId: "c2", stage: "reinforce", nodeBasis: "record", note: "提到钥匙", evidenceStatus: "mismatch", relatedEventId: null, relatedSceneId: null },
    { id: "n2", sourceId: "n2", hookId: "h1", chapterId: "c3", stage: "misdirect", nodeBasis: "plan", note: "错误钥匙", evidenceStatus: "planned", relatedEventId: null, relatedSceneId: null },
  ]), clue);
  assert.ok(risks.some(risk => risk.includes("证据未在正文精确定位")));
  assert.ok(risks.some(risk => risk.includes("已有正文")));
});

test("only future plan nodes can move on the axis", () => {
  const plan = { id: "n1", sourceId: "n1", chapterId: "c4", stage: "reinforce", basis: "plan", note: "", evidenceStatus: "planned", relatedEventId: null, relatedSceneId: null, editable: true };
  assert.equal(canMoveHookNode(workspace(), plan, "c5"), true);
  assert.equal(canMoveHookNode(workspace(), plan, "c2"), false);
  assert.equal(canMoveHookNode(workspace(), { ...plan, basis: "record" }, "c5"), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const zod = require("zod");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");

// Real route parsing and HTTP; the explicit facade double cannot import a DB or model.
const errors = loadRuntimeSource("../../../middleware/errorHandler.ts", { zod });
const contracts = loadRuntimeSource("../../../modules/novel/adjustments/domain/contracts.ts", {
  "node:crypto": require("node:crypto"), zod,
  "../../../../middleware/errorHandler": errors,
});

async function harness(t, overrides = {}) {
  const calls = [];
  const operations = [];
  const service = {};
  const names = ["workspace", "settings", "saveSettings", "preset", "resolve", "generate", "saveDraft", "review", "handleIssue", "accept", "receipt", "retry", "beginManual", "completeManual", "evidence", "previewPlan", "acceptPlan", "lines", "previewLine", "acceptLine", "createDecision", "updateDecision"];
  for (const name of names) service[name] = async (...args) => {
    calls.push({ name, args });
    return overrides[name] ? overrides[name](...args) : { called: name, args };
  };
  service.store = {
    once: async (novelId, operation, key, body, run) => { operations.push({ novelId, operation, key, body }); return run(); },
    chapter: async (novelId, chapterId) => ({ id: chapterId, novelId }),
    chapters: async (_novelId, scope) => (scope.chapterIds ?? [scope.chapterId]).map(id => ({ id })),
    mapVersion: row => row,
    db: {
      chapterEditVersion: { findMany: async input => { calls.push({ name: "versions", args: [input] }); return [{ id: "version1", kind: "draft" }]; } },
      manualEditSession: { findFirst: async ({ where }) => where.id === "session1" ? { id: "session1", scopeJson: JSON.stringify(["c1"]) } : null },
    },
  };
  const { registerWritingAdjustmentRoutes } = loadRuntimeSource("../../../modules/novel/adjustments/http/writingAdjustmentRoutes.ts", {
    zod, "..": { adjustmentService: service },
    "../../../../middleware/errorHandler": errors,
    "../domain/contracts": contracts,
  });
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerWritingAdjustmentRoutes(router);
  router.post("/:id/creative-decisions", (req, res) => res.json({ success: true, data: { legacy: true, body: req.body } }));
  router.put("/:id/creative-decisions/:decisionId", (req, res) => res.json({ success: true, data: { legacy: true, body: req.body } }));
  router.put("/:id/chapters/:chapterId", (req, res) => res.json({ success: true, data: { legacySave: true, body: req.body } }));
  app.use("/novels", router);
  app.use(errors.errorHandler);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (method, suffix, body, key = "logical-click-1") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/novels/n1${suffix}`, {
      method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { calls, operations, request };
}

test("opening optional workspace and reading settings/versions/lines never enters a mutation", async t => {
  const h = await harness(t);
  for (const url of ["/writing-adjustments/workspace", "/writing-settings", "/writing-settings?chapterId=c1", "/chapters/c1/editor/versions?requirementsId=req1", "/chapters/c1/acceptances/receipt1", "/writing-adjustments/lines?chapterId=c1&characterId=person1"]) {
    const response = await h.request("GET", url, undefined, null);
    assert.equal(response.status, 200, url);
    assert.equal(response.body.success, true);
  }
  assert.equal(h.operations.length, 0);
  assert.deepEqual(h.calls.map(call => call.name), ["workspace", "settings", "settings", "versions", "receipt", "lines"]);
  assert.deepEqual(h.calls[2].args, ["n1", "c1"]);
  assert.deepEqual(h.calls[5].args, ["n1", { chapterId: "c1", characterId: "person1" }]);
  assert.deepEqual(h.calls[3].args[0].where, { novelId: "n1", chapterId: "c1", requirementsId: "req1" });
});

test("legacy decisions and legacy chapter saves retain unversioned requests without idempotency", async t => {
  const h = await harness(t);
  for (const [method, path, body] of [
    ["POST", "/creative-decisions", { category: "style", content: "旧要求" }],
    ["PUT", "/creative-decisions/d1", { content: "旧更新" }],
    ["PUT", "/chapters/c1", { content: "作者原编辑器正文" }],
  ]) {
    const response = await h.request(method, path, body, null);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.body, body);
    assert.ok(response.body.data.legacy || response.body.data.legacySave);
  }
  assert.equal(h.operations.length, 0);
  assert.equal(h.calls.length, 0);
});

test("new mutation route groups dispatch parsed scopes, stable IDs and zero values", async t => {
  const h = await harness(t);
  const settings = { enabled: true, controls: { pace: { mode: "set", value: 0 } }, preserve: ["保留结盟"] };
  const adjustment = { chapterIds: ["c1", "c2"], preserve: ["保留结盟"], status: "active" };
  const cases = [
    ["PUT", "/writing-settings", { scope: { kind: "novel" }, expectedRevision: 0, settings }, "saveSettings", args => assert.equal(args[1].settings.controls.pace.value, 0)],
    ["POST", "/writing-presets", { name: "紧凑", settings }, "preset"],
    ["PUT", "/writing-presets/preset1", { name: "紧凑", settings, expectedRevision: 1 }, "preset", args => assert.equal(args[2], "preset1")],
    ["POST", "/writing-requirements/resolve", { scope: { kind: "chapter", chapterId: "c1" }, overrides: { tension: { mode: "set", value: 0 } }, preserve: [] }, "resolve", args => assert.equal(args[1].overrides.tension.value, 0)],
    ["POST", "/writing-requirements/resolve", { scope: { kind: "scene", chapterId: "c1", sceneId: "scene1" }, overrides: { pace: { mode: "set", value: 75 } }, preserve: [] }, "resolve", args => assert.deepEqual(args[1].scope, { kind: "scene", chapterId: "c1", sceneId: "scene1" })],
    ["POST", "/chapters/c1/editor/adjustment-preview", { requirementsId: "req1", operation: "write" }, "generate", args => assert.deepEqual(args.slice(0, 2), ["n1", "c1"])],
    ["POST", "/chapters/c1/editor/adjustment-preview", { requirementsId: "req1", operation: "rewrite", content: "草稿", instruction: "更简洁" }, "generate"],
    ["POST", "/chapters/c1/editor/drafts", { content: "草稿", expectedRevision: "rev1", requirementsId: "req1", sourceCandidateId: "candidate1" }, "saveDraft"],
    ["POST", "/chapters/c1/editor/adjustment-review", { editVersionId: "draft1" }, "review"],
    ["POST", "/chapters/c1/editor/adjustment-issues/issue1", { reviewId: "review1", action: "accepted_deviation", reason: "刻意保留悬念" }, "handleIssue", args => assert.equal(args[2], "issue1")],
    ["POST", "/chapters/c1/acceptances", { editVersionId: "draft1", expectedRevision: "rev1", reviewId: "review1", acceptedDeviationIds: ["issue1"] }, "accept", args => assert.equal(args[3], "logical-click-1")],
    ["POST", "/chapters/c1/acceptances/receipt1/sync/retry", {}, "retry", args => assert.equal(args[2], "receipt1")],
    ["POST", "/chapters/c1/runtime/manual-edit", { action: "begin", scope: { kind: "chapters", chapterIds: ["c1", "c2"] } }, "beginManual", args => assert.deepEqual(args[1], { chapterIds: ["c1", "c2"] })],
    ["POST", "/chapters/c1/runtime/manual-edit", { action: "complete", manualEditSessionId: "session1" }, "completeManual", args => assert.equal(args[1], "session1")],
    ["POST", "/evidence/query", { chapterId: "c1", characterIds: ["person1"], sourceKinds: ["candidate"], query: "信件在哪里", sourceRefs: ["source1"], limit: 10 }, "evidence"],
    ["POST", "/writing-adjustments/plans/preview", { chapterIds: ["c1", "c2"], instruction: "加强对立", preserve: ["保留结盟"] }, "previewPlan"],
    ["POST", "/writing-adjustments/plans/plan1/accept", { acceptedChapterIds: ["c1"] }, "acceptPlan", args => assert.equal(args[1], "plan1")],
    ["POST", "/writing-adjustments/lines/event1/preview", { expectedRevision: "rev1", patch: { storyDayIndex: 0, storyTimeLabel: null, participantIds: [] } }, "previewLine", args => assert.equal(args[2].patch.storyDayIndex, 0)],
    ["POST", "/writing-adjustments/lines/line1/accept", {}, "acceptLine", args => assert.equal(args[1], "line1")],
    ["POST", "/creative-decisions", { category: "manual_adjustment", content: "加强对立", adjustment }, "createDecision"],
    ["PUT", "/creative-decisions/d1", { adjustment: { status: "disabled", expectedRevision: "rev1" } }, "updateDecision", args => assert.equal(args[1], "d1")],
  ];
  for (const [method, path, body, expectedMethod, verify] of cases) await t.test(`${method} ${path} → ${expectedMethod}`, async () => {
    const response = await h.request(method, path, body);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.called, expectedMethod);
    const call = h.calls.at(-1);
    assert.equal(call.name, expectedMethod);
    assert.equal(call.args[0], "n1");
    verify?.(call.args);
    assert.equal(h.operations.at(-1).key, "logical-click-1");
    assert.ok(h.operations.at(-1).operation.endsWith(`/n1${path}`));
  });
});

test("only opted-in mutations require a bounded idempotency header", async t => {
  const h = await harness(t);
  for (const key of [null, "x".repeat(201)]) {
    const response = await h.request("POST", "/writing-adjustments/plans/preview", { chapterIds: ["c1"], instruction: "调整", preserve: [] }, key);
    assert.equal(response.status, 400);
    assert.match(response.body.error, /操作标识/u);
  }
  const optedIn = await h.request("POST", "/creative-decisions", { content: "要求", adjustment: { chapterIds: ["c1"], preserve: [], status: "active" } }, null);
  assert.equal(optedIn.status, 400);
  assert.equal(h.calls.length, 0);
  assert.equal(h.operations.length, 0);
});

test("invalid scope, duplicate ranges, excessive controls and stale-contract omissions fail before facade writes", async t => {
  const h = await harness(t);
  const invalid = [
    ["/writing-requirements/resolve", { scope: { kind: "everything" }, overrides: {} }],
    ["/writing-requirements/resolve", { scope: { kind: "chapters", chapterIds: [] }, overrides: {} }],
    ["/writing-requirements/resolve", { scope: { kind: "selection", chapterId: "c1", selection: { from: -1, to: 2, text: "x" } } }],
    ["/writing-requirements/resolve", { scope: { kind: "chapter", chapterId: "c1" }, overrides: { pace: { mode: "set", value: 101 } } }],
    ["/writing-requirements/resolve", { scope: { kind: "chapter", chapterId: "c1" }, overrides: { madeUpControl: { mode: "set", value: 50 } } }],
    ["/writing-adjustments/plans/preview", { chapterIds: ["c1", "c1"], instruction: "调整", preserve: [] }],
    ["/writing-adjustments/plans/plan1/accept", { acceptedChapterIds: [] }],
    ["/chapters/c1/editor/adjustment-preview", { requirementsId: "req1", operation: "erase" }],
    ["/chapters/c1/editor/drafts", { content: "draft" }],
    ["/chapters/c1/acceptances", { editVersionId: "draft1" }],
    ["/chapters/c1/editor/adjustment-issues/issue1", { reviewId: "review1", action: "dismissed", reason: " " }],
    ["/writing-adjustments/lines/event1/preview", { expectedRevision: "rev1", patch: { chapterId: "c9" } }],
    ["/writing-adjustments/lines/event1/preview", { expectedRevision: "rev1", patch: { storyDayIndex: 1.5 } }],
    ["/evidence/query", { sourceKinds: ["secret"], limit: 0 }],
  ];
  for (const [url, body] of invalid) {
    const response = await h.request("POST", url, body);
    assert.equal(response.status, 400, `${url}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.success, false);
  }
  assert.equal(h.calls.length, 0);
});

test("cross-book line errors and stale revision codes retain their HTTP meaning", async t => {
  const h = await harness(t, {
    previewLine: async () => { throw new errors.AppError("事件不属于当前作品。", 404); },
    acceptPlan: async () => { throw new errors.AppError("规划已变化。", 409, { errorCode: "REQUIREMENTS_STALE" }); },
    generate: async () => { throw new errors.AppError("当前范围由作者接管。", 409, { errorCode: "MANUAL_EDIT_REQUIRED" }); },
  });
  const wrongBook = await h.request("POST", "/writing-adjustments/lines/foreign-event/preview", { expectedRevision: "rev1", patch: { title: "other" } });
  assert.equal(wrongBook.status, 404);
  assert.equal(wrongBook.body.error, "事件不属于当前作品。");
  const stale = await h.request("POST", "/writing-adjustments/plans/plan1/accept", { acceptedChapterIds: ["c1"] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.errorCode, "REQUIREMENTS_STALE");
  const blocked = await h.request("POST", "/chapters/c1/editor/adjustment-preview", { requirementsId: "req1", operation: "write" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.errorCode, "MANUAL_EDIT_REQUIRED");
});

test("manual handoff refuses a range or session unrelated to the current chapter", async t => {
  const h = await harness(t);
  for (const body of [{ action: "begin", scope: { kind: "chapters", chapterIds: ["c2"] } }, { action: "complete" }, { action: "complete", manualEditSessionId: "foreign-session" }]) {
    const response = await h.request("POST", "/chapters/c1/runtime/manual-edit", body);
    assert.equal(response.status, 400);
  }
  assert.equal(h.calls.length, 0);
});

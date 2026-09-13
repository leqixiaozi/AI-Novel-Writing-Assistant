const test = require("node:test");
const assert = require("node:assert/strict");
const { AsyncLocalStorage } = require("node:async_hooks");
const { loadRuntimeSource } = require("./sourceHarness.cjs");

function runtimeHarness() {
  const reads = [];
  const runtime = loadRuntimeSource("adjustments/WritingAdjustmentRuntime.ts", {
    "node:async_hooks": { AsyncLocalStorage },
    "../../../../modules/novel/adjustments": {
      getRequirementsForRuntime: async (...args) => { reads.push(args); return { promptText: `frozen:${args[2]}` }; },
    },
  });
  return { ...runtime, reads };
}

test("optional writing runtime: absent adjustment does not resolve or inject requirements", async () => {
  const h = runtimeHarness();
  assert.equal(await h.resolveRuntimeWritingAdjustment("n", "c", {}), undefined);
  assert.equal(h.withWritingAdjustmentText(undefined, () => h.currentWritingAdjustmentText()), undefined);
  assert.equal(h.reads.length, 0);
});

test("optional writing runtime: each original run freezes its requirements once", async () => {
  const h = runtimeHarness();
  const value = await h.resolveRuntimeWritingAdjustment("n", "c", { adjustment: { contractVersion: 2, requirementsId: "r1", outputMode: "original" } });
  await h.withWritingAdjustmentText(value, async () => {
    await Promise.resolve();
    assert.equal(h.currentWritingAdjustmentText(), "frozen:r1");
  });
  assert.deepEqual(h.reads, [["n", "c", "r1"]]);
  assert.equal(h.currentWritingAdjustmentText(), undefined);
});

test("optional writing runtime: concurrent novel tasks cannot borrow each other's requirements", async () => {
  const h = runtimeHarness();
  const values = await Promise.all(["a", "b"].map((value) => h.withWritingAdjustmentText(value, async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return h.currentWritingAdjustmentText();
  })));
  assert.deepEqual(values, ["a", "b"]);
});

test("optional writing runtime: candidate must not accidentally enter original automatic adoption", async () => {
  const h = runtimeHarness();
  await assert.rejects(h.resolveRuntimeWritingAdjustment("n", "c", { adjustment: { contractVersion: 2, requirementsId: "r1", outputMode: "candidate" } }), /候选试写/);
  assert.equal(h.reads.length, 0);
});

const { z } = require("zod");
class Message { constructor(content) { this.content = content; } }
const prompts = loadRuntimeSource("../../../prompting/prompts/novel/writingAdjustment.prompts.ts", {
  "@langchain/core/messages": { HumanMessage: Message, SystemMessage: Message }, "zod": { z },
});
const promptInput = {
  content: "林舟问起寄信人。", requirementsText: "保留已知事实。", contextText: "规划与历史分开。",
  evidence: [{ id: "e1", chapterId: "c2", quote: "信已落入河中。" }],
  chapters: [{ chapterId: "c3", order: 3, outline: "询问寄信人" }],
};

test("adjustment review rejects invented evidence and stale text anchors", () => {
  const valid = { summary: "需查证", issues: [], checkedEvidenceIds: ["e1"], missingEvidence: [] };
  assert.equal(prompts.writingAdjustmentReviewPrompt.postValidate(valid, promptInput), valid);
  assert.throws(() => prompts.writingAdjustmentReviewPrompt.postValidate({ ...valid, checkedEvidenceIds: ["invented"] }, promptInput), /未提供/);
  assert.throws(() => prompts.writingAdjustmentReviewPrompt.postValidate({ ...valid, issues: [{ id: "q1", kind: "fact", severity: "error", quote: "不存在的句子", evidenceIds: ["e1"], message: "错误", suggestion: "修改" }] }, promptInput), /未匹配/);
});

test("adjustment planning rejects unauthorized chapter writes and duplicate targets", () => {
  const valid = { summary: "调整规划", changes: [{ chapterId: "c3", outline: "询问未果", reason: "保留悬念" }], preserved: ["信已丢失"], affectedChapterIds: ["c3"] };
  assert.equal(prompts.writingAdjustmentPlanPrompt.postValidate(valid, promptInput), valid);
  assert.throws(() => prompts.writingAdjustmentPlanPrompt.postValidate({ ...valid, changes: [{ ...valid.changes[0], chapterId: "c8" }] }, promptInput), /授权/);
  assert.throws(() => prompts.writingAdjustmentPlanPrompt.postValidate({ ...valid, changes: [valid.changes[0], valid.changes[0]] }, promptInput), /多个/);
});

test("adjustment review and planning structured schemas reject malformed AI results", () => {
  assert.equal(prompts.writingAdjustmentReviewSchema.safeParse({ summary: "通过" }).success, false);
  assert.equal(prompts.writingAdjustmentPlanSchema.safeParse({ summary: "完成", changes: "已写入" }).success, false);
  assert.equal(prompts.writingAdjustmentQuerySchema.safeParse({ query: "谁丢了信", characterIds: [], chapterIds: [], beforeChapterOrder: 0, reason: "查证" }).success, false);
});

test("runtime request contract preserves omitted adjustment and validates explicit contract", () => {
  const { chapterRuntimeRequestSchema } = loadRuntimeSource("chapterRuntimeSchema.ts", {
    zod: { z }, "../../../llm/providerSchema": { llmProviderSchema: z.enum(["deepseek"]) },
  });
  assert.deepEqual(chapterRuntimeRequestSchema.parse({ model: "legacy" }), { model: "legacy" });
  assert.equal(chapterRuntimeRequestSchema.safeParse({ adjustment: { contractVersion: 1, requirementsId: "r", outputMode: "original" } }).success, false);
  assert.equal(chapterRuntimeRequestSchema.safeParse({ adjustment: { contractVersion: 2, requirementsId: "", outputMode: "original" } }).success, false);
  assert.equal(chapterRuntimeRequestSchema.safeParse({ adjustment: { contractVersion: 2, requirementsId: "r", outputMode: "candidate" } }).success, true);
});

function lifecycleHarness(blocked) {
  const calls = [];
  const tx = { chapter: {
    findUnique: async () => ({ novelId: "n" }),
    update: async ({ data }) => { calls.push({ write: data }); return {}; },
  } };
  const { ChapterLifecycleService } = loadRuntimeSource("lifecycle/ChapterLifecycleService.ts", {
    "../../../../db/prisma": { prisma: { $transaction: async (run) => run(tx) } },
    "../../../../db/sqliteRetry": { withSqliteRetry: async (run) => run() },
    "../../chapterLifecycleState": { mergeChapterPatchForGenerationStateBump: (data, generationState) => ({ ...data, generationState }) },
    "../chapterEmptyContentError": { assertChapterContentNotEmpty: (value) => value },
    "../../../../modules/novel/adjustments": { assertAdjustmentWrite: async (novelId, chapterId, actualTx) => {
      assert.equal(actualTx, tx);
      calls.push({ guard: [novelId, chapterId] });
      if (blocked) throw new Error("manual barrier");
    } },
  });
  return { service: new ChapterLifecycleService(), calls };
}

test("lifecycle writes use the same transaction after checking manual ownership", async () => {
  const h = lifecycleHarness(false);
  const result = await h.service.saveWorkingContent({ novelId: "n", chapterId: "c", content: "original draft", generationState: "drafted" });
  assert.equal(result, "original draft");
  assert.deepEqual(h.calls, [{ guard: ["n", "c"] }, { write: { content: "original draft", generationState: "drafted", chapterStatus: "generating" } }]);
});

test("manual barrier prevents both late prose and status writes", async () => {
  const h = lifecycleHarness(true);
  await assert.rejects(h.service.saveWorkingContent({ novelId: "n", chapterId: "c", content: "late draft", generationState: "drafted" }), /manual barrier/);
  await assert.rejects(h.service.markChapterStatus("c", "generating"), /manual barrier/);
  await assert.rejects(h.service.markGenerationState("c", "approved"), /manual barrier/);
  assert.equal(h.calls.some(call => call.write), false);
});

test("semantic evidence selection cannot return invented source ids", () => {
  const result = prompts.writingAdjustmentEvidencePrompt.postValidate({ selectedEvidenceIds: ["e1", "e1"], missingEvidence: [] }, promptInput);
  assert.deepEqual(result.selectedEvidenceIds, ["e1"]);
  assert.throws(() => prompts.writingAdjustmentEvidencePrompt.postValidate({ selectedEvidenceIds: ["fictional"], missingEvidence: [] }, promptInput), /未提供/);
});

function sideEffectHarness(syncWritingAdjustment) {
  const { NovelSideEffectJobHandlers } = loadRuntimeSource("../../../events/sideEffects/NovelSideEffectJobHandlers.ts", {
    zod: { z },
    "../../services/novel/application/sharedNovelServices": {},
    "../../services/novel/dynamics/CharacterDynamicsService": {},
    "../../services/payoff/PayoffLedgerSyncService": {},
    "../../db/prisma": { prisma: {} },
    "./NovelSideEffectJobTypes": { NOVEL_SIDE_EFFECT_PAYLOAD_VERSION: 1 },
  });
  return new NovelSideEffectJobHandlers({ syncWritingAdjustment });
}

test("durable adjustment synchronization passes the frozen permit to the existing worker", async () => {
  const calls = [];
  const payload = { novelId: "n", chapterId: "c", acceptanceId: "a", contentHash: "hash", epochs: { c: 2 }, manualSessionId: "m" };
  const worker = sideEffectHarness(async (value) => calls.push(value));
  await worker.execute({ novelId: "n", jobType: "writing.adjustmentSync", payloadVersion: 1, payloadJson: JSON.stringify(payload) });
  assert.deepEqual(calls, [payload]);
  await assert.rejects(worker.execute({ novelId: "different", jobType: "writing.adjustmentSync", payloadVersion: 1, payloadJson: JSON.stringify(payload) }), /归属/);
  await assert.rejects(worker.execute({ novelId: "n", jobType: "writing.adjustmentSync", payloadVersion: 1, payloadJson: JSON.stringify({ ...payload, epochs: {} }) }), /写入许可/);
  assert.equal(calls.length, 1);
});

test("durable adjustment synchronization failure remains retryable by the worker", async () => {
  const worker = sideEffectHarness(async () => { throw new Error("index unavailable"); });
  const payload = { novelId: "n", chapterId: "c", acceptanceId: "a", contentHash: "hash", epochs: { c: 2 } };
  await assert.rejects(worker.execute({ novelId: "n", jobType: "writing.adjustmentSync", payloadVersion: 1, payloadJson: JSON.stringify(payload) }), /index unavailable/);
});

function coordinatorHarness() {
  const events = [], storage = new AsyncLocalStorage();
  const runtime = runtimeHarness();
  const imports = Object.fromEntries([
    "../../../db/prisma", "../../audit/AuditService", "../../planner/PlannerService", "../chapterWritingGraph",
    "./ChapterArtifactSyncService", "./GenerationContextAssembler", "./ChapterAcceptanceAssessmentService",
    "./ChapterRuntimeReadinessService", "./repair/ChapterRepairStreamRuntime", "./ChapterQualityGateService",
    "./ChapterContentFinalizationService", "./ChapterStreamGenerationOrchestrator", "./ChapterPipelineRuntimeAdapter",
    "./ChapterTimelineFinalizationService", "./lifecycle", "./ChapterRuntimeDefaultDeps", "../production/preparation",
  ].map(id => [id, {}]));
  imports["@langchain/core/messages"] = { AIMessageChunk: Message };
  imports["./chapterRuntimeSchema"] = { chapterRuntimeRequestSchema: { parse: value => value } };
  imports["./adjustments/WritingAdjustmentRuntime"] = runtime;
  imports["../../../modules/novel/adjustments"] = {
    captureAdjustmentFence: async () => { events.push("capture"); return { c: 4 }; },
    runWithCapturedAdjustmentFence: (fence, run) => storage.run(fence, run),
    adjustmentService: { generate: async () => { events.push("candidate"); return [{ content: "candidate text" }]; } },
  };
  imports["./adjustments/ChapterAdjustmentExecution"] = loadRuntimeSource("adjustments/ChapterAdjustmentExecution.ts", {
    "@langchain/core/messages": imports["@langchain/core/messages"],
    "../../../../modules/novel/adjustments": imports["../../../modules/novel/adjustments"],
    "../chapterRuntimeSchema": imports["./chapterRuntimeSchema"],
    "./WritingAdjustmentRuntime": runtime,
  });
  const { ChapterRuntimeCoordinator } = loadRuntimeSource("ChapterRuntimeCoordinator.ts", imports);
  const coordinator = Object.create(ChapterRuntimeCoordinator.prototype);
  coordinator.streamOrchestrator = { createChapterStream: async (...args) => {
    events.push({ create: args[2], permit: storage.getStore(), text: runtime.currentWritingAdjustmentText() });
    return {
      stream: (async function* () { events.push({ iteration: storage.getStore() }); yield new Message("legacy text"); })(),
      onDone: async (content) => { events.push({ done: storage.getStore(), text: runtime.currentWritingAdjustmentText() }); return { fullContent: content }; },
    };
  } };
  coordinator.pipelineAdapter = { runPipelineChapter: async () => { events.push({ pipeline: runtime.currentWritingAdjustmentText() }); return { pass: true }; } };
  return { coordinator, events };
}

test("coordinator preserves old options and binds delayed streaming callbacks to their original permit", async () => {
  const { coordinator, events } = coordinatorHarness();
  const options = { model: "legacy-model" };
  const result = await coordinator.createChapterStream("n", "c", options);
  let content = "";
  for await (const chunk of result.stream) content += chunk.content;
  assert.deepEqual(await result.onDone(content, {}), { fullContent: "legacy text" });
  assert.equal(events[1].create, options);
  assert.deepEqual(events, ["capture", { create: options, permit: { c: 4 }, text: undefined }, { iteration: { c: 4 } }, { done: { c: 4 }, text: undefined }]);
});

test("coordinator candidate output never starts the original write or finalization flow", async () => {
  const { coordinator, events } = coordinatorHarness();
  const result = await coordinator.createChapterStream("n", "c", { adjustment: { contractVersion: 2, requirementsId: "r", outputMode: "candidate" } });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk.content);
  assert.deepEqual(chunks, ["candidate text"]);
  assert.deepEqual(await result.onDone("tampered client text", {}), { fullContent: "candidate text" });
  assert.deepEqual(events, ["candidate"]);
});

test("coordinator original output keeps the pipeline and supplies frozen author requirements", async () => {
  const { coordinator, events } = coordinatorHarness();
  assert.deepEqual(await coordinator.runPipelineChapter("n", "c", { adjustment: { contractVersion: 2, requirementsId: "r", outputMode: "original" } }), { pass: true });
  assert.deepEqual(events, ["capture", { pipeline: "frozen:r" }]);
});

function artifactStageHarness() {
  let state = { writes: [], completed: [] }, deltaCalls = 0;
  const db = {
    chapter: { findFirst: async () => ({ order: 1, title: "chapter", content: "text" }) },
    character: { findMany: async () => [] },
    characterTimeline: { findMany: async () => [] },
    consistencyFact: { findMany: async () => [] },
    $transaction: async run => {
      const next = structuredClone(state);
      const tx = {
        chapter: db.chapter,
        chapterSummary: { upsert: async () => next.writes.push("summary") },
        consistencyFact: { deleteMany: async () => next.writes.push("facts"), createMany: async () => {} },
        characterTimeline: { deleteMany: async () => next.writes.push("timeline"), createMany: async () => {} },
        mark: stage => next.completed.push(stage),
      };
      const result = await run(tx);
      state = next;
      return result;
    },
  };
  const { ChapterArtifactSyncService } = loadRuntimeSource("ChapterArtifactSyncService.ts", {
    "../../../modules/novel/adjustments": { assertAdjustmentWrite: async () => {} },
    "../../../db/prisma": { prisma: db },
    "../../../db/sqliteRetry": { withSqliteRetry: async run => run() },
    "../../rag": { ragServices: { ragIndexService: { enqueueUpsert: async () => {} } } },
    "../novelP0Utils": { briefSummary: () => "summary", extractFacts: () => [] },
    "./ChapterArtifactBackgroundSyncService": { chapterArtifactBackgroundSyncService: { runChapterSyncNow: async () => ({ status: ++deltaCalls === 1 ? "failed" : "completed", contentHash: "text", completedArtifacts: [] }) } },
    "./ChapterArtifactDeltaService": { buildContentHash: value => value },
    "./artifactSync/ChapterArtifactSyncResult": { ChapterArtifactContentVersionError: class extends Error {}, mergeChapterArtifactSyncResults: (_hash, local, delta) => ({ ...delta, completedArtifacts: local.completedArtifacts }) },
    "./lifecycle": { chapterLifecycleService: {} },
  });
  return { service: new ChapterArtifactSyncService(), get state() { return state; } };
}

test("optional outbox retry resumes after durable local artifact stages", async () => {
  const h = artifactStageHarness();
  const callback = async (stage, tx) => tx.mark(stage);
  const first = await h.service.syncChapterArtifacts("n", "c", "text", { artifactSyncMode: "strict", onLocalStageCompleted: callback });
  assert.equal(first.status, "failed");
  assert.deepEqual(h.state.completed, ["legacy_summary_and_facts", "character_timeline"]);
  const second = await h.service.syncChapterArtifacts("n", "c", "text", { artifactSyncMode: "strict", completedLocalStages: h.state.completed, onLocalStageCompleted: callback });
  assert.equal(second.status, "completed");
  assert.deepEqual(h.state.writes, ["summary", "facts", "timeline"]);
});

test("stage marker failure rolls back the same transaction as local artifacts", async () => {
  const h = artifactStageHarness();
  await assert.rejects(h.service.syncChapterArtifacts("n", "c", "text", {
    artifactSyncMode: "strict", onLocalStageCompleted: async () => { throw new Error("marker persistence failed"); },
  }), /marker persistence failed/);
  assert.deepEqual(h.state, { writes: [], completed: [] });
});

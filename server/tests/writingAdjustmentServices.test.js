const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");

const serverRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(serverRoot, "src");
const moduleRoot = "modules/novel/adjustments/";
let schemaDdl;

// Source imports are explicit so production Prisma and model-provider modules
// cannot be loaded. Persistence below uses the real Prisma SQLite adapter.
function loadServices(db, ai, syncImplementation) {
  const load = (name, imports) => loadRuntimeSource(path.join(sourceRoot, name), imports);
  const errors = load("middleware/errorHandler.ts", { zod: require("zod") });
  const contracts = load(`${moduleRoot}domain/contracts.ts`, { "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors });
  const common = { "node:crypto": require("node:crypto"), "../../../../middleware/errorHandler": errors, "../domain/contracts": contracts };
  const operations = load(`${moduleRoot}infrastructure/OperationLease.ts`, { ...common, "node:async_hooks": require("node:async_hooks") });
  const fence = load(`${moduleRoot}infrastructure/fence.ts`, { "node:async_hooks": require("node:async_hooks"), "../../../../db/prisma": { prisma: db }, "../domain/contracts": contracts });
  const storage = load(`${moduleRoot}infrastructure/AdjustmentStore.ts`, { ...common, "../../../../db/prisma": { prisma: db }, "./OperationLease": operations });
  common["../infrastructure/AdjustmentStore"] = storage;
  const settingsModule = load(`${moduleRoot}application/WritingSettingsService.ts`, {
    ...common, "../../../../prompting/prompts/novel/chapterNarrativeControls": load("prompting/prompts/novel/chapterNarrativeControls.ts", {}),
  });
  common["./WritingSettingsService"] = settingsModule;
  const prompts = Object.fromEntries(["Generate", "Review", "Plan", "Query", "Evidence"].map(name => [`writingAdjustment${name}Prompt`, { id: `test.adjustment.${name}`, version: "v1" }]));
  const forbidden = () => { throw new Error("Real model invocation forbidden in storage integration test"); };
  const contentModule = load(`${moduleRoot}application/WritingContentService.ts`, {
    ...common, "../../../../prompting/core/promptRunner": { runTextPrompt: forbidden, runStructuredPrompt: forbidden },
    "../../../../prompting/prompts/novel/writingAdjustment.prompts": prompts,
  });
  const governanceModule = load(`${moduleRoot}application/WritingGovernanceService.ts`, {
    ...common, "../infrastructure/fence": fence,
    "../../../../services/novel/runtime/ChapterArtifactSyncService": {
      ChapterArtifactSyncService: class {
        async syncChapterArtifacts(...args) {
          if (!syncImplementation) throw new Error("No artifact sync substitute supplied");
          return syncImplementation(...args, db, fence);
        }
      },
    },
  });
  const planningModule = load(`${moduleRoot}application/WritingPlanningService.ts`, { ...common, "./WritingContentService": contentModule });
  const linesModule = load(`${moduleRoot}application/WritingLineService.ts`, common);
  const store = new storage.AdjustmentStore(db);
  const settings = new settingsModule.WritingSettingsService(store);
  return {
    store, settings, contracts, fence, Governance: governanceModule.WritingGovernanceService, Store: storage.AdjustmentStore,
    content: new contentModule.WritingContentService(store, settings, ai),
    governance: new governanceModule.WritingGovernanceService(store),
    planning: new planningModule.WritingPlanningService(store, settings, ai),
    lines: new linesModule.WritingLineService(store),
  };
}

async function fixture(t, overrides = {}, syncImplementation) {
  const temporaryRoot = process.platform === "win32" && fs.existsSync("D:/cache") ? "D:/cache" : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(temporaryRoot, "writing-adjustment-test-"));
  const databasePath = path.join(dir, "isolated.db");
  if (!schemaDdl) {
    schemaDdl = execFileSync(process.execPath, [path.join(serverRoot, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema", "src/prisma/schema.sqlite.prisma", "--script"], {
      cwd: serverRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DATABASE_URL: `file:${databasePath.replace(/\\/g, "/")}`, CHECKPOINT_DISABLE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const sqlite = new Database(databasePath);
  sqlite.exec(schemaDdl);
  sqlite.close();
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replace(/\\/g, "/")}` }) });
  t.after(async () => {
    await db.$disconnect();
    const relative = path.relative(path.resolve(temporaryRoot), path.resolve(dir));
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(dir).startsWith("writing-adjustment-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const calls = { generate: [], review: [], plan: [] };
  const ai = {
    generate: async input => { calls.generate.push(input); return "林舟问寄信人的身份。掌柜回避了问题。"; },
    review: async input => { calls.review.push(input); return { summary: "checked", issues: [] }; },
    plan: async input => { calls.plan.push(input); return { summary: "increase opposition", preserved: ["chapter 8 alliance"], affectedChapterIds: [], changes: input.chapters.map(c => ({ chapterId: c.chapterId, outline: `第${c.order}章加强对立`, reason: "加强已有分歧" })) }; },
    query: async () => ({ query: "", characterIds: [], chapterIds: [], beforeChapterOrder: null }),
    evidence: async () => ({ selectedEvidenceIds: [], missingEvidence: [] }),
    ...overrides,
  };
  const services = loadServices(db, ai, syncImplementation);
  const novel = await db.novel.create({ data: { title: "雾港来信" } });
  const chapters = [];
  for (const order of [2, 4, 5, 8]) chapters.push(await db.chapter.create({ data: { novelId: novel.id, order, title: `第${order}章`, expectation: order === 8 ? "两人正式结盟" : `第${order}章原规划`, content: order === 2 ? "信落水，尚未找回。" : `第${order}章已存正文` } }));
  return { db, novelId: novel.id, chapters, calls, ...services };
}
const settings = (controls, preserve = []) => ({ enabled: true, controls, preserve });
const conflict = (error) => error.statusCode === 409;

test("real SQLite: chapter overrides and zero are frozen per chapter across default changes", async t => {
  const f = await fixture(t);
  const [, fourth, fifth] = f.chapters;
  await f.settings.save(f.novelId, { scope: { kind: "novel" }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 75 }, tension: { mode: "set", value: 50 } }) });
  await f.settings.save(f.novelId, { scope: { kind: "chapter", chapterId: fourth.id }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 0 }, tension: { mode: "disabled" } }) });
  const frozen = await f.settings.resolve(f.novelId, { scope: { kind: "chapters", chapterIds: [fourth.id, fifth.id] }, overrides: { pace: { mode: "inherit" } } });
  assert.equal(frozen.chapterRequirements[fourth.id].controls.pace.value, 0);
  assert.equal(frozen.chapterRequirements[fourth.id].controls.tension.mode, "disabled");
  assert.equal(frozen.chapterRequirements[fifth.id].controls.pace.value, 75);
  const prompt = await f.settings.prompt(frozen, fourth.id);
  await f.settings.save(f.novelId, { scope: { kind: "novel" }, expectedRevision: 1, settings: settings({ pace: { mode: "set", value: 100 } }) });
  const reread = await f.settings.load(f.novelId, fourth.id, frozen.id);
  assert.equal(await f.settings.prompt(reread, fourth.id), prompt);
  assert.equal(reread.chapterRequirements[fifth.id].controls.pace.value, 75);
  await assert.rejects(f.settings.save(f.novelId, { scope: { kind: "novel" }, expectedRevision: 1, settings: settings({}) }), conflict);
});

test("real SQLite: generated candidate, hand-edited draft and review never overwrite formal prose", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const req = await f.settings.resolve(f.novelId, { scope: { kind: "chapter", chapterId: chapter.id }, overrides: { pace: { mode: "set", value: 75 } } });
  const [candidate] = await f.content.generate(f.novelId, chapter.id, { requirementsId: req.id, operation: "rewrite" });
  const draft = await f.content.saveDraft(f.novelId, chapter.id, { content: "作者手改：林舟压下怒气，明日再来。", expectedRevision: req.baseRevisions[chapter.id], sourceCandidateId: candidate.id });
  const review = await f.content.review(f.novelId, chapter.id, { editVersionId: draft.id });
  assert.equal(f.calls.review[0].content, draft.content);
  assert.equal(review.editVersionId, draft.id);
  assert.equal(review.contentHash, f.contracts.digest(draft.content));
  assert.notEqual(review.contentHash, candidate.contentHash);
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
  assert.equal(await f.db.canonicalStateVersion.count(), 0);
  assert.equal(await f.db.storyTimelineEvent.count(), 0);
  assert.equal(await f.db.writingAcceptance.count(), 0);
  assert.equal(await f.db.novelSideEffectJob.count(), 0);
});

test("real SQLite: acceptance atomically writes prose, receipt and one retry-safe sync job", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const base = f.contracts.chapterRevision(chapter);
  const draft = await f.content.saveDraft(f.novelId, chapter.id, { content: "采纳的新正文", expectedRevision: base });
  const review = await f.content.review(f.novelId, chapter.id, { editVersionId: draft.id });
  const input = { editVersionId: draft.id, expectedRevision: base, reviewId: review.id };
  const first = await f.governance.accept(f.novelId, chapter.id, input, "accept-1");
  const second = await f.governance.accept(f.novelId, chapter.id, input, "accept-1");
  assert.deepEqual(second, first);
  assert.equal(first.reviewState, "checked");
  assert.equal(first.canonicalSyncStatus, "pending");
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, draft.content);
  assert.equal(await f.db.writingAcceptance.count(), 1);
  assert.equal(await f.db.novelSideEffectJob.count(), 1);
  const job = await f.db.novelSideEffectJob.findFirst();
  assert.equal(job.jobType, "writing.adjustmentSync");
  assert.equal(JSON.parse(job.payloadJson).acceptanceId, first.id);
  assert.equal(JSON.parse(job.payloadJson).epochs[chapter.id], 1);
  await assert.rejects(f.governance.accept(f.novelId, chapter.id, input, "accept-again-different-key"), conflict);
  assert.equal(await f.db.novelSideEffectJob.count(), 1);
});

test("real SQLite: failed sync-job insert rolls back prose, guard and receipt together", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const base = f.contracts.chapterRevision(chapter);
  const draft = await f.content.saveDraft(f.novelId, chapter.id, { content: "must roll back", expectedRevision: base });
  const failingDb = f.db.$extends({ query: { novelSideEffectJob: { async create() { throw new Error("injected job insert failure"); } } } });
  const governance = new f.Governance(new f.Store(failingDb));
  await assert.rejects(governance.accept(f.novelId, chapter.id, { editVersionId: draft.id, expectedRevision: base }, "failing-accept"), /injected job insert failure/);
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
  assert.equal(await f.db.writingAcceptance.count(), 0);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
  assert.equal(await f.db.novelSideEffectJob.count(), 0);
});

test("real SQLite: review of a different draft cannot authorize the edited content", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1], base = f.contracts.chapterRevision(chapter);
  const first = await f.content.saveDraft(f.novelId, chapter.id, { content: "第一稿", expectedRevision: base });
  const review = await f.content.review(f.novelId, chapter.id, { editVersionId: first.id });
  const second = await f.content.saveDraft(f.novelId, chapter.id, { content: "人工继续修改后的第二稿", expectedRevision: base });
  await assert.rejects(f.governance.accept(f.novelId, chapter.id, { editVersionId: second.id, expectedRevision: base, reviewId: review.id }, "wrong-review"), error => error.details?.errorCode === "REVIEW_STALE");
  assert.equal(await f.db.writingAcceptance.count(), 0);
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
});

test("real SQLite: manual takeover is scoped, overlapping acquisition rolls back, old tokens stay revoked", async t => {
  const f = await fixture(t);
  const [, fourth, fifth, eighth] = f.chapters;
  const before = await f.fence.captureAdjustmentFence(f.novelId, [fourth.id, fifth.id, eighth.id]);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
  const session = await f.governance.beginManual(f.novelId, { chapterIds: [fifth.id] });
  await assert.rejects(f.governance.beginManual(f.novelId, { chapterIds: [fourth.id, fifth.id] }), conflict);
  assert.equal(await f.db.manualEditSession.count(), 1);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 1);
  await f.fence.runWithCapturedAdjustmentFence(before, () => f.db.$transaction(tx => f.fence.assertAdjustmentWrite(f.novelId, eighth.id, tx)));
  await assert.rejects(f.fence.runWithCapturedAdjustmentFence(before, () => f.db.$transaction(tx => f.fence.assertAdjustmentWrite(f.novelId, fifth.id, tx))), conflict);
  await f.governance.completeManual(f.novelId, session.id);
  assert.equal((await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: fifth.id } })).epoch, 2);
  await assert.rejects(f.fence.runWithCapturedAdjustmentFence(before, () => f.db.$transaction(tx => f.fence.assertAdjustmentWrite(f.novelId, fifth.id, tx))), conflict);
  await f.governance.completeManual(f.novelId, session.id);
  assert.equal((await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: fifth.id } })).epoch, 2);
});

test("real SQLite: planning preview is isolated and accepting chapters 4/5 preserves chapter 8 and formal prose", async t => {
  const f = await fixture(t);
  const [, fourth, fifth, eighth] = f.chapters;
  const volume = await f.db.volumePlan.create({ data: { novelId: f.novelId, sortOrder: 1, title: "卷一" } });
  const links = [];
  for (const chapter of [fourth, fifth, eighth]) links.push(await f.db.volumeChapterPlan.create({ data: { volumeId: volume.id, chapterId: chapter.id, chapterOrder: chapter.order, title: chapter.title, summary: chapter.expectation } }));
  const active = await f.db.volumePlanVersion.create({ data: { novelId: f.novelId, version: 1, status: "active", contentJson: JSON.stringify({ volumes: [{ id: volume.id, chapters: links.map(link => ({ id: link.id, chapterId: link.chapterId, summary: link.summary })) }] }) } });
  const preview = await f.planning.previewPlan(f.novelId, { chapterIds: [fourth.id, fifth.id], instruction: "加强第4—5章对立", preserve: ["第8章结盟"] });
  assert.equal((await f.db.chapter.findUnique({ where: { id: fourth.id } })).expectation, fourth.expectation);
  assert.equal((await f.db.volumePlanVersion.findUnique({ where: { id: active.id } })).contentJson, active.contentJson);
  assert.match(f.calls.plan[0].requirementsText, /第8章结盟/);
  await f.planning.acceptPlan(f.novelId, preview.id, { acceptedChapterIds: [fourth.id, fifth.id] });
  for (const original of f.chapters) {
    const row = await f.db.chapter.findUnique({ where: { id: original.id } });
    assert.equal(row.content, original.content);
    assert.equal(row.expectation, [fourth.id, fifth.id].includes(original.id) ? `第${original.order}章加强对立` : original.expectation);
  }
  const savedLinks = await f.db.volumeChapterPlan.findMany({ where: { volumeId: volume.id }, orderBy: { chapterOrder: "asc" } });
  assert.deepEqual(savedLinks.map(link => link.summary), ["第4章加强对立", "第5章加强对立", eighth.expectation]);
  const savedDocument = JSON.parse((await f.db.volumePlanVersion.findUnique({ where: { id: active.id } })).contentJson);
  assert.deepEqual(savedDocument.volumes[0].chapters.map(c => c.summary), ["第4章加强对立", "第5章加强对立", eighth.expectation]);
  await f.planning.acceptPlan(f.novelId, preview.id, { acceptedChapterIds: [fourth.id, fifth.id] });
  assert.equal(await f.db.storyTimelineEvent.count(), 0);
});

test("real SQLite: timeline edit updates one shared event without changing prose or reading order", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const event = await f.db.storyTimelineEvent.create({ data: { novelId: f.novelId, chapterId: chapter.id, chapterIndex: 4, eventOrder: 1, storyDayIndex: 3, title: "询问信源", summary: "计划询问掌柜", type: "plot", status: "planned", visibility: "author", source: "manual" } });
  const view = await f.lines.lines(f.novelId);
  const preview = await f.lines.preview(f.novelId, event.id, { expectedRevision: view.events[0].revision, patch: { storyDayIndex: 5, summary: "计划第五天询问掌柜" } });
  assert.equal((await f.db.storyTimelineEvent.findUnique({ where: { id: event.id } })).storyDayIndex, 3);
  await f.lines.accept(f.novelId, preview.id);
  assert.equal(await f.db.storyTimelineEvent.count(), 1);
  const changed = await f.db.storyTimelineEvent.findUnique({ where: { id: event.id } });
  assert.equal(changed.storyDayIndex, 5);
  assert.equal(changed.chapterIndex, 4);
  assert.equal(changed.status, "planned");
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).order, 4);
  assert.equal(await f.db.canonicalStateVersion.count(), 0);
});

test("real SQLite: source changes between acceptance validation and transaction are rejected", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1], base = f.contracts.chapterRevision(chapter);
  const draft = await f.content.saveDraft(f.novelId, chapter.id, { content: "based on the old history", expectedRevision: base });
  let changed = false;
  const racedDb = f.db.$extends({ query: { chapter: { async findFirst({ args, query }) {
    const result = await query(args);
    if (!changed) {
      changed = true;
      await f.db.storyTimelineEvent.create({ data: { novelId: f.novelId, chapterId: chapter.id, chapterIndex: 4, eventOrder: 1, title: "new author correction", summary: "the letter was destroyed", type: "plot", status: "planned", visibility: "author", source: "manual" } });
    }
    return result;
  } } } });
  const governance = new f.Governance(new f.Store(racedDb));
  await assert.rejects(governance.accept(f.novelId, chapter.id, { editVersionId: draft.id, expectedRevision: base }, "raced-accept"), conflict);
  assert.equal(await f.db.writingAcceptance.count(), 0);
  assert.equal(await f.db.novelSideEffectJob.count(), 0);
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
});

test("real SQLite: a newer acceptance invalidates older sync even inside one manual session", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const session = await f.governance.beginManual(f.novelId, { chapterIds: [chapter.id] });
  const first = await f.content.saveDraft(f.novelId, chapter.id, { content: "first accepted prose", expectedRevision: f.contracts.chapterRevision(chapter) });
  const firstReceipt = await f.governance.accept(f.novelId, chapter.id, { editVersionId: first.id, expectedRevision: first.baseRevision }, "manual-first");
  const oldJob = await f.db.novelSideEffectJob.findFirst({ where: { idempotencyKey: `writing-acceptance:${firstReceipt.id}` } });
  const oldToken = JSON.parse(oldJob.payloadJson);
  const current = await f.db.chapter.findUnique({ where: { id: chapter.id } });
  const second = await f.content.saveDraft(f.novelId, chapter.id, { content: "second accepted prose", expectedRevision: f.contracts.chapterRevision(current) });
  const secondReceipt = await f.governance.accept(f.novelId, chapter.id, { editVersionId: second.id, expectedRevision: second.baseRevision }, "manual-second");
  await assert.rejects(f.fence.runWithCapturedAdjustmentFence(oldToken.epochs, () => f.fence.runWithAuthorizedManualSession(session.id, () => f.db.$transaction(tx => f.fence.assertAdjustmentWrite(f.novelId, chapter.id, tx)))), conflict);
  assert.equal((await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: chapter.id } })).epoch, 3);
  assert.equal((await f.governance.receipt(f.novelId, chapter.id, firstReceipt.id)).canonicalSyncStatus, "superseded");
  await f.governance.synchronize(oldToken);
  await assert.rejects(f.governance.retry(f.novelId, chapter.id, firstReceipt.id), conflict);
  await assert.rejects(f.governance.completeManual(f.novelId, session.id), error => error.details?.errorCode === "SYNC_PENDING");
  // Simulate completion of only the latest sync: superseded history must not block handoff.
  await f.db.writingAcceptance.update({ where: { id: secondReceipt.id }, data: { status: "succeeded", payloadJson: JSON.stringify({ ...secondReceipt, canonicalSyncStatus: "succeeded" }) } });
  await f.governance.completeManual(f.novelId, session.id);
  assert.equal((await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: chapter.id } })).manualSessionId, null);
});

test("real SQLite: failed optional operation retries the same input once and rejects key reuse with changed input", async t => {
  const f = await fixture(t);
  let attempts = 0;
  const action = async () => { if (++attempts === 1) throw new Error("temporary model failure"); return { candidateId: "candidate-after-retry" }; };
  await assert.rejects(f.store.once(f.novelId, "preview", "stable-key", { pace: 0 }, action), /temporary model failure/);
  const result = await f.store.once(f.novelId, "preview", "stable-key", { pace: 0 }, action);
  assert.deepEqual(await f.store.once(f.novelId, "preview", "stable-key", { pace: 0 }, action), result);
  assert.equal(attempts, 2);
  await assert.rejects(f.store.once(f.novelId, "preview", "stable-key", { pace: 100 }, action), error => error.details?.errorCode === "IDEMPOTENCY_CONFLICT");
  assert.equal(await f.db.writingAdjustmentOperation.count(), 1);
});

test("real SQLite: retry preserves completed local sync stages and does not repeat their writes", async t => {
  let attempts = 0;
  const executed = [];
  const f = await fixture(t, {}, async (novelId, chapterId, _content, options, db, fence) => {
    attempts++;
    for (const stage of ["legacy_summary_and_facts", "character_timeline"]) {
      if (options.completedLocalStages?.includes(stage)) continue;
      await db.$transaction(async tx => {
        await fence.assertAdjustmentWrite(novelId, chapterId, tx);
        await tx.storyTimelineEvent.create({ data: { novelId, chapterId, chapterIndex: 4, eventOrder: executed.length + 1, title: stage, summary: "isolated artifact-stage substitute", type: "test", status: "planned", visibility: "author", source: "test" } });
        await options.onLocalStageCompleted(stage, tx);
      });
      executed.push(stage);
      if (attempts === 1) throw new Error("failed between local sync stages");
    }
    return { status: "completed" };
  });
  const chapter = f.chapters[1];
  const draft = await f.content.saveDraft(f.novelId, chapter.id, { content: "待同步的新稿", expectedRevision: f.contracts.chapterRevision(chapter) });
  const receipt = await f.governance.accept(f.novelId, chapter.id, { editVersionId: draft.id, expectedRevision: draft.baseRevision }, "partial-sync");
  const job = await f.db.novelSideEffectJob.findFirst({ where: { idempotencyKey: `writing-acceptance:${receipt.id}` } });
  const payload = JSON.parse(job.payloadJson);
  await assert.rejects(f.governance.synchronize(payload), /failed between local sync stages/);
  const failed = await f.governance.receipt(f.novelId, chapter.id, receipt.id);
  assert.equal(failed.canonicalSyncStatus, "failed");
  assert.deepEqual(failed.completedLocalStages, ["legacy_summary_and_facts"]);
  assert.equal(await f.db.storyTimelineEvent.count(), 1);
  await f.db.novelSideEffectJob.update({ where: { id: job.id }, data: { status: "failed" } });
  await f.governance.retry(f.novelId, chapter.id, receipt.id);
  await f.governance.synchronize(payload);
  await f.governance.synchronize(payload);
  assert.deepEqual(executed, ["legacy_summary_and_facts", "character_timeline"]);
  assert.equal(attempts, 2);
  assert.equal(await f.db.storyTimelineEvent.count(), 2);
  assert.equal((await f.governance.receipt(f.novelId, chapter.id, receipt.id)).canonicalSyncStatus, "succeeded");
});

test("real SQLite: live operation lease excludes another owner and an expired running operation is recoverable", async t => {
  const f = await fixture(t);
  const input = { pace: 0 };
  const requestKey = f.contracts.digest([f.novelId, "lease-test", "same-key"]);
  const row = await f.db.writingAdjustmentOperation.create({ data: { id: "orphan-operation", novelId: f.novelId, requestKey, requestHash: f.contracts.digest(input), status: "running", resultJson: null } });
  let called = 0;
  const action = async () => { called++; return { recovered: true }; };
  await assert.rejects(f.store.once(f.novelId, "lease-test", "same-key", input, action), error => error.details?.errorCode === "OPERATION_IN_PROGRESS");
  assert.equal(called, 0);
  await f.db.writingAdjustmentOperation.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 121_000) } });
  assert.deepEqual(await f.store.once(f.novelId, "lease-test", "same-key", input, action), { recovered: true });
  assert.equal(called, 1);
  assert.equal(await f.db.writingAdjustmentOperation.count(), 1);
});

test("real SQLite: heartbeat renews a long operation without allowing lease theft", async t => {
  const f = await fixture(t);
  const store = new f.Store(f.db, { leaseDurationMs: 400, renewIntervalMs: 50 });
  let release;
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const operation = store.once(f.novelId, "long-model", "heartbeat", {}, async () => { started(); await gate; return { completed: true }; });
  await running;
  try {
    const initial = await f.db.writingAdjustmentOperation.findFirst();
    await new Promise(resolve => setTimeout(resolve, 650));
    const renewed = await f.db.writingAdjustmentOperation.findFirst();
    assert.ok(renewed.updatedAt > initial.updatedAt);
    await assert.rejects(store.once(f.novelId, "long-model", "heartbeat", {}, async () => ({ stolen: true })), error => error.details?.errorCode === "OPERATION_IN_PROGRESS");
  } finally { release(); }
  assert.deepEqual(await operation, { completed: true });
});

test("real SQLite: transactional response survives a lost response with no duplicate candidate", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  let actions = 0;
  const action = async () => {
    actions++;
    await f.store.createVersion({ novelId: f.novelId, chapterId: chapter.id, kind: "candidate", content: "候选已提交", baseRevision: f.contracts.chapterRevision(chapter), operationResult: version => ({ candidates: [version], selectedId: version.id }) });
    throw new Error("response lost after business transaction committed");
  };
  const first = await f.store.once(f.novelId, "generate", "lost-response", {}, action);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.selectedId, first.candidates[0].id);
  assert.deepEqual(await f.store.once(f.novelId, "generate", "lost-response", {}, action), first);
  assert.equal(actions, 1);
  assert.equal(await f.db.chapterEditVersion.count(), 1);
  assert.equal(await f.db.directorArtifact.count(), 1);
});

test("real SQLite: expired owner cannot commit business writes or replace a newer owner's response", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  let clock = Date.now();
  const options = { now: () => clock, leaseDurationMs: 120_000, renewIntervalMs: 60_000 };
  const oldStore = new f.Store(f.db, options);
  const newStore = new f.Store(f.db, options);
  const result = await oldStore.once(f.novelId, "fenced-operation", "lease-transfer", {}, async () => {
    clock += 121_000;
    const winner = await newStore.once(f.novelId, "fenced-operation", "lease-transfer", {}, async () => f.db.$transaction(tx => newStore.recordResult(tx, { winner: "new-owner" })));
    assert.deepEqual(winner, { winner: "new-owner" });
    await assert.rejects(f.db.$transaction(async tx => {
      await tx.chapter.update({ where: { id: chapter.id }, data: { content: "late old-owner overwrite" } });
      return oldStore.recordResult(tx, { winner: "old-owner" });
    }), error => error.details?.errorCode === "OPERATION_LEASE_LOST");
    await assert.rejects(oldStore.withDeferredResult(() => f.db.$transaction(async tx => {
      await tx.chapter.update({ where: { id: chapter.id }, data: { content: "late deferred overwrite" } });
      return oldStore.recordResult(tx, { intermediate: true });
    })), error => error.details?.errorCode === "OPERATION_LEASE_LOST");
    throw new Error("old response cannot overwrite the new result");
  });
  assert.deepEqual(result, { winner: "new-owner" });
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
  assert.deepEqual(JSON.parse((await f.db.writingAdjustmentOperation.findFirst()).resultJson), { winner: "new-owner" });
});

test("real SQLite: deferred intermediate results do not finish the operation before its final durable step", async t => {
  const f = await fixture(t);
  const result = await f.store.once(f.novelId, "director-handoff", "deferred", {}, async () => {
    await f.store.withDeferredResult(() => f.db.$transaction(tx => f.store.recordResult(tx, { intermediate: true })));
    assert.equal((await f.db.writingAdjustmentOperation.findFirst()).status, "running");
    return f.db.$transaction(tx => f.store.recordResult(tx, { completed: true, continuationKey: "stable-continuation" }));
  });
  assert.deepEqual(result, { completed: true, continuationKey: "stable-continuation" });
});

test("real SQLite: pending canonical sync blocks takeover and plan/event acceptance without changing their targets", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const event = await f.db.storyTimelineEvent.create({ data: { novelId: f.novelId, chapterId: chapter.id, chapterIndex: 4, eventOrder: 1, title: "existing event", summary: "original event", type: "plot", status: "planned", visibility: "author", source: "manual" } });
  const draft = await f.content.saveDraft(f.novelId, chapter.id, { content: "accepted but pending sync", expectedRevision: f.contracts.chapterRevision(chapter) });
  await f.governance.accept(f.novelId, chapter.id, { editVersionId: draft.id, expectedRevision: draft.baseRevision }, "pending-sync-lock");
  const guardBefore = await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: chapter.id } });
  const syncPending = error => error.details?.errorCode === "SYNC_PENDING";
  await assert.rejects(f.governance.beginManual(f.novelId, { chapterIds: [chapter.id] }), syncPending);
  const plan = await f.planning.previewPlan(f.novelId, { chapterIds: [chapter.id], instruction: "change later plan", preserve: [] });
  await assert.rejects(f.planning.acceptPlan(f.novelId, plan.id, { acceptedChapterIds: [chapter.id] }), syncPending);
  const lines = await f.lines.lines(f.novelId);
  const line = await f.lines.preview(f.novelId, event.id, { expectedRevision: lines.events[0].revision, patch: { summary: "new event" } });
  await assert.rejects(f.lines.accept(f.novelId, line.id), syncPending);
  assert.equal((await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: chapter.id } })).epoch, guardBefore.epoch);
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).expectation, chapter.expectation);
  assert.equal((await f.db.storyTimelineEvent.findUnique({ where: { id: event.id } })).summary, event.summary);
  assert.equal(await f.db.manualEditSession.count(), 0);
});

test("real SQLite: once replays exact settings and candidate HTTP shapes from business transactions", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const input = { scope: { kind: "novel" }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 0 } }) };
  const saved = await f.store.once(f.novelId, "settings", "save", input, () => f.settings.save(f.novelId, input));
  assert.equal(saved.settings.controls.pace.value, 0);
  assert.deepEqual(await f.store.once(f.novelId, "settings", "save", input, () => { throw new Error("settings must replay"); }), saved);
  const req = await f.settings.resolve(f.novelId, { scope: { kind: "chapter", chapterId: chapter.id } });
  const generate = { requirementsId: req.id, operation: "rewrite" };
  const first = await f.store.once(f.novelId, "generate", "generate-once", generate, () => f.content.generate(f.novelId, chapter.id, generate));
  const second = await f.store.once(f.novelId, "generate", "generate-once", generate, () => { throw new Error("candidate must replay"); });
  assert.ok(Array.isArray(first));
  assert.deepEqual(second, first);
  assert.equal(f.calls.generate.length, 1);
  assert.equal(await f.db.chapterEditVersion.count({ where: { kind: "candidate" } }), 1);
});

test("real SQLite: planning and timeline operations replay preview DTOs rather than internal edit rows", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const event = await f.db.storyTimelineEvent.create({ data: { novelId: f.novelId, chapterId: chapter.id, chapterIndex: 4, eventOrder: 1, title: "event", summary: "source", type: "plot", status: "planned", visibility: "author", source: "manual" } });
  const planInput = { chapterIds: [chapter.id], instruction: "加强已有冲突", preserve: ["第8章结盟"] };
  const plan = await f.store.once(f.novelId, "plan-preview", "plan-key", planInput, () => f.planning.previewPlan(f.novelId, planInput));
  assert.ok(Array.isArray(plan.changes));
  assert.equal(plan.kind, undefined);
  assert.deepEqual(await f.store.once(f.novelId, "plan-preview", "plan-key", planInput, () => { throw new Error("plan must replay"); }), plan);
  const lines = await f.lines.lines(f.novelId);
  const lineInput = { expectedRevision: lines.events[0].revision, patch: { storyDayIndex: 5 } };
  const line = await f.store.once(f.novelId, "line-preview", "line-key", lineInput, () => f.lines.preview(f.novelId, event.id, lineInput));
  assert.equal(line.after.storyDayIndex, 5);
  assert.equal(line.kind, undefined);
  assert.deepEqual(await f.store.once(f.novelId, "line-preview", "line-key", lineInput, () => { throw new Error("line must replay"); }), line);
  assert.equal(f.calls.plan.length, 1);
  assert.equal(await f.db.chapterEditVersion.count({ where: { kind: "plan" } }), 1);
  assert.equal(await f.db.chapterEditVersion.count({ where: { kind: "line" } }), 1);
});

test("real SQLite: editing a scene alone invalidates frozen writing requirements without touching its parent plan", async t => {
  const f = await fixture(t);
  const chapter = f.chapters[1];
  const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: "问询计划", objective: "询问寄信人" } });
  const scene = await f.db.chapterPlanScene.create({ data: { planId: plan.id, sortOrder: 1, title: "柜台前", objective: "询问信源" } });
  const frozen = await f.settings.resolve(f.novelId, { scope: { kind: "scene", chapterId: chapter.id, sceneId: scene.id } });
  assert.equal((await f.settings.load(f.novelId, chapter.id, frozen.id)).id, frozen.id);
  await f.db.chapterPlanScene.update({ where: { id: scene.id }, data: { objective: "隐瞒问题，先试探掌柜", updatedAt: new Date(scene.updatedAt.getTime() + 1000) } });
  assert.equal((await f.db.storyPlan.findUnique({ where: { id: plan.id } })).updatedAt.toISOString(), plan.updatedAt.toISOString());
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).updatedAt.toISOString(), chapter.updatedAt.toISOString());
  await assert.rejects(f.settings.load(f.novelId, chapter.id, frozen.id), error => error.details?.errorCode === "REQUIREMENTS_STALE");
  assert.notEqual(await f.store.dependencies(f.novelId), frozen.dependencyRevision);
});

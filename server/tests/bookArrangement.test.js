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
let ddl;
function loadModules(db) {
  const load = (name, imports) => loadRuntimeSource(path.join(serverRoot, "src", name), imports);
  const base = "modules/novel/adjustments/";
  const errors = load("middleware/errorHandler.ts", { zod: require("zod") });
  const contracts = load(`${base}domain/contracts.ts`, { "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors });
  const common = { "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors, "../domain/contracts": contracts };
  const operations = load(`${base}infrastructure/OperationLease.ts`, { ...common, "node:async_hooks": require("node:async_hooks") });
  const storage = load(`${base}infrastructure/AdjustmentStore.ts`, { ...common, "../../../../db/prisma": { prisma: db }, "./OperationLease": operations });
  common["../infrastructure/AdjustmentStore"] = storage;
  const settingsModule = load(`${base}application/WritingSettingsService.ts`, { ...common, "../../../../prompting/prompts/novel/chapterNarrativeControls": load("prompting/prompts/novel/chapterNarrativeControls.ts", {}) });
  const arrangement = load(`${base}application/BookArrangementService.ts`, { ...common, "./WritingSettingsService": settingsModule, "../../../../prompting/prompts/novel/bookArrangementControls": load("prompting/prompts/novel/bookArrangementControls.ts", {}) });
  const store = new storage.AdjustmentStore(db);
  const settings = new settingsModule.WritingSettingsService(store);
  return { store, settings, service: new arrangement.BookArrangementService(store, settings), Store: storage.AdjustmentStore, Arrangement: arrangement.BookArrangementService, contracts, arrangementModule: arrangement, errors };
}
async function fixture(t) {
  const temporaryRoot = process.platform === "win32" && fs.existsSync("D:/cache") ? "D:/cache" : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(temporaryRoot, "book-arrangement-test-"));
  const databasePath = path.join(dir, "isolated.db");
  if (!ddl) ddl = execFileSync(process.execPath, [path.join(serverRoot, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema", "src/prisma/schema.sqlite.prisma", "--script"], { cwd: serverRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: `file:${databasePath.replace(/\\/g, "/")}`, CHECKPOINT_DISABLE: "1" } });
  const sqlite = new Database(databasePath); sqlite.exec(ddl); sqlite.close();
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replace(/\\/g, "/")}` }) });
  t.after(async () => {
    await db.$disconnect();
    const relative = path.relative(path.resolve(temporaryRoot), path.resolve(dir));
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(dir).startsWith("book-arrangement-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const novel = await db.novel.create({ data: { title: "雾港来信" } });
  const chapters = [];
  for (const order of [4, 5, 8]) chapters.push(await db.chapter.create({ data: { novelId: novel.id, order, title: `第${order}章`, content: `第${order}章已存正文`, expectation: order === 8 ? "两人结盟" : "询问信源" } }));
  const character = await db.character.create({ data: { novelId: novel.id, name: "林舟", role: "主角" } });
  const modules = loadModules(db);
  const payload = { baseRevision: await modules.store.dependencies(novel.id), chapterEdits: chapters.map(chapter => ({ chapterId: chapter.id, note: "", controls: {}, locked: false })), characterSpans: [], pinnedTracks: ["pace", character.id] };
  return { db, novelId: novel.id, chapters, character, payload, ...modules };
}
const settings = controls => ({ enabled: true, controls, preserve: [] });
const isConflict = error => error.statusCode === 409;
async function savedPreview(f, ids = f.chapters.map(chapter => chapter.id)) {
  const draft = await f.service.saveDraft(f.novelId, { expectedRevision: 0, payload: f.payload });
  return f.service.preview(f.novelId, { draftRevision: draft.revision, chapterIds: ids });
}

test("book arrangement: workspace reuses original records without writes or invented settings", async t => {
  const f = await fixture(t), chapter = f.chapters[0];
  const event = await f.db.storyTimelineEvent.create({ data: { novelId: f.novelId, chapterId: chapter.id, chapterIndex: 4, eventOrder: 1, storyDayIndex: 2, title: "问询", summary: "计划询问掌柜", type: "plot", status: "planned", visibility: "author", source: "manual", participantIdsJson: JSON.stringify([f.character.id]) } });
  const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: "问询", objective: "确认信源" } });
  const scene = await f.db.chapterPlanScene.create({ data: { planId: plan.id, sortOrder: 1, title: "柜台前", objective: "向掌柜提问" } });
  const oldPlan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: "旧版本", objective: "旧目标", status: "stale" } });
  await f.db.chapterPlanScene.create({ data: { planId: oldPlan.id, sortOrder: 0, title: "过期场景", objective: "不能作为当前编排" } });
  const volume = await f.db.volumePlan.create({ data: { novelId: f.novelId, sortOrder: 1, title: "第一卷" } });
  await f.db.volumeChapterPlan.create({ data: { volumeId: volume.id, chapterId: chapter.id, chapterOrder: chapter.order, title: chapter.title, summary: chapter.expectation } });
  const workspace = await f.service.workspace(f.novelId);
  assert.equal(workspace.chapters[0].revision, f.contracts.chapterRevision(chapter));
  assert.equal(workspace.events[0].id, event.id);
  assert.equal(workspace.events[0].chapterOrder, 4);
  assert.equal(workspace.events[0].storyDayIndex, 2);
  assert.equal(workspace.scenes[0].id, scene.id);
  assert.equal(workspace.scenes[0].objective, scene.objective);
  assert.equal(workspace.scenes.length, 1);
  assert.deepEqual(workspace.volumes[0].chapterIds, [chapter.id]);
  assert.deepEqual(workspace.appliedSettings, {});
  assert.deepEqual(workspace.draft.payload.chapterEdits, []);
  assert.equal(workspace.draft.revision, 0);
  assert.deepEqual(workspace.relations, []);
  assert.deepEqual(workspace.clues, []);
  assert.deepEqual(workspace.checks, []);
  assert.equal(workspace.coverUrl, null);
  assert.equal(workspace.genre, null);
  assert.equal(await f.db.writingSetting.count(), 0);
  assert.equal(await f.db.chapterEditVersion.count(), 0);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
});

test("book arrangement: read-only tracks preserve source identity and separate plans from evidence", async t => {
  const f = await fixture(t), [fourth, fifth, eighth] = f.chapters;
  const earlier = new Date("2026-01-01T00:00:00Z"), later = new Date("2026-01-02T00:00:00Z");
  const partner = await f.db.character.create({ data: { novelId: f.novelId, name: "许岚", role: "配角" } });
  const volume = await f.db.volumePlan.create({ data: { novelId: f.novelId, sortOrder: 1, title: "初遇" } });
  for (const chapter of [fourth, fifth]) await f.db.volumeChapterPlan.create({ data: { volumeId: volume.id, chapterId: chapter.id, chapterOrder: chapter.order, title: chapter.title, summary: chapter.expectation } });
  const relationData = { novelId: f.novelId, sourceCharacterId: f.character.id, targetCharacterId: partner.id, stageLabel: "互相试探", stageSummary: "尚未信任" };
  const planned = await f.db.characterRelationStage.create({ data: { ...relationData, volumeId: volume.id, sourceType: "volume_projection" } });
  const extracted = await f.db.characterRelationStage.create({ data: { ...relationData, chapterId: fourth.id, sourceType: "chapter_draft_extract", isCurrent: false } });
  const unlocated = await f.db.characterRelationStage.create({ data: { ...relationData, chapterOrder: 8, sourceType: "manual_override" } });
  const hook = await f.db.timelineHook.create({ data: { novelId: f.novelId, createdInChapterId: fourth.id, createdInChapterIndex: 4, expectedResolveByChapterIndex: 8, title: "未拆的信", description: "第八章预计揭示", status: "open", priority: "high" } });
  const orphanHook = await f.db.timelineHook.create({ data: { novelId: f.novelId, createdInChapterId: "deleted-chapter", createdInChapterIndex: 5, title: "旧位置", description: "不能按旧章序猜测新位置", status: "open", priority: "low" } });
  const oldSnapshot = await f.db.storyStateSnapshot.create({ data: { novelId: f.novelId, sourceChapterId: fourth.id, createdAt: earlier } });
  const newSnapshot = await f.db.storyStateSnapshot.create({ data: { novelId: f.novelId, sourceChapterId: fifth.id, createdAt: later } });
  const oldForeshadow = await f.db.foreshadowState.create({ data: { snapshotId: oldSnapshot.id, title: "旧快照线索", status: "open", setupChapterId: fourth.id } });
  const newForeshadow = await f.db.foreshadowState.create({ data: { snapshotId: newSnapshot.id, title: "新快照线索", status: "resolved", setupChapterId: fourth.id, payoffChapterId: fifth.id } });
  const oldReport = await f.db.auditReport.create({ data: { novelId: f.novelId, chapterId: fourth.id, auditType: "continuity", createdAt: earlier } });
  const newReport = await f.db.auditReport.create({ data: { novelId: f.novelId, chapterId: fourth.id, auditType: "continuity", createdAt: later } });
  const issueData = { auditType: "continuity", severity: "high", code: "LOCATION", description: "确认人物所在地点", evidence: "原文地点引用", fixSuggestion: "对照上一章核实" };
  const oldIssue = await f.db.auditIssue.create({ data: { ...issueData, reportId: oldReport.id } });
  const newIssue = await f.db.auditIssue.create({ data: { ...issueData, reportId: newReport.id } });
  const conflictData = { novelId: f.novelId, chapterId: fourth.id, sourceType: "audit", conflictType: "continuity", title: "地点需核对", summary: "原有问题登记" };
  const duplicate = await f.db.openConflict.create({ data: { ...conflictData, conflictKey: "audit-reference", sourceIssueId: newIssue.id } });
  const independent = await f.db.openConflict.create({ data: { ...conflictData, conflictKey: "independent", evidenceJson: "[\"原有证据\"]" } });
  const genre = await f.db.novelGenre.create({ data: { name: "悬疑" } });
  await f.db.novel.update({ where: { id: f.novelId }, data: { genreId: genre.id } });
  const imageTask = await f.db.imageGenerationTask.create({ data: { novelId: f.novelId, sceneType: "novel_cover", provider: "fixture", model: "fixture", prompt: "isolated fixture only" } });
  const assetData = { taskId: imageTask.id, novelId: f.novelId, sceneType: "novel_cover", provider: "fixture", model: "fixture" };
  await f.db.imageAsset.create({ data: { ...assetData, url: "/uploads/existing-primary-cover.png", isPrimary: true, createdAt: earlier } });
  await f.db.imageAsset.create({ data: { ...assetData, url: "/uploads/unselected-cover.png", isPrimary: false, createdAt: later } });
  const chaptersBefore = await f.db.chapter.findMany({ orderBy: { order: "asc" } });
  const dependenciesBefore = await f.store.dependencies(f.novelId);
  const workspace = await f.service.workspace(f.novelId);
  const relation = id => workspace.relations.find(item => item.sourceId === id);
  assert.deepEqual(relation(planned.id).chapterIds, [fourth.id, fifth.id]);
  assert.equal(relation(planned.id).basis, "plan");
  assert.equal(relation(planned.id).sourceEntity, "CharacterRelationStage");
  assert.deepEqual(relation(extracted.id).chapterIds, [fourth.id]);
  assert.equal(relation(extracted.id).basis, "record");
  assert.equal(relation(extracted.id).isCurrent, false);
  assert.match(relation(extracted.id).evidenceLabel, /草稿/);
  assert.deepEqual(relation(unlocated.id).chapterIds, [], "a chapter number alone must not create a stable relation reference");
  const projectedHook = workspace.clues.find(item => item.sourceId === hook.id);
  assert.deepEqual(projectedHook.chapterIds, [fourth.id]);
  assert.equal(projectedHook.expectedPayoffChapterOrder, 8);
  assert.equal(projectedHook.payoffChapterId, null);
  assert.ok(!projectedHook.chapterIds.includes(eighth.id));
  assert.deepEqual(workspace.clues.find(item => item.sourceId === orphanHook.id).chapterIds, []);
  assert.ok(!workspace.clues.some(item => item.sourceId === oldForeshadow.id));
  const projectedForeshadow = workspace.clues.find(item => item.sourceId === newForeshadow.id);
  assert.equal(projectedForeshadow.sourceSnapshotId, newSnapshot.id);
  assert.deepEqual(projectedForeshadow.chapterIds, [fourth.id, fifth.id]);
  assert.equal(projectedForeshadow.status, "resolved");
  assert.ok(!workspace.checks.some(item => item.sourceId === oldIssue.id || item.sourceId === duplicate.id));
  const projectedIssue = workspace.checks.find(item => item.sourceId === newIssue.id);
  assert.equal(projectedIssue.reportId, newReport.id);
  assert.equal(projectedIssue.evidence, issueData.evidence);
  assert.equal(projectedIssue.sourceRevision, null, "unversioned legacy audits must not prove the current draft passed");
  assert.equal(projectedIssue.status, "open");
  assert.equal(workspace.checks.find(item => item.sourceId === independent.id).sourceEntity, "OpenConflict");
  assert.equal(workspace.coverUrl, "/uploads/existing-primary-cover.png");
  assert.deepEqual(workspace.genre, { id: genre.id, name: genre.name });
  assert.deepEqual(await f.db.chapter.findMany({ orderBy: { order: "asc" } }), chaptersBefore);
  assert.equal(await f.store.dependencies(f.novelId), dependenciesBefore);
  for (const model of ["writingSetting", "chapterEditVersion", "chapterAdjustmentGuard", "writingAdjustmentOperation", "directorArtifact"])
    assert.equal(await f.db[model].count(), 0, `GET must not create ${model}`);
});

test("book arrangement: draft persistence preserves original content and rejects concurrent stale revisions", async t => {
  const f = await fixture(t);
  const original = await f.db.chapter.findMany({ orderBy: { order: "asc" } });
  f.payload.chapterEdits[0].controls = { pace: { mode: "set", value: 0 } };
  const saved = await f.service.saveDraft(f.novelId, { expectedRevision: 0, payload: f.payload });
  assert.equal(saved.revision, 1);
  assert.equal(saved.payload.chapterEdits[0].controls.pace.value, 0);
  const competing = await Promise.allSettled(["first editor", "second editor"].map(note => f.service.saveDraft(f.novelId, { expectedRevision: 1, payload: { ...f.payload, chapterEdits: [{ ...f.payload.chapterEdits[0], note }] } })));
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter(result => result.status === "rejected").length, 1);
  assert.equal((await f.service.workspace(f.novelId)).draft.revision, 2);
  assert.deepEqual(await f.db.chapter.findMany({ orderBy: { order: "asc" } }), original);
  assert.equal(await f.db.storyTimelineEvent.count(), 0);
  assert.equal(await f.db.chapterEditVersion.count(), 0);
});

test("book arrangement: all draft objects and character controls must belong to the novel", async t => {
  const f = await fixture(t);
  const foreign = await f.db.novel.create({ data: { title: "另一部作品" } });
  const foreignChapter = await f.db.chapter.create({ data: { novelId: foreign.id, title: "外部章节", order: 1 } });
  for (const payload of [
    { ...f.payload, chapterEdits: [{ chapterId: foreignChapter.id, note: "", controls: {}, locked: true }] },
    { ...f.payload, characterSpans: [{ id: "foreign-span", characterId: "not-in-this-novel", chapterIds: [f.chapters[0].id], mode: "must", weight: null, note: "" }] },
    { ...f.payload, chapterEdits: [{ ...f.payload.chapterEdits[0], controls: { characterProminence: { mode: "set", value: 0, characterId: "not-in-this-novel" } } }] },
    { ...f.payload, chapterEdits: [f.payload.chapterEdits[0], f.payload.chapterEdits[0]] },
  ]) await assert.rejects(f.service.saveDraft(f.novelId, { expectedRevision: 0, payload }), error => error.statusCode === 400);
  assert.equal(await f.db.writingSetting.count(), 0);
});

test("book arrangement: locked chapters are excluded and cannot be added back when applying", async t => {
  const f = await fixture(t);
  f.payload.chapterEdits[0].locked = true;
  const preview = await savedPreview(f, [f.chapters[0].id, f.chapters[1].id]);
  assert.deepEqual(preview.excludedChapterIds, [f.chapters[0].id]);
  assert.deepEqual(preview.chapterIds, [f.chapters[1].id]);
  await assert.rejects(f.service.preview(f.novelId, { draftRevision: 1, chapterIds: [f.chapters[0].id] }), error => error.statusCode === 400);
  await assert.rejects(f.service.apply(f.novelId, preview.id, { chapterIds: [f.chapters[0].id] }), error => error.statusCode === 400);
  const workspace = await f.service.workspace(f.novelId);
  assert.equal(workspace.previews[0].id, preview.id);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
});

test("book arrangement: application affects only the optional layer with book-arrangement-chapter-task precedence", async t => {
  const f = await fixture(t), [fourth, fifth, eighth] = f.chapters;
  const original = await f.db.chapter.findMany({ orderBy: { order: "asc" } });
  await f.settings.save(f.novelId, { scope: { kind: "novel" }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 75 }, tension: { mode: "set", value: 50 } }) });
  await f.settings.save(f.novelId, { scope: { kind: "chapter", chapterId: fourth.id }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 100 } }) });
  const beforeFrozen = await f.settings.resolve(f.novelId, { scope: { kind: "chapter", chapterId: fifth.id } });
  f.payload.chapterEdits[0].controls = { pace: { mode: "set", value: 0 }, tension: { mode: "disabled" } };
  f.payload.chapterEdits[1].controls = { pace: { mode: "set", value: 25 } };
  f.payload.chapterEdits[0].note = "保留第8章结盟";
  f.payload.characterSpans = [{ id: "lin-span", characterId: f.character.id, chapterIds: [fourth.id], mode: "indirect", weight: 0, note: "保留身份秘密" }];
  const preview = await savedPreview(f, [fourth.id, fifth.id]);
  assert.equal(preview.changes[0].after.controls.pace.value, 100);
  assert.equal(preview.changes[1].after.controls.pace.value, 25);
  const applied = await f.service.apply(f.novelId, preview.id, { chapterIds: [fourth.id, fifth.id] });
  assert.equal(applied.appliedSettings[fourth.id].settings.controls.pace.value, 0);
  assert.match(applied.appliedSettings[fourth.id].settings.preserve.join("\n"), new RegExp(f.character.id));
  assert.match(applied.appliedSettings[fourth.id].settings.preserve.join("\n"), /0\/100/);
  assert.equal((await f.settings.get(f.novelId, fourth.id)).effective.controls.tension.mode, "disabled");
  assert.equal((await f.settings.get(f.novelId, fourth.id)).sources.pace, "本章");
  assert.equal((await f.settings.get(f.novelId, fifth.id)).sources.pace, "全书编排");
  assert.equal((await f.settings.get(f.novelId, eighth.id)).effective.controls.pace.value, 75);
  const task = await f.settings.resolve(f.novelId, { scope: { kind: "chapter", chapterId: fifth.id }, overrides: { pace: { mode: "set", value: 0 } } });
  assert.equal(task.chapterRequirements[fifth.id].controls.pace.value, 0);
  assert.equal((await f.settings.load(f.novelId, fifth.id, beforeFrozen.id)).chapterRequirements[fifth.id].controls.pace.value, 75);
  assert.deepEqual(await f.db.chapter.findMany({ orderBy: { order: "asc" } }), original);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
  assert.equal(await f.db.storyTimelineEvent.count(), 0);
  assert.equal(await f.db.canonicalStateVersion.count(), 0);
  assert.deepEqual(await f.service.apply(f.novelId, preview.id, { chapterIds: [fifth.id, fourth.id] }), applied);
  await assert.rejects(f.service.apply(f.novelId, preview.id, { chapterIds: [fourth.id] }), isConflict);
});

test("book arrangement: changed draft, settings, and source versions reject outdated previews", async t => {
  const f = await fixture(t);
  const preview = await savedPreview(f);
  await f.service.saveDraft(f.novelId, { expectedRevision: 1, payload: { ...f.payload, pinnedTracks: ["tension"] } });
  await assert.rejects(f.service.apply(f.novelId, preview.id, { chapterIds: preview.chapterIds }), isConflict);
  const settingsPreview = await f.service.preview(f.novelId, { draftRevision: 2, chapterIds: [f.chapters[0].id] });
  await f.settings.save(f.novelId, { scope: { kind: "novel" }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 50 } }) });
  await assert.rejects(f.service.apply(f.novelId, settingsPreview.id, { chapterIds: settingsPreview.chapterIds }), isConflict);
  const sourcePreview = await f.service.preview(f.novelId, { draftRevision: 2, chapterIds: [f.chapters[0].id] });
  await f.db.chapter.update({ where: { id: f.chapters[0].id }, data: { expectation: "规划被另一窗口调整" } });
  await assert.rejects(f.service.apply(f.novelId, sourcePreview.id, { chapterIds: sourcePreview.chapterIds }), error => error.details?.errorCode === "REQUIREMENTS_STALE");
  assert.equal(await f.db.writingSetting.count({ where: { scopeKey: { startsWith: "arrangement:chapter:" } } }), 0);
});

test("book arrangement: second setting write failure rolls back the complete application", async t => {
  const f = await fixture(t), preview = await savedPreview(f);
  let writes = 0;
  const failing = f.db.$extends({ query: { writingSetting: { async create({ args, query }) { if (args.data.scopeKey.startsWith("arrangement:chapter:") && ++writes === 2) throw new Error("injected setting failure"); return query(args); } } } });
  const service = new f.Arrangement(new f.Store(failing));
  await assert.rejects(service.apply(f.novelId, preview.id, { chapterIds: preview.chapterIds }), /injected setting failure/);
  assert.equal(await f.db.writingSetting.count({ where: { scopeKey: { startsWith: "arrangement:chapter:" } } }), 0);
  assert.equal(JSON.parse((await f.db.chapterEditVersion.findUnique({ where: { id: preview.id } })).metadataJson).applied, undefined);
  assert.equal((await f.db.directorArtifact.findFirst({ where: { contentId: preview.id } })).status, "candidate");
});

test("book arrangement: changed takeover and unfinished sync block application", async t => {
  const f = await fixture(t), preview = await savedPreview(f), chapter = f.chapters[0];
  await f.db.chapterAdjustmentGuard.create({ data: { novelId: f.novelId, chapterId: chapter.id, epoch: 1, manualSessionId: "new-session" } });
  await assert.rejects(f.service.apply(f.novelId, preview.id, { chapterIds: [chapter.id] }), isConflict);
  const afterTakeover = await f.service.preview(f.novelId, { draftRevision: 1, chapterIds: [chapter.id] });
  await f.db.writingAcceptance.create({ data: { id: "pending-acceptance", novelId: f.novelId, chapterId: chapter.id, editVersionId: "test-draft", requestKey: "pending-key", status: "pending", payloadJson: "{}" } });
  await assert.rejects(f.service.apply(f.novelId, afterTakeover.id, { chapterIds: [chapter.id] }), error => error.details?.errorCode === "SYNC_PENDING");
  assert.equal(await f.db.writingSetting.count({ where: { scopeKey: { startsWith: "arrangement:chapter:" } } }), 0);
});

test("book arrangement: durable operation replay preserves draft/preview/apply HTTP DTOs", async t => {
  const f = await fixture(t);
  const draftInput = { expectedRevision: 0, payload: f.payload };
  const draft = await f.store.once(f.novelId, "arrangement-draft", "draft", draftInput, () => f.service.saveDraft(f.novelId, draftInput));
  assert.deepEqual(await f.store.once(f.novelId, "arrangement-draft", "draft", draftInput, () => { throw new Error("must replay saved draft"); }), draft);
  const previewInput = { draftRevision: draft.revision, chapterIds: [f.chapters[0].id] };
  const preview = await f.store.once(f.novelId, "arrangement-preview", "preview", previewInput, () => f.service.preview(f.novelId, previewInput));
  assert.ok(preview.changes);
  assert.equal(preview.kind, undefined);
  assert.deepEqual(await f.store.once(f.novelId, "arrangement-preview", "preview", previewInput, () => { throw new Error("must replay saved preview"); }), preview);
  const receipt = await f.store.once(f.novelId, "arrangement-apply", "apply", { chapterIds: preview.chapterIds }, () => f.service.apply(f.novelId, preview.id, { chapterIds: preview.chapterIds }));
  assert.equal(receipt.status, "applied");
  assert.deepEqual(await f.store.once(f.novelId, "arrangement-apply", "apply", { chapterIds: preview.chapterIds }, () => { throw new Error("must replay saved apply"); }), receipt);
  assert.equal(await f.db.chapterEditVersion.count(), 1);
  assert.equal(receipt.appliedSettings[f.chapters[0].id].revision, 1);
});

test("book arrangement: GET avoids operation creation and every write requires an idempotency key", async t => {
  const f = await fixture(t);
  const handlers = new Map();
  const service = { store: f.store, arrangementWorkspace: f.service.workspace.bind(f.service), saveArrangementDraft: f.service.saveDraft.bind(f.service), previewArrangement: f.service.preview.bind(f.service), applyArrangement: f.service.apply.bind(f.service) };
  const routes = loadRuntimeSource(path.join(serverRoot, "src/modules/novel/adjustments/http/bookArrangementRoutes.ts"), { zod: require("zod"), "..": { adjustmentService: service }, "../../../../middleware/errorHandler": f.errors, "../application/BookArrangementService": f.arrangementModule });
  routes.registerBookArrangementRoutes(Object.fromEntries(["get", "put", "post"].map(method => [method, (route, handler) => handlers.set(`${method}:${route}`, handler)])));
  const req = { params: { id: f.novelId, candidateId: "candidate" }, body: {}, path: "/test", get: () => undefined };
  let response;
  await handlers.get("get:/:id/book-arrangement")(req, { json(value) { response = value; } }, error => { throw error; });
  assert.equal(response.success, true);
  assert.equal(await f.db.writingAdjustmentOperation.count(), 0);
  for (const [key, handler] of handlers) if (!key.startsWith("get:")) {
    let caught;
    await handler(req, {}, error => { caught = error; });
    assert.equal(caught?.statusCode, 400, key);
  }
  assert.equal(await f.db.writingAdjustmentOperation.count(), 0);
});

test("book arrangement: applying an empty replacement removes previous controls and character rules", async t => {
  const f = await fixture(t), chapter = f.chapters[0];
  await f.settings.save(f.novelId, { scope: { kind: "novel" }, expectedRevision: 0, settings: settings({ pace: { mode: "set", value: 75 } }) });
  f.payload.chapterEdits[0].controls = { pace: { mode: "set", value: 0 } };
  f.payload.chapterEdits[0].note = "加强此章对立";
  f.payload.characterSpans = [{ id: "must-appear", characterId: f.character.id, chapterIds: [chapter.id], mode: "must", weight: null, note: "" }];
  const initial = await savedPreview(f, [chapter.id]);
  await f.service.apply(f.novelId, initial.id, { chapterIds: [chapter.id] });
  assert.equal((await f.settings.get(f.novelId, chapter.id)).effective.controls.pace.value, 0);
  const empty = { baseRevision: f.payload.baseRevision, chapterEdits: [], characterSpans: [], pinnedTracks: [] };
  const draft = await f.service.saveDraft(f.novelId, { expectedRevision: 1, payload: empty });
  const preview = await f.service.preview(f.novelId, { draftRevision: draft.revision, chapterIds: [chapter.id] });
  assert.equal(preview.changes[0].after.controls.pace.value, 75);
  await f.service.apply(f.novelId, preview.id, { chapterIds: [chapter.id] });
  const effective = await f.settings.get(f.novelId, chapter.id);
  assert.equal(effective.effective.controls.pace.value, 75);
  assert.deepEqual(effective.effective.preserve, []);
  assert.equal(effective.sources.pace, "本书");
  const applied = (await f.service.workspace(f.novelId)).appliedSettings[chapter.id];
  assert.equal(applied.revision, 2);
  assert.deepEqual(applied.settings, { enabled: true, controls: {}, preserve: [] });
});

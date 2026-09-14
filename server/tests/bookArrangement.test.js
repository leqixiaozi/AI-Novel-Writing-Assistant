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
  const arrangement = load(`${base}application/BookArrangementService.ts`, { ...common, "./WritingSettingsService": settingsModule, "../../../../prompting/prompts/novel/bookArrangementControls": load("prompting/prompts/novel/bookArrangementControls.ts", {}), "@ai-novel/shared/types/chapterLengthControl": require("@ai-novel/shared/types/chapterLengthControl"), "@ai-novel/shared/types/sceneExpressionTracks": require("@ai-novel/shared/types/sceneExpressionTracks") });
  const objectContracts = load(`${base}domain/arrangementObjects.ts`, { zod: require("zod"), "./contracts": contracts });
  const metadata = load("services/planner/plannerPlanMetadata.ts", { "@ai-novel/shared/types/chapterCreativeContract": require("@ai-novel/shared/types/chapterCreativeContract") });
  const persistence = load("services/planner/plannerPersistence.ts", { "node:crypto": require("node:crypto"), "../../db/prisma": { prisma: db }, "./plannerPlanMetadata": metadata, "@ai-novel/shared/types/chapterCreativeContract": require("@ai-novel/shared/types/chapterCreativeContract"), "@ai-novel/shared/types/chapterLengthControl": require("@ai-novel/shared/types/chapterLengthControl") });
  const sceneCards = load(`${base}infrastructure/ArrangementSceneCards.ts`, { "@ai-novel/shared/types/chapterLengthControl": require("@ai-novel/shared/types/chapterLengthControl") });
  const objectRepository = load(`${base}infrastructure/ArrangementObjectRepository.ts`, { "../../../../services/planner/plannerPersistence": persistence, "./ArrangementSceneCards": sceneCards });
  const objectModule = load(`${base}application/BookArrangementObjectService.ts`, { ...common, "../../../../events": { novelEventBus: { emit: async () => {} } }, "../domain/arrangementObjects": objectContracts, "../infrastructure/ArrangementObjectRepository": objectRepository, "../infrastructure/ArrangementSceneCards": sceneCards });
  const chapterScenesModule = load(`${base}application/ChapterSceneArrangementService.ts`, { ...common, "node:crypto": require("node:crypto"), "@ai-novel/shared/types/chapterLengthControl": require("@ai-novel/shared/types/chapterLengthControl"), "../../../../events": { novelEventBus: { emit: async () => {} } }, "../../../../services/planner/plannerPersistence": persistence });
  const expressionModule = load(`${base}application/SceneExpressionTrackService.ts`, { ...common, "@ai-novel/shared/types/sceneExpressionTracks": require("@ai-novel/shared/types/sceneExpressionTracks"), "../../../../services/novel/runtime/BatchContextCache": { batchContextCache: { invalidate() {} } } });
  const store = new storage.AdjustmentStore(db);
  const settings = new settingsModule.WritingSettingsService(store);
  return { store, settings, service: new arrangement.BookArrangementService(store, settings), objects: new objectModule.BookArrangementObjectService(store), chapterScenes: new chapterScenesModule.ChapterSceneArrangementService(store), expressions: new expressionModule.SceneExpressionTrackService(store), objectContracts, Store: storage.AdjustmentStore, Arrangement: arrangement.BookArrangementService, contracts, arrangementModule: arrangement, errors };
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

test("scene expression points save only registered five-level tracks on scenes owned by the novel", async t => {
  const f = await fixture(t);
  const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: f.chapters[0].id, level: "chapter", title: "本章", objective: "确认异常" } });
  const scene = await f.db.chapterPlanScene.create({ data: { planId: plan.id, sortOrder: 1, title: "推门入室", objective: "确认屋内异常" } });
  const foreignNovel = await f.db.novel.create({ data: { title: "他书" } });
  const foreignChapter = await f.db.chapter.create({ data: { novelId: foreignNovel.id, order: 1, title: "他章" } });
  const foreignPlan = await f.db.storyPlan.create({ data: { novelId: foreignNovel.id, chapterId: foreignChapter.id, level: "chapter", title: "他章", objective: "他书目标" } });
  const foreignScene = await f.db.chapterPlanScene.create({ data: { planId: foreignPlan.id, sortOrder: 1, title: "他书场景" } });
  const beforeScene = await f.db.chapterPlanScene.findUnique({ where: { id: scene.id } });
  const current = await f.expressions.list(f.novelId);
  assert.equal(current.enabled, false);
  const saved = await f.expressions.save(f.novelId, { expectedRevision: current.revision, enabled: true, points: [{ sceneId: scene.id, dimensionKey: "scene_pace", level: 4, note: "动作衔接更紧" }] });
  assert.equal(saved.enabled, true);
  assert.equal(saved.points.length, 1);
  assert.equal(saved.points[0].level, 4);
  assert.notEqual(saved.revision, current.revision);
  assert.deepEqual(await f.db.chapterPlanScene.findUnique({ where: { id: scene.id } }), beforeScene);
  await assert.rejects(() => f.expressions.save(f.novelId, { expectedRevision: saved.revision, enabled: true, points: [{ sceneId: scene.id, dimensionKey: "plot_twist", level: 5 }] }), /维度/);
  await assert.rejects(() => f.expressions.save(f.novelId, { expectedRevision: saved.revision, enabled: true, points: [{ sceneId: scene.id, dimensionKey: "scene_pace", level: 6 }] }), /档位/);
  await assert.rejects(() => f.expressions.save(f.novelId, { expectedRevision: saved.revision, enabled: true, points: [{ sceneId: foreignScene.id, dimensionKey: "scene_pace", level: 2 }] }), /不属于当前作品/);
  await assert.rejects(() => f.expressions.save(f.novelId, { expectedRevision: current.revision, enabled: false, points: [] }), isConflict);
  const cleared = await f.expressions.save(f.novelId, { expectedRevision: saved.revision, enabled: false, points: [] });
  assert.equal(cleared.enabled, false);
  assert.deepEqual(cleared.points, []);
});

test("book-level expression catalog saves custom tracks and validates their scene points", async t => {
  const f = await fixture(t);
  const current = await f.expressions.catalog(f.novelId);
  assert.equal(current.revision, 0);
  assert.equal(current.definitions.length, 5);
  const source = current.definitions[0];
  const custom = {
    ...source,
    key: "custom_dialogue_density",
    origin: "custom",
    label: "对话密度",
    description: "控制已有场景中的对话占比。",
    sortOrder: 6,
    bands: source.bands.map(band => ({ ...band, name: `对话 L${band.level}`, instruction: `使用第 ${band.level} 档对话密度，不新增剧情事实。` })),
    invariants: ["不得新增人物或对话事实"],
  };
  const savedCatalog = await f.expressions.saveCatalog(f.novelId, { expectedRevision: 0, definitions: [...current.definitions, custom] });
  assert.equal(savedCatalog.revision, 1);
  assert.equal(savedCatalog.definitions.at(-1).label, "对话密度");
  await assert.rejects(() => f.expressions.saveCatalog(f.novelId, { expectedRevision: 0, definitions: savedCatalog.definitions }), isConflict);

  const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: f.chapters[0].id, level: "chapter", title: "本章", objective: "确认异常" } });
  const scene = await f.db.chapterPlanScene.create({ data: { planId: plan.id, sortOrder: 1, title: "推门入室" } });
  const points = await f.expressions.list(f.novelId);
  const receipt = await f.expressions.save(f.novelId, { expectedRevision: points.revision, enabled: true, points: [{ sceneId: scene.id, dimensionKey: custom.key, level: 3 }] });
  assert.equal(receipt.points[0].dimensionKey, custom.key);
});

test("chapter scene arrangement previews and applies the complete scene sequence atomically", async t => {
  const f = await fixture(t);
  const { normalizeChapterScenePlan, serializeChapterScenePlan, parseChapterScenePlan } = require("@ai-novel/shared/types/chapterLengthControl");
  const chapter = f.chapters[0];
  const obsoletePlan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: "旧章计划", objective: "不应进入工作区", updatedAt: new Date("2020-01-01T00:00:00Z") } });
  await f.db.chapterPlanScene.create({ data: { planId: obsoletePlan.id, sortOrder: 1, title: "旧计划场景" } });
  const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: chapter.title, objective: chapter.expectation } });
  const rows = [];
  for (const [index, title] of ["发现异常", "当面试探", "独自确认"].entries()) rows.push(await f.db.chapterPlanScene.create({ data: { planId: plan.id, sortOrder: index + 1, title, objective: `目标${index + 1}` } }));
  const originalCards = normalizeChapterScenePlan(rows.map((row, index) => ({ key: row.id, title: `卡片标题${index + 1}`, purpose: `卡片目的${index + 1}`, mustAdvance: [], mustPreserve: [], entryState: `进入${index + 1}`, exitState: `结束${index + 1}`, forbiddenExpansion: [], targetWordCount: [600, 1500, 900][index], resistance: "", turn: "", emotionalShift: "", readerValue: "" })), 3000);
  await f.db.chapter.update({ where: { id: chapter.id }, data: { targetWordCount: 3000, sceneCards: serializeChapterScenePlan(originalCards) } });
  const workspace = await f.service.workspace(f.novelId);
  const source = workspace.scenes.filter(scene => scene.chapterId === chapter.id);
  assert.equal(source.length, 3);
  assert.ok(source.every(scene => rows.some(row => row.id === scene.id)));
  const changed = [source[0], source[2], source[1]].map((scene, index) => ({ ...scene, sortOrder: index + 1, targetWordCount: [900, 900, 1200][index] }));
  const runtime = await f.db.directorRuntimeInstance.create({ data: { novelId: f.novelId, currentChapterId: null } });
  const execution = await f.db.directorRuntimeExecution.create({ data: { novelId: f.novelId, runtimeId: runtime.id, stepType: "chapter_generation", status: "running", leaseExpiresAt: new Date(Date.now() + 60000) } });
  assert.equal((await f.chapterScenes.preview(f.novelId, { chapterId: chapter.id, expectedChapterRevision: workspace.chapters.find(item => item.id === chapter.id).revision, scenes: changed })).canApply, false);
  await f.db.directorRuntimeExecution.delete({ where: { id: execution.id } });
  await f.db.directorRuntimeInstance.delete({ where: { id: runtime.id } });
  const preview = await f.chapterScenes.preview(f.novelId, { chapterId: chapter.id, expectedChapterRevision: workspace.chapters.find(item => item.id === chapter.id).revision, scenes: changed });
  assert.ok(preview);
  assert.deepEqual(preview.after.map(scene => [scene.id, scene.sortOrder, scene.targetWordCount]), changed.map(scene => [scene.id, scene.sortOrder, scene.targetWordCount]));
  assert.deepEqual((await f.db.chapterPlanScene.findMany({ where: { planId: plan.id }, orderBy: { sortOrder: "asc" } })).map(scene => scene.id), rows.map(scene => scene.id));
  const receipt = await f.chapterScenes.apply(f.novelId, preview.id);
  assert.deepEqual(await f.chapterScenes.apply(f.novelId, preview.id), receipt);
  assert.deepEqual((await f.db.chapterPlanScene.findMany({ where: { planId: plan.id }, orderBy: { sortOrder: "asc" } })).map(scene => scene.id), [rows[0].id, rows[2].id, rows[1].id]);
  const applied = parseChapterScenePlan((await f.db.chapter.findUnique({ where: { id: chapter.id } })).sceneCards);
  assert.deepEqual(applied.scenes.map(scene => scene.targetWordCount), [900, 900, 1200]);
  assert.deepEqual(applied.scenes.map(card => [card.key, card.title, card.purpose]), changed.map(scene => { const original = originalCards.scenes.find(card => card.key === scene.id); return [scene.id, original.title, original.purpose]; }));
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
});

test("planned hook guidance: only setup and payoff chapters receive author plans, never historical hooks", async t => {
  const f = await fixture(t);
  const renderer = loadRuntimeSource(path.join(serverRoot, "src/prompting/prompts/novel/plannedHookGuidance.ts"), {});
  const { TimelineHookPlanService } = loadRuntimeSource(path.join(serverRoot, "src/modules/timeline/timeline-hook-plan.service.ts"), { "../../db/prisma": { prisma: f.db }, "../../prompting/prompts/novel/plannedHookGuidance": renderer });
  const service = new TimelineHookPlanService(f.db);
  const input = chapter => ({ novelId: f.novelId, chapterId: chapter.id });
  assert.equal(await service.buildForChapter(input(f.chapters[0])), "");
  const hook = await f.db.timelineHook.create({ data: { novelId: f.novelId, title: "未铺设的来信", description: "计划说明", priority: "medium", createdInChapterId: f.chapters[0].id, createdInChapterIndex: 4, expectedResolveByChapterIndex: 8, status: "planned" } });
  await f.db.timelineHook.create({ data: { novelId: f.novelId, title: "历史钩子不混入计划", description: "历史记录", priority: "medium", createdInChapterId: f.chapters[0].id, createdInChapterIndex: 4, status: "open" } });
  assert.match(await service.buildForChapter(input(f.chapters[0])), /本章铺设：未铺设的来信/);
  assert.equal(await service.buildForChapter(input(f.chapters[1])), "");
  assert.match(await service.buildForChapter(input(f.chapters[2])), /本章预计回收：未铺设的来信/);
  assert.doesNotMatch(await service.buildForChapter(input(f.chapters[0])), /历史钩子不混入计划/);
  await f.db.chapter.update({ where: { id: f.chapters[0].id }, data: { order: 6 } });
  assert.match(await service.buildForChapter(input(f.chapters[0])), /本章铺设/);
  await f.db.timelineHook.update({ where: { id: hook.id }, data: { status: "dropped" } });
  assert.equal(await service.buildForChapter(input(f.chapters[0])), "");
  assert.equal(await service.buildForChapter({ novelId: "foreign", chapterId: f.chapters[2].id }), "");
});

test("arrangement objects: scene card synchronization preserves sibling detail, budgets and move/delete order", async t => {
  const f = await fixture(t);
  const { normalizeChapterScenePlan, serializeChapterScenePlan, parseChapterScenePlan } = require("@ai-novel/shared/types/chapterLengthControl");
  const plans = [], allScenes = [], cardsByChapter = [];
  for (const [chapterIndex, count] of [4, 3].entries()) {
    const chapter = f.chapters[chapterIndex];
    const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: chapter.title, objective: chapter.expectation } });
    plans.push(plan);
    const scenes = [];
    for (let i = 0; i < count; i++) scenes.push(await f.db.chapterPlanScene.create({ data: { planId: plan.id, title: `${chapterIndex}场${i}`, sortOrder: i + 1, objective: `目标${i}`, reveal: `揭示${i}` } }));
    allScenes.push(scenes);
    const cards = normalizeChapterScenePlan(scenes.map((scene, i) => ({ key: `plan_scene_${i + 1}`, title: scene.title, purpose: `细化目的${i}`, mustAdvance: [scene.reveal, "保留作者约束"], mustPreserve: ["人物身份"], entryState: "特定进入状态", exitState: scene.reveal, forbiddenExpansion: ["不要新增旁支"], targetWordCount: 1000, resistance: `细化阻力${i}`, turn: `细化转折${i}`, emotionalShift: "隐忍", readerValue: "悬念" })), 4000);
    cardsByChapter.push(cards);
    await f.db.chapter.update({ where: { id: chapter.id }, data: { sceneCards: serializeChapterScenePlan(cards) } });
  }
  const beforeProse = f.chapters.map(chapter => chapter.content);
  const moving = await f.objects.detail(f.novelId, "scene", allScenes[0][0].id);
  const preview = await f.objects.preview(f.novelId, { kind: "scene", action: "update", objectId: moving.id, expectedRevision: moving.revision, patch: { chapterId: f.chapters[1].id, sortOrder: 2, reveal: "新的揭示" } });
  const saved = JSON.parse((await f.db.chapterEditVersion.findUnique({ where: { id: preview.id } })).metadataJson);
  assert.equal(saved.previousChapterSceneCards.length, 2);
  assert.ok(saved.previousScenePlans.length >= 7);
  await f.objects.apply(f.novelId, preview.id);
  const source = parseChapterScenePlan((await f.db.chapter.findUnique({ where: { id: f.chapters[0].id } })).sceneCards);
  const target = parseChapterScenePlan((await f.db.chapter.findUnique({ where: { id: f.chapters[1].id } })).sceneCards);
  assert.deepEqual(source.scenes.map(card => card.key), allScenes[0].slice(1).map(scene => scene.id));
  assert.deepEqual(target.scenes.map(card => card.key), [allScenes[1][0].id, moving.id, ...allScenes[1].slice(1).map(scene => scene.id)]);
  assert.deepEqual(source.scenes[0], { ...cardsByChapter[0].scenes[1], key: allScenes[0][1].id });
  assert.deepEqual(target.scenes[0], { ...cardsByChapter[1].scenes[0], key: allScenes[1][0].id });
  assert.equal(target.scenes[1].targetWordCount, cardsByChapter[0].scenes[0].targetWordCount);
  assert.equal(target.scenes[1].exitState, "新的揭示");
  assert.ok(target.scenes[1].mustAdvance.includes("保留作者约束"));
  assert.ok(!target.scenes[1].mustAdvance.includes("揭示0"));
  const current = await f.objects.detail(f.novelId, "scene", moving.id);
  await f.objects.apply(f.novelId, (await f.objects.preview(f.novelId, { kind: "scene", action: "delete", objectId: current.id, expectedRevision: current.revision, patch: {} })).id);
  const afterDelete = parseChapterScenePlan((await f.db.chapter.findUnique({ where: { id: f.chapters[1].id } })).sceneCards);
  assert.deepEqual(afterDelete.scenes.map(card => card.key), allScenes[1].map(scene => scene.id));
  assert.ok(!JSON.stringify(afterDelete).includes("新的揭示"));
  const first = await f.objects.detail(f.novelId, "scene", allScenes[1][0].id);
  await assert.rejects(f.objects.preview(f.novelId, { kind: "scene", action: "delete", objectId: first.id, expectedRevision: first.revision, patch: {} }), /3 至 8/);
  assert.deepEqual((await f.db.chapter.findMany({ orderBy: { order: "asc" } })).map(chapter => chapter.content), beforeProse);
  const mismatched = { ...afterDelete, scenes: afterDelete.scenes.map((card, index) => ({ ...card, key: `independent_${index}`, title: `另行编辑的场景${index}` })) };
  await f.db.chapter.update({ where: { id: f.chapters[1].id }, data: { sceneCards: serializeChapterScenePlan(mismatched) } });
  await assert.rejects(f.objects.preview(f.novelId, { kind: "scene", action: "update", objectId: first.id, expectedRevision: first.revision, patch: { objective: "新目标" } }), /无法逐项对应/);
  assert.deepEqual(parseChapterScenePlan((await f.db.chapter.findUnique({ where: { id: f.chapters[1].id } })).sceneCards), mismatched);
});

test("arrangement objects: timeline constraints protect referenced chapters and invalidate frozen candidates", async t => {
  const f = await fixture(t);
  const created = await f.objects.apply(f.novelId, (await f.objects.preview(f.novelId, { kind: "event", action: "create", patch: { title: "关联事件", chapterId: f.chapters[0].id } })).id);
  const detail = await f.objects.detail(f.novelId, "event", created.objectId);
  const input = { kind: "event", action: "update", objectId: detail.id, expectedRevision: detail.revision, patch: { summary: "调整资料" } };
  const old = await f.objects.preview(f.novelId, input);
  const constraint = await f.db.timelineConstraint.create({ data: { novelId: f.novelId, chapterIndex: 5, type: "causal", severity: "hard", description: "第5章依赖该事件", relatedEventIdsJson: JSON.stringify([detail.id]) } });
  await assert.rejects(f.objects.apply(f.novelId, old.id), isConflict);
  await f.db.writingSetting.create({ data: { id: "constraint-lock", novelId: f.novelId, scopeKey: "book-arrangement:draft", payloadJson: JSON.stringify({ chapterEdits: [{ chapterId: f.chapters[1].id, locked: true }] }) } });
  const preview = await f.objects.preview(f.novelId, input);
  assert.ok(preview.references.some(ref => ref.sourceEntity === "TimelineConstraint" && ref.sourceId === constraint.id));
  assert.equal(preview.canApply, false);
  assert.ok(preview.affectedChapterIds.includes(f.chapters[1].id));
  await f.db.timelineConstraint.update({ where: { id: constraint.id }, data: { chapterIndex: null } });
  assert.deepEqual((await f.objects.preview(f.novelId, input)).affectedChapterIds, f.chapters.map(chapter => chapter.id));
});

test("arrangement objects: accepted scenes survive original planner reuse and changed chapter contracts still replan", async t => {
  const f = await fixture(t), chapter = f.chapters[0];
  const load = (name, imports) => loadRuntimeSource(path.join(serverRoot, "src/services/planner", name), imports);
  const metadata = load("plannerPlanMetadata.ts", { "@ai-novel/shared/types/chapterCreativeContract": require("@ai-novel/shared/types/chapterCreativeContract") });
  const persistence = load("plannerPersistence.ts", { "node:crypto": require("node:crypto"), "../../db/prisma": { prisma: f.db }, "./plannerPlanMetadata": metadata, "@ai-novel/shared/types/chapterCreativeContract": require("@ai-novel/shared/types/chapterCreativeContract"), "@ai-novel/shared/types/chapterLengthControl": require("@ai-novel/shared/types/chapterLengthControl") });
  const query = load("query/PlannerPlanQueryService.ts", { "../../../db/prisma": { prisma: f.db }, "../../novel/novelP0Utils": {}, "../plannerPlanMetadata": metadata });
  const unused = Object.fromEntries(["../novel/dynamics/CharacterDynamicsQueryService", "../novel/production/ContextAssemblyService", "../novel/state/CanonicalStateService", "../payoff/PayoffLedgerSyncService", "../novel/storyMacro/storyMacroPlanPersistence", "../../modules/timeline", "./plannerLlm", "./plannerContextBlocks", "./replanDecision", "./plannerContextHelpers", "./plannerParticipantResolution", "./replan", "./plannerStateDirectives", "./plannerOutputNormalization"].map(name => [name, {}]));
  const { PlannerService } = load("PlannerService.ts", { ...unused, "../../db/prisma": { prisma: f.db }, "../styleEngine/StyleBindingService": { StyleBindingService: class {} }, "./plannerPlanMetadata": metadata, "./plannerPersistence": persistence, "./query": { plannerPlanQueryService: new query.PlannerPlanQueryService() } });
  const planner = new PlannerService();
  let regenerated = 0;
  planner.generateChapterPlan = async () => { regenerated++; return "regenerated"; };
  const plan = await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: "原章计划", objective: "计划目标", rawPlanJson: JSON.stringify({ provenance: { source: "original" }, scenes: [{ title: "历史模型输出" }] }) } });
  const scene = await f.db.chapterPlanScene.create({ data: { planId: plan.id, title: "旧场景", sortOrder: 1 } });
  assert.equal(await planner.ensureChapterPlan(f.novelId, chapter.id), "regenerated");
  const detail = await f.objects.detail(f.novelId, "scene", scene.id);
  const candidate = await f.objects.preview(f.novelId, { kind: "scene", action: "update", objectId: scene.id, expectedRevision: detail.revision, patch: { title: "作者接受的场景", objective: "试探口风" } });
  await f.objects.apply(f.novelId, candidate.id);
  const reused = await planner.ensureChapterPlan(f.novelId, chapter.id);
  assert.equal(reused.id, plan.id);
  assert.equal(reused.scenes[0].title, "作者接受的场景");
  assert.equal(regenerated, 1);
  assert.equal(JSON.parse((await f.db.chapter.findUnique({ where: { id: chapter.id } })).sceneCards).scenes[0].title, "作者接受的场景");
  const onlyScene = await f.objects.detail(f.novelId, "scene", scene.id);
  for (const [action, patch] of [["delete", {}], ["update", { chapterId: f.chapters[1].id }]]) await assert.rejects(f.objects.preview(f.novelId, { kind: "scene", action, objectId: scene.id, expectedRevision: onlyScene.revision, patch }), /最后一个场景/);
  assert.deepEqual(JSON.parse(reused.rawPlanJson).provenance, { source: "original" });
  assert.equal((await f.db.chapter.findUnique({ where: { id: chapter.id } })).content, chapter.content);
  await f.db.chapter.update({ where: { id: chapter.id }, data: { expectation: "作者另改章节执行目标" } });
  assert.equal(await planner.ensureChapterPlan(f.novelId, chapter.id), "regenerated");
  assert.equal(regenerated, 2);
  await f.db.storyPlan.update({ where: { id: plan.id }, data: { status: "stale" } });
  assert.equal((await f.objects.detail(f.novelId, "scene", scene.id)).editable, false);
});

test("arrangement objects: event candidate create, move, cancellation and replay leave prose untouched", async t => {
  const f = await fixture(t), [first, second] = f.chapters;
  const original = await f.db.chapter.findMany();
  const template = await f.objects.detail(f.novelId, "event", "new", first.id);
  assert.equal(await f.db.storyTimelineEvent.count(), 0);
  const candidate = await f.objects.preview(f.novelId, { kind: "event", action: "create", patch: { ...template.fields, title: "计划问询", participantIds: [f.character.id], storyDayIndex: 0 } });
  assert.equal(candidate.canApply, true);
  assert.equal(await f.db.storyTimelineEvent.count(), 0);
  const created = await f.objects.apply(f.novelId, candidate.id);
  assert.deepEqual((await f.service.workspace(f.novelId)).objectPreviews.find(item => item.id === candidate.id).applied, created);
  const detail = await f.objects.detail(f.novelId, "event", created.objectId);
  assert.equal(detail.record.status, "planned");
  assert.equal(detail.fields.storyDayIndex, 0);
  assert.equal((await f.objects.detail(f.novelId, "event", "new", first.id)).fields.eventOrder, 2);
  const moved = await f.objects.preview(f.novelId, { kind: "event", action: "update", objectId: detail.id, expectedRevision: detail.revision, patch: { chapterId: second.id } });
  assert.deepEqual(moved.affectedChapterIds, [first.id, second.id]);
  await f.objects.apply(f.novelId, moved.id);
  const current = await f.objects.detail(f.novelId, "event", detail.id);
  assert.equal(current.record.chapterIndex, second.order);
  const deleted = await f.objects.preview(f.novelId, { kind: "event", action: "delete", objectId: current.id, expectedRevision: current.revision, patch: {} });
  const receipt = await f.objects.apply(f.novelId, deleted.id);
  assert.deepEqual(await f.objects.apply(f.novelId, deleted.id), receipt);
  assert.equal((await f.db.storyTimelineEvent.findUnique({ where: { id: current.id } })).status, "cancelled");
  assert.deepEqual(await f.db.chapter.findMany(), original);
});

test("arrangement objects: moving a scene reorders only source and destination while retaining original IDs", async t => {
  const f = await fixture(t);
  const plans = [];
  for (const chapter of f.chapters) plans.push(await f.db.storyPlan.create({ data: { novelId: f.novelId, chapterId: chapter.id, level: "chapter", title: chapter.title, objective: "原目标" } }));
  const scenes = [];
  for (const [index, plan] of plans.entries()) for (const position of [1, 2]) scenes.push(await f.db.chapterPlanScene.create({ data: { planId: plan.id, sortOrder: position, title: `${index}-${position}` } }));
  const untouched = await f.db.storyPlan.findUnique({ where: { id: plans[2].id }, include: { scenes: true } });
  const detail = await f.objects.detail(f.novelId, "scene", scenes[0].id);
  const preview = await f.objects.preview(f.novelId, { kind: "scene", action: "update", objectId: detail.id, expectedRevision: detail.revision, patch: { chapterId: f.chapters[1].id, sortOrder: 2, objective: "新的目标" } });
  assert.deepEqual(preview.affectedChapterIds, [f.chapters[0].id, f.chapters[1].id]);
  assert.equal((await f.db.chapterPlanScene.findUnique({ where: { id: scenes[0].id } })).planId, plans[0].id);
  await f.objects.apply(f.novelId, preview.id);
  assert.deepEqual((await f.db.chapterPlanScene.findMany({ where: { planId: plans[1].id }, orderBy: { sortOrder: "asc" } })).map(scene => scene.id), [scenes[2].id, scenes[0].id, scenes[3].id]);
  assert.equal((await f.db.chapterPlanScene.findUnique({ where: { id: scenes[1].id } })).sortOrder, 1);
  assert.deepEqual(await f.db.storyPlan.findUnique({ where: { id: plans[2].id }, include: { scenes: true } }), untouched);
});

test("arrangement objects: historical source and causal-reference changes invalidate old candidates", async t => {
  const f = await fixture(t);
  const event = await f.db.storyTimelineEvent.create({ data: { novelId: f.novelId, chapterId: f.chapters[0].id, chapterIndex: 4, eventOrder: 1, title: "既有事件", summary: "既有摘要", type: "plot", status: "occurred", visibility: "reader_known", source: "chapter_extraction" } });
  const detail = await f.objects.detail(f.novelId, "event", event.id);
  assert.equal(detail.basis, "record");
  const preview = await f.objects.preview(f.novelId, { kind: "event", action: "update", objectId: event.id, expectedRevision: detail.revision, patch: { summary: "拟修订的描述" } });
  assert.deepEqual(preview.writtenChapterIds, [f.chapters[0].id]);
  await f.db.chapterTimeAnchor.create({ data: { novelId: f.novelId, chapterId: f.chapters[1].id, chapterIndex: 5, timeLabel: "之后", startsAfterIdsJson: JSON.stringify([event.id]) } });
  await assert.rejects(f.objects.apply(f.novelId, preview.id), isConflict);
  assert.equal((await f.db.storyTimelineEvent.findUnique({ where: { id: event.id } })).summary, event.summary);
  const fresh = await f.objects.preview(f.novelId, { kind: "event", action: "update", objectId: event.id, expectedRevision: detail.revision, patch: { summary: "拟修订的描述" } });
  assert.ok(fresh.affectedChapterIds.includes(f.chapters[1].id));
  await f.db.storyTimelineEvent.update({ where: { id: event.id }, data: { summary: "另一窗口的修改" } });
  await assert.rejects(f.objects.apply(f.novelId, fresh.id), isConflict);
});

test("arrangement objects: cross-book references and fields that invent completed facts are rejected", async t => {
  const f = await fixture(t);
  const foreign = await f.db.novel.create({ data: { title: "其他作品" } });
  const character = await f.db.character.create({ data: { novelId: foreign.id, name: "外部人物", role: "配角" } });
  const event = await f.db.storyTimelineEvent.create({ data: { novelId: foreign.id, eventOrder: 1, title: "外部事件", summary: "", type: "plot", status: "planned", visibility: "hidden_truth", source: "manual" } });
  for (const patch of [{ title: "不合法", participantIds: [character.id] }, { title: "不合法", prerequisiteIds: [event.id] }, { title: "不合法", chapterId: "missing" }, { title: "不合法", status: "occurred" }]) await assert.rejects(f.objects.preview(f.novelId, { kind: "event", action: "create", patch }));
  await assert.rejects(f.objects.detail(f.novelId, "event", event.id), error => error.statusCode === 404);
  await assert.rejects(f.objects.preview(f.novelId, { kind: "hook", action: "create", patch: { title: "不能捏造回收", chapterId: f.chapters[0].id, resolvedInChapterId: f.chapters[2].id } }));
  assert.equal(await f.db.chapterEditVersion.count(), 0);
});

test("arrangement objects: relation settings and hook plans preserve historical snapshot facts", async t => {
  const f = await fixture(t);
  const person = await f.db.character.create({ data: { novelId: f.novelId, name: "许岚", role: "配角" } });
  const relation = await f.objects.preview(f.novelId, { kind: "relation", action: "create", patch: { sourceCharacterId: f.character.id, targetCharacterId: person.id, chapterId: f.chapters[0].id, stageLabel: "逐渐信任", stageSummary: "未来安排" } });
  const receipt = await f.objects.apply(f.novelId, relation.id);
  assert.equal((await f.db.characterRelationStage.findUnique({ where: { id: receipt.objectId } })).sourceType, "arrangement_plan");
  const hook = await f.objects.preview(f.novelId, { kind: "hook", action: "create", patch: { title: "来信", description: "计划第8章揭示", chapterId: f.chapters[0].id, expectedResolveByChapterIndex: 8 } });
  const applied = await f.objects.apply(f.novelId, hook.id);
  const row = await f.db.timelineHook.findUnique({ where: { id: applied.objectId } });
  assert.equal(row.expectedResolveByChapterIndex, 8);
  assert.equal(row.resolvedInChapterId, null);
  assert.equal(row.status, "planned");
  const snapshot = await f.db.storyStateSnapshot.create({ data: { novelId: f.novelId, sourceChapterId: f.chapters[0].id } });
  const fact = await f.db.foreshadowState.create({ data: { snapshotId: snapshot.id, title: "原文中的伏笔", status: "open", setupChapterId: f.chapters[0].id } });
  assert.equal((await f.objects.detail(f.novelId, "foreshadow", fact.id)).editable, false);
  await assert.rejects(f.objects.preview(f.novelId, { kind: "foreshadow", action: "update", objectId: fact.id, expectedRevision: "any", patch: { title: "改事实" } }), error => error.statusCode === 400);
  assert.deepEqual(await f.db.foreshadowState.findUnique({ where: { id: fact.id } }), fact);
});

test("hook lifecycle nodes preview, apply, verify prose evidence and retain the canonical hook", async t => {
  const f = await fixture(t);
  const hook = await f.db.timelineHook.create({ data: { novelId: f.novelId, title: "旧钥匙", description: "门锁线索", priority: "high", createdInChapterId: f.chapters[0].id, createdInChapterIndex: 4, expectedResolveByChapterIndex: 8, status: "open" } });
  const candidate = await f.objects.preview(f.novelId, { kind: "hookNode", action: "create", patch: { hookId: hook.id, chapterId: f.chapters[1].id, stage: "reinforce", basis: "record", note: "再次出现钥匙", evidence: "不存在的原文" } });
  assert.ok(candidate.impact.some(item => item.includes("未在所选章节精确定位")));
  const receipt = await f.objects.apply(f.novelId, candidate.id);
  const workspace = await f.service.workspace(f.novelId);
  const node = workspace.hookNodes.find(item => item.sourceId === receipt.objectId);
  assert.equal(node.evidenceStatus, "mismatch");
  assert.equal(node.stage, "reinforce");
  assert.equal((await f.db.timelineHook.findUnique({ where: { id: hook.id } })).status, "open");
  const detail = await f.objects.detail(f.novelId, "hookNode", receipt.objectId);
  const update = await f.objects.preview(f.novelId, { kind: "hookNode", action: "update", objectId: receipt.objectId, expectedRevision: detail.revision, patch: { evidence: f.chapters[1].content } });
  await f.objects.apply(f.novelId, update.id);
  assert.equal((await f.service.workspace(f.novelId)).hookNodes.find(item => item.sourceId === receipt.objectId).evidenceStatus, "matched");
  const current = await f.objects.detail(f.novelId, "hookNode", receipt.objectId);
  await f.objects.apply(f.novelId, (await f.objects.preview(f.novelId, { kind: "hookNode", action: "delete", objectId: receipt.objectId, expectedRevision: current.revision, patch: {} })).id);
  assert.equal((await f.db.timelineHookLifecycleNode.findUnique({ where: { id: receipt.objectId } })).active, false);
});

test("arrangement objects: locks, takeover, sync and active runtime leases block application", async t => {
  for (const block of ["lock", "manual", "sync", "runtime"]) {
    const f = await fixture(t), chapterId = f.chapters[0].id;
    if (block === "lock") await f.db.writingSetting.create({ data: { id: "draft", novelId: f.novelId, scopeKey: "book-arrangement:draft", payloadJson: JSON.stringify({ chapterEdits: [{ chapterId, locked: true }] }) } });
    if (block === "manual") await f.db.chapterAdjustmentGuard.create({ data: { chapterId, novelId: f.novelId, epoch: 1, manualSessionId: "session" } });
    if (block === "sync") await f.db.writingAcceptance.create({ data: { id: "pending", novelId: f.novelId, chapterId, editVersionId: "edit", requestKey: "pending", status: "pending", payloadJson: "{}" } });
    if (block === "runtime") {
      const runtime = await f.db.directorRuntimeInstance.create({ data: { novelId: f.novelId, currentChapterId: chapterId } });
      await f.db.directorRuntimeExecution.create({ data: { novelId: f.novelId, runtimeId: runtime.id, stepType: "chapter_generation", status: "running", leaseExpiresAt: new Date(Date.now() + 60000) } });
    }
    const preview = await f.objects.preview(f.novelId, { kind: "event", action: "create", patch: { title: "未来事件", chapterId } });
    assert.equal(preview.canApply, false, block);
    await assert.rejects(f.objects.apply(f.novelId, preview.id), isConflict);
    assert.equal(await f.db.storyTimelineEvent.count(), 0);
  }
});

test("arrangement objects: failed receipt rolls back scene creation and lost response replays exact receipt", async t => {
  const f = await fixture(t), chapterId = f.chapters[0].id;
  const preview = await f.objects.preview(f.novelId, { kind: "scene", action: "create", patch: { title: "新场景", chapterId } });
  assert.equal(await f.db.storyPlan.count(), 0);
  const recordResult = f.store.recordResult;
  f.store.recordResult = async () => { throw new Error("receipt failure"); };
  await assert.rejects(f.objects.apply(f.novelId, preview.id), /receipt failure/);
  assert.equal(await f.db.storyPlan.count(), 0);
  assert.equal(await f.db.chapterPlanScene.count(), 0);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
  f.store.recordResult = recordResult;
  const receipt = await f.store.once(f.novelId, "object-apply", "once", {}, async () => { await f.objects.apply(f.novelId, preview.id); throw new Error("response lost"); });
  assert.equal(receipt.id, preview.id);
  assert.deepEqual(await f.store.once(f.novelId, "object-apply", "once", {}, async () => { throw new Error("must replay"); }), receipt);
  assert.equal(await f.db.chapterPlanScene.count(), 1);
});
function volumeService(f) {
  const load = (file, imports) => loadRuntimeSource(path.join(serverRoot, "src", file), imports);
  const root = "services/novel/volume/";
  const utils = load(`${root}volumePlanUtils.ts`, { "node:crypto": require("node:crypto"), zod: require("zod"), "./volumePlanChangeDetection": {} });
  const documents = load(`${root}volumeWorkspaceDocument.ts`, { "./volumePlanUtils": utils, "@ai-novel/shared/types/volumeBeatSlots": require("@ai-novel/shared/types/volumeBeatSlots") });
  const models = load(`${root}volumeModels.ts`, { "../../../db/prisma": { prisma: f.db } });
  const persistence = load(`${root}volumeWorkspacePersistence.ts`, { "../../../db/prisma": { prisma: f.db }, "../../../db/sqliteRetry": { withSqliteRetry: () => { throw new Error("legacy outer transaction must not run"); } }, "./volumePlanUtils": utils, "./volumeModels": models, "./volumeWorkspaceDocument": documents });
  const adapter = load(`${root}ArrangementVolumeAdapter.ts`, { "node:crypto": require("node:crypto"), "./volumeModels": models, "./volumePlanUtils": utils, "./volumeWorkspaceDocument": documents, "./volumeWorkspacePersistence": persistence });
  const service = load("modules/novel/adjustments/application/BookArrangementVolumeService.ts", { "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../events": { novelEventBus: { emit: async event => { assert.equal(event.type, "novel:updated"); } } }, "../../../../middleware/errorHandler": f.errors, "../domain/contracts": f.contracts, "../infrastructure/AdjustmentStore": { AdjustmentStore: f.Store }, "./BookArrangementService": f.arrangementModule, "../../../../services/novel/volume/ArrangementVolumeAdapter": adapter });
  return new service.BookArrangementVolumeService(f.store);
}
async function volumeFixture(t) {
  const f = await fixture(t);
  const first = await f.db.volumePlan.create({ data: { novelId: f.novelId, sortOrder: 1, title: "第一卷", mainPromise: "查信", openPayoffsJson: '["身份"]' } });
  const second = await f.db.volumePlan.create({ data: { novelId: f.novelId, sortOrder: 2, title: "第二卷", summary: "结盟" } });
  const links = [];
  for (const [index, chapter] of f.chapters.entries()) links.push(await f.db.volumeChapterPlan.create({ data: { volumeId: index < 2 ? first.id : second.id, chapterId: chapter.id, chapterOrder: chapter.order, title: chapter.title, summary: chapter.expectation, taskSheet: "保留任务", payoffRefsJson: '["身份"]' } }));
  const edit = volume => ({ volumeId: volume.id, title: volume.title, summary: volume.summary ?? "", mainPromise: volume.mainPromise ?? "", protagonistChange: "", climax: "", nextVolumeHook: "", chapterIds: links.filter(link => link.volumeId === volume.id).map(link => link.chapterId) });
  f.payload.baseRevision = await f.store.dependencies(f.novelId);
  return { ...f, first, second, links, edits: [edit(first), edit(second)], volumes: volumeService(f) };
}
async function volumePreview(f, edits = f.edits, volumeIds = edits.map(edit => edit.volumeId)) {
  const payload = { ...f.payload, volumeEdits: edits };
  const saved = await f.service.saveDraft(f.novelId, { expectedRevision: 0, payload });
  return f.volumes.preview(f.novelId, { draftRevision: saved.revision, volumeIds });
}

test("volume arrangement: preview does not activate versions and rejects implicit chapter stealing", async t => {
  const f = await volumeFixture(t), original = await f.db.chapter.findMany();
  const preview = await volumePreview(f, [{ ...f.edits[0], chapterIds: f.chapters.map(chapter => chapter.id) }]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.conflicts.some(item => item.code === "VOLUME_OVERLAP"));
  assert.ok(preview.neighboringVolumeIds.includes(f.second.id));
  assert.equal(await f.db.volumePlanVersion.count(), 0);
  assert.equal(await f.db.chapterEditVersion.count({ where: { kind: "arrangement_volume" } }), 1);
  await assert.rejects(f.volumes.apply(f.novelId, preview.id), isConflict);
  assert.deepEqual(await f.db.chapter.findMany(), original);
});

test("volume arrangement: explicit transfer keeps plan identity, prose, chapter order and original resources", async t => {
  const f = await volumeFixture(t), original = await f.db.chapter.findMany();
  const assignment = await f.db.characterVolumeAssignment.create({ data: { novelId: f.novelId, volumeId: f.first.id, characterId: f.character.id, roleLabel: "调查", responsibility: "保存原职责", appearanceExpectation: "原计划" } });
  f.edits[0] = { ...f.edits[0], title: "修订卷名", chapterIds: [f.chapters[0].id] };
  f.edits[1] = { ...f.edits[1], chapterIds: [f.chapters[1].id, f.chapters[2].id] };
  const preview = await volumePreview(f);
  assert.equal(preview.canApply, true);
  assert.deepEqual(preview.writtenChapterIds, f.chapters.map(chapter => chapter.id));
  assert.ok(preview.references.some(ref => ref.sourceId === assignment.id));
  const receipt = await f.volumes.apply(f.novelId, preview.id);
  assert.equal(receipt.status, "applied");
  assert.deepEqual(await f.volumes.apply(f.novelId, preview.id), receipt);
  const moved = await f.db.volumeChapterPlan.findUniqueOrThrow({ where: { id: f.links[1].id } });
  assert.equal(moved.volumeId, f.second.id);
  assert.equal(moved.taskSheet, f.links[1].taskSheet);
  assert.equal(moved.payoffRefsJson, f.links[1].payoffRefsJson);
  assert.deepEqual(await f.db.chapter.findMany(), original);
  assert.deepEqual(await f.db.characterVolumeAssignment.findUnique({ where: { id: assignment.id } }), assignment);
  assert.equal(await f.db.volumePlanVersion.count({ where: { status: "active" } }), 1);
  assert.equal(await f.db.volumePlanVersion.count(), 2);
  assert.deepEqual((await f.service.workspace(f.novelId)).draft.payload.volumeEdits, []);
  assert.equal((await f.service.workspace(f.novelId)).draft.payload.baseRevision, await f.store.dependencies(f.novelId));
  assert.equal(await f.db.storyPlan.count({ where: { level: "arc" } }), 2);
  assert.equal(await f.db.novelSideEffectJob.count(), 0, "no implicit global AI character rebuild");
});

test("volume arrangement: partial application preserves unrelated volumes, arc plans and pending draft edits", async t => {
  const f = await volumeFixture(t);
  const outsideArc = await f.db.storyPlan.create({ data: { novelId: f.novelId, level: "arc", externalRef: "volume:2", title: "原第二卷", objective: "保持原目标", rawPlanJson: '{"customResource":"keep"}' } });
  const outsideVolume = await f.db.volumePlan.findUnique({ where: { id: f.second.id }, include: { chapters: true } });
  f.payload.baseRevision = await f.store.dependencies(f.novelId);
  f.payload.chapterEdits[0].note = "保留待编辑备注";
  f.edits[0].title = "新第一卷";
  f.edits[1].title = "尚未应用第二卷";
  const preview = await volumePreview(f, f.edits, [f.first.id]);
  await f.volumes.apply(f.novelId, preview.id);
  assert.deepEqual(await f.db.volumePlan.findUnique({ where: { id: f.second.id }, include: { chapters: true } }), outsideVolume);
  assert.deepEqual(await f.db.storyPlan.findUnique({ where: { id: outsideArc.id } }), outsideArc);
  const workspace = await f.service.workspace(f.novelId);
  assert.deepEqual(workspace.draft.payload.volumeEdits, [f.edits[1]]);
  assert.equal(workspace.draft.payload.chapterEdits[0].note, "保留待编辑备注");
  assert.equal(workspace.draft.revision, 2);
});

test("volume arrangement: transaction failure rolls back membership, versions, derived outlines and guards", async t => {
  const f = await volumeFixture(t);
  f.edits[0].chapterIds = [f.chapters[0].id];
  f.edits[1].chapterIds = [f.chapters[1].id, f.chapters[2].id];
  const preview = await volumePreview(f);
  const before = { novel: await f.db.novel.findUnique({ where: { id: f.novelId } }), volumes: await f.db.volumePlan.findMany({ include: { chapters: true } }), draft: await f.db.writingSetting.findMany() };
  f.store.recordResult = async () => { throw new Error("simulated receipt storage failure"); };
  await assert.rejects(f.volumes.apply(f.novelId, preview.id), /receipt storage failure/);
  assert.deepEqual(await f.db.novel.findUnique({ where: { id: f.novelId } }), before.novel);
  assert.deepEqual(await f.db.volumePlan.findMany({ include: { chapters: true } }), before.volumes);
  assert.deepEqual(await f.db.writingSetting.findMany(), before.draft);
  assert.equal(await f.db.volumePlanVersion.count(), 0);
  assert.equal(await f.db.storyPlan.count(), 0);
  assert.equal(await f.db.chapterAdjustmentGuard.count(), 0);
});

test("volume arrangement: persisted HTTP receipt replays after response loss without applying twice", async t => {
  const f = await volumeFixture(t);
  f.edits[0].title = "一次应用";
  const preview = await volumePreview(f, [f.edits[0]]);
  const result = await f.store.once(f.novelId, "apply-volumes", "request", {}, async () => {
    await f.volumes.apply(f.novelId, preview.id);
    throw new Error("response disconnected after commit");
  });
  assert.equal(result.id, preview.id);
  assert.deepEqual(await f.store.once(f.novelId, "apply-volumes", "request", {}, async () => { throw new Error("must not execute"); }), result);
  assert.equal(await f.db.volumePlanVersion.count(), 2);
  assert.equal((await f.db.chapterAdjustmentGuard.findUnique({ where: { chapterId: f.chapters[0].id } })).epoch, 1);
});

test("volume arrangement: old candidate rejects changed volume rows, active leases and pending synchronization", async t => {
  for (const change of ["volume", "guard", "sync"]) {
    const f = await volumeFixture(t);
    const preview = await volumePreview(f, [{ ...f.edits[0], title: "新卷名" }]);
    if (change === "volume") await f.db.volumePlan.update({ where: { id: f.first.id }, data: { summary: "另一窗口已修改" } });
    if (change === "guard") await f.db.chapterAdjustmentGuard.create({ data: { chapterId: f.chapters[0].id, novelId: f.novelId, epoch: 1, manualSessionId: "active-manual" } });
    if (change === "sync") await f.db.writingAcceptance.create({ data: { id: "pending", novelId: f.novelId, chapterId: f.chapters[0].id, editVersionId: "edited", requestKey: "sync-pending", status: "pending", payloadJson: "{}" } });
    await assert.rejects(f.volumes.apply(f.novelId, preview.id), isConflict);
    assert.equal(await f.db.volumePlanVersion.count(), 0);
  }
});

test("volume arrangement: foreign ranges, disconnected intervals and locked chapters never apply", async t => {
  const f = await volumeFixture(t);
  await assert.rejects(f.service.saveDraft(f.novelId, { expectedRevision: 0, payload: { ...f.payload, volumeEdits: [{ ...f.edits[0], volumeId: "foreign-volume" }] } }), error => error.statusCode === 400);
  await assert.rejects(f.service.saveDraft(f.novelId, { expectedRevision: 0, payload: { ...f.payload, volumeEdits: [{ ...f.edits[0], chapterIds: ["foreign-chapter"] }] } }), error => error.statusCode === 400);
  f.payload.chapterEdits[0].locked = true;
  const preview = await volumePreview(f, [{ ...f.edits[0], chapterIds: [f.chapters[0].id, f.chapters[2].id] }]);
  assert.ok(preview.conflicts.some(item => item.code === "VOLUME_GAP"));
  assert.ok(preview.conflicts.some(item => item.code === "VOLUME_LOCKED"));
  await assert.rejects(f.volumes.apply(f.novelId, preview.id), isConflict);
  assert.equal(await f.db.volumePlanVersion.count(), 0);
});

test("volume arrangement: partial edit keeps prior document-only resources and old strategic review", async t => {
  const f = await volumeFixture(t);
  const initial = await volumePreview(f, [{ ...f.edits[0], title: "初始预览" }]);
  const candidate = await f.db.chapterEditVersion.findUniqueOrThrow({ where: { id: initial.id } });
  const document = JSON.parse(candidate.metadataJson).before;
  document.volumes[0].openingHook = "开场抓手保留";
  document.volumes[0].chapters[0].exclusiveEvent = "独占事件保留";
  document.beatSheets = [{ volumeId: f.first.id, volumeSortOrder: 1, status: "generated", beats: [] }, { volumeId: f.second.id, volumeSortOrder: 2, status: "generated", beats: [] }];
  document.rebalanceDecisions = [{ anchorVolumeId: f.second.id, affectedVolumeId: f.second.id, direction: "hold", severity: "low", summary: "未选卷保留", actions: [] }];
  document.critiqueReport = { overallRisk: "low", needsReplan: false, summary: "原战略审核", issues: [], recommendedActions: [] };
  const active = await f.db.volumePlanVersion.create({ data: { novelId: f.novelId, version: 1, status: "active", contentJson: JSON.stringify(document) } });
  const payload = { ...f.payload, baseRevision: await f.store.dependencies(f.novelId), volumeEdits: [{ ...f.edits[0], title: "只改第一卷" }] };
  await f.service.saveDraft(f.novelId, { expectedRevision: 1, payload });
  const preview = await f.volumes.preview(f.novelId, { draftRevision: 2, volumeIds: [f.first.id] });
  assert.ok(preview.references.some(ref => ref.sourceEntity === "VolumePlanVersion" && ref.sourceId === active.id));
  const receipt = await f.volumes.apply(f.novelId, preview.id);
  const applied = JSON.parse((await f.db.volumePlanVersion.findUniqueOrThrow({ where: { id: receipt.volumeVersionId } })).contentJson);
  assert.equal(applied.volumes[0].openingHook, document.volumes[0].openingHook);
  assert.equal(applied.volumes[0].chapters[0].exclusiveEvent, document.volumes[0].chapters[0].exclusiveEvent);
  assert.deepEqual(applied.beatSheets, [document.beatSheets[1]]);
  assert.deepEqual(applied.rebalanceDecisions, document.rebalanceDecisions);
  assert.deepEqual(applied.critiqueReport, document.critiqueReport);
  const frozen = await f.db.volumePlanVersion.findUniqueOrThrow({ where: { id: active.id } });
  assert.equal(frozen.status, "frozen");
  assert.equal(JSON.parse(frozen.contentJson).volumes[0].title, f.first.title);
});
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
  const service = { store: f.store, arrangementWorkspace: f.service.workspace.bind(f.service), saveArrangementDraft: f.service.saveDraft.bind(f.service), previewArrangement: f.service.preview.bind(f.service), applyArrangement: f.service.apply.bind(f.service), sceneExpressionCatalog: f.expressions.catalog.bind(f.expressions) };
  const routes = loadRuntimeSource(path.join(serverRoot, "src/modules/novel/adjustments/http/bookArrangementRoutes.ts"), { zod: require("zod"), "..": { adjustmentService: service }, "@ai-novel/shared/types/sceneExpressionTracks": require("@ai-novel/shared/types/sceneExpressionTracks"), "../../../../middleware/errorHandler": f.errors, "../application/BookArrangementService": f.arrangementModule, "../application/ChapterSceneArrangementService": { chapterScenePreviewSchema: { parse: value => value } }, "../application/SceneExpressionTrackService": { sceneExpressionSaveSchema: { parse: value => value }, sceneExpressionCatalogSaveSchema: { parse: value => value } }, "../domain/arrangementObjects": f.objectContracts });
  routes.registerBookArrangementRoutes(Object.fromEntries(["get", "put", "post"].map(method => [method, (route, handler) => handlers.set(`${method}:${route}`, handler)])));
  const req = { params: { id: f.novelId, candidateId: "candidate" }, body: {}, path: "/test", get: () => undefined };
  let response;
  await handlers.get("get:/:id/book-arrangement")(req, { json(value) { response = value; } }, error => { throw error; });
  assert.equal(response.success, true);
  await handlers.get("get:/:id/book-arrangement/scene-expression-definitions")(req, { json(value) { response = value; } }, error => { throw error; });
  assert.equal(response.data.revision, 0);
  assert.deepEqual(response.data.definitions.map(item => item.key), ["scene_pace", "sentence_cadence", "detail_expansion", "camera_distance", "language_ornament"]);
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

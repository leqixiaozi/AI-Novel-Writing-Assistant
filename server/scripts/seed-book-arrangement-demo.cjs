/* Development-only, additive fixture preparation for an explicitly selected existing novel. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const Database = require("better-sqlite3");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const marker = "arrangement-demo-v1";
const expressionDimensions = ["scene_pace", "sentence_cadence", "detail_expansion", "camera_distance", "language_ornament"];

function prepareDraft(original, chapters, people, novelId) {
  const payload = structuredClone(original);
  const id = (...parts) => `${marker}:${hash([novelId, ...parts]).slice(0, 28)}`;
  for (const [index, chapter] of chapters.entries()) {
    if (payload.chapterEdits.some(edit => edit.chapterId === chapter.id)) continue;
    const value = [0, 25, 50, 75, 100, 50, 25, 75][index % 8];
    payload.chapterEdits.push({ chapterId: chapter.id, note: "【演示】仅用于编排体验；按原章纲推进，不新增已发生事实。", locked: index === 7, controls: {
      pace: index === 6 ? { mode: "inherit" } : { mode: "set", value },
      tension: index === 5 ? { mode: "disabled" } : { mode: "set", value: 100 - value },
      suspicionTarget: { mode: "set", value: 50, subjectId: people[0].id, objectId: people[1].id, matter: "【演示】核对既有线索的来源" },
      dialogueDirectness: { mode: "set", value, speakerId: people[0].id, listenerId: people[1].id },
      characterProminence: { mode: "set", value: 75, characterId: people[index % people.length].id },
    } });
  }
  for (const [index, person] of people.entries()) {
    const available = chapters.filter((chapter, i) => i % 3 === index % 3 && !payload.characterSpans.some(span => span.characterId === person.id && span.chapterIds.includes(chapter.id)));
    for (let offset = 0; offset < available.length; offset += 2) {
      const chapterIds = available.slice(offset, offset + 2).map(chapter => chapter.id);
      payload.characterSpans.push({ id: id("span", person.id, ...chapterIds), characterId: person.id, chapterIds, mode: ["must", "suggested", "indirect", "forbidden"][index % 4], weight: [75, 50, 0, null][index % 4], note: "【演示】人物参与计划，可移动、拆分或修改；不代表历史出场。" });
    }
  }
  payload.pinnedTracks = [...new Set([...payload.pinnedTracks, "pace", "tension", "suspicionTarget", "dialogueDirectness", "characterProminence"])];
  return payload;
}

async function main() {
  process.chdir(path.resolve(__dirname, ".."));
  require("dotenv/config");
  if (process.env.NODE_ENV === "production") throw new Error("Only development databases may be seeded.");
  const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
  if (!args.includes("--novel-id") || !args.includes("--backup-dir")) throw new Error("Usage: --novel-id ID --backup-dir ABSOLUTE_DIRECTORY [--apply]");
  const novelId = arg("--novel-id"), backupRoot = arg("--backup-dir");
  if (!path.isAbsolute(backupRoot)) throw new Error("Backup directory must be absolute.");
  const { prisma } = require("../dist/db/prisma");
  const { AdjustmentStore } = require("../dist/modules/novel/adjustments/infrastructure/AdjustmentStore");
  const { BookArrangementService, arrangementDraftSchema } = require("../dist/modules/novel/adjustments/application/BookArrangementService");
  const { validateControlObjects } = require("../dist/modules/novel/adjustments/domain/contracts");
  const { parseChapterScenePlan } = require("@ai-novel/shared/types/chapterLengthControl");
  const store = new AdjustmentStore(prisma), service = new BookArrangementService(store);
  try {
    const workspace = await service.workspace(novelId);
    if (workspace.characters.length < 2 || !workspace.chapters.length) throw new Error("The selected novel needs existing chapters and at least two characters.");
    const sample = [...new Map([...workspace.chapters.slice(0, 8), ...workspace.chapters.slice(-8)].map(chapter => [chapter.id, chapter])).values()];
    const plan = { novelId, title: workspace.title, sampleOrders: sample.map(chapter => chapter.order), action: "add missing demo plans and draft settings only", apply: args.includes("--apply") };
    if (!plan.apply) { console.log(JSON.stringify(plan, null, 2)); return; }
    const dbList = await prisma.$queryRawUnsafe("PRAGMA database_list");
    const sourcePath = dbList.find(row => row.name === "main")?.file;
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("An existing SQLite database is required; never create an empty source.");
    const runDir = path.join(backupRoot, `${marker}-${Date.now()}`);
    fs.mkdirSync(runDir, { recursive: true });
    const backupPath = path.join(runDir, "before.sqlite");
    const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try { await sourceDb.backup(backupPath); } finally { sourceDb.close(); }
    const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backupDb.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed."); } finally { backupDb.close(); }
    const beforeChapters = await prisma.chapter.findMany({ where: { novelId }, orderBy: { id: "asc" } });
    const beforeHash = hash(beforeChapters), id = (...parts) => `${marker}:${hash([novelId, ...parts]).slice(0, 28)}`;
    fs.writeFileSync(path.join(runDir, "before.json"), JSON.stringify({ ...plan, backupPath, beforeHash, draft: workspace.draft }, null, 2));
    const upgraded = [];
    const created = await prisma.$transaction(async tx => {
      await new AdjustmentStore(tx).lockChapters(tx, novelId, sample.map(chapter => chapter.id), true);
      if (await tx.chapterAdjustmentGuard.count({ where: { novelId, manualSessionId: { not: null } } })) throw new Error("Finish active manual handoff before preparing demo data.");
      await tx.novel.update({ where: { id: novelId }, data: { sceneExpressionTracksEnabled: true } });
      const receipt = [];
      const add = async (model, data) => { if (!await tx[model].findUnique({ where: { id: data.id } })) { await tx[model].create({ data }); receipt.push({ model, id: data.id }); } };
      const maxEvent = await tx.storyTimelineEvent.aggregate({ where: { novelId }, _max: { eventOrder: true } });
      for (const [index, chapter] of sample.entries()) {
        if (!await tx.storyTimelineEvent.count({ where: { novelId, chapterId: chapter.id } })) await add("storyTimelineEvent", { id: id("event", chapter.id), novelId, chapterId: chapter.id, chapterIndex: chapter.order, eventOrder: (maxEvent._max.eventOrder ?? 0) + index + 1, title: `【演示计划】${chapter.title}`, summary: "仅供编排体验：按已有章纲核对线索来源、安排人物交换信息。尚未作为正文事实采纳。", type: "plot", status: "planned", visibility: "author", source: "manual", eventKey: id("event", chapter.id), confidence: 0, participantIdsJson: JSON.stringify([workspace.characters[index % workspace.characters.length].id, workspace.characters[(index + 1) % workspace.characters.length].id]) });
        if (!await tx.chapterPlanScene.count({ where: { plan: { novelId, chapterId: chapter.id, status: { not: "stale" } } } })) {
          const planId = id("plan", chapter.id);
          await add("storyPlan", { id: planId, novelId, chapterId: chapter.id, level: "chapter", title: `【演示场景草案】${chapter.title}`, objective: "体验场景编排；不替代原章纲或正文。", status: "draft", externalRef: marker });
          for (let scene = 0; scene < 2; scene++) await add("chapterPlanScene", { id: id("scene", chapter.id, scene), planId, sortOrder: scene + 1, title: scene ? "【演示】交锋与转折" : "【演示】线索核对", objective: scene ? "围绕原章纲安排一次信息交换" : "明确已有线索的来源和人物目标", conflict: "【演示】对同一条线索持不同解释", reveal: "只重述既有章纲的信息，不补造新事实", emotionBeat: scene ? "紧迫" : "试探" });
        }
        // Keep the demo's editable scene rows aligned with the original chapter's existing cards.
        // Only upgrade this script's untouched two-scene fixture; never replace user-created plans.
        const demoPlan = await tx.storyPlan.findUnique({ where: { id: id("plan", chapter.id) }, include: { scenes: { orderBy: { sortOrder: "asc" } } } });
        const originalChapter = await tx.chapter.findUnique({ where: { id: chapter.id }, select: { sceneCards: true } });
        const originalCards = parseChapterScenePlan(originalChapter?.sceneCards);
        if (demoPlan?.externalRef === marker && demoPlan.scenes.length === 2 && demoPlan.scenes[0].title === "【演示】线索核对" && demoPlan.scenes[1].title === "【演示】交锋与转折" && originalCards) {
          for (const [sceneIndex, card] of originalCards.scenes.entries()) {
            const sceneId = id("scene", chapter.id, sceneIndex);
            const data = { title: card.title, objective: card.purpose, conflict: card.resistance || null, reveal: card.turn || null, emotionBeat: card.emotionalShift || null, sortOrder: sceneIndex + 1 };
            const old = demoPlan.scenes.find(scene => scene.id === sceneId);
            if (old) { await tx.chapterPlanScene.update({ where: { id: sceneId }, data }); upgraded.push({ model: "chapterPlanScene", id: sceneId, before: old, after: data }); }
            else await add("chapterPlanScene", { id: sceneId, planId: demoPlan.id, ...data });
          }
        }
        const expressionScenes = await tx.chapterPlanScene.findMany({ where: { planId: id("plan", chapter.id) }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
        for (const [sceneIndex, scene] of expressionScenes.entries()) {
          for (const [dimensionIndex, dimensionKey] of expressionDimensions.entries()) {
            // Leave occasional bindings unset so the demo also exposes the base-writing state.
            if ((index + sceneIndex + dimensionIndex) % 9 === 8) continue;
            if (!await tx.sceneExpressionPoint.count({ where: { novelId, sceneId: scene.id, dimensionKey } })) await add("sceneExpressionPoint", {
              id: id("expression", scene.id, dimensionKey), novelId, sceneId: scene.id, dimensionKey,
              level: ((index + sceneIndex + dimensionIndex) % 5) + 1,
              note: "【演示】只约束本场景的表达方式，不改变场景任务、事件、人物或事实。",
              revision: 1,
            });
          }
        }
        if (index % 4 === 0 && !await tx.characterRelationStage.count({ where: { novelId, chapterId: chapter.id } })) await add("characterRelationStage", { id: id("relation", chapter.id), novelId, chapterId: chapter.id, chapterOrder: chapter.order, sourceCharacterId: workspace.characters[0].id, targetCharacterId: workspace.characters[(index / 4 + 1) % (workspace.characters.length - 1) + 1].id, sourceType: "arrangement_plan", stageLabel: "【演示目标】由试探转为有限合作", stageSummary: "规划目标，不代表本章已经发生关系变化。", nextTurnPoint: "通过既有线索核对决定合作条件", confidence: 0, isCurrent: true });
        const demoRelation = await tx.characterRelationStage.findUnique({ where: { id: id("relation", chapter.id) } });
        if (demoRelation?.novelId === novelId && demoRelation.sourceType === "volume_projection" && demoRelation.stageLabel === "【演示目标】由试探转为有限合作" && demoRelation.confidence === 0) {
          await tx.characterRelationStage.update({ where: { id: demoRelation.id }, data: { sourceType: "arrangement_plan" } });
          upgraded.push({ model: "characterRelationStage", id: demoRelation.id, before: demoRelation, sourceType: "arrangement_plan" });
        }
        if (index % 4 === 1 && !await tx.timelineHook.count({ where: { novelId, createdInChapterId: chapter.id } })) await add("timelineHook", { id: id("hook", chapter.id), novelId, createdInChapterId: chapter.id, createdInChapterIndex: chapter.order, expectedResolveByChapterIndex: sample[Math.min(index + 2, sample.length - 1)].order, title: "【演示计划】待核对的线索来源", description: "计划伏笔，仅用于体验铺设与预计回收位置；尚未在正文确认。", status: "planned", priority: "low", blocking: false, resolveMode: "long_arc", participantIdsJson: JSON.stringify([workspace.characters[0].id]) });
      }
      const row = await tx.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: "book-arrangement:draft" } } });
      if ((row?.revision ?? 0) !== workspace.draft.revision) throw new Error("Draft changed while backing up; retry without overwriting the user's changes.");
      const payload = prepareDraft(row ? JSON.parse(row.payloadJson) : workspace.draft.payload, sample, workspace.characters, novelId);
      payload.baseRevision = await new AdjustmentStore(tx).dependencies(novelId);
      arrangementDraftSchema.parse(payload);
      for (const edit of payload.chapterEdits) validateControlObjects(edit.controls, new Set(workspace.characters.map(person => person.id)));
      if (!row) await tx.writingSetting.create({ data: { id: id("draft"), novelId, scopeKey: "book-arrangement:draft", payloadJson: JSON.stringify(payload) } });
      else if (row.payloadJson !== JSON.stringify(payload)) { const result = await tx.writingSetting.updateMany({ where: { id: row.id, revision: row.revision }, data: { payloadJson: JSON.stringify(payload), revision: { increment: 1 } } }); if (result.count !== 1) throw new Error("Draft CAS failed."); }
      if (hash(await tx.chapter.findMany({ where: { novelId }, orderBy: { id: "asc" } })) !== beforeHash) throw new Error("Chapter contents or metadata changed; rollback fixture preparation.");
      return receipt;
    }, { timeout: 60000, isolationLevel: "Serializable" });
    const after = await service.workspace(novelId);
    const result = { ...plan, backupPath, backupBytes: fs.statSync(backupPath).size, integrity: "ok", chapterHashPreserved: hash(await prisma.chapter.findMany({ where: { novelId }, orderBy: { id: "asc" } })) === beforeHash, created, upgraded, counts: { events: after.events.length, scenes: after.scenes.length, expressionPoints: after.sceneExpressionPoints.length, relations: after.relations.length, clues: after.clues.length, characterSpans: after.draft.payload.characterSpans.length, chapterEdits: after.draft.payload.chapterEdits.length } };
    fs.writeFileSync(path.join(runDir, "receipt.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, created: created.length, upgraded: upgraded.length, receipt: path.join(runDir, "receipt.json") }, null, 2));
  } finally { await prisma.$disconnect(); }
}
module.exports = { prepareDraft };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

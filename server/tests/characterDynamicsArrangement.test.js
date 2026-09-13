const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");
const { arrangementRelationInScope, CharacterDynamicsQueryService } = loadRuntimeSource(path.resolve(__dirname, "../src/services/novel/dynamics/CharacterDynamicsQueryService.ts"), {
  "../../../db/prisma": { prisma: {} },
  "./characterDynamicsShared": {},
  "./characterDynamicsUtils": {},
});

test("arrangement relationship plans follow stable chapter references and do not leak future stages", () => {
  const plan = { sourceType: "arrangement_plan", isCurrent: true, chapterId: "chapter-8", volumeId: "volume-1", chapterOrder: 4 };
  assert.equal(arrangementRelationInScope(plan, "chapter-4", "volume-1"), false);
  assert.equal(arrangementRelationInScope(plan, "chapter-8", "volume-2"), true);
  assert.equal(arrangementRelationInScope({ ...plan, isCurrent: false }, "chapter-8", "volume-1"), false);
  assert.equal(arrangementRelationInScope({ ...plan, chapterId: null }, "chapter-4", "volume-1"), true);
  assert.equal(arrangementRelationInScope({ ...plan, chapterId: null }, "chapter-4", "volume-2"), false);
  assert.equal(arrangementRelationInScope({ ...plan, chapterId: null, volumeId: null }, null, null), false);
  assert.equal(arrangementRelationInScope({ ...plan, sourceType: "manual_override" }, "chapter-4", "volume-1"), true);
});

test("relationship plans have a separate prompt section and legacy digests keep their previous shape", () => {
  const service = new CharacterDynamicsQueryService();
  const relation = { sourceCharacterName: "甲", targetCharacterName: "乙", stageLabel: "试探", stageSummary: "原关系", sourceType: "manual_override" };
  const overview = { summary: "summary", characters: [], relations: [relation], pendingCandidateCount: 0, currentVolume: null };
  const original = service.formatContextDigest(overview);
  assert.equal(original, "Dynamic character system summary: summary\n\nCurrent volume: unavailable\n\nVolume assignments and risks:\nnone\n\nCurrent relationship stages:\n甲 -> 乙: 试探 | 原关系\n\nPending character candidates: 0 (do not inject into generation until confirmed)");
  const withPlan = service.formatContextDigest({ ...overview, plannedRelations: [{ ...relation, isCurrent: true, sourceType: "arrangement_plan", stageLabel: "结盟", stageSummary: "本章目标" }] });
  assert.match(withPlan, /targets, not established facts/);
  assert.doesNotMatch(withPlan.split("Author relationship plans")[0], /结盟|本章目标/);
});

const fact = { id: "fact", novelId: "n", sourceCharacterId: "a", targetCharacterId: "b", sourceCharacterName: "甲", targetCharacterName: "乙", stageLabel: "试探", stageSummary: "保持戒备", sourceType: "manual_override", isCurrent: true, chapterId: "chapter-4", volumeId: "volume-1", createdAt: "2026-09-13", updatedAt: "2026-09-13" };
const plan = { ...fact, id: "plan", stageLabel: "结盟", stageSummary: "作者目标", sourceType: "arrangement_plan", chapterId: "chapter-8" };

test("overview separates author goals from facts and ignores moved, inactive and foreign-volume plans", async () => {
  const { CharacterDynamicsQueryService: Query } = loadRuntimeSource(path.resolve(__dirname, "../src/services/novel/dynamics/CharacterDynamicsQueryService.ts"), {
    "../../../db/prisma": { prisma: {
      novel: { findUnique: async () => ({ chapters: [{ id: "chapter-4", order: 4, content: "" }, { id: "chapter-8", order: 20, content: "" }], characters: [], volumePlans: [] }) },
      characterCandidate: { findMany: async () => [] }, characterVolumeAssignment: { findMany: async () => [] }, characterFactionTrack: { findMany: async () => [] }, characterTimeline: { findMany: async () => [] },
      characterRelationStage: { findMany: async () => [fact, plan, { ...plan, id: "disabled", isCurrent: false }, { ...plan, id: "other-volume", chapterId: null, volumeId: "volume-2" }] },
    } },
    "./characterDynamicsShared": { PROJECTION_SOURCE_TYPES: ["volume_projection"], compareDynamicRows: () => 0 },
    "./characterDynamicsUtils": { buildVolumeWindows: () => [], resolveCurrentVolume: () => ({ id: "volume-1", title: "第一卷" }), toCharacterRelationStage: row => row, buildOverviewSummary: input => `facts:${input.relationStageCount}` },
  });
  const query = new Query();
  const chapter4 = await query.getOverview("n", { chapterOrder: 4 });
  assert.deepEqual(chapter4.relations.map(item => item.id), ["fact"]);
  assert.equal(Object.hasOwn(chapter4, "plannedRelations"), false);
  const movedChapter8 = await query.getOverview("n", { chapterOrder: 20 });
  assert.deepEqual(movedChapter8.plannedRelations.map(item => item.id), ["plan"]);
  assert.equal(movedChapter8.summary, "facts:1");
});

test("canonical snapshots never copy author targets into attained relationship labels", async () => {
  let where;
  const { CanonicalStateService } = loadRuntimeSource(path.resolve(__dirname, "../src/services/novel/state/CanonicalStateService.ts"), {
    "../../../db/prisma": { prisma: {
      novel: { findUnique: async () => ({ id: "n", title: "小说", characters: [{ id: "a", name: "甲", role: "主角" }], volumePlans: [] }) },
      storyStateSnapshot: { findFirst: async () => null }, characterRelationStage: { findMany: async input => { where = input.where; return [fact, plan]; } },
      openConflict: { findMany: async () => [] }, payoffLedgerItem: { findMany: async () => [] }, chapter: { findMany: async () => [] },
    } },
    "../characterResource/CharacterResourceLedgerService": { characterResourceLedgerService: { listResources: async () => [], buildCharacterSummaries: () => [] } },
  });
  const result = await new CanonicalStateService().getSnapshot("n", { chapterOrder: 4 });
  assert.deepEqual(where.sourceType, { not: "arrangement_plan" });
  assert.deepEqual(result.characters[0].relationStageLabels, ["试探"]);
  assert.doesNotMatch(JSON.stringify(result), /结盟|作者目标/);
});

test("chapter guidance keeps plans out of current character behavior and only renders matching stable chapter targets", () => {
  const shared = loadRuntimeSource(path.resolve(__dirname, "../src/prompting/prompts/novel/chapterLayeredContextShared.ts"), {
    "@ai-novel/shared/types/chapterLengthControl": {}, "../../../services/styleEngine/styleContractText": {},
  });
  const { buildDynamicCharacterGuidance } = loadRuntimeSource(path.resolve(__dirname, "../src/prompting/prompts/novel/chapterLayeredContextCharacters.ts"), { "./chapterLayeredContextShared": shared });
  const character = { characterId: "a", name: "甲", role: "主角", isCoreInVolume: false, plannedChapterOrders: [], absenceRisk: "none", absenceSpan: 0 };
  const context = { chapter: { id: "chapter-8", order: 20 }, characterRoster: [{ id: "a", name: "甲", role: "主角" }], openConflicts: [], characterDynamics: { characters: [character], relations: [fact, plan], plannedRelations: [plan], candidates: [], currentVolume: { id: "volume-1" } } };
  const result = buildDynamicCharacterGuidance(context);
  assert.deepEqual(result.activeRelationStages.map(item => item.stageLabel), ["试探"]);
  assert.deepEqual(result.characterBehaviorGuides[0].relationStageLabels, ["试探"]);
  assert.equal(result.plannedRelationStages[0].isCurrent, false);
  const text = shared.buildRelationStageText(result);
  assert.match(text, /作者关系目标，尚未发生/);
  assert.doesNotMatch(text.split("作者关系目标")[0], /结盟/);
  const earlier = buildDynamicCharacterGuidance({ ...context, chapter: { id: "chapter-4", order: 4 } });
  assert.equal(earlier.plannedRelationStages, undefined);
  assert.equal(shared.buildRelationStageText(earlier), "活跃关系阶段：\n- 甲 -> 乙：试探 | 保持戒备");
});

test("planner context returns separate optional target text without modifying legacy facts", () => {
  const { buildPlannerCharacterDynamicsContext } = loadRuntimeSource(path.resolve(__dirname, "../src/services/planner/plannerContextHelpers.ts"), {
    "../payoff/payoffLedgerShared": {}, "../styleEngine/styleContractText": {}, "../storyMode/storyModeProfile": {}, "../novel/dynamics/CharacterDynamicsQueryService": {},
  });
  const overview = { summary: "summary", characters: [], relations: [fact], candidates: [], pendingCandidateCount: 0, currentVolume: null };
  const legacy = buildPlannerCharacterDynamicsContext(overview);
  assert.equal(Object.hasOwn(legacy, "plannedRelationStages"), false);
  const current = buildPlannerCharacterDynamicsContext({ ...overview, relations: [fact, plan], plannedRelations: [plan] });
  assert.equal(current.relationStages, legacy.relationStages);
  assert.match(current.plannedRelationStages, /结盟/);
  assert.doesNotMatch(current.summary, /结盟/);
});

test("runtime schema keeps the optional plan channel while leaving old overview JSON unchanged", () => {
  const { runtimeDynamicCharacterOverviewSchema } = loadRuntimeSource(path.resolve(__dirname, "../../shared/types/chapterRuntime/dynamicCharacterSchemas.ts"), { zod: require("zod") });
  const overview = { novelId: "n", summary: "summary", characters: [], relations: [fact], candidates: [], factionTracks: [], assignments: [], pendingCandidateCount: 0, currentVolume: null };
  assert.deepEqual(runtimeDynamicCharacterOverviewSchema.parse(overview), overview);
  assert.deepEqual(runtimeDynamicCharacterOverviewSchema.parse({ ...overview, plannedRelations: [plan] }).plannedRelations, [plan]);
});

import type { Prisma } from "@prisma/client";
import type { BookArrangementObjectKind } from "@ai-novel/shared/types/bookArrangement";
import { buildChapterExecutionContractHash } from "../../../../services/planner/plannerPersistence";
import { synchronizeArrangementSceneCards } from "./ArrangementSceneCards";

export async function findArrangementObject(db: Prisma.TransactionClient, novelId: string, kind: BookArrangementObjectKind, id: string): Promise<Record<string, any> | null> {
  switch (kind) {
    case "event": return db.storyTimelineEvent.findFirst({ where: { id, novelId } });
    case "scene": return db.chapterPlanScene.findFirst({ where: { id, plan: { novelId } }, include: { plan: true } });
    case "relation": return db.characterRelationStage.findFirst({ where: { id, novelId, sourceCharacter: { novelId }, targetCharacter: { novelId } } });
    case "hook": return db.timelineHook.findFirst({ where: { id, novelId } });
    case "hookNode": return db.timelineHookLifecycleNode.findFirst({ where: { id, novelId, active: true } });
    case "foreshadow": return db.foreshadowState.findFirst({ where: { id, snapshot: { novelId } }, include: { snapshot: { select: { id: true, novelId: true, sourceChapterId: true, updatedAt: true } } } });
  }
}

/** Scene positioning updates only the two involved plans, retaining every scene ID. */
export async function writeArrangementObject(db: Prisma.TransactionClient, input: {
  novelId: string; kind: BookArrangementObjectKind; action: "create" | "update" | "delete";
  objectId: string; row: Record<string, any>; old: Record<string, any> | null;
  targetPlan?: { id: string; create?: { chapterId: string; title: string; objective: string } };
}) {
  const { kind, action, objectId, novelId, row, old } = input;
  if (kind === "event") {
    if (action === "create") await db.storyTimelineEvent.create({ data: { ...row, id: objectId, novelId } as Prisma.StoryTimelineEventUncheckedCreateInput });
    else await db.storyTimelineEvent.update({ where: { id: objectId }, data: row });
  } else if (kind === "relation") {
    if (action === "create") await db.characterRelationStage.create({ data: { ...row, id: objectId, novelId } as Prisma.CharacterRelationStageUncheckedCreateInput });
    else await db.characterRelationStage.update({ where: { id: objectId }, data: row });
  } else if (kind === "hook") {
    if (action === "create") await db.timelineHook.create({ data: { ...row, id: objectId, novelId } as Prisma.TimelineHookUncheckedCreateInput });
    else await db.timelineHook.update({ where: { id: objectId }, data: row });
  } else if (kind === "hookNode") {
    if (action === "create") await db.timelineHookLifecycleNode.create({ data: { ...row, id: objectId, novelId } as Prisma.TimelineHookLifecycleNodeUncheckedCreateInput });
    else if (action === "delete") await db.timelineHookLifecycleNode.update({ where: { id: objectId }, data: { active: false } });
    else await db.timelineHookLifecycleNode.update({ where: { id: objectId }, data: row });
  } else if (kind === "scene") {
    if (input.targetPlan?.create) await db.storyPlan.create({ data: { id: input.targetPlan.id, novelId, level: "chapter", status: "draft", ...input.targetPlan.create } });
    const planId = input.targetPlan?.id ?? old!.planId;
    const changedPlanIds = [...new Set([planId, old?.planId].filter(Boolean) as string[])];
    const snapshots = [];
    for (const id of changedPlanIds) {
      const plan = await db.storyPlan.findUniqueOrThrow({ where: { id }, include: { scenes: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
      const chapter = plan.chapterId ? await db.chapter.findFirst({ where: { id: plan.chapterId, novelId } }) : null;
      if (chapter) snapshots.push({ chapterId: chapter.id, sceneCards: chapter.sceneCards, scenes: plan.scenes });
    }
    const targetScenes = await db.chapterPlanScene.findMany({ where: { planId, id: { not: objectId } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    if (action === "delete") await db.chapterPlanScene.delete({ where: { id: objectId } });
    else {
      if (action === "create") await db.chapterPlanScene.create({ data: { ...row, id: objectId, planId } as Prisma.ChapterPlanSceneUncheckedCreateInput });
      else await db.chapterPlanScene.update({ where: { id: objectId }, data: { ...row, planId } });
      targetScenes.splice(Math.max(0, Math.min(targetScenes.length, Number(row.sortOrder) - 1)), 0, { id: objectId } as typeof targetScenes[number]);
    }
    for (const [index, scene] of targetScenes.entries()) await db.chapterPlanScene.update({ where: { id: scene.id }, data: { sortOrder: index + 1 } });
    if (old && old.planId !== planId) {
      const sourceScenes = await db.chapterPlanScene.findMany({ where: { planId: old.planId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
      for (const [index, scene] of sourceScenes.entries()) await db.chapterPlanScene.update({ where: { id: scene.id }, data: { sortOrder: index + 1 } });
    }
    // Explicitly accepted scenes satisfy the same contract check as original planner output.
    // Keep the other raw fields as provenance; current scene rows carry the accepted ordering.
    for (const changedPlanId of changedPlanIds) {
      const plan = await db.storyPlan.findUniqueOrThrow({ where: { id: changedPlanId } });
      const chapter = plan.chapterId ? await db.chapter.findFirst({ where: { id: plan.chapterId, novelId } }) : null;
      if (!chapter || plan.status === "stale") continue;
      const scenes = await db.chapterPlanScene.findMany({ where: { planId: changedPlanId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
      const sceneCards = synchronizeArrangementSceneCards(chapter.id, scenes, snapshots);
      await db.chapter.update({ where: { id: chapter.id }, data: { sceneCards } });
      let raw: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(plan.rawPlanJson ?? "{}");
        raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { previousRawPlan: parsed };
      } catch { raw = { previousRawPlan: plan.rawPlanJson }; }
      await db.storyPlan.update({ where: { id: changedPlanId }, data: {
        rawPlanJson: JSON.stringify({ ...raw, executionContractHash: buildChapterExecutionContractHash({ ...chapter, sceneCards }) }),
        updatedAt: new Date(),
      } });
    }
  }
}

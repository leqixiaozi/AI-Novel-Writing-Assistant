import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { WritingAdjustmentScope, WritingEditVersion } from "@ai-novel/shared/types/writingAdjustments";
import { prisma } from "../../../../db/prisma";
import { AppError } from "../../../../middleware/errorHandler";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";
import { recordOperationResult, runOperationOnce, withDeferredOperationResult, type OperationLeaseOptions } from "./OperationLease";

export class AdjustmentStore {
  constructor(readonly db: PrismaClient = prisma, readonly operationLeaseOptions?: OperationLeaseOptions) {}
  recordResult<T>(tx: Prisma.TransactionClient, output: T): Promise<T> { return recordOperationResult(tx, output); }
  withDeferredResult<T>(fn: () => T): T { return withDeferredOperationResult(fn); }
  async lockChapters(tx: Prisma.TransactionClient, novelId: string, ids: string[], requireSettledSync = false) {
    for (const id of [...new Set(ids)].sort()) await tx.$executeRaw`UPDATE "Chapter" SET "id" = "id" WHERE "id" = ${id} AND "novelId" = ${novelId}`;
    if (requireSettledSync && await tx.writingAcceptance.count({ where: { novelId, chapterId: { in: ids }, status: { in: ["pending", "running", "failed"] } } })) conflict("相关章节的已采纳正文尚未同步完成，请先完成同步；需要更换正文时可采纳新稿替代旧稿。", "SYNC_PENDING");
  }
  async novel(novelId: string) {
    const novel = await this.db.novel.findUnique({ where: { id: novelId } });
    if (!novel) throw new AppError("小说不存在。", 404);
    return novel;
  }
  async chapter(novelId: string, chapterId: string) {
    const chapter = await this.db.chapter.findFirst({ where: { id: chapterId, novelId } });
    if (!chapter) throw new AppError("章节不存在。", 404);
    return chapter;
  }
  /** Read author background without triggering world generation or state synchronization. */
  async writingBackground(novelId: string, chapterOrder: number, chapterId: string) {
    const [novel, worldInstance, relations, stages] = await Promise.all([
      this.novel(novelId),
      this.db.novelWorld.findUnique({ where: { novelId }, select: { title: true, coverSummary: true, structuredDataJson: true, storySliceJson: true, bindingContractJson: true } }),
      this.db.characterRelation.findMany({ where: { novelId }, orderBy: { id: "asc" }, select: { id: true, sourceCharacterId: true, targetCharacterId: true, surfaceRelation: true, hiddenTension: true, conflictSource: true, secretAsymmetry: true } }),
      this.db.characterRelationStage.findMany({ where: { novelId, OR: [{ chapter: { order: { lte: chapterOrder } } }, { chapterId: null, chapterOrder: { lte: chapterOrder } }] }, orderBy: [{ chapterOrder: "asc" }, { id: "asc" }], select: { sourceCharacterId: true, targetCharacterId: true, stageLabel: true, stageSummary: true, sourceType: true, chapterOrder: true, chapter: { select: { order: true } } } }),
    ]);
    const worldTemplate = !worldInstance && novel.worldId ? await this.db.world.findUnique({ where: { id: novel.worldId }, select: { name: true, background: true, axioms: true, geography: true, cultures: true, magicSystem: true, politics: true, economy: true, factions: true, history: true } }) : null;
    const tasks = await this.db.storyTimelineEvent.findMany({ where: { novelId, chapterId, status: { not: "cancelled" } }, orderBy: [{ eventOrder: "asc" }, { id: "asc" }], select: { id: true, title: true, summary: true, status: true, source: true, type: true, prerequisiteIdsJson: true, participantIdsJson: true } });
    const prerequisiteIds = tasks.flatMap(task => parseJson<string[]>(task.prerequisiteIdsJson, []));
    const prerequisites = prerequisiteIds.length ? await this.db.storyTimelineEvent.findMany({ where: { novelId, id: { in: prerequisiteIds }, chapterIndex: { lt: chapterOrder }, status: { not: "cancelled" } }, select: { id: true, title: true, summary: true, status: true, source: true } }) : [];
    return {
      authorBackground: { description: novel.description, targetAudience: novel.targetAudience, bookSellingPoint: novel.bookSellingPoint, styleTone: novel.styleTone },
      world: worldInstance ? { source: "本书世界设定", title: worldInstance.title, summary: worldInstance.coverSummary, structure: parseJson(worldInstance.structuredDataJson, null), slice: parseJson(worldInstance.storySliceJson, null), contract: parseJson(worldInstance.bindingContractJson, null) } : { source: "本书关联世界样本", template: worldTemplate, slice: parseJson(novel.storyWorldSliceJson, null) },
      authorRelationBackground: relations,
      chapterTasks: tasks.map(({ prerequisiteIdsJson, participantIdsJson, ...task }) => ({ ...task, participantIds: parseJson(participantIdsJson, []), prerequisites: prerequisites.filter(item => parseJson<string[]>(prerequisiteIdsJson, []).includes(item.id)) })),
      chapterRelationStages: stages.map(stage => ({ ...stage, chapter: undefined, chapterOrder: stage.chapter?.order ?? stage.chapterOrder })),
      usageBoundary: "人物背景、秘密和世界设定供作者保持一致，不等于角色已知，也不授权提前揭露。关系背景不是开篇实时状态；关系阶段只查询至本章，计划来源仍是待发生安排。本章之前的已确认历史及本章任务决定实际知情与关系。未查询到的资料保持未知。",
    };
  }
  async chapters(novelId: string, scope: WritingAdjustmentScope) {
    await this.novel(novelId);
    const ids = scope.kind === "novel" ? null : scope.kind === "chapters" ? scope.chapterIds : scope.chapterId ? [scope.chapterId] : [];
    if (ids && (!ids.length || new Set(ids).size !== ids.length)) throw new AppError("请选择有效且不重复的章节范围。", 400);
    const rows = await this.db.chapter.findMany({ where: { novelId, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { order: "asc" } });
    if (!rows.length || (ids && rows.length !== ids.length)) throw new AppError("所选章节不属于当前作品或已删除。", 400);
    if (scope.kind === "selection") {
      const s = scope.selection;
      // The editor may contain unsaved text. Validate its actual snapshot at generation.
      if (!s || s.to <= s.from || s.to - s.from !== s.text.length) throw new AppError("选区已变化，请重新选择。", 400);
    }
    if (scope.kind === "scene") {
      const scene = await this.db.chapterPlanScene.findFirst({ where: { id: scope.sceneId, plan: { novelId, chapterId: scope.chapterId } } });
      if (!scene) throw new AppError("场景未找到，请从本章场景中选择。", 400);
    }
    return rows;
  }
  async dependencies(novelId: string) {
    const [novel, chapters, characters, canon, plans, decisions, events, scenes, backgroundRevisions] = await Promise.all([
      this.novel(novelId),
      this.db.chapter.findMany({ where: { novelId }, select: { id: true, content: true, expectation: true, order: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.character.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.canonicalStateVersion.findFirst({ where: { novelId }, orderBy: { version: "desc" }, select: { id: true, version: true } }),
      this.db.volumePlanVersion.findFirst({ where: { novelId, status: "active" }, orderBy: { version: "desc" }, select: { id: true, version: true } }),
      this.db.creativeDecision.findMany({ where: { novelId, adjustmentJson: { not: null } }, select: { id: true, adjustmentJson: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.storyTimelineEvent.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.storyPlan.findMany({ where: { novelId }, select: { id: true, updatedAt: true, scenes: { select: { id: true, updatedAt: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
      Promise.all([
        this.db.novelWorld.findUnique({ where: { novelId }, select: { updatedAt: true } }),
        this.db.world.findMany({ where: { novels: { some: { id: novelId } } }, select: { id: true, updatedAt: true } }),
        this.db.characterRelation.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
        this.db.characterRelationStage.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
        this.db.sceneExpressionPoint.findMany({ where: { novelId }, select: { id: true, revision: true }, orderBy: { id: "asc" } }),
        this.db.sceneExpressionTrackCatalog.findUnique({ where: { novelId }, select: { revision: true } }),
      ]),
    ]);
    return digest({ novel: novel.updatedAt, chapters: chapters.map(c => [c.id, chapterRevision(c)]), characters, canon, plans, decisions, events, scenes, backgroundRevisions });
  }
  async version(novelId: string, chapterId: string, id: string) {
    const row = await this.db.chapterEditVersion.findFirst({ where: { id, novelId, chapterId } });
    if (!row) throw new AppError("稿件版本不存在。", 404);
    return row;
  }
  mapVersion(row: Awaited<ReturnType<AdjustmentStore["version"]>>): WritingEditVersion {
    return { ...row, metadata: parseJson(row.metadataJson, {}), createdAt: row.createdAt.toISOString() };
  }
  async createVersion(input: { novelId: string; chapterId: string; kind: string; content: string; baseRevision: string; requirementsId?: string; sessionId?: string; metadata?: Record<string, unknown>; operationResult?: (version: WritingEditVersion) => unknown }) {
    return this.db.$transaction(async tx => {
      const row = await tx.chapterEditVersion.create({ data: { id: randomUUID(), novelId: input.novelId, chapterId: input.chapterId, sessionId: input.sessionId ?? randomUUID(), kind: input.kind, content: input.content, contentHash: digest(input.content), baseRevision: input.baseRevision, requirementsId: input.requirementsId, metadataJson: JSON.stringify(input.metadata ?? {}) } });
      const dependencies = await tx.directorArtifact.findMany({ where: { novelId: input.novelId, status: { in: ["accepted", "active", "ready", "approved"] }, OR: [{ targetId: input.chapterId }, { targetType: "novel" }] }, select: { id: true, version: true }, take: 100, orderBy: { updatedAt: "desc" } });
      const artifact = await tx.directorArtifact.create({ data: { id: randomUUID(), novelId: input.novelId, artifactType: "writing_adjustment", targetType: "chapter", targetId: input.chapterId, status: "candidate", source: "manual_adjustment", contentTable: "ChapterEditVersion", contentId: row.id, contentHash: row.contentHash, schemaVersion: "v1", protectedUserContent: input.kind === "draft", promptAssetKey: typeof input.metadata?.promptId === "string" ? input.metadata.promptId : undefined, promptVersion: typeof input.metadata?.promptVersion === "string" ? input.metadata.promptVersion : undefined } });
      if (dependencies.length) await tx.directorArtifactDependency.createMany({ data: dependencies.map(dep => ({ artifactId: artifact.id, dependsOnArtifactId: dep.id, dependsOnVersion: dep.version })) });
      const mapped = this.mapVersion(row);
      await this.recordResult(tx, input.operationResult ? input.operationResult(mapped) : mapped);
      return mapped;
    });
  }
  async once<T>(novelId: string, operation: string, key: string, input: unknown, action: () => Promise<T>): Promise<T> {
    return runOperationOnce(this.db, novelId, operation, key, input, action, this.operationLeaseOptions);
  }
}

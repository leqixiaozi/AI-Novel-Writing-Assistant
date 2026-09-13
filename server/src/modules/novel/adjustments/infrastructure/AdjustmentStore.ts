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
    const [novel, chapters, characters, canon, plans, decisions, events, scenes] = await Promise.all([
      this.novel(novelId),
      this.db.chapter.findMany({ where: { novelId }, select: { id: true, content: true, expectation: true, order: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.character.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.canonicalStateVersion.findFirst({ where: { novelId }, orderBy: { version: "desc" }, select: { id: true, version: true } }),
      this.db.volumePlanVersion.findFirst({ where: { novelId, status: "active" }, orderBy: { version: "desc" }, select: { id: true, version: true } }),
      this.db.creativeDecision.findMany({ where: { novelId, adjustmentJson: { not: null } }, select: { id: true, adjustmentJson: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.storyTimelineEvent.findMany({ where: { novelId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
      this.db.storyPlan.findMany({ where: { novelId }, select: { id: true, updatedAt: true, scenes: { select: { id: true, updatedAt: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
    ]);
    return digest({ novel: novel.updatedAt, chapters: chapters.map(c => [c.id, chapterRevision(c)]), characters, canon, plans, decisions, events, scenes });
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

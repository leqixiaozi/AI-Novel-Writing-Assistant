import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ManualWritingSession, WritingAcceptanceReceipt, WritingReview } from "@ai-novel/shared/types/writingAdjustments";
import { AppError } from "../../../../middleware/errorHandler";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";
import { runWithAuthorizedManualSession, runWithCapturedAdjustmentFence } from "../infrastructure/fence";

export class WritingGovernanceService {
  constructor(readonly store: AdjustmentStore) {}
  async beginManual(novelId: string, input: { chapterIds: string[]; taskId?: string; runtimeId?: string }): Promise<ManualWritingSession> {
    const chapters = await this.store.chapters(novelId, { kind: "chapters", chapterIds: input.chapterIds });
    if (input.taskId && !await this.store.db.novelWorkflowTask.findFirst({ where: { id: input.taskId, novelId } })) throw new AppError("导演任务不属于当前作品。", 400);
    if (input.runtimeId && !await this.store.db.directorRuntimeInstance.findFirst({ where: { id: input.runtimeId, novelId, ...(input.taskId ? { workflowTaskId: input.taskId } : {}) } })) throw new AppError("运行记录不属于当前作品或任务。", 400);
    const id = randomUUID();
    await this.store.db.$transaction(async tx => {
      await this.store.lockChapters(tx, novelId, chapters.map(c => c.id), true);
      for (const chapter of chapters) {
        const guard = await tx.chapterAdjustmentGuard.upsert({ where: { chapterId: chapter.id }, create: { novelId, chapterId: chapter.id }, update: {} });
        if (guard.manualSessionId) conflict("所选范围已被接管，请先完成现有调整。", "MANUAL_EDIT_REQUIRED");
        const claim = await tx.chapterAdjustmentGuard.updateMany({ where: { chapterId: chapter.id, epoch: guard.epoch, manualSessionId: null }, data: { epoch: { increment: 1 }, manualSessionId: id } });
        if (claim.count !== 1) conflict("接管范围正在变化，请刷新。", "MANUAL_EDIT_REQUIRED");
      }
      await tx.manualEditSession.create({ data: { id, novelId, taskId: input.taskId, runtimeId: input.runtimeId, scopeJson: JSON.stringify(chapters.map(c => c.id)), status: "active", payloadJson: JSON.stringify({ baseRevisions: Object.fromEntries(chapters.map(c => [c.id, chapterRevision(c)])) }) } });
      if (input.taskId) await tx.novelWorkflowTask.update({ where: { id: input.taskId }, data: { pendingManualRecovery: true, status: "waiting_approval", checkpointSummary: "作者正在调整所选章节。" } });
      await this.store.recordResult(tx, { id, chapterIds: chapters.map(c => c.id), status: "active", taskId: input.taskId, runtimeId: input.runtimeId });
    });
    return { id, chapterIds: chapters.map(c => c.id), status: "active", taskId: input.taskId, runtimeId: input.runtimeId };
  }
  async completeManual(novelId: string, sessionId: string): Promise<ManualWritingSession> {
    const session = await this.store.db.manualEditSession.findFirst({ where: { id: sessionId, novelId } });
    if (!session) throw new AppError("人工交接记录不存在。", 404);
    const chapterIds = parseJson<string[]>(session.scopeJson, []);
    if (session.status !== "completed") await this.store.db.$transaction(async tx => {
      await this.store.lockChapters(tx, novelId, chapterIds);
      const pending = await tx.writingAcceptance.count({ where: { novelId, chapterId: { in: chapterIds }, createdAt: { gte: session.createdAt }, status: { notIn: ["succeeded", "superseded"] } } });
      if (pending) conflict("已采纳稿件的历史依据尚未同步，请先处理同步结果。", "SYNC_PENDING");
      await tx.chapterAdjustmentGuard.updateMany({ where: { novelId, chapterId: { in: chapterIds }, manualSessionId: sessionId }, data: { epoch: { increment: 1 }, manualSessionId: null } });
      await tx.manualEditSession.update({ where: { id: sessionId }, data: { status: "completed" } });
      if (session.taskId) {
        const otherSessions = await tx.manualEditSession.count({ where: { novelId, taskId: session.taskId, status: "active", id: { not: sessionId } } });
        if (!otherSessions) await tx.novelWorkflowTask.update({ where: { id: session.taskId }, data: { pendingManualRecovery: false } });
      }
      await this.store.recordResult(tx, { id: session.id, chapterIds, status: "completed", taskId: session.taskId, runtimeId: session.runtimeId });
    });
    return { id: session.id, chapterIds, status: "completed", taskId: session.taskId, runtimeId: session.runtimeId };
  }
  async accept(novelId: string, chapterId: string, input: { editVersionId: string; expectedRevision: string; reviewId?: string; acceptedDeviationIds?: string[] }, requestKey: string): Promise<WritingAcceptanceReceipt> {
    const key = digest([novelId, chapterId, "accept", requestKey]);
    const previous = await this.store.db.writingAcceptance.findUnique({ where: { requestKey: key } });
    if (previous) {
      if (previous.editVersionId !== input.editVersionId) conflict("该采纳标识已用于另一稿件。", "IDEMPOTENCY_CONFLICT");
      return parseJson(previous.payloadJson, null!);
    }
    const edit = await this.store.version(novelId, chapterId, input.editVersionId);
    if (!["draft", "candidate"].includes(edit.kind)) throw new AppError("请选择可采纳的正文版本。", 400);
    if (!edit.content.trim()) throw new AppError("不能采纳空正文。", 400);
    const dependencies = parseJson<{ dependencyRevision?: string }>(edit.metadataJson, {});
    if (dependencies.dependencyRevision && dependencies.dependencyRevision !== await this.store.dependencies(novelId)) conflict("稿件依赖的历史或规划已变化，请重新比较并核对。", "REQUIREMENTS_STALE");
    const chapter = await this.store.chapter(novelId, chapterId);
    if (chapterRevision(chapter) !== input.expectedRevision || edit.baseRevision !== input.expectedRevision) conflict("正式正文已变化，请重新比较当前稿。");
    let reviewState: WritingAcceptanceReceipt["reviewState"] = "not_reviewed";
    if (input.reviewId) {
      const report = await this.store.version(novelId, chapterId, input.reviewId);
      const review = parseJson<WritingReview>(report.metadataJson, null!);
      if (report.kind !== "review" || review.editVersionId !== edit.id || review.contentHash !== edit.contentHash || review.dependencyRevision !== await this.store.dependencies(novelId)) conflict("审核依据已变化，请核对当前稿。", "REVIEW_STALE");
      const accepted = new Set(input.acceptedDeviationIds ?? []);
      if ([...accepted].some(id => !review.issues.some(i => i.id === id))) throw new AppError("所选问题不属于本次审核。", 400);
      const open = review.issues.filter(i => i.status === "open" && !accepted.has(i.id));
      if (open.length) conflict("请先修复所选问题，或明确记录接受偏离。", "UNRESOLVED_REVIEW");
      reviewState = review.issues.some(i => i.status === "accepted_deviation" || accepted.has(i.id)) ? "accepted_deviation" : "checked";
    }
    const id = randomUUID();
    return this.store.db.$transaction(async tx => {
      await this.store.lockChapters(tx, novelId, [chapterId]);
      if (dependencies.dependencyRevision && dependencies.dependencyRevision !== await new AdjustmentStore(tx as PrismaClient).dependencies(novelId)) conflict("采纳期间故事依据发生变化，请重新核对。", "REQUIREMENTS_STALE");
      const current = await tx.chapter.findFirst({ where: { id: chapterId, novelId } });
      if (!current || chapterRevision(current) !== input.expectedRevision) conflict("正文在采纳期间发生变化。");
      const guard = await tx.chapterAdjustmentGuard.upsert({ where: { chapterId }, create: { chapterId, novelId }, update: {} });
      const changedGuard = await tx.chapterAdjustmentGuard.updateMany({ where: { chapterId, epoch: guard.epoch }, data: { epoch: { increment: 1 } } });
      if (changedGuard.count !== 1) conflict("章节写入许可已变化。");
      const saved = await tx.chapter.updateMany({ where: { id: chapterId, novelId, updatedAt: current.updatedAt, content: current.content }, data: { content: edit.content } });
      if (saved.count !== 1) conflict("正文在采纳期间发生变化。");
      const updated = await tx.chapter.findUniqueOrThrow({ where: { id: chapterId } });
      const obsolete = await tx.writingAcceptance.findMany({ where: { novelId, chapterId, status: { in: ["pending", "running", "failed"] } } });
      for (const old of obsolete) {
        const oldReceipt = parseJson<WritingAcceptanceReceipt>(old.payloadJson, null!);
        oldReceipt.canonicalSyncStatus = "superseded"; oldReceipt.nextActions = ["inspect_latest_acceptance"]; delete oldReceipt.error;
        await tx.writingAcceptance.update({ where: { id: old.id }, data: { status: "superseded", payloadJson: JSON.stringify(oldReceipt) } });
        await tx.novelSideEffectJob.updateMany({ where: { novelId, idempotencyKey: `writing-acceptance:${old.id}`, status: { in: ["pending", "running", "failed", "dead"] } }, data: { status: "cancelled", leaseOwner: null, leaseExpiresAt: null } });
      }
      const receipt: WritingAcceptanceReceipt = { id, chapterId, editVersionId: edit.id, acceptedRevision: chapterRevision(updated), reviewState, canonicalSyncStatus: "pending", nextActions: ["inspect_sync"] };
      await tx.writingAcceptance.create({ data: { id, novelId, chapterId, editVersionId: edit.id, requestKey: key, status: "pending", payloadJson: JSON.stringify(receipt) } });
      await tx.novelSideEffectJob.create({ data: { novelId, jobType: "writing.adjustmentSync", idempotencyKey: `writing-acceptance:${id}`, payloadJson: JSON.stringify({ novelId, chapterId, acceptanceId: id, contentHash: edit.contentHash, epochs: { [chapterId]: guard.epoch + 1 }, manualSessionId: guard.manualSessionId }), payloadVersion: 1 } });
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: edit.id }, data: { status: "accepted" } });
      return this.store.recordResult(tx, receipt);
    }, { isolationLevel: "Serializable" });
  }
  async receipt(novelId: string, chapterId: string, id: string): Promise<WritingAcceptanceReceipt> {
    const row = await this.store.db.writingAcceptance.findFirst({ where: { id, novelId, chapterId } });
    if (!row) throw new AppError("采纳记录不存在。", 404);
    return parseJson(row.payloadJson, null!);
  }
  async retry(novelId: string, chapterId: string, id: string) {
    const receipt = await this.receipt(novelId, chapterId, id);
    if (receipt.canonicalSyncStatus === "superseded") conflict("此稿已被新的采纳替代，请查看最新稿件的同步结果。");
    if (receipt.canonicalSyncStatus === "succeeded") return receipt;
    await this.store.db.$transaction(async tx => {
      const result = await tx.novelSideEffectJob.updateMany({ where: { novelId, idempotencyKey: `writing-acceptance:${id}`, status: { in: ["failed", "dead"] } }, data: { status: "pending", attempts: 0, runAfter: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      if (!result.count) conflict("同步正在排队或运行，请稍后查看。", "OPERATION_IN_PROGRESS");
      receipt.canonicalSyncStatus = "pending"; delete receipt.error;
      await tx.writingAcceptance.update({ where: { id }, data: { status: "pending", payloadJson: JSON.stringify(receipt) } });
      await this.store.recordResult(tx, receipt);
    });
    return receipt;
  }
  async synchronize(payload: { novelId: string; chapterId: string; acceptanceId: string; contentHash: string; epochs: Record<string, number>; manualSessionId?: string | null }) {
    const { novelId, chapterId, acceptanceId } = payload;
    const receipt = await this.receipt(novelId, chapterId, acceptanceId);
    if (["succeeded", "superseded"].includes(receipt.canonicalSyncStatus)) return;
    const update = async (status: WritingAcceptanceReceipt["canonicalSyncStatus"], error?: string) => {
      const current = await this.receipt(novelId, chapterId, acceptanceId);
      current.canonicalSyncStatus = status; current.error = error; current.nextActions = status === "succeeded" ? ["continue"] : ["inspect_sync"];
      await this.store.db.writingAcceptance.updateMany({ where: { id: acceptanceId, status: { not: "superseded" } }, data: { status, payloadJson: JSON.stringify(current) } });
    };
    await update("running");
    try {
      const chapter = await this.store.chapter(novelId, chapterId);
      if (digest(chapter.content ?? "") !== payload.contentHash) conflict("正文已更新，此版本的同步不能覆盖新状态。");
      const execute = async () => {
        const { ChapterArtifactSyncService } = await import("../../../../services/novel/runtime/ChapterArtifactSyncService");
        type Progress = WritingAcceptanceReceipt & { completedLocalStages?: Array<"legacy_summary_and_facts" | "character_timeline"> };
        const saved = await this.receipt(novelId, chapterId, acceptanceId) as Progress;
        const result = await new ChapterArtifactSyncService().syncChapterArtifacts(novelId, chapterId, chapter.content!, {
          artifactSyncMode: "strict", awaitArtifactDelta: true,
          completedLocalStages: saved.completedLocalStages,
          onLocalStageCompleted: async (stage, tx) => {
            const row = await tx.writingAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
            const progress = parseJson<Progress>(row.payloadJson, null!);
            progress.completedLocalStages = [...new Set([...(progress.completedLocalStages ?? []), stage])];
            await tx.writingAcceptance.update({ where: { id: acceptanceId }, data: { payloadJson: JSON.stringify(progress) } });
          },
        });
        if (result.status !== "completed") throw new Error(result.reason ?? "历史依据尚未同步完成。");
      };
      await runWithCapturedAdjustmentFence(payload.epochs, () => payload.manualSessionId ? runWithAuthorizedManualSession(payload.manualSessionId, execute) : execute());
      await update("succeeded");
    } catch (error) { await update("failed", error instanceof Error ? error.message : "同步失败"); throw error; }
  }
}

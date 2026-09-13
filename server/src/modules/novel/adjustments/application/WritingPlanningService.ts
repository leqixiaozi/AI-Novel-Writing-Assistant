import type { Prisma, PrismaClient } from "@prisma/client";
import type { WritingAcceptanceReceipt, WritingAdjustmentWorkspace, WritingReview } from "@ai-novel/shared/types/writingAdjustments";
import { AppError } from "../../../../middleware/errorHandler";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";
import { WritingSettingsService } from "./WritingSettingsService";
import { adjustmentAi, type AdjustmentAi } from "./WritingContentService";

interface DecisionAdjustment {
  chapterIds: string[];
  preserve: string[];
  status: "active" | "disabled";
}
interface PlanChange { chapterId: string; before: string; after: string }
interface VolumeBaseline { id: string; contentJson: string; updatedAt: string }
interface PlanningCandidate {
  changes: PlanChange[];
  impact: string[];
  baseRevisions: Record<string, string>;
  dependencyRevision: string;
  instruction: string;
  preserve: string[];
  guardStates: Record<string, { epoch: number; manualSessionId: string | null }>;
  volumeVersions: VolumeBaseline[];
  volumeLinks: Array<{ id: string; chapterId: string | null; updatedAt: string }>;
  acceptedChapterIds?: string[];
  acceptedAt?: string;
}
interface PlanDocument {
  volumes: Array<{ id: string; chapters: Array<{ id: string; chapterId?: string | null; purpose?: string | null; summary?: string }> }>;
}

function decisionRevision(row: { content: string; adjustmentJson: string | null; updatedAt: Date }) {
  return digest([row.content, row.adjustmentJson, row.updatedAt.toISOString()]);
}

/** Optional planning writes share the foundation's chapter and volume references. */
export class WritingPlanningService {
  constructor(readonly store: AdjustmentStore, readonly settings: WritingSettingsService, readonly ai: AdjustmentAi = adjustmentAi) {}

  async workspace(novelId: string): Promise<WritingAdjustmentWorkspace> {
    await this.store.novel(novelId);
    const [chapters, characters, versions, sessions, receipts, decisions, planningVersions, reviews, scenes] = await Promise.all([
      this.store.db.chapter.findMany({ where: { novelId }, orderBy: { order: "asc" } }),
      this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.store.db.chapterEditVersion.findMany({ where: { novelId, kind: { in: ["draft", "candidate"] } }, orderBy: { createdAt: "desc" }, take: 200 }),
      this.store.db.manualEditSession.findMany({ where: { novelId, status: "active" }, orderBy: { createdAt: "desc" } }),
      this.store.db.writingAcceptance.findMany({ where: { novelId }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.store.db.creativeDecision.findMany({ where: { novelId, adjustmentJson: { not: null } }, orderBy: { createdAt: "desc" }, take: 200 }),
      this.store.db.chapterEditVersion.findMany({ where: { novelId, kind: { in: ["plan", "line"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.store.db.chapterEditVersion.findMany({ where: { novelId, kind: "review" }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.store.db.chapterPlanScene.findMany({ where: { plan: { novelId, chapterId: { not: null }, status: { not: "stale" } } }, select: { id: true, title: true, sortOrder: true, plan: { select: { chapterId: true } } }, orderBy: [{ planId: "asc" }, { sortOrder: "asc" }] }),
    ]);
    return {
      chapters: chapters.map(row => ({ id: row.id, title: row.title, order: row.order, revision: chapterRevision(row), content: row.content ?? "", expectation: row.expectation })),
      characters,
      scenes: scenes.flatMap(scene => scene.plan.chapterId ? [{ id: scene.id, chapterId: scene.plan.chapterId, title: scene.title, sortOrder: scene.sortOrder }] : []),
      versions: versions.map(row => this.store.mapVersion(row)),
      planningVersions: planningVersions.map(row => this.store.mapVersion(row)),
      reviews: reviews.map(row => parseJson<WritingReview>(row.metadataJson, null!)),
      manualSessions: sessions.map(row => ({ id: row.id, chapterIds: parseJson<string[]>(row.scopeJson, []), status: "active", taskId: row.taskId, runtimeId: row.runtimeId })),
      acceptances: receipts.map(row => parseJson<WritingAcceptanceReceipt>(row.payloadJson, null!)),
      decisions: decisions.map(row => {
        const adjustment = parseJson<DecisionAdjustment>(row.adjustmentJson, { chapterIds: [], preserve: [], status: "disabled" });
        return { id: row.id, content: row.content, ...adjustment, revision: decisionRevision(row) };
      }),
    };
  }

  async previewPlan(novelId: string, input: { chapterIds: string[]; instruction: string; preserve: string[] }) {
    if (!input.instruction.trim()) throw new AppError("请填写规划调整目标。", 400);
    const selected = await this.store.chapters(novelId, { kind: "chapters", chapterIds: input.chapterIds });
    const [novel, allChapters, characters, guards, volumeVersions, volumeLinks, dependencyRevision] = await Promise.all([
      this.store.novel(novelId),
      this.store.db.chapter.findMany({ where: { novelId }, select: { id: true, order: true, title: true, expectation: true, content: true }, orderBy: { order: "asc" } }),
      this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true, role: true } }),
      this.store.db.chapterAdjustmentGuard.findMany({ where: { novelId, chapterId: { in: input.chapterIds } } }),
      this.store.db.volumePlanVersion.findMany({ where: { novelId, status: "active" }, select: { id: true, contentJson: true, updatedAt: true }, orderBy: { version: "desc" } }),
      this.store.db.volumeChapterPlan.findMany({ where: { chapterId: { in: input.chapterIds }, volume: { novelId } }, select: { id: true, chapterId: true, updatedAt: true } }),
      this.store.dependencies(novelId),
    ]);
    const result = await this.ai.plan({
      instruction: input.instruction,
      requirementsText: input.preserve.join("\n"),
      chapters: selected.map(row => ({ chapterId: row.id, order: row.order, outline: row.expectation ?? "" })),
      contextText: JSON.stringify({ title: novel.title, characters, existingChapters: allChapters.map(row => ({ chapterId: row.id, order: row.order, title: row.title, plannedOutline: row.expectation, hasAcceptedProse: Boolean(row.content?.trim()) })), boundary: "只调整授权章节的未来规划；已写正文保持原样。已有正文的章节需要作者另行复核，不能因改纲而视为历史事实已被修改。" }),
    }, novelId);
    const ids = new Set(input.chapterIds);
    if (result.changes.some(row => !ids.has(row.chapterId)) || new Set(result.changes.map(row => row.chapterId)).size !== result.changes.length) throw new AppError("规划候选包含未授权或重复章节，请重新生成。", 502);
    if (result.changes.some(row => !row.outline.trim())) throw new AppError("规划候选包含空章纲，请重新生成。", 502);
    if (result.affectedChapterIds.some(id => !allChapters.some(row => row.id === id))) throw new AppError("规划候选引用了无法定位的章节。", 502);
    const changes = result.changes.map(row => ({ chapterId: row.chapterId, before: selected.find(chapter => chapter.id === row.chapterId)!.expectation ?? "", after: row.outline }));
    const metadata: PlanningCandidate = {
      changes,
      impact: [result.summary, ...result.changes.map(row => row.reason), ...result.preserved.map(item => `保留：${item}`), ...result.affectedChapterIds.map(id => `建议复核：第 ${allChapters.find(row => row.id === id)!.order} 章`), ...selected.filter(row => row.content?.trim()).map(row => `第 ${row.order} 章已有正文；本次仅改规划，正文及历史事实需另行复核。`)].filter(Boolean),
      baseRevisions: Object.fromEntries(selected.map(row => [row.id, chapterRevision(row)])),
      dependencyRevision, instruction: input.instruction, preserve: [...input.preserve],
      guardStates: Object.fromEntries(selected.map(row => { const guard = guards.find(item => item.chapterId === row.id); return [row.id, { epoch: guard?.epoch ?? 0, manualSessionId: guard?.manualSessionId ?? null }]; })),
      volumeVersions: volumeVersions.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      volumeLinks: volumeLinks.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    };
    const operationResult = (version: { id: string }) => ({ id: version.id, changes, impact: metadata.impact, baseRevisions: metadata.baseRevisions });
    const version = await this.store.createVersion({ novelId, chapterId: selected[0].id, kind: "plan", content: JSON.stringify({ changes, impact: metadata.impact }), baseRevision: metadata.baseRevisions[selected[0].id], metadata: metadata as unknown as Record<string, unknown>, operationResult });
    return operationResult(version);
  }

  async acceptPlan(novelId: string, versionId: string, input: { acceptedChapterIds: string[] }) {
    const version = await this.store.db.chapterEditVersion.findFirst({ where: { id: versionId, novelId, kind: "plan" } });
    if (!version) throw new AppError("规划候选不存在。", 404);
    const candidate = parseJson<PlanningCandidate>(version.metadataJson, null!);
    const ids = input.acceptedChapterIds;
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !candidate.changes.some(row => row.chapterId === id))) throw new AppError("请选择本次候选内不重复的章节。", 400);
    if (candidate.acceptedChapterIds) {
      if (candidate.acceptedChapterIds.length !== ids.length || ids.some(id => !candidate.acceptedChapterIds!.includes(id))) conflict("此候选已按另一范围采纳，请重新生成剩余规划。");
      return { id: versionId, status: "accepted" };
    }
    return this.store.db.$transaction(async tx => {
      await this.store.lockChapters(tx, novelId, ids, true);
      const currentVersion = await tx.chapterEditVersion.findFirst({ where: { id: versionId, novelId, metadataJson: version.metadataJson } });
      if (!currentVersion) conflict("规划候选正在被另一操作采纳。");
      const transactionStore = new AdjustmentStore(tx as PrismaClient);
      if (candidate.dependencyRevision !== await transactionStore.dependencies(novelId)) conflict("规划或故事依据已变化，请重新预览影响。", "REQUIREMENTS_STALE");
      for (const id of [...ids].sort()) {
        const chapter = await tx.chapter.findFirst({ where: { id, novelId } });
        if (!chapter || chapterRevision(chapter) !== candidate.baseRevisions[id]) conflict("所选章节已变化，请重新预览规划。");
        const previousGuard = candidate.guardStates[id];
        const guard = await tx.chapterAdjustmentGuard.upsert({ where: { chapterId: id }, create: { chapterId: id, novelId }, update: {} });
        if (!previousGuard || guard.epoch !== previousGuard.epoch || guard.manualSessionId !== previousGuard.manualSessionId) conflict("章节交接状态已变化，请重新预览规划。", "MANUAL_EDIT_REQUIRED");
        const claimed = await tx.chapterAdjustmentGuard.updateMany({ where: { chapterId: id, novelId, epoch: guard.epoch, manualSessionId: guard.manualSessionId }, data: { epoch: { increment: 1 } } });
        if (claimed.count !== 1) conflict("章节写入许可已变化。");
        const change = candidate.changes.find(row => row.chapterId === id)!;
        const saved = await tx.chapter.updateMany({ where: { id, novelId, updatedAt: chapter.updatedAt, expectation: chapter.expectation, content: chapter.content }, data: { expectation: change.after } });
        if (saved.count !== 1) conflict("章节在采纳规划期间发生变化。");
        await this.updateVolumeLinks(tx, novelId, id, change.after, candidate);
      }
      await this.updateVolumeDocuments(tx, novelId, ids, candidate);
      await tx.storyPlan.updateMany({ where: { novelId, chapterId: { in: ids }, level: "chapter" }, data: { status: "stale" } });
      const accepted = { ...candidate, acceptedChapterIds: [...ids], acceptedAt: new Date().toISOString() };
      const savedVersion = await tx.chapterEditVersion.updateMany({ where: { id: versionId, novelId, metadataJson: version.metadataJson }, data: { metadataJson: JSON.stringify(accepted) } });
      if (savedVersion.count !== 1) conflict("规划候选已被其他操作采纳。");
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: versionId }, data: { status: "accepted" } });
      return this.store.recordResult(tx, { id: versionId, status: "accepted" });
    });
  }

  private async updateVolumeLinks(tx: Prisma.TransactionClient, novelId: string, chapterId: string, outline: string, candidate: PlanningCandidate) {
    const rows = await tx.volumeChapterPlan.findMany({ where: { chapterId, volume: { novelId } } });
    const expected = candidate.volumeLinks.filter(row => row.chapterId === chapterId);
    if (rows.length !== expected.length || rows.some(row => !expected.some(item => item.id === row.id && item.updatedAt === row.updatedAt.toISOString()))) conflict("章节对应的卷规划已变化，请重新预览。");
    for (const row of rows) {
      const saved = await tx.volumeChapterPlan.updateMany({ where: { id: row.id, chapterId, updatedAt: row.updatedAt }, data: { summary: outline, purpose: outline } });
      if (saved.count !== 1) conflict("卷内章纲在采纳期间发生变化。");
    }
  }

  private async updateVolumeDocuments(tx: Prisma.TransactionClient, novelId: string, chapterIds: string[], candidate: PlanningCandidate) {
    const rows = await tx.volumePlanVersion.findMany({ where: { novelId, status: "active" } });
    if (rows.length !== candidate.volumeVersions.length || rows.some(row => !candidate.volumeVersions.some(item => item.id === row.id && item.contentJson === row.contentJson && item.updatedAt === row.updatedAt.toISOString()))) conflict("活动卷规划版本已变化，请重新预览。");
    const updates = new Map(candidate.changes.filter(row => chapterIds.includes(row.chapterId)).map(row => [row.chapterId, row.after]));
    const linkIds = new Map(candidate.volumeLinks.filter(row => row.chapterId && chapterIds.includes(row.chapterId)).map(row => [row.id, row.chapterId!]));
    for (const row of rows) {
      const document = parseJson<PlanDocument>(row.contentJson, null!);
      if (!document || !Array.isArray(document.volumes)) throw new AppError("活动卷规划结构无法读取，请先修复规划资料。", 409);
      let changed = false;
      for (const volume of document.volumes) for (const chapter of volume.chapters ?? []) {
        const id = chapter.chapterId ?? linkIds.get(chapter.id);
        const outline = id ? updates.get(id) : undefined;
        if (outline !== undefined) { chapter.summary = outline; chapter.purpose = outline; changed = true; }
      }
      if (changed) {
        const saved = await tx.volumePlanVersion.updateMany({ where: { id: row.id, novelId, status: "active", contentJson: row.contentJson, updatedAt: row.updatedAt }, data: { contentJson: JSON.stringify(document) } });
        if (saved.count !== 1) conflict("卷规划在采纳期间发生变化。");
      }
    }
  }

  async createDecision(novelId: string, input: { category?: string; content: string; adjustment: DecisionAdjustment }) {
    if (!input.content.trim()) throw new AppError("请填写干预要求。", 400);
    await this.store.chapters(novelId, { kind: "chapters", chapterIds: input.adjustment.chapterIds });
    // Negative legacy expiry keeps optional decisions out of the unchanged legacy assembler.
    return this.store.db.$transaction(async tx => {
      const row = await tx.creativeDecision.create({ data: { novelId, category: "manual_adjustment", content: input.content, chapterId: input.adjustment.chapterIds.length === 1 ? input.adjustment.chapterIds[0] : null, adjustmentJson: JSON.stringify(input.adjustment), sourceType: "author", expiresAt: -1 } });
      return this.store.recordResult(tx, { id: row.id, content: row.content, ...input.adjustment, revision: decisionRevision(row) });
    });
  }

  async updateDecision(novelId: string, decisionId: string, input: { content?: string; adjustment: Partial<DecisionAdjustment> & { expectedRevision: string } }) {
    const row = await this.store.db.creativeDecision.findFirst({ where: { id: decisionId, novelId, adjustmentJson: { not: null } } });
    if (!row) throw new AppError("人工干预要求不存在。", 404);
    if (decisionRevision(row) !== input.adjustment.expectedRevision) conflict("干预要求已变化，请刷新后重试。");
    const original = parseJson<DecisionAdjustment>(row.adjustmentJson, null!);
    const adjustment: DecisionAdjustment = { chapterIds: input.adjustment.chapterIds ?? original.chapterIds, preserve: input.adjustment.preserve ?? original.preserve, status: input.adjustment.status ?? original.status };
    await this.store.chapters(novelId, { kind: "chapters", chapterIds: adjustment.chapterIds });
    const content = input.content ?? row.content;
    if (!content.trim()) throw new AppError("请填写干预要求。", 400);
    return this.store.db.$transaction(async tx => {
      const saved = await tx.creativeDecision.updateMany({ where: { id: row.id, novelId, updatedAt: row.updatedAt, adjustmentJson: row.adjustmentJson }, data: { content, chapterId: adjustment.chapterIds.length === 1 ? adjustment.chapterIds[0] : null, adjustmentJson: JSON.stringify(adjustment), expiresAt: -1 } });
      if (saved.count !== 1) conflict("干预要求在保存期间发生变化。");
      const updated = await tx.creativeDecision.findUniqueOrThrow({ where: { id: row.id } });
      return this.store.recordResult(tx, { id: row.id, content, ...adjustment, revision: decisionRevision(updated) });
    });
  }
}

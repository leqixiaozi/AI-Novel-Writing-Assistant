import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { BookArrangementScene, BookArrangementSceneApplyReceipt, BookArrangementScenePreview, BookArrangementScenePreviewRequest } from "@ai-novel/shared/types/bookArrangement";
import { normalizeChapterScenePlan, parseChapterScenePlan, serializeChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";
import { AppError } from "../../../../middleware/errorHandler";
import { novelEventBus } from "../../../../events";
import { buildChapterExecutionContractHash } from "../../../../services/planner/plannerPersistence";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";

const id = z.string().trim().min(1).max(200);
const sceneSchema = z.object({
  id, revision: id, chapterId: id, sortOrder: z.number().int().min(1).max(8),
  title: z.string().trim().min(1).max(500), objective: z.string().max(10000), conflict: z.string().max(10000), reveal: z.string().max(10000), emotionBeat: z.string().max(10000),
  targetWordCount: z.number().int().min(150).max(20000), mustAdvance: z.array(z.string().trim().min(1)).max(100), mustPreserve: z.array(z.string().trim().min(1)).max(100),
  entryState: z.string().trim().min(1).max(10000), exitState: z.string().trim().min(1).max(10000), forbiddenExpansion: z.array(z.string().trim().min(1)).max(100),
  resistance: z.string().max(10000), turn: z.string().max(10000), emotionalShift: z.string().max(10000), readerValue: z.string().max(10000),
}).strict();
export const chapterScenePreviewSchema = z.object({ chapterId: id, expectedChapterRevision: id, scenes: z.array(sceneSchema).min(3).max(8) }).strict();

type SceneRow = { id: string; sortOrder: number; title: string; objective: string | null; conflict: string | null; reveal: string | null; emotionBeat: string | null; updatedAt: Date };
interface SceneCandidate { preview: BookArrangementScenePreview; input: BookArrangementScenePreviewRequest; contextRevision: string; guardEpoch: number; planId: string | null; applied?: BookArrangementSceneApplyReceipt }
const sceneRevision = (row: SceneRow) => digest({ id: row.id, updatedAt: row.updatedAt, sortOrder: row.sortOrder, title: row.title, objective: row.objective, conflict: row.conflict, reveal: row.reveal, emotionBeat: row.emotionBeat });

function project(chapter: { id: string; targetWordCount: number | null; sceneCards: string | null }, rows: SceneRow[]): BookArrangementScene[] {
  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const plan = parseChapterScenePlan(chapter.sceneCards, { targetWordCount: chapter.targetWordCount ?? undefined });
  const fallback = Math.max(1, Math.round((chapter.targetWordCount ?? 3000) / Math.max(1, ordered.length)));
  return ordered.map((row, index) => {
    const card = plan?.scenes.find(item => item.key === row.id) ?? plan?.scenes[index];
    return { id: row.id, revision: sceneRevision(row), chapterId: chapter.id, sortOrder: index + 1,
      title: row.title, objective: row.objective ?? card?.purpose ?? "", conflict: row.conflict ?? card?.resistance ?? "", reveal: row.reveal ?? card?.turn ?? "", emotionBeat: row.emotionBeat ?? card?.emotionalShift ?? "",
      targetWordCount: card?.targetWordCount ?? fallback, mustAdvance: card?.mustAdvance ?? [], mustPreserve: card?.mustPreserve ?? [], entryState: card?.entryState ?? row.objective ?? row.title,
      exitState: card?.exitState ?? row.reveal ?? row.emotionBeat ?? row.objective ?? row.title, forbiddenExpansion: card?.forbiddenExpansion ?? [], resistance: card?.resistance ?? row.conflict ?? "",
      turn: card?.turn ?? row.reveal ?? "", emotionalShift: card?.emotionalShift ?? row.emotionBeat ?? "", readerValue: card?.readerValue ?? "" };
  });
}

export class ChapterSceneArrangementService {
  constructor(readonly store: AdjustmentStore) {}

  private async context(novelId: string, chapterId: string) {
    const chapter = await this.store.db.chapter.findFirst({ where: { id: chapterId, novelId } });
    if (!chapter) throw new AppError("章节不存在或不属于当前作品。", 404);
    const plan = await this.store.db.storyPlan.findFirst({ where: { novelId, chapterId, level: "chapter", status: { not: "stale" } }, include: { scenes: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
    const scenes = plan?.scenes ?? [];
    return { chapter, plan, scenes, revision: digest({ chapter: chapterRevision(chapter), plan: plan && { id: plan.id, updatedAt: plan.updatedAt }, scenes }) };
  }

  private async conflicts(novelId: string, chapterId: string) {
    const conflicts: BookArrangementScenePreview["conflicts"] = [];
    const [draft, guard, running, execution, sync] = await Promise.all([
      this.store.db.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: "book-arrangement:draft" } } }),
      this.store.db.chapterAdjustmentGuard.findUnique({ where: { chapterId } }),
      this.store.db.directorStepRun.count({ where: { novelId, status: { in: ["running", "queued"] }, OR: [{ targetId: null }, { targetType: "novel" }, { targetId: chapterId }] } }),
      this.store.db.directorRuntimeExecution.count({ where: { novelId, status: { in: ["leased", "running"] }, runtime: { OR: [{ currentChapterId: null }, { currentChapterId: chapterId }] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: new Date() } }] } }),
      this.store.db.writingAcceptance.count({ where: { novelId, chapterId, status: { in: ["pending", "running", "failed"] } } }),
    ]);
    const locked = parseJson<{ chapterEdits?: Array<{ chapterId: string; locked: boolean }> }>(draft?.payloadJson, {}).chapterEdits?.some(edit => edit.chapterId === chapterId && edit.locked);
    if (locked) conflicts.push({ code: "ARRANGEMENT_LOCKED", message: "本章编排已锁定，请先解除锁定。", chapterIds: [chapterId] });
    if (guard && guard.novelId !== novelId) conflicts.push({ code: "SCOPE_CHANGED", message: "本章写入保护不属于当前作品，请刷新后重试。", chapterIds: [chapterId] });
    if (guard?.manualSessionId) conflicts.push({ code: "MANUAL_ACTIVE", message: "本章正在人工接管，请先完成交接。", chapterIds: [chapterId] });
    if (running || execution) conflicts.push({ code: "RUNNING_SCOPE", message: "本章仍有导演任务运行，请完成原流程交接。", chapterIds: [chapterId] });
    if (sync) conflicts.push({ code: "SYNC_PENDING", message: "本章采纳资料尚未同步完成。", chapterIds: [chapterId] });
    return { conflicts, guardEpoch: guard?.epoch ?? 0 };
  }

  async preview(novelId: string, raw: BookArrangementScenePreviewRequest): Promise<BookArrangementScenePreview> {
    const input = chapterScenePreviewSchema.parse(raw) as BookArrangementScenePreviewRequest;
    const context = await this.context(novelId, input.chapterId);
    if (chapterRevision(context.chapter) !== input.expectedChapterRevision) conflict("章节资料已变化，请重新读取场景。", "REQUIREMENTS_STALE");
    if (new Set(input.scenes.map(scene => scene.id)).size !== input.scenes.length) throw new AppError("场景标识不能重复。", 400);
    if (input.scenes.some((scene, index) => scene.chapterId !== input.chapterId || scene.sortOrder !== index + 1)) throw new AppError("场景必须属于本章并按连续顺序提交。", 400);
    const existing = new Map(context.scenes.map(scene => [scene.id, scene]));
    for (const scene of input.scenes) {
      const row = existing.get(scene.id);
      if (row && sceneRevision(row) !== scene.revision) conflict("场景已被其他操作修改，请重新读取。", "REQUIREMENTS_STALE");
      if (!row && scene.revision !== "new") throw new AppError("新增场景必须使用新场景版本。", 400);
    }
    const newIds = input.scenes.filter(scene => !existing.has(scene.id)).map(scene => scene.id);
    if (newIds.length && await this.store.db.chapterPlanScene.count({ where: { id: { in: newIds } } })) throw new AppError("新增场景标识已存在。", 400);
    const total = input.scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0);
    if (total < 200 || total > 20000) throw new AppError("本章参考字数需在 200 至 20000 字之间。", 400);
    const before = project(context.chapter, context.scenes), after = input.scenes.map(scene => ({ ...scene }));
    if (JSON.stringify(before) === JSON.stringify(after)) throw new AppError("请先调整场景再预览。", 400);
    const { conflicts, guardEpoch } = await this.conflicts(novelId, input.chapterId), baseRevision = await this.store.dependencies(novelId);
    const preview: BookArrangementScenePreview = { id: "", chapterId: input.chapterId, before, after, affectedChapterIds: [input.chapterId], writtenChapterIds: context.chapter.content?.trim() ? [input.chapterId] : [], baseRevision, conflicts, canApply: conflicts.length === 0,
      impact: ["场景顺序、内容和篇幅预算将作为本章后续写作依据。", "已有正文保持原样；已写章节会进入待核对状态。"], unchecked: ["尚未进行 AI 剧情合理性审核。", "场景调整不会自动证明正文已符合新的安排。"] };
    const version = await this.store.createVersion({ novelId, chapterId: input.chapterId, kind: "arrangement_scene", content: JSON.stringify(after), baseRevision: chapterRevision(context.chapter), metadata: { preview, input, contextRevision: context.revision, guardEpoch, planId: context.plan?.id ?? null }, operationResult: row => ({ ...preview, id: row.id }) });
    return { ...preview, id: version.id };
  }

  async apply(novelId: string, candidateId: string): Promise<BookArrangementSceneApplyReceipt> {
    const receipt = await this.store.db.$transaction(async tx => {
      const version = await tx.chapterEditVersion.findFirst({ where: { id: candidateId, novelId, kind: "arrangement_scene" } });
      if (!version) throw new AppError("场景候选不存在。", 404);
      const candidate = parseJson<SceneCandidate>(version.metadataJson, null!);
      if (candidate.applied) return candidate.applied;
      if (!candidate.preview.canApply) conflict("请先处理预览冲突，再重新预览。");
      const store = new AdjustmentStore(tx as PrismaClient), service = new ChapterSceneArrangementService(store), chapterId = candidate.input.chapterId;
      await store.lockChapters(tx, novelId, [chapterId], true);
      const current = await service.context(novelId, chapterId), guard = await tx.chapterAdjustmentGuard.findUnique({ where: { chapterId } });
      if (current.revision !== candidate.contextRevision || chapterRevision(current.chapter) !== candidate.input.expectedChapterRevision || await store.dependencies(novelId) !== candidate.preview.baseRevision) conflict("场景或章节依据已变化，请重新预览。", "REQUIREMENTS_STALE");
      if ((guard?.epoch ?? 0) !== candidate.guardEpoch || (guard && guard.novelId !== novelId) || (await service.conflicts(novelId, chapterId)).conflicts.length) conflict("本章已锁定、接管或正在运行，请完成交接后重新预览。");
      const planId = current.plan?.id ?? candidate.planId ?? randomUUID();
      if (!current.plan) await tx.storyPlan.create({ data: { id: planId, novelId, chapterId, level: "chapter", status: "draft", title: current.chapter.title, objective: current.chapter.expectation ?? "作者安排的章节场景。" } });
      const beforeById = new Map(project(current.chapter, current.scenes).map(scene => [scene.id, scene]));
      const oldPlan = parseChapterScenePlan(current.chapter.sceneCards);
      const oldCardsById = new Map(current.scenes.map((row, index) => [row.id, oldPlan?.scenes.find(card => card.key === row.id) ?? oldPlan?.scenes[index]]));
      const keep = new Set(candidate.input.scenes.map(scene => scene.id));
      if (current.scenes.length) await tx.chapterPlanScene.deleteMany({ where: { planId: current.plan?.id ?? planId, id: { notIn: [...keep] } } });
      for (const scene of candidate.input.scenes) {
        const row = current.scenes.find(item => item.id === scene.id), before = beforeById.get(scene.id);
        const unchanged = (key: "title" | "objective" | "conflict" | "reveal" | "emotionBeat") => Boolean(before && scene[key] === before[key]);
        const data = { sortOrder: scene.sortOrder, title: unchanged("title") && row ? row.title : scene.title,
          objective: unchanged("objective") && row ? row.objective : scene.objective || null, conflict: unchanged("conflict") && row ? row.conflict : scene.conflict || null,
          reveal: unchanged("reveal") && row ? row.reveal : scene.reveal || null, emotionBeat: unchanged("emotionBeat") && row ? row.emotionBeat : scene.emotionBeat || null };
        if (current.scenes.some(row => row.id === scene.id)) await tx.chapterPlanScene.update({ where: { id: scene.id }, data });
        else await tx.chapterPlanScene.create({ data: { id: scene.id, planId, ...data } });
      }
      const total = candidate.input.scenes.reduce((sum, scene) => sum + scene.targetWordCount, 0);
      const cards = candidate.input.scenes.map(scene => {
        const before = beforeById.get(scene.id), oldCard = oldCardsById.get(scene.id);
        return { key: scene.id,
          title: before && scene.title === before.title ? oldCard?.title ?? scene.title : scene.title,
          purpose: before && scene.objective === before.objective ? (oldCard?.purpose ?? scene.objective) || scene.title : scene.objective || scene.title,
          mustAdvance: scene.mustAdvance, mustPreserve: scene.mustPreserve, entryState: scene.entryState || scene.title, exitState: scene.exitState || scene.title,
          forbiddenExpansion: scene.forbiddenExpansion, targetWordCount: scene.targetWordCount, resistance: scene.resistance || scene.conflict, turn: scene.turn || scene.reveal,
          emotionalShift: scene.emotionalShift || scene.emotionBeat, readerValue: scene.readerValue };
      });
      const normalized = normalizeChapterScenePlan(cards, total);
      const sceneCards = serializeChapterScenePlan({ ...normalized, ...(oldPlan ? { readerExperience: oldPlan.readerExperience } : {}) });
      const chapter = await tx.chapter.update({ where: { id: chapterId }, data: { targetWordCount: total, sceneCards } });
      const plan = await tx.storyPlan.findUniqueOrThrow({ where: { id: planId } });
      let rawPlan: Record<string, unknown> = {};
      try { const parsed = JSON.parse(plan.rawPlanJson ?? "{}"); rawPlan = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { previousRawPlan: parsed }; } catch { rawPlan = { previousRawPlan: plan.rawPlanJson }; }
      await tx.storyPlan.update({ where: { id: planId }, data: { rawPlanJson: JSON.stringify({ ...rawPlan, executionContractHash: buildChapterExecutionContractHash({ ...chapter, sceneCards }) }), updatedAt: new Date() } });
      await tx.chapterAdjustmentGuard.upsert({ where: { chapterId }, create: { chapterId, novelId, epoch: 1 }, update: { epoch: { increment: 1 } } });
      await tx.novel.update({ where: { id: novelId }, data: { updatedAt: new Date() } });
      await tx.directorArtifact.updateMany({ where: { novelId, protectedUserContent: false, targetId: chapterId, artifactType: { in: ["chapter_task_sheet", "chapter_retention_contract", "audit_report"] }, status: { in: ["active", "ready", "approved", "accepted"] } }, data: { status: "stale" } });
      const result: BookArrangementSceneApplyReceipt = { id: candidateId, status: "applied", chapterId, sceneIds: candidate.input.scenes.map(scene => scene.id) };
      const stored = await tx.chapterEditVersion.updateMany({ where: { id: candidateId, metadataJson: version.metadataJson }, data: { metadataJson: JSON.stringify({ ...candidate, applied: result }) } });
      if (stored.count !== 1) conflict("此场景候选已被另一操作采纳。");
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: candidateId }, data: { status: "accepted" } });
      return result;
    }, { isolationLevel: "Serializable", timeout: 60000 }).catch(error => { if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) conflict("场景正被另一操作修改，请重试。"); throw error; });
    await novelEventBus.emit({ type: "novel:updated", payload: { novelId, fields: ["arrangement_scenes"] } });
    return receipt;
  }
}

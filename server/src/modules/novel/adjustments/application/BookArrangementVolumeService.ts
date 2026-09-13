import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { VolumePlanDocument, VolumeChapterPlan } from "@ai-novel/shared/types/novel";
import type { BookArrangementVolumeEdit, BookArrangementVolumePreview, BookArrangementVolumeApplyReceipt, DraftPayload } from "@ai-novel/shared/types/bookArrangement";
import { AppError } from "../../../../middleware/errorHandler";
import { novelEventBus } from "../../../../events";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { arrangementChapterIdsSchema, arrangementDraftSchema } from "./BookArrangementService";
import { activateArrangementVolumeDocument, deriveArrangementVolumeDocument, readArrangementVolumeState } from "../../../../services/novel/volume/ArrangementVolumeAdapter";

interface VolumeCandidate {
  preview: BookArrangementVolumePreview;
  draftJson: string;
  volumeRevision: string;
  guards: Record<string, { epoch: number; manualSessionId: string | null }>;
  before: VolumePlanDocument;
  after: VolumePlanDocument;
  applied?: BookArrangementVolumeApplyReceipt;
}
const toEdit = (volume: VolumePlanDocument["volumes"][number]): BookArrangementVolumeEdit => ({ volumeId: volume.id, title: volume.title, summary: volume.summary ?? "", mainPromise: volume.mainPromise ?? "", protagonistChange: volume.protagonistChange ?? "", climax: volume.climax ?? "", nextVolumeHook: volume.nextVolumeHook ?? "", chapterIds: volume.chapters.flatMap(chapter => chapter.chapterId ? [chapter.chapterId] : []) });

export class BookArrangementVolumeService {
  constructor(readonly store: AdjustmentStore) {}

  private async references(novelId: string, volumeIds: string[], chapterIds: string[]): Promise<BookArrangementVolumePreview["references"]> {
    const [assignments, relations, scenes, events, artifacts] = await Promise.all([
      this.store.db.characterVolumeAssignment.findMany({ where: { novelId, volumeId: { in: volumeIds } } }),
      this.store.db.characterRelationStage.findMany({ where: { novelId, OR: [{ volumeId: { in: volumeIds } }, { chapterId: { in: chapterIds } }] } }),
      this.store.db.chapterPlanScene.findMany({ where: { plan: { novelId, chapterId: { in: chapterIds }, status: { not: "stale" } } }, include: { plan: { select: { chapterId: true } } } }),
      this.store.db.storyTimelineEvent.findMany({ where: { novelId, chapterId: { in: chapterIds } } }),
      this.store.db.directorArtifact.findMany({ where: { novelId, targetId: { in: [...volumeIds, ...chapterIds] }, status: { in: ["active", "accepted", "ready", "approved"] } } }),
    ]);
    return [
      ...assignments.map(row => ({ sourceEntity: "CharacterVolumeAssignment", sourceId: row.id, chapterIds: [], volumeId: row.volumeId, label: row.responsibility })),
      ...relations.map(row => ({ sourceEntity: "CharacterRelationStage", sourceId: row.id, chapterIds: row.chapterId && chapterIds.includes(row.chapterId) ? [row.chapterId] : [], volumeId: row.volumeId, label: row.stageLabel })),
      ...scenes.map(row => ({ sourceEntity: "ChapterPlanScene", sourceId: row.id, chapterIds: row.plan.chapterId ? [row.plan.chapterId] : [], volumeId: null, label: row.title })),
      ...events.map(row => ({ sourceEntity: "StoryTimelineEvent", sourceId: row.id, chapterIds: row.chapterId ? [row.chapterId] : [], volumeId: null, label: row.title })),
      ...artifacts.map(row => ({ sourceEntity: "DirectorArtifact", sourceId: row.id, chapterIds: row.targetId && chapterIds.includes(row.targetId) ? [row.targetId] : [], volumeId: row.targetId && volumeIds.includes(row.targetId) ? row.targetId : null, label: row.artifactType })),
    ];
  }

  async preview(novelId: string, input: { draftRevision: number; volumeIds: string[] }): Promise<BookArrangementVolumePreview> {
    const volumeIds = arrangementChapterIdsSchema.parse(input.volumeIds);
    const draft = await this.store.db.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: "book-arrangement:draft" } } });
    if (!draft || draft.revision !== input.draftRevision) conflict("请先保存卷段草稿，再预览影响。");
    const payload: DraftPayload = arrangementDraftSchema.parse(parseJson(draft.payloadJson, null));
    const state = await readArrangementVolumeState(this.store.db, novelId), baseRevision = await this.store.dependencies(novelId);
    if (payload.baseRevision !== baseRevision) conflict("故事依据已变化，请刷新并重新保存。", "REQUIREMENTS_STALE");
    const edits = volumeIds.map(volumeId => {
      const edit = payload.volumeEdits?.find(item => item.volumeId === volumeId);
      if (!edit || !state.rows.some(volume => volume.id === volumeId)) throw new AppError("所选卷段没有已保存的本作品调整。", 400);
      return edit;
    });
    const chapters = await this.store.chapters(novelId, { kind: "novel" }), ids = new Set(chapters.map(chapter => chapter.id));
    if (edits.some(edit => edit.chapterIds.some(id => !ids.has(id)))) throw new AppError("卷段包含不属于本作品的章节。", 400);
    const changes = edits.map(edit => {
      const before = toEdit(state.document.volumes.find(volume => volume.id === edit.volumeId)!);
      const after = { ...edit, chapterIds: chapters.filter(chapter => edit.chapterIds.includes(chapter.id)).map(chapter => chapter.id) };
      return { volumeId: edit.volumeId, before, after, addedChapterIds: after.chapterIds.filter(id => !before.chapterIds.includes(id)), removedChapterIds: before.chapterIds.filter(id => !after.chapterIds.includes(id)) };
    });
    const affectedChapterIds = chapters.filter(chapter => changes.some(change => [...change.before.chapterIds, ...change.after.chapterIds].includes(chapter.id))).map(chapter => chapter.id);
    const conflicts: BookArrangementVolumePreview["conflicts"] = [];
    const addConflict = (code: string, message: string, volumeIds: string[], chapterIds: string[]) => conflicts.push({ code, message, volumeIds, chapterIds });
    for (const edit of edits) {
      const indexes = chapters.flatMap((chapter, index) => edit.chapterIds.includes(chapter.id) ? [index] : []);
      if (indexes.length && indexes.at(-1)! - indexes[0] + 1 !== indexes.length) addConflict("VOLUME_GAP", "卷段必须按实际阅读顺序包含连续章节。", [edit.volumeId], edit.chapterIds);
    }
    const finalMembership = state.document.volumes.map(volume => ({ volumeId: volume.id, chapterIds: changes.find(change => change.volumeId === volume.id)?.after.chapterIds ?? toEdit(volume).chapterIds }));
    const positioned = finalMembership.map(volume => ({ ...volume, indexes: chapters.flatMap((chapter, index) => volume.chapterIds.includes(chapter.id) ? [index] : []) })).filter(volume => volume.indexes.length);
    for (let index = 1; index < positioned.length; index++) {
      const previous = positioned[index - 1], current = positioned[index];
      if ((volumeIds.includes(previous.volumeId) || volumeIds.includes(current.volumeId)) && previous.indexes.at(-1)! >= current.indexes[0]) addConflict("VOLUME_ORDER", "卷次与章节阅读顺序发生交叉；请调整卷段，不会自动重排卷次或实际章序。", [previous.volumeId, current.volumeId], [...previous.chapterIds, ...current.chapterIds]);
    }
    for (const change of changes) if (change.before.chapterIds.some(id => !ids.has(id))) addConflict("INVALID_EXISTING_REFERENCE", "原卷包含无法定位到本作品的章节链接，请先核对底座规划。", [change.volumeId], change.before.chapterIds.filter(id => !ids.has(id)));
    for (const chapter of chapters) {
      const owners = finalMembership.filter(volume => volume.chapterIds.includes(chapter.id));
      if (owners.length > 1 && owners.some(volume => volumeIds.includes(volume.volumeId))) addConflict("VOLUME_OVERLAP", "章节仍属于其他卷；请明确调整双方卷段，不能自动夺取章节。", owners.map(volume => volume.volumeId), [chapter.id]);
    }
    const locked = affectedChapterIds.filter(id => payload.chapterEdits.some(edit => edit.chapterId === id && edit.locked));
    if (locked.length) addConflict("VOLUME_LOCKED", "受影响章节包含已锁定编排，请先解除锁定。", volumeIds, locked);
    const guards = await this.store.db.chapterAdjustmentGuard.findMany({ where: { novelId, chapterId: { in: affectedChapterIds } } });
    const manual = guards.filter(guard => guard.manualSessionId);
    if (manual.length) addConflict("MANUAL_ACTIVE", "受影响章节正在人工接管，请完成交接后调整卷段。", volumeIds, manual.map(guard => guard.chapterId));
    if (await this.store.db.writingAcceptance.count({ where: { novelId, chapterId: { in: affectedChapterIds }, status: { in: ["pending", "running", "failed"] } } })) addConflict("SYNC_PENDING", "受影响章节还有待完成的采纳同步。", volumeIds, affectedChapterIds);
    const neighboringVolumeIds = state.document.volumes.filter((volume, index, all) => !volumeIds.includes(volume.id) && (volume.chapters.some(chapter => chapter.chapterId && affectedChapterIds.includes(chapter.chapterId)) || volumeIds.includes(all[index - 1]?.id) || volumeIds.includes(all[index + 1]?.id))).map(volume => volume.id);
    const oldPlans = state.document.volumes.flatMap(volume => volume.chapters);
    const nextVolumes = state.document.volumes.map(volume => {
      const edit = changes.find(change => change.volumeId === volume.id)?.after;
      if (!edit) return volume;
      const plans = edit.chapterIds.map(chapterId => {
        const existing = oldPlans.filter(plan => plan.chapterId === chapterId);
        if (existing.length > 1) addConflict("AMBIGUOUS_MEMBERSHIP", "同一章节已有多个卷规划引用，请先核对原规划。", volumeIds, [chapterId]);
        const chapter = chapters.find(chapter => chapter.id === chapterId)!;
        const plan: VolumeChapterPlan = existing[0] ?? { id: randomUUID(), volumeId: volume.id, chapterId, chapterOrder: chapter.order, title: chapter.title, summary: chapter.expectation ?? "", targetWordCount: chapter.targetWordCount, conflictLevel: chapter.conflictLevel, revealLevel: chapter.revealLevel, mustAvoid: chapter.mustAvoid, taskSheet: chapter.taskSheet, sceneCards: chapter.sceneCards, payoffRefs: [], createdAt: chapter.createdAt.toISOString(), updatedAt: chapter.updatedAt.toISOString() };
        return { ...plan, volumeId: volume.id, chapterOrder: chapter.order };
      });
      const unlinked = volume.chapters.filter(chapter => !chapter.chapterId);
      if (unlinked.some(chapter => plans.some(plan => plan.chapterOrder === chapter.chapterOrder))) addConflict("UNLINKED_PLAN_COLLISION", "卷内同章序存在尚未关联正文的规划，请先在底座核对。", [volume.id], edit.chapterIds);
      return { ...volume, title: edit.title, summary: edit.summary, mainPromise: edit.mainPromise, protagonistChange: edit.protagonistChange, climax: edit.climax, nextVolumeHook: edit.nextVolumeHook, chapters: [...plans, ...unlinked].sort((a, b) => a.chapterOrder - b.chapterOrder) };
    });
    const after = deriveArrangementVolumeDocument(state.document, nextVolumes, volumeIds);
    const references = await this.references(novelId, [...volumeIds, ...neighboringVolumeIds], affectedChapterIds);
    if (state.document.activeVersionId) references.push({ sourceEntity: "VolumePlanVersion", sourceId: state.document.activeVersionId, chapterIds: [], volumeId: null, label: "调整前卷规划版本；其中审核仅对应原战略，未审核本次改动。" });
    const preview: BookArrangementVolumePreview = { id: "", baseRevision, draftRevision: draft.revision, volumeIds, changes, affectedChapterIds, writtenChapterIds: chapters.filter(chapter => affectedChapterIds.includes(chapter.id) && chapter.content?.trim()).map(chapter => chapter.id), neighboringVolumeIds, conflicts, references, canApply: conflicts.length === 0, impact: ["应用到原卷规划版本，更新卷资料、章节归属与派生大纲；实际章序、正文和章级执行要求保持原样。", "明确移卷保留原章节规划标识；移出且未归入其他卷的规划链接留在调整前版本。", "所改卷的节拍表及相关重平衡建议需重新核对；人物、事件和资源不会自动重写。"], unchecked: ["尚未进行 AI 剧情合理性审核。", "人物职责、关系阶段、伏笔回收及已有正文与新卷段是否相符，需按所列来源核对。"] };
    const volumeRevision = digest({ rows: state.rows, versions: state.versions });
    const fresh = await readArrangementVolumeState(this.store.db, novelId);
    if (volumeRevision !== digest({ rows: fresh.rows, versions: fresh.versions }) || baseRevision !== await this.store.dependencies(novelId)) conflict("卷规划在预览期间变化，请重试。", "REQUIREMENTS_STALE");
    const version = await this.store.createVersion({ novelId, chapterId: affectedChapterIds[0] ?? chapters[0].id, kind: "arrangement_volume", baseRevision: chapterRevision(chapters.find(chapter => chapter.id === affectedChapterIds[0]) ?? chapters[0]), content: JSON.stringify(preview), metadata: { preview, draftJson: draft.payloadJson, volumeRevision, before: state.document, after, guards: Object.fromEntries(affectedChapterIds.map(chapterId => { const guard = guards.find(item => item.chapterId === chapterId); return [chapterId, { epoch: guard?.epoch ?? 0, manualSessionId: guard?.manualSessionId ?? null }]; })) }, operationResult: version => ({ ...preview, id: version.id }) });
    return { ...preview, id: version.id };
  }

  async apply(novelId: string, candidateId: string): Promise<BookArrangementVolumeApplyReceipt> {
    const receipt = await this.store.db.$transaction(async tx => {
      const store = new AdjustmentStore(tx as PrismaClient);
      const row = await tx.chapterEditVersion.findFirst({ where: { novelId, id: candidateId, kind: "arrangement_volume" } });
      if (!row) throw new AppError("卷段候选不存在。", 404);
      const candidate = parseJson<VolumeCandidate>(row.metadataJson, null!);
      if (candidate.applied) return this.store.recordResult(tx, candidate.applied);
      if (!candidate.preview.canApply || candidate.preview.conflicts.length) conflict("请先解决卷段预览中的冲突再重新预览。");
      const chapterIds = candidate.preview.affectedChapterIds;
      await store.lockChapters(tx, novelId, chapterIds, true);
      await tx.$executeRaw`UPDATE "Novel" SET "id" = "id" WHERE "id" = ${novelId}`;
      for (const volumeId of [...candidate.preview.volumeIds].sort()) await tx.$executeRaw`UPDATE "VolumePlan" SET "id" = "id" WHERE "id" = ${volumeId} AND "novelId" = ${novelId}`;
      const current = await readArrangementVolumeState(tx, novelId);
      if (candidate.volumeRevision !== digest({ rows: current.rows, versions: current.versions }) || candidate.preview.baseRevision !== await store.dependencies(novelId)) conflict("卷段依据已变化，请重新预览。", "REQUIREMENTS_STALE");
      const draft = await tx.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: "book-arrangement:draft" } } });
      if (!draft || draft.revision !== candidate.preview.draftRevision || draft.payloadJson !== candidate.draftJson) conflict("卷段草稿已变化，请重新预览。");
      for (const chapterId of chapterIds) {
        const guard = await tx.chapterAdjustmentGuard.findUnique({ where: { chapterId } }), expected = candidate.guards[chapterId];
        if (!expected || guard?.manualSessionId || (guard?.epoch ?? 0) !== expected.epoch || (guard && guard.novelId !== novelId)) conflict("受影响章节的交接状态已变化，请重新预览。");
      }
      const volumeVersionId = await activateArrangementVolumeDocument(tx, novelId, candidate.before, candidate.after, candidate.preview.volumeIds);
      for (const chapterId of chapterIds) await tx.chapterAdjustmentGuard.upsert({ where: { chapterId }, create: { chapterId, novelId, epoch: 1 }, update: { epoch: { increment: 1 } } });
      const payload = arrangementDraftSchema.parse(parseJson(draft.payloadJson, null));
      const updatedPayload = { ...payload, volumeEdits: payload.volumeEdits?.filter(edit => !candidate.preview.volumeIds.includes(edit.volumeId)), baseRevision: await store.dependencies(novelId) };
      const consumed = await tx.writingSetting.updateMany({ where: { id: draft.id, revision: draft.revision, payloadJson: draft.payloadJson }, data: { revision: { increment: 1 }, payloadJson: JSON.stringify(updatedPayload) } });
      if (consumed.count !== 1) conflict("卷段草稿正在被另一窗口修改。");
      const receipt: BookArrangementVolumeApplyReceipt = { id: candidateId, status: "applied", volumeVersionId, volumeIds: candidate.preview.volumeIds, affectedChapterIds: chapterIds };
      const updated = await tx.chapterEditVersion.updateMany({ where: { id: row.id, metadataJson: row.metadataJson }, data: { metadataJson: JSON.stringify({ ...candidate, applied: receipt }) } });
      if (updated.count !== 1) conflict("卷段候选已被其他操作应用。");
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: candidateId }, data: { status: "accepted" } });
      return this.store.recordResult(tx, receipt);
    }, { isolationLevel: "Serializable", timeout: 60000 }).catch(error => {
      if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) conflict("卷规划正在被另一操作修改，请重新预览。");
      throw error;
    });
    // Existing cache invalidation only; volume:updated would schedule global AI rebuilding.
    await novelEventBus.emit({ type: "novel:updated", payload: { novelId, fields: ["outline", "structuredOutline"] } });
    return receipt;
  }
}

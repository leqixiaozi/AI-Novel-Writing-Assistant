import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { BookArrangementObjectDetail, BookArrangementObjectKind, BookArrangementObjectPreview, BookArrangementObjectPreviewRequest, BookArrangementObjectApplyReceipt } from "@ai-novel/shared/types/bookArrangement";
import { AppError } from "../../../../middleware/errorHandler";
import { novelEventBus } from "../../../../events";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";
import { arrangementObjectKindSchema, arrangementObjectPreviewSchema, newObjectFields, objectDetail, objectPatchSchemas } from "../domain/arrangementObjects";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { findArrangementObject, writeArrangementObject } from "../infrastructure/ArrangementObjectRepository";
import { hasCanonicalArrangementSceneCards, hasUnmappedArrangementSceneCards } from "../infrastructure/ArrangementSceneCards";

interface ObjectCandidate {
  preview: BookArrangementObjectPreview;
  input: BookArrangementObjectPreviewRequest;
  old: Record<string, any> | null; row: Record<string, any>;
  targetPlan?: { id: string; create?: { chapterId: string; title: string; objective: string } };
  contextRevision: string;
  guards: Record<string, number>;
  applied?: BookArrangementObjectApplyReceipt;
}

export class BookArrangementObjectService {
  constructor(readonly store: AdjustmentStore) {}
  async detail(novelId: string, kindInput: string, objectId: string, chapterId?: string): Promise<BookArrangementObjectDetail> {
    const kind = arrangementObjectKindSchema.parse(kindInput);
    await this.store.novel(novelId);
    if (chapterId) await this.store.chapter(novelId, chapterId);
    const row = objectId === "new" ? null : await findArrangementObject(this.store.db, novelId, kind, objectId);
    if (!row && objectId !== "new") throw new AppError("对象不存在或不属于当前作品。", 404);
    const detail = objectDetail(kind, row, chapterId ?? null);
    if (!row && kind === "event") detail.fields.eventOrder = ((await this.store.db.storyTimelineEvent.aggregate({ where: { novelId }, _max: { eventOrder: true } }))._max.eventOrder ?? 0) + 1;
    if (!row && kind === "scene" && chapterId) detail.fields.sortOrder = ((await this.store.db.chapterPlanScene.aggregate({ where: { plan: { novelId, chapterId, status: { not: "stale" } } }, _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 1;
    if (!row && kind === "hookNode" && chapterId) detail.fields.position = ((await this.store.db.timelineHookLifecycleNode.aggregate({ where: { novelId, chapterId, active: true }, _max: { position: true } }))._max.position ?? 0) + 1;
    if (row && kind === "relation" && !detail.chapterIds.length && row.volumeId) {
      const links = await this.store.db.volumeChapterPlan.findMany({ where: { volume: { id: row.volumeId, novelId }, chapter: { novelId } }, select: { chapterId: true } });
      detail.chapterIds = links.flatMap(link => link.chapterId ? [link.chapterId] : []);
    }
    const chapters = await this.store.db.chapter.findMany({ where: { novelId }, select: { id: true } });
    detail.chapterIds = detail.chapterIds.filter(id => chapters.some(chapter => chapter.id === id));
    return detail;
  }

  private async context(novelId: string) {
    const [chapters, events, anchors, hooks, hookNodes, relations, volumes, scenes, draft, running, executions, constraints] = await Promise.all([
      this.store.db.chapter.findMany({ where: { novelId }, orderBy: { order: "asc" } }),
      this.store.db.storyTimelineEvent.findMany({ where: { novelId }, orderBy: { id: "asc" } }),
      this.store.db.chapterTimeAnchor.findMany({ where: { novelId }, orderBy: { id: "asc" } }),
      this.store.db.timelineHook.findMany({ where: { novelId }, orderBy: { id: "asc" } }),
      this.store.db.timelineHookLifecycleNode.findMany({ where: { novelId, active: true }, orderBy: [{ chapterIndex: "asc" }, { position: "asc" }, { id: "asc" }] }),
      this.store.db.characterRelationStage.findMany({ where: { novelId }, orderBy: { id: "asc" } }),
      this.store.db.volumePlan.findMany({ where: { novelId }, include: { chapters: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
      this.store.db.chapterPlanScene.findMany({ where: { plan: { novelId } }, include: { plan: true }, orderBy: { id: "asc" } }),
      this.store.db.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: "book-arrangement:draft" } } }),
      this.store.db.directorStepRun.findMany({ where: { novelId, status: { in: ["running", "queued"] } }, select: { id: true, targetId: true, targetType: true } }),
      this.store.db.directorRuntimeExecution.findMany({ where: { novelId, status: { in: ["leased", "running"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: new Date() } }] }, include: { runtime: { select: { currentChapterId: true } } } }),
      this.store.db.timelineConstraint.findMany({ where: { novelId }, orderBy: { id: "asc" } }),
    ]);
    return { chapters, events, anchors, hooks, hookNodes, relations, volumes, scenes, draft, running, executions, constraints, revision: digest({ events, anchors, hooks, hookNodes, relations, volumes, scenes, draft, constraints }) };
  }

  async preview(novelId: string, rawInput: BookArrangementObjectPreviewRequest): Promise<BookArrangementObjectPreview> {
    const input = arrangementObjectPreviewSchema.parse(rawInput) as BookArrangementObjectPreviewRequest;
    if (input.kind === "foreshadow") throw new AppError("故事快照只读；请新建或调整线索计划。", 400);
    if (input.action !== "create" && (!input.objectId || !input.expectedRevision)) throw new AppError("请提供原对象及当前版本。", 400);
    const old = input.action === "create" ? null : await findArrangementObject(this.store.db, novelId, input.kind, input.objectId!);
    if (!old && input.action !== "create") throw new AppError("对象不存在或不属于当前作品。", 404);
    const before = old ? await this.detail(novelId, input.kind, old.id) : null;
    if (before && input.expectedRevision !== before.revision) conflict("对象已被其他操作修改，请重新读取。");
    if (before && (!before.editable || input.action === "delete" && !before.deletable)) throw new AppError("此历史对象只读，请通过原章节流程核对。", 400);
    const patch = objectPatchSchemas[input.kind].parse(input.patch);
    if (input.action === "update" && !Object.keys(patch).length) throw new AppError("请至少修改一个字段。", 400);
    if (input.action === "delete" && Object.keys(patch).length) throw new AppError("移除对象不接受额外修改字段。", 400);
    const fields = input.action === "delete" ? before!.fields : { ...(before?.fields ?? newObjectFields(input.kind, null)), ...patch };
    const objectId = old?.id ?? randomUUID();
    const context = await this.context(novelId), baseRevision = await this.store.dependencies(novelId);
    if (input.kind === "event" && input.action === "create" && !("eventOrder" in patch)) fields.eventOrder = Math.max(0, ...context.events.map(event => event.eventOrder)) + 1;
    if (!context.chapters.length) throw new AppError("请先建立章节再编排对象。", 400);
    const chapterId = typeof fields.chapterId === "string" && fields.chapterId ? fields.chapterId : null;
    const chapter = chapterId ? context.chapters.find(item => item.id === chapterId) : null;
    if (chapterId && !chapter) throw new AppError("所在章节不属于当前作品。", 400);
    if ((input.kind === "scene" || input.kind === "hook" || input.kind === "hookNode") && !chapter) throw new AppError("请选择所在章节。", 400);
    const characterIds = [...new Set([...(Array.isArray(fields.participantIds) ? fields.participantIds : []), ...[fields.sourceCharacterId, fields.targetCharacterId].filter((id): id is string => typeof id === "string")])];
    if (characterIds.length && await this.store.db.character.count({ where: { novelId, id: { in: characterIds } } }) !== characterIds.length) throw new AppError("人物引用必须属于当前作品。", 400);
    if (input.kind === "relation" && (!fields.sourceCharacterId || !fields.targetCharacterId || fields.sourceCharacterId === fields.targetCharacterId)) throw new AppError("请选择两个不同的本书人物。", 400);
    if (input.kind === "relation" && (!old || old.sourceType === "arrangement_plan") && !fields.chapterId && !fields.volumeId) throw new AppError("请选择此关系计划所作用的章节或卷段。", 400);
    if (fields.volumeId && !context.volumes.some(volume => volume.id === fields.volumeId)) throw new AppError("所指卷段不属于当前作品。", 400);
    const eventIds = [fields.prerequisiteIds, fields.consequenceIds, fields.relatedEventIds].flatMap(value => Array.isArray(value) ? value : []).concat(typeof fields.relatedEventId === "string" && fields.relatedEventId ? [fields.relatedEventId] : []);
    if (eventIds.some(id => id === objectId || !context.events.some(event => event.id === id))) throw new AppError("关联事件必须属于本书，且不能引用自己。", 400);
    if (input.action !== "delete" && input.kind !== "hookNode" && !String(fields.title ?? fields.stageLabel ?? "").trim()) throw new AppError("请填写标题或关系阶段。", 400);
    if (input.kind === "hookNode" && input.action !== "delete") {
      if (!context.hooks.some(hook => hook.id === fields.hookId)) throw new AppError("所属线索必须是本书已有的线索安排。", 400);
      if (!String(fields.note ?? "").trim()) throw new AppError("请填写此生命周期节点的具体安排。", 400);
      if (fields.basis === "record" && !String(fields.evidence ?? "").trim()) throw new AppError("正文记录必须填写可在本章定位的原文证据。", 400);
      if (fields.relatedSceneId) {
        const scene = context.scenes.find(item => item.id === fields.relatedSceneId);
        if (!scene || scene.plan.chapterId !== chapterId) throw new AppError("关联场景必须属于节点所在章节。", 400);
      }
      const event = fields.relatedEventId ? context.events.find(item => item.id === fields.relatedEventId) : null;
      if (fields.relatedEventId && (!event || event.chapterId !== chapterId)) throw new AppError("关联事件必须属于节点所在章节。", 400);
    }
    let row: Record<string, any> = {}, targetPlan: ObjectCandidate["targetPlan"];
    if (input.kind === "event") {
      const { participantIds, prerequisiteIds, consequenceIds, ...plain } = fields;
      row = input.action === "delete" ? { status: "cancelled" } : { ...plain, chapterIndex: chapter?.order ?? null, participantIdsJson: JSON.stringify(participantIds), prerequisiteIdsJson: JSON.stringify(prerequisiteIds), consequenceIdsJson: JSON.stringify(consequenceIds), ...(!old ? { status: "planned", source: "manual" } : {}) };
    } else if (input.kind === "hook") {
      const { chapterId: _chapterId, participantIds, relatedEventIds, ...plain } = fields;
      row = input.action === "delete" ? { status: "dropped" } : { ...plain, createdInChapterId: chapterId, createdInChapterIndex: chapter!.order, participantIdsJson: JSON.stringify(participantIds), relatedEventIdsJson: JSON.stringify(relatedEventIds), ...(!old ? { status: "planned" } : {}) };
    } else if (input.kind === "hookNode") {
      row = input.action === "delete" ? { active: false } : { ...fields, chapterIndex: chapter!.order, active: true };
    } else if (input.kind === "relation") {
      row = input.action === "delete" ? { isCurrent: false } : { ...fields, chapterOrder: chapter?.order ?? null, ...(!old ? { sourceType: "arrangement_plan", isCurrent: true } : {}) };
    } else if (input.kind === "scene") {
      const { chapterId: _chapterId, ...plain } = fields;
      row = plain;
      const plan = old?.plan.chapterId === chapterId ? old.plan : await this.store.db.storyPlan.findFirst({ where: { novelId, chapterId, level: "chapter", status: { not: "stale" } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
      targetPlan = plan ? { id: plan.id } : { id: randomUUID(), create: { chapterId: chapterId!, title: chapter!.title, objective: chapter!.expectation ?? "作者安排的章节场景。" } };
      const siblings = context.scenes.filter(scene => scene.planId === targetPlan!.id && scene.id !== objectId);
      row.sortOrder = Math.max(1, Math.min(siblings.length + 1, Number(row.sortOrder)));
      const sourceRemaining = old ? context.scenes.filter(scene => scene.planId === old.planId && scene.id !== objectId).length : 0;
      if (old && (input.action === "delete" || old.planId !== targetPlan.id) && sourceRemaining === 0) throw new AppError("不能移除或移走本章最后一个场景，请先补充替代场景。", 400);
      for (const planId of new Set([targetPlan.id, old?.planId].filter(Boolean))) {
        const relatedChapterId = planId === targetPlan.id ? chapterId : old!.plan.chapterId;
        const relatedChapter = context.chapters.find(chapter => chapter.id === relatedChapterId);
        const count = planId === targetPlan.id ? siblings.length + (input.action === "delete" ? 0 : 1) : sourceRemaining;
        const existingScenes = context.scenes.filter(scene => scene.planId === planId).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
        if (relatedChapter && hasUnmappedArrangementSceneCards(relatedChapter.sceneCards, existingScenes)) throw new AppError("此章场景卡与场景计划无法逐项对应，请先在章节规划中核对后再编排，原预算和约束将保留。", 400);
        if (relatedChapter && hasCanonicalArrangementSceneCards(relatedChapter.sceneCards) && (count < 3 || count > 8)) throw new AppError("此章已有完整场景预算，底座要求保留 3 至 8 个场景；请先调整目标范围或补充替代场景。", 400);
      }
    }
    const previewRow = { ...old, ...row, id: objectId, ...(input.kind === "scene" ? { planId: targetPlan!.id, plan: { ...old?.plan, chapterId } } : {}) };
    const after = input.action === "delete" ? null : objectDetail(input.kind, previewRow);
    const affected = new Set([...(before?.chapterIds ?? []), ...(after?.chapterIds ?? [])]);
    const references: BookArrangementObjectPreview["references"] = [];
    const reference = (sourceEntity: string, sourceId: string, chapterIds: Array<string | null>, label: string) => {
      const ids = chapterIds.filter((id): id is string => Boolean(id) && context.chapters.some(chapter => chapter.id === id));
      ids.forEach(id => affected.add(id)); references.push({ sourceEntity, sourceId, chapterIds: ids, label });
    };
    for (const volume of context.volumes) if ([old?.volumeId, fields.volumeId].includes(volume.id)) reference("VolumePlan", volume.id, volume.chapters.map(chapter => chapter.chapterId), volume.title);
    for (const event of context.events) if (eventIds.includes(event.id) || [event.prerequisiteIdsJson, event.consequenceIdsJson].some(json => parseJson<string[]>(json, []).includes(objectId))) reference("StoryTimelineEvent", event.id, [event.chapterId], event.title);
    for (const anchor of context.anchors) if ([anchor.startsAfterIdsJson, anchor.plannedEventIdsJson, anchor.endedWithIdsJson, anchor.forbiddenEventIdsJson, anchor.previousHookIdsJson, anchor.nextHookIdsJson].some(json => parseJson<string[]>(json, []).includes(objectId))) reference("ChapterTimeAnchor", anchor.id, [anchor.chapterId], anchor.timeLabel);
    for (const hook of context.hooks) if (parseJson<string[]>(hook.relatedEventIdsJson, []).includes(objectId)) reference("TimelineHook", hook.id, [hook.createdInChapterId, hook.resolvedInChapterId], hook.title);
    for (const node of context.hookNodes) if (node.id !== objectId && (node.hookId === fields.hookId || node.hookId === old?.hookId || [node.relatedEventId, node.relatedSceneId].includes(objectId))) reference("TimelineHookLifecycleNode", node.id, [node.chapterId], node.note);
    if (input.kind === "hookNode") {
      const hook = context.hooks.find(item => item.id === fields.hookId || item.id === old?.hookId);
      if (hook) reference("TimelineHook", hook.id, [hook.createdInChapterId, hook.resolvedInChapterId], hook.title);
      const scene = context.scenes.find(item => item.id === fields.relatedSceneId);
      if (scene) reference("ChapterPlanScene", scene.id, [scene.plan.chapterId], scene.title);
    }
    for (const constraint of context.constraints) if (constraint.active && [constraint.relatedEventIdsJson, constraint.relatedHookIdsJson].some(json => parseJson<string[]>(json, []).includes(objectId))) {
      const chapterIds = constraint.chapterId ? [constraint.chapterId] : constraint.chapterIndex != null ? context.chapters.filter(chapter => chapter.order === constraint.chapterIndex).map(chapter => chapter.id) : context.chapters.map(chapter => chapter.id);
      reference("TimelineConstraint", constraint.id, chapterIds, constraint.description);
    }
    if (input.kind === "scene") for (const scene of context.scenes) if ([old?.planId, targetPlan?.id].includes(scene.planId)) reference("ChapterPlanScene", scene.id, [scene.plan.chapterId], scene.title);
    const affectedChapterIds = context.chapters.filter(chapter => affected.has(chapter.id)).map(chapter => chapter.id);
    const guardedIds = affectedChapterIds.length ? affectedChapterIds : [context.chapters[0].id];
    const guards = await this.store.db.chapterAdjustmentGuard.findMany({ where: { novelId, chapterId: { in: guardedIds } } });
    const conflicts = await this.conflicts(novelId, context, guardedIds, guards);
    const evidenceMatched = input.kind === "hookNode" && fields.basis === "record" && Boolean(chapter?.content?.includes(String(fields.evidence ?? "")));
    const preview: BookArrangementObjectPreview = { id: "", kind: input.kind, action: input.action, objectId, before, after, affectedChapterIds, writtenChapterIds: context.chapters.filter(chapter => affected.has(chapter.id) && chapter.content?.trim()).map(chapter => chapter.id), references, baseRevision, conflicts, canApply: conflicts.length === 0, impact: ["仅应用所选原对象；正文、实际章序、人物事实与伏笔回收证据保持原样。", input.kind === "hookNode" ? fields.basis === "record" ? evidenceMatched ? "证据原文可在所选章节定位；节点应用后会作为正文记录显示。" : "证据原文未在所选章节精确定位；可以保留候选，但应用后会持续显示复核风险。" : "计划节点会进入线索生命周期轨道，应用前不会改变正式编排。" : input.action === "delete" ? input.kind === "scene" ? "移除原场景并整理章内顺序；候选保留完整修改前记录。" : "停用原记录并保留其稳定标识与引用；不会删除历史正文。" : input.kind === "scene" ? "场景位置调整会整理源章与目标章场景顺序，保留已有场景标识。" : "所列来源需要复核；事件参与不等于人物知情，预计回收不等于已经回收。"], unchecked: ["尚未进行 AI 剧情合理性审核；历史正文差异请回原章节核对修复。", "旧模型规划及其审核不证明本次改动已通过；不会自动重写正文或重建全部人物资料。"] };
    if (context.revision !== (await this.context(novelId)).revision || baseRevision !== await this.store.dependencies(novelId)) conflict("对象依据在预览期间发生变化，请重试。");
    const anchor = context.chapters.find(chapter => chapter.id === guardedIds[0])!;
    const version = await this.store.createVersion({ novelId, chapterId: anchor.id, kind: "arrangement_object", baseRevision: chapterRevision(anchor), content: JSON.stringify(preview), metadata: { preview, input, old, row, targetPlan, previousScenePlans: input.kind === "scene" ? context.scenes.filter(scene => [old?.planId, targetPlan?.id].includes(scene.planId)) : [], previousChapterSceneCards: input.kind === "scene" ? context.chapters.filter(chapter => affected.has(chapter.id)).map(chapter => ({ chapterId: chapter.id, sceneCards: chapter.sceneCards })) : [], contextRevision: context.revision, guards: Object.fromEntries(guardedIds.map(chapterId => [chapterId, guards.find(guard => guard.chapterId === chapterId)?.epoch ?? 0])) }, operationResult: version => ({ ...preview, id: version.id }) });
    return { ...preview, id: version.id };
  }

  private async conflicts(novelId: string, context: Awaited<ReturnType<BookArrangementObjectService["context"]>>, chapterIds: string[], guards: Array<{ chapterId: string; manualSessionId: string | null }>) {
    const conflicts: BookArrangementObjectPreview["conflicts"] = [];
    const locked = parseJson<{ chapterEdits?: Array<{ chapterId: string; locked: boolean }> }>(context.draft?.payloadJson, {}).chapterEdits?.filter(edit => edit.locked && chapterIds.includes(edit.chapterId)).map(edit => edit.chapterId) ?? [];
    if (locked.length) conflicts.push({ code: "ARRANGEMENT_LOCKED", message: "相关章节编排已锁定，请先解除锁定。", chapterIds: locked });
    const manual = guards.filter(guard => guard.manualSessionId).map(guard => guard.chapterId);
    if (manual.length) conflicts.push({ code: "MANUAL_ACTIVE", message: "相关章节正在人工接管，请先完成交接。", chapterIds: manual });
    if (context.running.some(step => !step.targetId || step.targetType === "novel" || chapterIds.includes(step.targetId))) conflicts.push({ code: "RUNNING_SCOPE", message: "相关范围仍有导演步骤运行，请回原流程暂停并完成交接。", chapterIds });
    if (context.executions.some(execution => !execution.runtime.currentChapterId || chapterIds.includes(execution.runtime.currentChapterId))) conflicts.push({ code: "RUNNING_SCOPE", message: "相关范围仍有有效的导演执行租约，请完成原流程交接。", chapterIds });
    if (await this.store.db.writingAcceptance.count({ where: { novelId, chapterId: { in: chapterIds }, status: { in: ["pending", "running", "failed"] } } })) conflicts.push({ code: "SYNC_PENDING", message: "相关章节的采纳资料尚未同步完成。", chapterIds });
    return conflicts;
  }

  async apply(novelId: string, candidateId: string): Promise<BookArrangementObjectApplyReceipt> {
    const receipt = await this.store.db.$transaction(async tx => {
      const store = new AdjustmentStore(tx as PrismaClient), service = new BookArrangementObjectService(store);
      const version = await tx.chapterEditVersion.findFirst({ where: { novelId, id: candidateId, kind: "arrangement_object" } });
      if (!version) throw new AppError("对象候选不存在。", 404);
      const candidate = parseJson<ObjectCandidate>(version.metadataJson, null!);
      if (candidate.applied) return this.store.recordResult(tx, candidate.applied);
      if (!candidate.preview.canApply) conflict("请先处理预览冲突，再重新预览。");
      const chapterIds = Object.keys(candidate.guards);
      await store.lockChapters(tx, novelId, chapterIds, true);
      await tx.$executeRaw`UPDATE "Novel" SET "id" = "id" WHERE "id" = ${novelId}`;
      const context = await service.context(novelId), guards = await tx.chapterAdjustmentGuard.findMany({ where: { chapterId: { in: chapterIds } } });
      if (candidate.contextRevision !== context.revision || candidate.preview.baseRevision !== await store.dependencies(novelId)) conflict("对象或依赖已变化，请重新预览。", "REQUIREMENTS_STALE");
      if ((await service.conflicts(novelId, context, chapterIds, guards)).length || guards.some(guard => guard.novelId !== novelId || guard.epoch !== candidate.guards[guard.chapterId])) conflict("范围已锁定、接管或正在运行，请完成交接后重新预览。");
      const current = candidate.input.action === "create" ? null : await findArrangementObject(tx, novelId, candidate.input.kind, candidate.preview.objectId);
      if (candidate.input.action !== "create" && (!current || digest(current) !== candidate.input.expectedRevision)) conflict("原对象版本已变化。");
      await writeArrangementObject(tx, { novelId, kind: candidate.input.kind, action: candidate.input.action, objectId: candidate.preview.objectId, row: candidate.row, old: current, targetPlan: candidate.targetPlan });
      for (const chapterId of chapterIds) await tx.chapterAdjustmentGuard.upsert({ where: { chapterId }, create: { chapterId, novelId, epoch: 1 }, update: { epoch: { increment: 1 } } });
      await tx.novel.update({ where: { id: novelId }, data: { updatedAt: new Date() } });
      const affectedArtifacts = await tx.directorArtifact.findMany({ where: { novelId, protectedUserContent: false, targetId: { in: candidate.preview.affectedChapterIds }, artifactType: { in: ["chapter_task_sheet", "chapter_retention_contract", "audit_report"] }, status: { in: ["active", "ready", "approved", "accepted"] } }, select: { id: true } });
      if (affectedArtifacts.length) await tx.directorArtifact.updateMany({ where: { id: { in: affectedArtifacts.map(item => item.id) } }, data: { status: "stale" } });
      const result: BookArrangementObjectApplyReceipt = { id: candidateId, status: "applied", kind: candidate.input.kind, objectId: candidate.preview.objectId, affectedChapterIds: candidate.preview.affectedChapterIds };
      const stored = await tx.chapterEditVersion.updateMany({ where: { id: candidateId, metadataJson: version.metadataJson }, data: { metadataJson: JSON.stringify({ ...candidate, applied: result }) } });
      if (stored.count !== 1) conflict("此对象候选已被另一操作采纳。");
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: candidateId }, data: { status: "accepted" } });
      return this.store.recordResult(tx, result);
    }, { isolationLevel: "Serializable", timeout: 60000 }).catch(error => {
      if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) conflict("对象正被另一操作修改，请重试。");
      throw error;
    });
    await novelEventBus.emit({ type: "novel:updated", payload: { novelId, fields: ["arrangement_objects"] } });
    return receipt;
  }
}

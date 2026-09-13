import { randomUUID } from "node:crypto";
import type { PrismaClient, WritingSetting } from "@prisma/client";
import { z } from "zod";
import type { BookArrangementApplyReceipt, BookArrangementWorkspace, BookArrangementCheck, BookArrangementClue, BookArrangementHookNode, BookArrangementRelation, DraftPayload, DraftRecord, Preview } from "@ai-novel/shared/types/bookArrangement";
import type { WritingSettingsPayload } from "@ai-novel/shared/types/writingAdjustments";
import { AppError } from "../../../../middleware/errorHandler";
import { chapterRevision, conflict, controlsSchema, digest, EMPTY_SETTINGS, parseJson, validateControlObjects } from "../domain/contracts";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { WritingSettingsService } from "./WritingSettingsService";
import { BOOK_ARRANGEMENT_CONTROL_VERSION, renderBookArrangementPreserve } from "../../../../prompting/prompts/novel/bookArrangementControls";
import { parseChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";

const DRAFT_SCOPE = "book-arrangement:draft";
const chapterScope = (id: string) => `arrangement:chapter:${id}`;
const id = z.string().trim().min(1).max(200);
export const arrangementChapterIdsSchema = z.array(id).min(1).max(2000).refine(ids => new Set(ids).size === ids.length, "章节不能重复。");
export const arrangementVolumeEditSchema = z.object({ volumeId: id, title: z.string().trim().min(1).max(300), summary: z.string().max(10000), mainPromise: z.string().max(10000), protagonistChange: z.string().max(10000), climax: z.string().max(10000), nextVolumeHook: z.string().max(10000), chapterIds: arrangementChapterIdsSchema }).strict();
export const arrangementDraftSchema = z.object({
  baseRevision: z.string().trim().min(1).max(200),
  chapterEdits: z.array(z.object({ chapterId: id, note: z.string().max(2000), controls: controlsSchema, locked: z.boolean() }).strict()).max(2000),
  characterSpans: z.array(z.object({ id, characterId: id, chapterIds: arrangementChapterIdsSchema, mode: z.enum(["must", "suggested", "indirect", "forbidden"]), weight: z.number().min(0).max(100).nullable(), note: z.string().max(2000) }).strict()).max(500),
  pinnedTracks: z.array(id).max(100).refine(ids => new Set(ids).size === ids.length, "固定轨道不能重复。"),
  volumeEdits: z.array(arrangementVolumeEditSchema).max(200).optional(),
}).strict();
interface ArrangementCandidate {
  preview: Omit<Preview, "id">;
  draftRevision: number;
  draftPayloadJson: string;
  settingsRevision: string;
  settingsByChapter: Record<string, WritingSettingsPayload>;
  guards: Record<string, { epoch: number; manualSessionId: string | null }>;
  applied?: BookArrangementApplyReceipt;
}

/** Arrangement drafts reuse optional settings and candidate artifacts, never formal prose. */
export class BookArrangementService {
  constructor(readonly store: AdjustmentStore, readonly settings = new WritingSettingsService(store)) {}

  private draftRecord(row: WritingSetting | null, baseRevision: string): DraftRecord {
    return { revision: row?.revision ?? 0, payload: parseJson<DraftPayload>(row?.payloadJson, { baseRevision, chapterEdits: [], characterSpans: [], pinnedTracks: [] }), updatedAt: row?.updatedAt.toISOString() ?? null };
  }
  private async validateDraft(novelId: string, payload: DraftPayload) {
    const parsed = arrangementDraftSchema.parse(payload);
    if (new Set(parsed.chapterEdits.map(edit => edit.chapterId)).size !== parsed.chapterEdits.length) throw new AppError("同一章节只能有一份编排设置。", 400);
    if (new Set(parsed.characterSpans.map(span => span.id)).size !== parsed.characterSpans.length) throw new AppError("人物参与段标识不能重复。", 400);
    const volumeEdits = parsed.volumeEdits ?? [];
    if (new Set(volumeEdits.map(edit => edit.volumeId)).size !== volumeEdits.length) throw new AppError("同一卷只能有一份编排设置。", 400);
    if (volumeEdits.length && await this.store.db.volumePlan.count({ where: { novelId, id: { in: volumeEdits.map(edit => edit.volumeId) } } }) !== volumeEdits.length) throw new AppError("卷段不属于当前作品。", 400);
    const allIds = [...new Set([...parsed.chapterEdits.map(edit => edit.chapterId), ...parsed.characterSpans.flatMap(span => span.chapterIds), ...volumeEdits.flatMap(edit => edit.chapterIds)])];
    if (allIds.length) await this.store.chapters(novelId, { kind: "chapters", chapterIds: allIds });
    else await this.store.novel(novelId);
    const characters = await this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true } });
    const characterIds = new Set(characters.map(character => character.id));
    for (const edit of parsed.chapterEdits) validateControlObjects(edit.controls, characterIds);
    const bindings = new Set<string>();
    for (const span of parsed.characterSpans) {
      if (!characterIds.has(span.characterId)) throw new AppError("编排中的人物必须属于当前作品。", 400);
      for (const chapterId of span.chapterIds) {
        const binding = JSON.stringify([span.characterId, chapterId]);
        if (bindings.has(binding)) throw new AppError("同一人物在同一章节的参与段不能重叠，请合并为一份要求。", 400);
        bindings.add(binding);
      }
    }
    return { payload: parsed, characters };
  }
  private async settingsRevision(novelId: string, chapterIds: string[]) {
    const keys = ["novel", ...chapterIds.flatMap(chapterId => [chapterScope(chapterId), `chapter:${chapterId}`])];
    const rows = await this.store.db.writingSetting.findMany({ where: { novelId, scopeKey: { in: keys } }, select: { id: true, scopeKey: true, revision: true, payloadJson: true }, orderBy: { scopeKey: "asc" } });
    return digest(rows);
  }
  private chapterSettings(payload: DraftPayload, chapterId: string, names: Map<string, string>): WritingSettingsPayload {
    const edit = payload.chapterEdits.find(row => row.chapterId === chapterId);
    const preserve = renderBookArrangementPreserve(edit?.note ?? "", payload.characterSpans.filter(row => row.chapterIds.includes(chapterId)).map(span => ({ ...span, characterName: names.get(span.characterId)! })));
    return { enabled: true, controls: edit?.controls ?? {}, preserve };
  }

  async workspace(novelId: string): Promise<BookArrangementWorkspace> {
    const novel = await this.store.novel(novelId);
    const [baseRevision, chapters, characters, events, chapterPlans, volumes, settings, draft, candidates, relationStages, hooks, hookLifecycleNodes, latestSnapshot, auditReports, conflicts, cover, genre] = await Promise.all([
      this.store.dependencies(novelId),
      this.store.db.chapter.findMany({ where: { novelId }, orderBy: { order: "asc" } }),
      this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      this.store.db.storyTimelineEvent.findMany({ where: { novelId }, orderBy: [{ eventOrder: "asc" }, { id: "asc" }] }),
      this.store.db.storyPlan.findMany({ where: { novelId, chapterId: { not: null }, level: "chapter", status: { not: "stale" } }, include: { scenes: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
      this.store.db.volumePlan.findMany({ where: { novelId }, include: { chapters: { select: { chapterId: true }, orderBy: { chapterOrder: "asc" } } }, orderBy: { sortOrder: "asc" } }),
      this.store.db.writingSetting.findMany({ where: { novelId, scopeKey: { startsWith: "arrangement:chapter:" } } }),
      this.store.db.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: DRAFT_SCOPE } } }),
      this.store.db.chapterEditVersion.findMany({ where: { novelId, kind: { in: ["arrangement", "arrangement_volume", "arrangement_object", "arrangement_scene"] } }, orderBy: { createdAt: "desc" }, take: 80 }),
      this.store.db.characterRelationStage.findMany({ where: { novelId, sourceCharacter: { novelId }, targetCharacter: { novelId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      this.store.db.timelineHook.findMany({ where: { novelId }, orderBy: [{ createdInChapterIndex: "asc" }, { id: "asc" }] }),
      this.store.db.timelineHookLifecycleNode.findMany({ where: { novelId, active: true }, orderBy: [{ chapterIndex: "asc" }, { position: "asc" }, { id: "asc" }] }),
      this.store.db.storyStateSnapshot.findFirst({ where: { novelId }, include: { foreshadowStates: { orderBy: { id: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      this.store.db.auditReport.findMany({ where: { novelId }, include: { issues: { orderBy: { createdAt: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      this.store.db.openConflict.findMany({ where: { novelId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
      this.store.db.imageAsset.findFirst({ where: { novelId, sceneType: "novel_cover", isPrimary: true }, select: { url: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      novel.genreId ? this.store.db.novelGenre.findUnique({ where: { id: novel.genreId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    const chapterIds = new Set(chapters.map(chapter => chapter.id));
    const validChapter = (chapterId: string | null): string | null => chapterId && chapterIds.has(chapterId) ? chapterId : null;
    const chapterRefs = (ids: Array<string | null>): string[] => [...new Set(ids.flatMap(chapterId => validChapter(chapterId) ? [chapterId!] : []))];
    const projectionSources = new Set(["volume_projection", "cast_option_projection", "rebuild_projection", "arrangement_plan"]);
    const relations: BookArrangementRelation[] = relationStages.map(stage => {
      const basis = projectionSources.has(stage.sourceType) ? "plan" : stage.sourceType === "chapter_draft_extract" ? "record" : stage.sourceType === "manual_override" ? "setting" : "unknown";
      const chapterId = validChapter(stage.chapterId);
      const refs = chapterId ? [chapterId] : basis === "plan" ? chapterRefs(volumes.find(volume => volume.id === stage.volumeId)?.chapters.map(chapter => chapter.chapterId) ?? []) : [];
      return { id: `CharacterRelationStage:${stage.id}`, sourceId: stage.id, sourceEntity: "CharacterRelationStage", chapterIds: refs, title: stage.stageLabel, summary: stage.stageSummary, status: stage.isCurrent ? "current" : "historical", basis, evidenceLabel: basis === "plan" ? "关系规划投影，尚不代表已经发生。" : basis === "record" ? "章节草稿提取记录，需对照正文确认。" : basis === "setting" ? "作者关系设定，是否发生须查正文。" : "原有关系记录，来源未明确为规划或历史事实。", sourceCharacterId: stage.sourceCharacterId, targetCharacterId: stage.targetCharacterId, sourceType: stage.sourceType, chapterId, volumeId: stage.volumeId, isCurrent: stage.isCurrent };
    });
    const clues: BookArrangementClue[] = [
      ...hooks.map((hook): BookArrangementClue => ({ id: `TimelineHook:${hook.id}`, sourceId: hook.id, sourceEntity: "TimelineHook", chapterIds: chapterRefs([hook.createdInChapterId, hook.resolvedInChapterId]), title: hook.title, summary: hook.description, status: hook.status, basis: hook.status === "planned" ? "plan" : "record", evidenceLabel: "已存线索记录；预计回收章是规划，不能据此视为已回收。", setupChapterId: validChapter(hook.createdInChapterId), payoffChapterId: validChapter(hook.resolvedInChapterId), expectedPayoffChapterOrder: hook.expectedResolveByChapterIndex, sourceSnapshotId: null })),
      ...(latestSnapshot?.foreshadowStates ?? []).map((state): BookArrangementClue => ({ id: `ForeshadowState:${state.id}`, sourceId: state.id, sourceEntity: "ForeshadowState", chapterIds: chapterRefs([state.setupChapterId, state.payoffChapterId]), title: state.title, summary: state.summary ?? "", status: state.status, basis: state.status === "planned" ? "plan" : "record", evidenceLabel: "最新故事状态快照中的伏笔记录；回收位置须对照正文核实。", setupChapterId: validChapter(state.setupChapterId), payoffChapterId: validChapter(state.payoffChapterId), expectedPayoffChapterOrder: null, sourceSnapshotId: latestSnapshot!.id })),
    ];
    const chapterById = new Map(chapters.map(chapter => [chapter.id, chapter]));
    const hookNodes: BookArrangementHookNode[] = hookLifecycleNodes.flatMap(node => {
      const chapter = chapterById.get(node.chapterId);
      if (!chapter || !hooks.some(hook => hook.id === node.hookId)) return [];
      const evidence = node.evidence?.trim() || null;
      const evidenceStatus: BookArrangementHookNode["evidenceStatus"] = node.basis === "plan" ? "planned" : !evidence ? "missing" : chapter.content?.includes(evidence) ? "matched" : "mismatch";
      return [{ id: `TimelineHookLifecycleNode:${node.id}`, sourceId: node.id, sourceEntity: "TimelineHookLifecycleNode", chapterIds: [chapter.id], title: node.note || "未命名线索节点", summary: evidence ?? node.note, status: node.active ? "active" : "inactive", basis: node.basis === "record" ? "record" : "plan", evidenceLabel: node.basis === "plan" ? "作者计划节点，尚不代表正文已经发生。" : evidenceStatus === "matched" ? "证据原文可在该章正文精确定位。" : evidenceStatus === "missing" ? "正文记录缺少证据原文，需要补充。" : "证据原文未能在当前正文精确定位，需要复核。", hookId: node.hookId, chapterId: chapter.id, chapterOrder: chapter.order, stage: node.stage as BookArrangementHookNode["stage"], nodeBasis: node.basis === "record" ? "record" : "plan", note: node.note, evidence, evidenceStatus, relatedEventId: node.relatedEventId, relatedSceneId: node.relatedSceneId, position: node.position }];
    });
    const reportsSeen = new Set<string>(), auditIssueIds = new Set<string>();
    const checks: BookArrangementCheck[] = [];
    for (const report of auditReports) {
      const key = JSON.stringify([report.chapterId, report.auditType]);
      if (!chapterIds.has(report.chapterId) || reportsSeen.has(key)) continue;
      reportsSeen.add(key);
      for (const issue of report.issues) {
        auditIssueIds.add(issue.id);
        checks.push({ id: `AuditIssue:${issue.id}`, sourceId: issue.id, sourceEntity: "AuditIssue", chapterIds: [report.chapterId], title: issue.code, summary: issue.description, status: issue.status, basis: "record", evidenceLabel: "该章此类最新审核的已存问题；原报告未绑定正文版本，需复核当前稿。", chapterId: report.chapterId, severity: issue.severity, category: issue.auditType, evidence: issue.evidence, fixSuggestion: issue.fixSuggestion, reportId: report.id, sourceRevision: null });
      }
    }
    for (const item of conflicts) {
      if (item.sourceIssueId && auditIssueIds.has(item.sourceIssueId)) continue;
      const chapterId = validChapter(item.chapterId);
      checks.push({ id: `OpenConflict:${item.id}`, sourceId: item.id, sourceEntity: "OpenConflict", chapterIds: chapterId ? [chapterId] : [], title: item.title, summary: item.summary, status: item.status, basis: "record", evidenceLabel: "已登记的故事冲突；这是待核对记录，不等于已确认错误。", chapterId, severity: item.severity, category: item.conflictType, evidence: item.evidenceJson, fixSuggestion: item.resolutionHint, reportId: null, sourceRevision: null });
    }
    const canonicalPlans = new Map<string, (typeof chapterPlans)[number]>();
    for (const plan of chapterPlans) if (plan.chapterId && !canonicalPlans.has(plan.chapterId)) canonicalPlans.set(plan.chapterId, plan);
    const projectedScenes = chapters.flatMap(chapter => {
      const activePlan = canonicalPlans.get(chapter.id);
      if (!activePlan) return [];
      const parsedPlan = parseChapterScenePlan(chapter.sceneCards, { targetWordCount: chapter.targetWordCount ?? undefined });
      const fallbackWords = Math.max(1, Math.round((chapter.targetWordCount ?? 3000) / Math.max(1, activePlan.scenes.length)));
      return activePlan.scenes.map((scene, index) => {
        const card = parsedPlan?.scenes.find(item => item.key === scene.id) ?? parsedPlan?.scenes[index];
        return { id: scene.id, revision: digest({ id: scene.id, updatedAt: scene.updatedAt, sortOrder: scene.sortOrder, title: scene.title, objective: scene.objective, conflict: scene.conflict, reveal: scene.reveal, emotionBeat: scene.emotionBeat }), chapterId: chapter.id, sortOrder: index + 1,
          title: scene.title, objective: scene.objective ?? card?.purpose ?? "", conflict: scene.conflict ?? card?.resistance ?? "", reveal: scene.reveal ?? card?.turn ?? "", emotionBeat: scene.emotionBeat ?? card?.emotionalShift ?? "",
          targetWordCount: card?.targetWordCount ?? fallbackWords, mustAdvance: card?.mustAdvance ?? [], mustPreserve: card?.mustPreserve ?? [], entryState: card?.entryState ?? scene.objective ?? scene.title,
          exitState: card?.exitState ?? scene.reveal ?? scene.emotionBeat ?? scene.objective ?? scene.title, forbiddenExpansion: card?.forbiddenExpansion ?? [], resistance: card?.resistance ?? scene.conflict ?? "",
          turn: card?.turn ?? scene.reveal ?? "", emotionalShift: card?.emotionalShift ?? scene.emotionBeat ?? "", readerValue: card?.readerValue ?? "" };
      });
    });
    return {
      novelId, title: novel.title, baseRevision,
      coverUrl: cover?.url ?? null, genre, relations, clues, hookNodes, checks,
      chapters: chapters.map(chapter => ({ id: chapter.id, title: chapter.title, order: chapter.order, revision: chapterRevision(chapter), outline: chapter.expectation ?? "", hasContent: Boolean(chapter.content?.trim()), wordCount: Array.from((chapter.content ?? "").replace(/\s/g, "")).length, targetWordCount: chapter.targetWordCount })),
      characters,
      events: events.map(event => ({ id: event.id, title: event.title, summary: event.summary, revision: digest(event), chapterId: event.chapterId, chapterOrder: event.chapterIndex, storyDayIndex: event.storyDayIndex, storyTimeLabel: event.storyTimeLabel, participantIds: parseJson<string[]>(event.participantIdsJson, []), status: event.status, visibility: event.visibility })),
      scenes: projectedScenes,
      volumes: volumes.map(volume => {
        const ids = volume.chapters.flatMap(chapter => chapter.chapterId && chapterIds.has(chapter.chapterId) ? [chapter.chapterId] : []);
        const orders = chapters.filter(chapter => ids.includes(chapter.id)).map(chapter => chapter.order);
        return { id: volume.id, title: volume.title, order: volume.sortOrder, chapterIds: ids, startChapterOrder: orders.length ? Math.min(...orders) : null, endChapterOrder: orders.length ? Math.max(...orders) : null, summary: volume.summary ?? "", mainPromise: volume.mainPromise ?? "", protagonistChange: volume.protagonistChange ?? "", climax: volume.climax ?? "", nextVolumeHook: volume.nextVolumeHook ?? "", revision: digest(volume) };
      }),
      appliedSettings: Object.fromEntries(settings.flatMap(row => { const chapterId = row.scopeKey.slice("arrangement:chapter:".length); return chapterIds.has(chapterId) ? [[chapterId, { revision: row.revision, settings: parseJson<WritingSettingsPayload>(row.payloadJson, EMPTY_SETTINGS) }]] : []; })),
      draft: this.draftRecord(draft, baseRevision),
      previews: candidates.filter(row => row.kind === "arrangement").flatMap(row => { const candidate = parseJson<ArrangementCandidate>(row.metadataJson, null!); return candidate?.preview ? [{ ...candidate.preview, id: row.id }] : []; }),
      volumePreviews: candidates.filter(row => row.kind === "arrangement_volume").flatMap(row => { const candidate = parseJson<{ preview?: import("@ai-novel/shared/types/bookArrangement").BookArrangementVolumePreview }>(row.metadataJson, {}); return candidate.preview ? [{ ...candidate.preview, id: row.id }] : []; }),
      objectPreviews: candidates.filter(row => row.kind === "arrangement_object").flatMap(row => { const candidate = parseJson<{ preview?: import("@ai-novel/shared/types/bookArrangement").BookArrangementObjectPreview; applied?: import("@ai-novel/shared/types/bookArrangement").BookArrangementObjectApplyReceipt }>(row.metadataJson, {}); return candidate.preview ? [{ ...candidate.preview, id: row.id, ...(candidate.applied ? { applied: candidate.applied } : {}) }] : []; }),
      scenePreviews: candidates.filter(row => row.kind === "arrangement_scene").flatMap(row => { const candidate = parseJson<{ preview?: import("@ai-novel/shared/types/bookArrangement").BookArrangementScenePreview; applied?: import("@ai-novel/shared/types/bookArrangement").BookArrangementSceneApplyReceipt }>(row.metadataJson, {}); return candidate.preview ? [{ ...candidate.preview, id: row.id, ...(candidate.applied ? { applied: candidate.applied } : {}) }] : []; }),
    };
  }

  async saveDraft(novelId: string, input: { expectedRevision: number; payload: DraftPayload }): Promise<DraftRecord> {
    const expectedRevision = z.number().int().min(0).parse(input.expectedRevision);
    return this.store.db.$transaction(async tx => {
      const store = new AdjustmentStore(tx as PrismaClient), service = new BookArrangementService(store);
      const { payload } = await service.validateDraft(novelId, input.payload);
      const baseRevision = await store.dependencies(novelId);
      if (baseRevision !== payload.baseRevision) conflict("故事依据已变化，请刷新编排后重新保存草稿。", "REQUIREMENTS_STALE");
      const found = await tx.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: DRAFT_SCOPE } } });
      if ((found?.revision ?? 0) !== expectedRevision) conflict("编排草稿已被其他窗口修改，请刷新后比较。");
      const id = found?.id ?? randomUUID();
      if (found) {
        const changed = await tx.writingSetting.updateMany({ where: { id, revision: expectedRevision }, data: { revision: { increment: 1 }, payloadJson: JSON.stringify(payload) } });
        if (changed.count !== 1) conflict("编排草稿正在被其他操作修改。");
      } else await tx.writingSetting.create({ data: { id, novelId, scopeKey: DRAFT_SCOPE, payloadJson: JSON.stringify(payload) } });
      const row = await tx.writingSetting.findUniqueOrThrow({ where: { id } });
      return this.store.recordResult(tx, this.draftRecord(row, baseRevision));
    }, { isolationLevel: "Serializable" }).catch(error => {
      if ((error as { code?: string }).code === "P2002" || (error as { code?: string }).code === "P2034") conflict("编排草稿正在被其他操作修改，请刷新后重试。");
      throw error;
    });
  }

  async preview(novelId: string, input: { draftRevision: number; chapterIds: string[] }): Promise<Preview> {
    const requestedIds = arrangementChapterIdsSchema.parse(input.chapterIds);
    const requested = await this.store.chapters(novelId, { kind: "chapters", chapterIds: requestedIds });
    const draft = await this.store.db.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: DRAFT_SCOPE } } });
    if (!draft || draft.revision !== input.draftRevision) conflict("请先保存当前编排草稿，再预览所选章节。");
    const baseRevision = await this.store.dependencies(novelId);
    const { payload, characters } = await this.validateDraft(novelId, parseJson<DraftPayload>(draft.payloadJson, null!));
    if (payload.baseRevision !== baseRevision) conflict("故事依据已变化，请刷新并重新保存编排草稿。", "REQUIREMENTS_STALE");
    const excluded = new Set(payload.chapterEdits.filter(edit => edit.locked).map(edit => edit.chapterId));
    const chapters = requested.filter(chapter => !excluded.has(chapter.id));
    if (!chapters.length) throw new AppError("所选章节都已锁定，请解除编排锁定或选择其他章节。", 400);
    const ids = chapters.map(chapter => chapter.id), names = new Map(characters.map(character => [character.id, character.name]));
    const settingsRevision = await this.settingsRevision(novelId, ids);
    const changes: Preview["changes"] = [], settingsByChapter: Record<string, WritingSettingsPayload> = {};
    for (const chapter of chapters) {
      const settings = this.chapterSettings(payload, chapter.id, names);
      settingsByChapter[chapter.id] = settings;
      changes.push({ chapterId: chapter.id, before: (await this.settings.get(novelId, chapter.id)).effective, after: (await this.settings.get(novelId, chapter.id, settings)).effective });
    }
    const guards = await this.store.db.chapterAdjustmentGuard.findMany({ where: { novelId, chapterId: { in: ids } } });
    if (settingsRevision !== await this.settingsRevision(novelId, ids) || baseRevision !== await this.store.dependencies(novelId)) conflict("编排依据在预览期间发生变化，请重新预览。", "REQUIREMENTS_STALE");
    const preview = { chapterIds: ids, excludedChapterIds: requested.filter(chapter => excluded.has(chapter.id)).map(chapter => chapter.id), changes, impact: ["应用后仅更新所选章节的全书编排要求；正文、章纲、事件和正式人物状态保持原样。", "本章单独设置与本次写作参数优先于全书编排；已冻结的写作要求保持原样。", "编排锁定只排除此处的预览与应用，不锁住原写作流程。"], baseRevision };
    const metadata = { draftRevision: draft.revision, draftPayloadJson: draft.payloadJson, settingsRevision, settingsByChapter, controlFragmentVersion: BOOK_ARRANGEMENT_CONTROL_VERSION, guards: Object.fromEntries(ids.map(chapterId => { const guard = guards.find(row => row.chapterId === chapterId); return [chapterId, { epoch: guard?.epoch ?? 0, manualSessionId: guard?.manualSessionId ?? null }]; })) };
    const result = await this.store.createVersion({ novelId, chapterId: chapters[0].id, kind: "arrangement", content: JSON.stringify(preview), baseRevision: chapterRevision(chapters[0]), metadata: { ...metadata, preview }, operationResult: version => ({ ...preview, id: version.id }) });
    return { ...preview, id: result.id };
  }

  async apply(novelId: string, candidateId: string, input: { chapterIds: string[] }): Promise<BookArrangementApplyReceipt> {
    const ids = arrangementChapterIdsSchema.parse(input.chapterIds);
    return this.store.db.$transaction(async tx => {
      const store = new AdjustmentStore(tx as PrismaClient), service = new BookArrangementService(store);
      const row = await tx.chapterEditVersion.findFirst({ where: { id: candidateId, novelId, kind: "arrangement" } });
      if (!row) throw new AppError("编排候选不存在。", 404);
      const candidate = parseJson<ArrangementCandidate>(row.metadataJson, null!);
      if (ids.some(chapterId => !candidate.preview.chapterIds.includes(chapterId))) throw new AppError("只能应用本次预览中未锁定的章节。", 400);
      if (candidate.applied) {
        if (candidate.applied.chapterIds.length !== ids.length || ids.some(chapterId => !candidate.applied!.chapterIds.includes(chapterId))) conflict("此候选已按另一范围应用，请重新预览剩余章节。");
        return this.store.recordResult(tx, candidate.applied);
      }
      await store.chapters(novelId, { kind: "chapters", chapterIds: ids });
      await store.lockChapters(tx, novelId, ids, true);
      if (candidate.preview.baseRevision !== await store.dependencies(novelId)) conflict("故事依据已变化，请重新预览编排。", "REQUIREMENTS_STALE");
      const draft = await tx.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: DRAFT_SCOPE } } });
      if (!draft || draft.revision !== candidate.draftRevision || draft.payloadJson !== candidate.draftPayloadJson) conflict("编排草稿已变化，请重新预览。");
      if (candidate.settingsRevision !== await service.settingsRevision(novelId, candidate.preview.chapterIds)) conflict("写作设置已变化，请重新预览有效要求。");
      const appliedSettings: BookArrangementApplyReceipt["appliedSettings"] = {};
      for (const chapterId of [...ids].sort()) {
        const guard = await tx.chapterAdjustmentGuard.findUnique({ where: { chapterId } });
        if (guard && guard.novelId !== novelId) conflict("章节交接记录不属于当前作品。");
        const expected = candidate.guards[chapterId];
        if (!expected || (guard?.epoch ?? 0) !== expected.epoch || (guard?.manualSessionId ?? null) !== expected.manualSessionId) conflict("章节交接状态已变化，请重新预览。");
        const scopeKey = chapterScope(chapterId), settings = candidate.settingsByChapter[chapterId];
        const before = await tx.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey } } });
        if (before) {
          const changed = await tx.writingSetting.updateMany({ where: { id: before.id, revision: before.revision, payloadJson: before.payloadJson }, data: { revision: { increment: 1 }, payloadJson: JSON.stringify(settings) } });
          if (changed.count !== 1) conflict("编排要求正在被其他操作修改。");
        }
        const saved = before ? await tx.writingSetting.findUniqueOrThrow({ where: { id: before.id } })
          : await tx.writingSetting.create({ data: { id: randomUUID(), novelId, scopeKey, payloadJson: JSON.stringify(settings) } });
        appliedSettings[chapterId] = { revision: saved.revision, settings };
      }
      const receipt: BookArrangementApplyReceipt = { id: candidateId, status: "applied", chapterIds: ids, appliedSettings };
      const updated = await tx.chapterEditVersion.updateMany({ where: { id: candidateId, novelId, metadataJson: row.metadataJson }, data: { metadataJson: JSON.stringify({ ...candidate, applied: receipt }) } });
      if (updated.count !== 1) conflict("此编排候选正在被另一操作应用。");
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: candidateId }, data: { status: "accepted" } });
      return this.store.recordResult(tx, receipt);
    }, { isolationLevel: "Serializable" }).catch(error => {
      if ((error as { code?: string }).code === "P2002" || (error as { code?: string }).code === "P2034") conflict("编排设置正在被其他操作修改，请重新预览。");
      throw error;
    });
  }
}

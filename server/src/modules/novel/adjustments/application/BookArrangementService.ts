import { randomUUID } from "node:crypto";
import type { PrismaClient, WritingSetting } from "@prisma/client";
import { z } from "zod";
import type { BookArrangementApplyReceipt, BookArrangementWorkspace, DraftPayload, DraftRecord, Preview } from "@ai-novel/shared/types/bookArrangement";
import type { WritingSettingsPayload } from "@ai-novel/shared/types/writingAdjustments";
import { AppError } from "../../../../middleware/errorHandler";
import { chapterRevision, conflict, controlsSchema, digest, EMPTY_SETTINGS, parseJson, validateControlObjects } from "../domain/contracts";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { WritingSettingsService } from "./WritingSettingsService";
import { BOOK_ARRANGEMENT_CONTROL_VERSION, renderBookArrangementPreserve } from "../../../../prompting/prompts/novel/bookArrangementControls";

const DRAFT_SCOPE = "book-arrangement:draft";
const chapterScope = (id: string) => `arrangement:chapter:${id}`;
const id = z.string().trim().min(1).max(200);
export const arrangementChapterIdsSchema = z.array(id).min(1).max(2000).refine(ids => new Set(ids).size === ids.length, "章节不能重复。");
export const arrangementDraftSchema = z.object({
  baseRevision: z.string().trim().min(1).max(200),
  chapterEdits: z.array(z.object({ chapterId: id, note: z.string().max(2000), controls: controlsSchema, locked: z.boolean() }).strict()).max(2000),
  characterSpans: z.array(z.object({ id, characterId: id, chapterIds: arrangementChapterIdsSchema, mode: z.enum(["must", "suggested", "indirect", "forbidden"]), weight: z.number().min(0).max(100).nullable(), note: z.string().max(2000) }).strict()).max(500),
  pinnedTracks: z.array(id).max(100).refine(ids => new Set(ids).size === ids.length, "固定轨道不能重复。"),
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
    const allIds = [...new Set([...parsed.chapterEdits.map(edit => edit.chapterId), ...parsed.characterSpans.flatMap(span => span.chapterIds)])];
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
    const [baseRevision, chapters, characters, events, scenes, volumes, settings, draft, candidates] = await Promise.all([
      this.store.dependencies(novelId),
      this.store.db.chapter.findMany({ where: { novelId }, orderBy: { order: "asc" } }),
      this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      this.store.db.storyTimelineEvent.findMany({ where: { novelId }, orderBy: [{ eventOrder: "asc" }, { id: "asc" }] }),
      this.store.db.chapterPlanScene.findMany({ where: { plan: { novelId, chapterId: { not: null }, status: { not: "stale" } } }, include: { plan: { select: { chapterId: true } } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      this.store.db.volumePlan.findMany({ where: { novelId }, include: { chapters: { select: { chapterId: true }, orderBy: { chapterOrder: "asc" } } }, orderBy: { sortOrder: "asc" } }),
      this.store.db.writingSetting.findMany({ where: { novelId, scopeKey: { startsWith: "arrangement:chapter:" } } }),
      this.store.db.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey: DRAFT_SCOPE } } }),
      this.store.db.chapterEditVersion.findMany({ where: { novelId, kind: "arrangement" }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const chapterIds = new Set(chapters.map(chapter => chapter.id));
    return {
      novelId, title: novel.title, baseRevision,
      chapters: chapters.map(chapter => ({ id: chapter.id, title: chapter.title, order: chapter.order, revision: chapterRevision(chapter), outline: chapter.expectation ?? "", hasContent: Boolean(chapter.content?.trim()), wordCount: Array.from((chapter.content ?? "").replace(/\s/g, "")).length })),
      characters,
      events: events.map(event => ({ id: event.id, title: event.title, summary: event.summary, revision: digest(event), chapterId: event.chapterId, chapterOrder: event.chapterIndex, storyDayIndex: event.storyDayIndex, storyTimeLabel: event.storyTimeLabel, participantIds: parseJson<string[]>(event.participantIdsJson, []), status: event.status, visibility: event.visibility })),
      scenes: scenes.flatMap(scene => scene.plan.chapterId && chapterIds.has(scene.plan.chapterId) ? [{ id: scene.id, chapterId: scene.plan.chapterId, title: scene.title, objective: scene.objective, sortOrder: scene.sortOrder }] : []),
      volumes: volumes.map(volume => {
        const ids = volume.chapters.flatMap(chapter => chapter.chapterId && chapterIds.has(chapter.chapterId) ? [chapter.chapterId] : []);
        const orders = chapters.filter(chapter => ids.includes(chapter.id)).map(chapter => chapter.order);
        return { id: volume.id, title: volume.title, order: volume.sortOrder, chapterIds: ids, startChapterOrder: orders.length ? Math.min(...orders) : null, endChapterOrder: orders.length ? Math.max(...orders) : null };
      }),
      appliedSettings: Object.fromEntries(settings.flatMap(row => { const chapterId = row.scopeKey.slice("arrangement:chapter:".length); return chapterIds.has(chapterId) ? [[chapterId, { revision: row.revision, settings: parseJson<WritingSettingsPayload>(row.payloadJson, EMPTY_SETTINGS) }]] : []; })),
      draft: this.draftRecord(draft, baseRevision),
      previews: candidates.flatMap(row => { const candidate = parseJson<ArrangementCandidate>(row.metadataJson, null!); return candidate?.preview ? [{ ...candidate.preview, id: row.id }] : []; }),
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

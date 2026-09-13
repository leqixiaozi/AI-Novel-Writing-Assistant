import type { PrismaClient, StoryTimelineEvent } from "@prisma/client";
import { AppError } from "../../../../middleware/errorHandler";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";

interface EventPatch { title?: string; summary?: string; storyDayIndex?: number | null; storyTimeLabel?: string | null; participantIds?: string[] }
interface LineCandidate {
  eventId: string; expectedRevision: string; patch: EventPatch;
  affectedChapterIds: string[]; dependencyRevision: string;
  guards: Record<string, { epoch: number; manualSessionId: string | null }>;
  impact: string[]; accepted?: boolean;
}
function eventRevision(event: StoryTimelineEvent) { return digest(event); }
function eventView(event: StoryTimelineEvent) {
  return { id: event.id, title: event.title, summary: event.summary, revision: eventRevision(event), chapterId: event.chapterId, chapterOrder: event.chapterIndex, storyDayIndex: event.storyDayIndex, storyTimeLabel: event.storyTimeLabel, participantIds: parseJson<string[]>(event.participantIdsJson, []), status: event.status, visibility: event.visibility };
}

/** Timeline and character views reference the same original event; no parallel fact store. */
export class WritingLineService {
  constructor(readonly store: AdjustmentStore) {}
  async lines(novelId: string, input: { chapterId?: string; characterId?: string } = {}) {
    await this.store.novel(novelId);
    const chapters = await this.store.db.chapter.findMany({ where: { novelId }, select: { id: true, title: true, order: true }, orderBy: { order: "asc" } });
    const characters = await this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true } });
    if (input.chapterId && !chapters.some(c => c.id === input.chapterId)) throw new AppError("请选择本书章节。", 400);
    if (input.characterId && !characters.some(c => c.id === input.characterId)) throw new AppError("请选择本书人物。", 400);
    const rows = await this.store.db.storyTimelineEvent.findMany({ where: { novelId, ...(input.chapterId ? { chapterId: input.chapterId } : {}) }, orderBy: [{ eventOrder: "asc" }], take: 1000 });
    return { chapters, characters, events: rows.map(eventView).filter(e => !input.characterId || e.participantIds.includes(input.characterId)), coverage: "最多1000条已有事件；阅读顺序与故事发生日分别列示，参与人物不等于知情人物。" };
  }
  async preview(novelId: string, eventId: string, input: { expectedRevision: string; patch: EventPatch }) {
    const event = await this.store.db.storyTimelineEvent.findFirst({ where: { id: eventId, novelId } });
    if (!event) throw new AppError("事件不存在。", 404);
    if (eventRevision(event) !== input.expectedRevision) conflict("事件已经变化，请重新载入。");
    if (!Object.keys(input.patch).length) throw new AppError("请至少调整一项事件资料。", 400);
    const ids = input.patch.participantIds ?? parseJson<string[]>(event.participantIdsJson, []);
    const characters = await this.store.db.character.findMany({ where: { novelId, id: { in: ids } }, select: { id: true } });
    if (characters.length !== ids.length || new Set(ids).size !== ids.length) throw new AppError("事件参与人物必须来自本书且不能重复。", 400);
    const [chapters, events, anchors, dependencyRevision] = await Promise.all([
      this.store.db.chapter.findMany({ where: { novelId }, orderBy: { order: "asc" } }),
      this.store.db.storyTimelineEvent.findMany({ where: { novelId } }),
      this.store.db.chapterTimeAnchor.findMany({ where: { novelId } }),
      this.store.dependencies(novelId),
    ]);
    const related = new Set([event.id, ...parseJson<string[]>(event.prerequisiteIdsJson, []), ...parseJson<string[]>(event.consequenceIdsJson, [])]);
    for (const e of events) if ([...parseJson<string[]>(e.prerequisiteIdsJson, []), ...parseJson<string[]>(e.consequenceIdsJson, [])].includes(event.id)) related.add(e.id);
    const impacted = new Set(events.filter(e => related.has(e.id)).flatMap(e => e.chapterId ? [e.chapterId] : []));
    for (const anchor of anchors) {
      const refs = [anchor.startsAfterIdsJson, anchor.plannedEventIdsJson, anchor.endedWithIdsJson, anchor.forbiddenEventIdsJson].flatMap(text => parseJson<string[]>(text, []));
      if (refs.some(ref => related.has(ref))) impacted.add(anchor.chapterId);
    }
    // An unassigned planning event is anchored to an existing chapter only for candidate storage.
    const anchor = chapters.find(c => c.id === event.chapterId) ?? chapters[0];
    if (!anchor) throw new AppError("请先建立章节，再调整关联事件。", 400);
    const affectedChapterIds = chapters.filter(c => impacted.has(c.id)).map(c => c.id);
    const guardedIds = [...new Set([anchor.id, ...affectedChapterIds])];
    const guards = await this.store.db.chapterAdjustmentGuard.findMany({ where: { novelId, chapterId: { in: guardedIds } } });
    const impact = ["只修改此事件的资料及人物引用；正文、章序和正式人物状态保持原样。", ...chapters.filter(c => impacted.has(c.id)).map(c => `第${c.order}章引用此事件或相邻因果关系，需要复核。`)];
    if (event.status !== "planned") impact.push("此事件标记为已发生资料。调整后需对照原文处理历史差异；本次不会把新的描述补造成正文证据。");
    if (input.patch.storyDayIndex !== undefined) impact.push("发生日变化不会改动章节阅读顺序；相邻事件和章节时间锚需复核。");
    const metadata: LineCandidate = { eventId, expectedRevision: input.expectedRevision, patch: input.patch, affectedChapterIds, dependencyRevision, guards: Object.fromEntries(guardedIds.map(id => { const g = guards.find(row => row.chapterId === id); return [id, { epoch: g?.epoch ?? 0, manualSessionId: g?.manualSessionId ?? null }]; })), impact };
    const before = eventView(event), after = { ...before, ...input.patch };
    const operationResult = (version: { id: string }) => ({ id: version.id, eventId, before, after, affectedChapterIds, impact });
    const version = await this.store.createVersion({ novelId, chapterId: anchor.id, kind: "line", baseRevision: chapterRevision(anchor), content: JSON.stringify({ before, after }), metadata: metadata as unknown as Record<string, unknown>, operationResult });
    return operationResult(version);
  }
  async accept(novelId: string, candidateId: string) {
    const version = await this.store.db.chapterEditVersion.findFirst({ where: { id: candidateId, novelId, kind: "line" } });
    if (!version) throw new AppError("事件调整候选不存在。", 404);
    const candidate = parseJson<LineCandidate>(version.metadataJson, null!);
    if (candidate.accepted) return { id: candidateId, status: "accepted", affectedChapterIds: candidate.affectedChapterIds };
    return this.store.db.$transaction(async tx => {
      await this.store.lockChapters(tx, novelId, Object.keys(candidate.guards), true);
      if (candidate.dependencyRevision !== await new AdjustmentStore(tx as PrismaClient).dependencies(novelId)) conflict("故事依据已变化，请重新预览事件影响。");
      const event = await tx.storyTimelineEvent.findFirst({ where: { novelId, id: candidate.eventId } });
      if (!event || eventRevision(event) !== candidate.expectedRevision) conflict("事件已被另一操作修改。");
      for (const chapterId of Object.keys(candidate.guards).sort()) {
        const expected = candidate.guards[chapterId];
        const guard = await tx.chapterAdjustmentGuard.upsert({ where: { chapterId }, create: { chapterId, novelId }, update: {} });
        if (guard.epoch !== expected.epoch || guard.manualSessionId !== expected.manualSessionId) conflict("相关章节的交接状态已变化，请重新预览。");
        const result = await tx.chapterAdjustmentGuard.updateMany({ where: { chapterId, novelId, epoch: guard.epoch, manualSessionId: guard.manualSessionId }, data: { epoch: { increment: 1 } } });
        if (!result.count) conflict("相关章节写入许可已变化。");
      }
      const { participantIds, ...patch } = candidate.patch;
      const updated = await tx.storyTimelineEvent.updateMany({ where: { id: event.id, novelId, updatedAt: event.updatedAt }, data: { ...patch, ...(participantIds ? { participantIdsJson: JSON.stringify(participantIds) } : {}) } });
      if (!updated.count) conflict("事件在保存期间发生变化。");
      await tx.storyPlan.updateMany({ where: { novelId, chapterId: { in: candidate.affectedChapterIds } }, data: { status: "stale" } });
      const stored = await tx.chapterEditVersion.updateMany({ where: { id: version.id, metadataJson: version.metadataJson }, data: { metadataJson: JSON.stringify({ ...candidate, accepted: true }) } });
      if (!stored.count) conflict("事件候选已被另一操作采纳。");
      await tx.directorArtifact.updateMany({ where: { novelId, contentTable: "ChapterEditVersion", contentId: version.id }, data: { status: "accepted" } });
      return this.store.recordResult(tx, { id: candidateId, status: "accepted", affectedChapterIds: candidate.affectedChapterIds });
    });
  }
}

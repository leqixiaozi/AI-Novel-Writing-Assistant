import { randomUUID } from "node:crypto";
import type { WritingAdjustmentIssue, WritingEvidence, WritingEvidenceResponse, WritingReview } from "@ai-novel/shared/types/writingAdjustments";
import { runStructuredPrompt, runTextPrompt } from "../../../../prompting/core/promptRunner";
import { writingAdjustmentEvidencePrompt, writingAdjustmentGeneratePrompt, writingAdjustmentPlanPrompt, writingAdjustmentQueryPrompt, writingAdjustmentReviewPrompt, writingAdjustmentSceneLocationPrompt, type WritingAdjustmentPromptInput } from "../../../../prompting/prompts/novel/writingAdjustment.prompts";
import { AppError } from "../../../../middleware/errorHandler";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { WritingSettingsService } from "./WritingSettingsService";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";

export const adjustmentAi = {
  async generate(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runTextPrompt({ asset: writingAdjustmentGeneratePrompt, promptInput: input, options: { novelId, chapterId } })).output; },
  async review(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentReviewPrompt, promptInput: input, options: { novelId, chapterId } })).output; },
  async plan(input: WritingAdjustmentPromptInput, novelId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentPlanPrompt, promptInput: input, options: { novelId } })).output; },
  async query(input: WritingAdjustmentPromptInput, novelId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentQueryPrompt, promptInput: input, options: { novelId } })).output; },
  async evidence(input: WritingAdjustmentPromptInput, novelId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentEvidencePrompt, promptInput: input, options: { novelId } })).output; },
  async locateScene(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentSceneLocationPrompt, promptInput: input, options: { novelId, chapterId } })).output; },
};
export type AdjustmentAi = typeof adjustmentAi;

export class WritingContentService {
  constructor(readonly store: AdjustmentStore, readonly settings: WritingSettingsService, readonly ai: AdjustmentAi = adjustmentAi) {}
  async context(novelId: string, chapterId: string) {
    const chapter = await this.store.chapter(novelId, chapterId);
    const novel = await this.store.novel(novelId);
    const [previous, characters, plans, decisions] = await Promise.all([
      this.store.db.chapter.findMany({ where: { novelId, order: { lt: chapter.order } }, orderBy: { order: "desc" }, take: 8, select: { id: true, title: true, order: true, content: true } }),
      this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true, role: true } }),
      this.store.db.storyPlan.findMany({ where: { novelId, chapterId }, take: 8 }),
      this.store.db.creativeDecision.findMany({ where: { novelId, adjustmentJson: { not: null } }, take: 200 }),
    ]);
    const adjustments = decisions.filter(d => { const a = parseJson<{ status: string; chapterIds: string[] }>(d.adjustmentJson, null!); return a.status === "active" && a.chapterIds.includes(chapterId); }).map(d => ({ content: d.content, scope: parseJson(d.adjustmentJson, {}) }));
    return JSON.stringify({ title: novel.title, currentPlan: { chapterId, order: chapter.order, expectation: chapter.expectation, taskSheet: chapter.taskSheet, sceneCards: chapter.sceneCards, mustAvoid: chapter.mustAvoid, plans }, characters, adjustments, acceptedHistory: previous.reverse().map(c => ({ ...c, content: (c.content ?? "").slice(0, 18000) })), historyCoverage: "当前章之前最近八章，每章最多18000字符；其他历史需查询证据。角色姓名列表不表示人物已知未来计划。" });
  }
  async generate(novelId: string, chapterId: string, input: { requirementsId: string; operation: "write" | "rewrite"; content?: string; instruction?: string }) {
    const req = await this.settings.load(novelId, chapterId, input.requirementsId);
    const chapter = await this.store.chapter(novelId, chapterId);
    const content = input.content ?? chapter.content ?? "";
    let selection = req.scope.kind === "selection" ? req.scope.selection : undefined;
    if (req.scope.kind === "scene") {
      const scene = await this.store.db.chapterPlanScene.findFirst({ where: { id: req.scope.sceneId, plan: { novelId, chapterId } } });
      if (!scene) conflict("所选场景已变化，请重新选择。");
      const location = await this.ai.locateScene({ content, requirementsText: "仅定位指定场景，不修改正文。", contextText: JSON.stringify({ scene }), instruction: input.instruction }, novelId, chapterId);
      const from = location.quote ? content.indexOf(location.quote) : -1;
      if (from < 0 || content.indexOf(location.quote, from + 1) >= 0) throw new AppError("无法唯一定位此场景，请在编辑器选中需要调整的正文后再试。", 409);
      selection = { from, to: from + location.quote.length, text: location.quote };
    }
    if (selection && content.slice(selection.from, selection.to) !== selection.text) conflict("选区与当前编辑稿不一致，请重新选择。");
    const generated = await this.ai.generate({ operation: input.operation, content: selection ? selection.text : content, instruction: input.instruction, requirementsText: await this.settings.prompt(req, chapterId), contextText: await this.context(novelId, chapterId) }, novelId, chapterId);
    if (!generated.trim()) throw new AppError("AI 没有返回正文，请重试。", 502);
    const nextContent = selection ? content.slice(0, selection.from) + generated + content.slice(selection.to) : generated;
    return [await this.store.createVersion({ novelId, chapterId, kind: "candidate", content: nextContent, baseRevision: req.baseRevisions[chapterId], requirementsId: req.id, metadata: { dependencyRevision: req.dependencyRevision, sourceContent: content, selection, sceneId: req.scope.sceneId, instruction: input.instruction, promptId: writingAdjustmentGeneratePrompt.id, promptVersion: writingAdjustmentGeneratePrompt.version }, operationResult: version => [version] })];
  }
  async saveDraft(novelId: string, chapterId: string, input: { content: string; expectedRevision: string; requirementsId?: string; sourceCandidateId?: string }) {
    const chapter = await this.store.chapter(novelId, chapterId);
    if (chapterRevision(chapter) !== input.expectedRevision) conflict("正文已更新，请对比后再保存编辑稿。");
    if (input.sourceCandidateId) {
      const candidate = await this.store.version(novelId, chapterId, input.sourceCandidateId);
      if (candidate.baseRevision !== input.expectedRevision) conflict("候选基于旧稿，请重新生成。");
      input.requirementsId ??= candidate.requirementsId ?? undefined;
    }
    if (input.requirementsId) await this.settings.load(novelId, chapterId, input.requirementsId, false);
    return this.store.createVersion({ novelId, chapterId, kind: "draft", content: input.content, baseRevision: input.expectedRevision, requirementsId: input.requirementsId, metadata: { dependencyRevision: await this.store.dependencies(novelId), sourceCandidateId: input.sourceCandidateId } });
  }
  async evidence(novelId: string, input: { chapterId?: string; characterIds?: string[]; sourceKinds?: string[]; query?: string; cursor?: string; limit?: number; sourceRefs?: string[] }): Promise<WritingEvidenceResponse> {
    await this.store.novel(novelId);
    const all = await this.store.db.chapter.findMany({ where: { novelId }, orderBy: { order: "asc" } });
    const boundary = input.chapterId ? all.find(c => c.id === input.chapterId) : undefined;
    if (input.chapterId && !boundary) throw new AppError("章节不属于当前作品。", 400);
    const characters = await this.store.db.character.findMany({ where: { novelId }, select: { id: true, name: true } });
    let selectedCharacters = input.characterIds ?? [];
    let query = "";
    let chapterIds: string[] = [];
    let before = boundary?.order ?? Infinity;
    if (input.query?.trim()) {
      const intent = await this.ai.query({ instruction: input.query, requirementsText: "只选择给定作品内的对象；历史查询不得越过当前章。", contextText: JSON.stringify({ chapters: all.filter(c => c.order <= before).map(c => ({ id: c.id, order: c.order, title: c.title })), characters }) }, novelId);
      query = intent.query;
      selectedCharacters = [...new Set([...selectedCharacters, ...intent.characterIds])];
      chapterIds = intent.chapterIds;
      before = Math.min(before, intent.beforeChapterOrder === null ? Infinity : intent.beforeChapterOrder - 1);
    }
    if (selectedCharacters.some(id => !characters.some(c => c.id === id)) || chapterIds.some(id => !all.some(c => c.id === id))) throw new AppError("查询包含其他作品或不存在的对象。", 400);
    const names = selectedCharacters.map(id => characters.find(c => c.id === id)!.name);
    const kinds = input.sourceKinds ?? ["accepted_prose", "plan", "setting"];
    const items: WritingEvidence[] = [];
    for (const c of all) {
      if (c.order > before || (chapterIds.length && !chapterIds.includes(c.id))) continue;
      if (input.sourceRefs?.length && !input.sourceRefs.includes(c.id)) continue;
      for (const sourceKind of ["accepted_prose", "plan"] as const) {
        if (!kinds.includes(sourceKind)) continue;
        const content = sourceKind === "accepted_prose" ? c.content ?? "" : c.expectation ?? "";
        if (!content || (names.length && !names.some(name => content.includes(name)))) continue;
        for (let from = 0; from < content.length; from += 2000) {
          const to = Math.min(content.length, from + 2200);
          items.push({ id: `${sourceKind}:${c.id}:${chapterRevision(c)}:${from}`, sourceKind, sourceId: c.id, sourceRevision: chapterRevision(c), chapterId: c.id, title: `第${c.order}章 ${c.title}`, excerpt: content.slice(from, to), locator: { from, to } });
        }
      }
    }
    if (kinds.includes("setting") || kinds.includes("plan")) {
      const events = await this.store.db.storyTimelineEvent.findMany({ where: { novelId, ...(Number.isFinite(before) ? { chapterIndex: { lte: before } } : {}) }, orderBy: [{ eventOrder: "asc" }], take: 500 });
      for (const event of events) {
        const sourceKind = event.status === "planned" ? "plan" : "setting";
        if (!kinds.includes(sourceKind) || (chapterIds.length && (!event.chapterId || !chapterIds.includes(event.chapterId)))) continue;
        if (event.chapterId && !all.some(c => c.id === event.chapterId && c.order <= before)) continue;
        const ids = parseJson<string[]>(event.participantIdsJson, []);
        if (selectedCharacters.length && !selectedCharacters.some(id => ids.includes(id))) continue;
        if (input.sourceRefs?.length && !input.sourceRefs.includes(event.id)) continue;
        // The original event status is visible in the excerpt; no inference that planned events happened.
        items.push({ id: `event:${event.id}`, sourceKind, sourceId: event.id, sourceRevision: digest([event.updatedAt, event.summary]), chapterId: event.chapterId, title: event.title, excerpt: `[${event.status} / ${event.visibility}] ${event.summary}`, locator: null, storyDayIndex: event.storyDayIndex ?? undefined, participantIds: ids });
      }
    }
    if (kinds.includes("candidate")) {
      const versions = await this.store.db.chapterEditVersion.findMany({ where: { novelId, chapterId: { in: all.filter(c => c.order <= before && (!chapterIds.length || chapterIds.includes(c.id))).map(c => c.id) }, kind: { in: ["candidate", "draft"] } }, orderBy: { createdAt: "desc" }, take: 50 });
      for (const v of versions) {
        if (input.sourceRefs?.length && !input.sourceRefs.includes(v.id)) continue;
        items.push({ id: `candidate:${v.id}`, sourceKind: "candidate", sourceId: v.id, sourceRevision: v.contentHash, chapterId: v.chapterId, title: "未采纳编辑稿", excerpt: v.content.slice(0, 2200), locator: { from: 0, to: Math.min(2200, v.content.length) } });
      }
    }
    const start = input.cursor ? Number(input.cursor) : 0;
    if (!Number.isSafeInteger(start) || start < 0) throw new AppError("分页游标无效。", 400);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const scanned = items.slice(start, start + (query ? 40 : limit));
    let selected = scanned;
    let missingEvidence: string[] = [];
    if (query && scanned.length) {
      const result = await this.ai.evidence({ instruction: query, requirementsText: "仅返回提供的真实资料片段ID，不以规划或候选证明历史事实。", contextText: JSON.stringify({ beforeChapterOrder: Number.isFinite(before) ? before : null, characters: selectedCharacters }), evidence: scanned.map(item => ({ id: item.id, chapterId: item.chapterId ?? "", quote: `[${item.sourceKind}] ${item.title}\n${item.excerpt}` })) }, novelId);
      const allowed = new Set(scanned.map(item => item.id));
      if (result.selectedEvidenceIds.some(e => !allowed.has(e))) throw new AppError("查询返回了不存在的资料引用。", 502);
      const ids = new Set(result.selectedEvidenceIds); selected = scanned.filter(item => ids.has(item.id)); missingEvidence = result.missingEvidence;
    }
    if (!selected.length) missingEvidence.push("在本次已查范围未找到匹配依据；这不证明事件没有发生。");
    return { items: selected, searchedScope: `作品内${Number.isFinite(before) ? `截至第${before}章` : "全部章节"}的已存正文、章纲及最多500条事件；本页检查第${start + 1}—${start + scanned.length}个片段，共${items.length}个可查片段。人物筛选表示相关人物，不代表其知情。`, missingEvidence, nextCursor: start + scanned.length < items.length ? String(start + scanned.length) : null };
  }
  async review(novelId: string, chapterId: string, input: { editVersionId: string }): Promise<WritingReview> {
    const version = await this.store.version(novelId, chapterId, input.editVersionId);
    if (version.kind === "review" || version.kind === "plan") throw new AppError("请选择正文稿件。", 400);
    const evidence = await this.evidence(novelId, { chapterId, limit: 100 });
    const requirements = version.requirementsId ? await this.settings.load(novelId, chapterId, version.requirementsId, false) : undefined;
    const dependencyRevision = await this.store.dependencies(novelId);
    const result = await this.ai.review({ content: version.content, requirementsText: requirements ? await this.settings.prompt(requirements, chapterId) : "核对当前稿的因果与人物一致性，区分审美建议。", contextText: await this.context(novelId, chapterId), evidence: evidence.items.map(e => ({ id: e.id, chapterId: e.chapterId ?? "", quote: e.excerpt })) }, novelId, chapterId);
    const ids = new Set(evidence.items.map(e => e.id));
    if (result.issues.some(issue => issue.evidenceIds.some(id => !ids.has(id)))) throw new AppError("审核返回了无法定位的证据引用，请重试。", 502);
    const categories = { fact: "continuity", character: "character", plan: "planning", expression: "expression" } as const;
    const review: WritingReview = { id: randomUUID(), editVersionId: version.id, contentHash: version.contentHash, dependencyRevision, summary: result.summary, issues: result.issues.map(i => ({ id: randomUUID(), category: categories[i.kind], description: i.message, evidenceIds: i.evidenceIds, suggestion: i.suggestion, status: "open" })) };
    await this.store.db.$transaction(async tx => {
      await tx.chapterEditVersion.create({ data: { id: review.id, novelId, chapterId, sessionId: version.sessionId, kind: "review", baseRevision: version.baseRevision, content: version.content, contentHash: version.contentHash, requirementsId: version.requirementsId, metadataJson: JSON.stringify(review) } });
      await this.store.recordResult(tx, review);
    });
    return review;
  }
  async handleIssue(novelId: string, chapterId: string, issueId: string, input: { reviewId: string; action: "dismissed" | "accepted_deviation"; reason: string }) {
    const row = await this.store.version(novelId, chapterId, input.reviewId);
    if (row.kind !== "review") throw new AppError("审核记录不存在。", 404);
    const review = parseJson<WritingReview>(row.metadataJson, null!);
    const issue = review.issues.find(i => i.id === issueId);
    if (!issue) throw new AppError("审核问题不存在。", 404);
    issue.status = input.action; issue.reason = input.reason;
    await this.store.db.$transaction(async tx => {
      const updated = await tx.chapterEditVersion.updateMany({ where: { id: row.id, metadataJson: row.metadataJson }, data: { metadataJson: JSON.stringify(review) } });
      if (!updated.count) conflict("问题记录已变化，请重新打开审核。");
      await this.store.recordResult(tx, review);
    });
    return review;
  }
}

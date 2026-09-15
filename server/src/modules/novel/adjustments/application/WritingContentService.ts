import { randomUUID } from "node:crypto";
import { renderSceneExpressionControls, compileLegacySceneExpressionLabels } from "../../../../prompting/prompts/novel/sceneExpressionControls";
import { deserializeSceneExpressionDefinitions } from "@ai-novel/shared/types/sceneExpressionTracks";
import type { WritingAdjustmentIssue, WritingEvidence, WritingEvidenceResponse, WritingReview } from "@ai-novel/shared/types/writingAdjustments";
import { runStructuredPrompt, runTextPrompt } from "../../../../prompting/core/promptRunner";
import { writingAdjustmentSpinePrompt, writingAdjustmentEvidencePrompt, writingAdjustmentGeneratePrompt, writingAdjustmentPlanPrompt, writingAdjustmentQueryPrompt, writingAdjustmentReviewPrompt, writingAdjustmentSceneLocationPrompt, type WritingAdjustmentPromptInput } from "../../../../prompting/prompts/novel/writingAdjustment.prompts";
import { AppError } from "../../../../middleware/errorHandler";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { WritingSettingsService } from "./WritingSettingsService";
import { chapterRevision, conflict, digest, parseJson } from "../domain/contracts";

export const adjustmentAi = {
  async prepare(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentSpinePrompt, promptInput: input, options: { novelId, chapterId, temperature: 0.1 } })).output; },
  async generate(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runTextPrompt({ asset: writingAdjustmentGeneratePrompt, promptInput: input, options: { novelId, chapterId, temperature: 0.6 } })).output; },
  async review(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentReviewPrompt, promptInput: input, options: { novelId, chapterId, temperature: 0.1 } })).output; },
  async plan(input: WritingAdjustmentPromptInput, novelId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentPlanPrompt, promptInput: input, options: { novelId } })).output; },
  async query(input: WritingAdjustmentPromptInput, novelId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentQueryPrompt, promptInput: input, options: { novelId } })).output; },
  async evidence(input: WritingAdjustmentPromptInput, novelId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentEvidencePrompt, promptInput: input, options: { novelId } })).output; },
  async locateScene(input: WritingAdjustmentPromptInput, novelId: string, chapterId: string) { return (await runStructuredPrompt({ asset: writingAdjustmentSceneLocationPrompt, promptInput: input, options: { novelId, chapterId } })).output; },
};
export type AdjustmentAi = typeof adjustmentAi;

type ChapterLengthBudget = { targetWordCount?: number; softMinWordCount?: number; softMaxWordCount?: number; hardMaxWordCount?: number };

function chapterLengthBudget(contextText: string): ChapterLengthBudget {
  let context: { currentPlan?: { sceneCards?: { lengthBudget?: ChapterLengthBudget } | null } } = {};
  try {
    context = JSON.parse(contextText) as typeof context;
  } catch {
    return {};
  }
  const budget = context.currentPlan?.sceneCards?.lengthBudget ?? {};
  return {
    targetWordCount: Number.isFinite(budget.targetWordCount) && (budget.targetWordCount ?? 0) > 0 ? budget.targetWordCount : undefined,
    softMinWordCount: Number.isFinite(budget.softMinWordCount) && (budget.softMinWordCount ?? 0) > 0 ? budget.softMinWordCount : undefined,
    softMaxWordCount: Number.isFinite(budget.softMaxWordCount) && (budget.softMaxWordCount ?? 0) > 0 ? budget.softMaxWordCount : undefined,
    hardMaxWordCount: Number.isFinite(budget.hardMaxWordCount) && (budget.hardMaxWordCount ?? 0) > 0 ? budget.hardMaxWordCount : undefined,
  };
}

function countProseCharacters(content: string) {
  return Array.from(content.replace(/\s/g, "")).length;
}

type FreshAttempt = {
  content: string;
  wordCount?: number;
  lengthIssue?: string;
  review?: Awaited<ReturnType<AdjustmentAi["review"]>>;
  error?: string;
};

function attemptRank(attempt: FreshAttempt, budget: ChapterLengthBudget) {
  const reviewed = Boolean(attempt.review);
  const withinLength = !attempt.lengthIssue;
  const hardProblems = (attempt.review?.issues.filter(issue => issue.severity === "error").length ?? 0)
    + (attempt.review?.checks?.filter(check => check.status === "missing" || check.status === "conflict").length ?? 0);
  const uncertainties = attempt.review?.checks?.filter(check => check.status === "uncertain").length ?? 0;
  const targetDistance = budget.targetWordCount && attempt.wordCount ? Math.abs(attempt.wordCount - budget.targetWordCount) : 0;
  return [reviewed && withinLength ? 0 : withinLength ? 1 : reviewed ? 2 : 3, hardProblems, uncertainties, targetDistance];
}

function selectBestAttempt(attempts: FreshAttempt[], budget: ChapterLengthBudget) {
  return attempts.reduce((best, attempt) => {
    const left = attemptRank(attempt, budget), right = attemptRank(best, budget);
    for (let index = 0; index < left.length; index++) {
      if (left[index] < right[index]) return attempt;
      if (left[index] > right[index]) return best;
    }
    return best;
  });
}

function attemptStatus(attempt: FreshAttempt) {
  if (!attempt.review) return "review_failed";
  if (attempt.lengthIssue || attempt.review.issues.some(issue => issue.severity === "error") || attempt.review.checks?.some(check => check.status !== "met")) return "needs_attention";
  return "passed";
}

function spinePlanningContext(contextText: string) {
  try {
    const context = JSON.parse(contextText) as Record<string, unknown>;
    const characters = Array.isArray(context.characters)
      ? context.characters.flatMap(value => {
          if (!value || typeof value !== "object") return [];
          const character = value as { id?: unknown; name?: unknown };
          return typeof character.id === "string" && typeof character.name === "string" ? [{ id: character.id, name: character.name }] : [];
        })
      : [];
    return JSON.stringify({
      currentPlan: context.currentPlan,
      chapterTasks: context.chapterTasks,
      chapterRelationStages: context.chapterRelationStages,
      characters,
      adjustments: context.adjustments,
      usageBoundary: context.usageBoundary,
    });
  } catch {
    return contextText;
  }
}

function splitRequirementText(value: string) {
  return (value.match(/[^。！？；\r\n]+[。！？；]?/gu) ?? [value])
    .map(item => item.trim())
    .filter(Boolean);
}

function collectRequirementText(value: unknown, output: string[]) {
  if (typeof value === "string") {
    output.push(...splitRequirementText(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRequirementText(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectRequirementText(item, output);
  }
}

function requirementSources(requirementsText: string, contextText: string) {
  const sources: Array<{ id: string; group: string; role: string; text: string }> = [];
  const seen = new Set<string>();
  const add = (group: string, role: string, value: unknown) => {
    const texts: string[] = [];
    collectRequirementText(value, texts);
    for (const text of texts) {
      if (seen.has(text)) continue;
      seen.add(text);
      sources.push({ id: `SRC${String(sources.length + 1).padStart(3, "0")}`, group, role, text });
    }
  };
  const jsonStart = Math.min(...[requirementsText.indexOf("["), requirementsText.indexOf("{")].filter(index => index >= 0));
  if (Number.isFinite(jsonStart)) {
    add("request", "author_adjustment", requirementsText.slice(0, jsonStart));
    try { add("request", "author_adjustment", JSON.parse(requirementsText.slice(jsonStart))); } catch { add("request", "author_adjustment", requirementsText.slice(jsonStart)); }
  } else {
    add("request", "author_adjustment", requirementsText);
  }
  try {
    const context = JSON.parse(contextText) as {
      currentPlan?: {
        expectation?: unknown;
        mustAvoid?: unknown;
        sceneCards?: { scenes?: Array<{ entryState?: unknown; resistance?: unknown; mustAdvance?: unknown; turn?: unknown; exitState?: unknown; forbiddenExpansion?: unknown }> } | null;
      };
      adjustments?: unknown;
      chapterRelationStages?: unknown;
    };
    const plan = context.currentPlan;
    add("chapter", "chapter_goal_and_end", plan?.expectation);
    for (const [index, scene] of (plan?.sceneCards?.scenes ?? []).entries()) {
      const group = `scene_${index + 1}`;
      if (index === 0) add(group, "opening_state", scene.entryState);
      add(group, "resistance", scene.resistance);
      add(group, "required_action_or_result", scene.mustAdvance);
      add(group, "required_result", scene.turn);
      add(group, "end_state", scene.exitState);
      add(group, "forbidden", scene.forbiddenExpansion);
    }
    add("global", "fact_or_forbidden_boundary", plan?.mustAvoid);
    add("global", "relationship_state", context.chapterRelationStages);
    add("request", "author_adjustment", context.adjustments);
  } catch {
    add("chapter", "legacy_plan", spinePlanningContext(contextText));
  }
  return sources;
}

function compactReviewRequirements(spine: WritingAdjustmentPromptInput["spine"]) {
  return [...new Set((spine ?? []).map(item => item.requirement.trim()).filter(Boolean))].join("\n");
}

function storyOnlySceneCards(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const cards = value as Record<string, unknown>;
  if (!Array.isArray(cards.scenes)) return value;
  return {
    ...cards,
    scenes: cards.scenes.map(scene => {
      if (!scene || typeof scene !== "object") return scene;
      const record = scene as Record<string, unknown>;
      const mustPreserve = Array.isArray(record.mustPreserve)
        ? record.mustPreserve.filter(item => typeof item !== "string" || !/^【(?:场景差异化|表达验收)/u.test(item.trim()))
        : record.mustPreserve;
      return { ...record, mustPreserve };
    }),
  };
}

function writerContext(contextText: string) {
  try {
    const context = JSON.parse(contextText) as Record<string, unknown>;
    const currentPlan = context.currentPlan && typeof context.currentPlan === "object" ? context.currentPlan as Record<string, unknown> : {};
    return JSON.stringify({
      title: context.title,
      currentPlan: {
        chapterId: currentPlan.chapterId,
        order: currentPlan.order,
        targetWordCount: currentPlan.targetWordCount,
        expectation: currentPlan.expectation,
        sceneCards: storyOnlySceneCards(currentPlan.sceneCards),
        mustAvoid: currentPlan.mustAvoid,
        sceneExpressionInstructions: currentPlan.sceneExpressionInstructions,
      },
      characters: context.characters,
      chapterRelationStages: context.chapterRelationStages,
      adjustments: context.adjustments,
      acceptedHistory: context.acceptedHistory,
      usageBoundary: context.usageBoundary,
      historyCoverage: context.historyCoverage,
    });
  } catch {
    return contextText;
  }
}

export class WritingContentService {
  constructor(readonly store: AdjustmentStore, readonly settings: WritingSettingsService, readonly ai: AdjustmentAi = adjustmentAi) {}
  async context(novelId: string, chapterId: string) {
    const chapter = await this.store.chapter(novelId, chapterId);
    const novel = await this.store.novel(novelId);
    const [previous, characters, plans, decisions, background] = await Promise.all([
      this.store.db.chapter.findMany({ where: { novelId, order: { lt: chapter.order } }, orderBy: { order: "desc" }, take: 8, select: { id: true, title: true, order: true, content: true } }),
      this.store.db.character.findMany({ where: { novelId }, orderBy: { id: "asc" }, select: { id: true, name: true, role: true, personality: true, background: true, relationToProtagonist: true, identityLabel: true, factionLabel: true, outerGoal: true, innerNeed: true, fear: true, moralLine: true, appearance: true, voiceTexture: true, signatureDetail: true, prohibitionsJson: true } }),
      this.store.db.storyPlan.findMany({ where: { novelId, chapterId, level: "chapter", status: { not: "stale" } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 1, include: { scenes: { orderBy: { sortOrder: "asc" } } } }),
      this.store.db.creativeDecision.findMany({ where: { novelId, adjustmentJson: { not: null } }, take: 200 }),
      this.store.writingBackground(novelId, chapter.order, chapterId),
    ]);
    const adjustments = decisions.filter(d => { const a = parseJson<{ status: string; chapterIds: string[] }>(d.adjustmentJson, null!); return a.status === "active" && a.chapterIds.includes(chapterId); }).map(d => ({ content: d.content, scope: parseJson(d.adjustmentJson, {}) }));
    const scenes = plans[0]?.scenes ?? [];
    // Membership comes from author-linked structured data, never names mentioned in prose.
    const cards = parseJson<{ scenes?: Array<{ participantIds?: string[] }> }>(chapter.sceneCards, {});
    const participantIds = new Set<string>([
      ...background.chapterTasks.flatMap(task => task.participantIds as string[]),
      ...(cards?.scenes ?? []).flatMap(scene => scene.participantIds ?? []),
    ]);
    const chapterCharacters = characters.filter(character => participantIds.has(character.id));
    const validIds = new Set(chapterCharacters.map(character => character.id));
    const inCast = (relation: { sourceCharacterId: string; targetCharacterId: string }) => validIds.has(relation.sourceCharacterId) && validIds.has(relation.targetCharacterId);
    const plannedSources = new Set(["volume_projection", "cast_option_projection", "rebuild_projection", "arrangement_plan"]);
    const latestStages = new Map<string, typeof background.chapterRelationStages[number]>();
    for (const stage of background.chapterRelationStages.filter(inCast)) {
      const planned = plannedSources.has(stage.sourceType);
      // A fresh chapter must not inherit its own old draft's extracted ending state.
      if (stage.sourceType === "chapter_draft_extract" && stage.chapterOrder === chapter.order) continue;
      if (planned && stage.chapterOrder !== chapter.order) continue;
      const key = `${stage.sourceCharacterId}:${stage.targetCharacterId}:${planned ? "plan" : "state"}`;
      const previousStage = latestStages.get(key);
      if (!previousStage || (stage.chapterOrder ?? -1) >= (previousStage.chapterOrder ?? -1)) latestStages.set(key, stage);
    }
    background.chapterRelationStages = [...latestStages.values()];
    // Unversioned relationship secrets may describe later developments; they are not current state.
    background.authorRelationBackground = background.authorRelationBackground.filter(inCast).map(relation => ({ ...relation, hiddenTension: null, conflictSource: null, secretAsymmetry: null }));
    background.usageBoundary += " 人物档案仅含本章任务或场景明确关联的参与者。未关联人物不得因背景提及而安排登场。关系阶段保留截至本章的最新记录；本章计划来源是待发生变化，不是开场已成事实。缺少关系阶段时仅参考参与者档案中的关系说明与本章任务，不自行补造关系；名单为空表示未配置，不回退到全书人物。";
    const [points, catalog] = novel.sceneExpressionTracksEnabled && scenes.length ? await Promise.all([
      this.store.db.sceneExpressionPoint.findMany({ where: { novelId, sceneId: { in: scenes.map(scene => scene.id) } } }),
      this.store.db.sceneExpressionTrackCatalog.findUnique({ where: { novelId } }),
    ]) : [[], null];
    const sceneExpressionInstructions = renderSceneExpressionControls(scenes, points.map(point => ({ ...point, level: point.level as 1 | 2 | 3 | 4 | 5 })), deserializeSceneExpressionDefinitions(catalog?.definitionsJson));
    return JSON.stringify({ title: novel.title, ...background, currentPlan: { chapterId, order: chapter.order, targetWordCount: chapter.targetWordCount, expectation: chapter.expectation, taskSheet: compileLegacySceneExpressionLabels(chapter.taskSheet), sceneCards: parseJson(chapter.sceneCards, null), mustAvoid: chapter.mustAvoid, plans: plans.map(({ rawPlanJson, ...plan }) => plan), sceneExpressionInstructions }, characters: chapterCharacters, adjustments, acceptedHistory: previous.reverse().map(c => ({ ...c, content: (c.content ?? "").slice(0, 18000) })), historyCoverage: "当前章之前最近八章，每章最多18000字符；其他历史需查询证据。角色姓名列表不表示人物已知未来计划。场景表达执行sceneExpressionInstructions，旧任务单的表达备注只在不冲突时参考。" });
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
    const promptInput: WritingAdjustmentPromptInput = { operation: input.operation, scope: selection ? "fragment" : "chapter", content: selection ? selection.text : input.operation === "write" ? undefined : content, instruction: input.instruction, requirementsText: await this.settings.prompt(req, chapterId), contextText: writerContext(await this.context(novelId, chapterId)) };
    const freshChapter = input.operation === "write" && !selection;
    if (freshChapter) {
      const sources = requirementSources(promptInput.requirementsText, promptInput.contextText);
      const prepared = await this.ai.prepare({ ...promptInput, requirementsText: "", contextText: "", requirementSources: sources }, novelId, chapterId);
      const sourcesById = new Map(sources.map(source => [source.id, source.text]));
      promptInput.spine = prepared.items.map(item => ({ ...item, sourceQuote: sourcesById.get(item.sourceId) ?? "" }));
    }
    const lengthBudget = freshChapter ? chapterLengthBudget(promptInput.contextText) : {};
    const attempts: FreshAttempt[] = [];
    let generated = "", validationStatus = "not_requested";
    for (let round = 0; round < (freshChapter ? 3 : 1); round++) {
      generated = await this.ai.generate(promptInput, novelId, chapterId);
      if (!generated.trim()) throw new AppError("AI 没有返回正文，请重试。", 502);
      if (!freshChapter) break;
      const attempt: typeof attempts[number] = { content: generated }; attempts.push(attempt);
      attempt.wordCount = countProseCharacters(generated);
      if (lengthBudget.softMinWordCount && attempt.wordCount < lengthBudget.softMinWordCount) {
        attempt.lengthIssue = `当前正文约${attempt.wordCount}字，少于章节软下限${lengthBudget.softMinWordCount}字。`;
      } else if (lengthBudget.hardMaxWordCount && attempt.wordCount > lengthBudget.hardMaxWordCount) {
        attempt.lengthIssue = `当前正文约${attempt.wordCount}字，超过章节硬上限${lengthBudget.hardMaxWordCount}字。`;
      } else if (lengthBudget.softMaxWordCount && attempt.wordCount > lengthBudget.softMaxWordCount) {
        attempt.lengthIssue = `当前正文约${attempt.wordCount}字，超过章节软上限${lengthBudget.softMaxWordCount}字。`;
      }
      try {
        attempt.review = await this.ai.review({ content: generated, spine: promptInput.spine, requirementsText: compactReviewRequirements(promptInput.spine), contextText: "", evidence: [], instruction: "仅按spine逐项核对新写整章，不与本章旧正文比较，不从世界背景或常识补足缺失动作。篇幅由程序另行核验；不要因审美偏好要求重写。" }, novelId, chapterId);
      } catch (error) {
        attempt.error = error instanceof Error ? error.message : "配置核对失败";
        if (attempt.lengthIssue && round < 2) {
          validationStatus = "needs_attention";
          promptInput.instruction = [input.instruction, "按相同配置重新生成完整章，不修改或续接失败稿。", attempt.lengthIssue, "只通过展开既定阻力、动作、观察、人物取舍和场景过渡进入配置篇幅范围，不新增故事事实或证据。"].filter(Boolean).join("\n");
          continue;
        }
        validationStatus = "review_failed";
        break;
      }
      const errors = attempt.review.issues.filter(issue => issue.severity === "error").map(issue => ({ problem: issue.message, correction: issue.suggestion }));
      for (const check of attempt.review.checks ?? []) {
        if (check.status === "missing" || check.status === "conflict" || check.status === "uncertain") errors.push({ problem: check.reason, correction: promptInput.spine?.find(i => i.id === check.id)?.requirement ?? check.reason });
      }
      if (attempt.lengthIssue) errors.push({ problem: attempt.lengthIssue, correction: "保持既定故事事实、场景结果和证据边界不变，调整既有动作、交锋、观察与过渡的展开程度，使正文进入配置篇幅范围。" });
      if (!errors.length) { validationStatus = attempt.review.checks?.some(c => c.status === "uncertain") ? "needs_attention" : "passed"; break; }
      validationStatus = "needs_attention";
      promptInput.instruction = [input.instruction, "按相同配置重新生成完整章，不修改或续接失败稿。以下是上一轮配置核对发现的问题，只作为纠错提醒，当前配置仍是依据；不新增事实来圆错。", JSON.stringify(errors)].filter(Boolean).join("\n");
    }
    if (!generated.trim()) throw new AppError("AI 没有返回正文，请重试。", 502);
    let selectedAttemptIndex: number | undefined;
    if (freshChapter && attempts.length) {
      const selected = selectBestAttempt(attempts, lengthBudget);
      selectedAttemptIndex = attempts.indexOf(selected);
      generated = selected.content;
      validationStatus = attemptStatus(selected);
    }
    if (freshChapter) await this.settings.load(novelId, chapterId, input.requirementsId);
    const nextContent = selection ? content.slice(0, selection.from) + generated + content.slice(selection.to) : generated;
    return [await this.store.createVersion({ novelId, chapterId, kind: "candidate", content: nextContent, baseRevision: req.baseRevisions[chapterId], requirementsId: req.id, metadata: { dependencyRevision: req.dependencyRevision, contextSnapshot: promptInput.contextText, sourceContent: content, selection, sceneId: req.scope.sceneId, instruction: input.instruction, promptId: writingAdjustmentGeneratePrompt.id, promptVersion: writingAdjustmentGeneratePrompt.version, ...(freshChapter ? { configurationValidation: { status: validationStatus, selectedAttemptIndex, spine: promptInput.spine, attempts } } : {}) }, operationResult: version => [version] })];
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
    const metadata = parseJson<{ contextSnapshot?: string; configurationValidation?: { spine?: WritingAdjustmentPromptInput["spine"] } }>(version.metadataJson, {});
    const result = await this.ai.review({ content: version.content, spine: metadata.configurationValidation?.spine, requirementsText: requirements ? await this.settings.prompt(requirements, chapterId) : "核对当前稿的因果与人物一致性，区分审美建议。", contextText: metadata.contextSnapshot ?? await this.context(novelId, chapterId), evidence: evidence.items.map(e => ({ id: e.id, chapterId: e.chapterId ?? "", quote: e.excerpt })) }, novelId, chapterId);
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

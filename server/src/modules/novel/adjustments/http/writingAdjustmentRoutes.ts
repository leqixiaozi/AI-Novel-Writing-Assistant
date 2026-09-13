import type { Request, RequestHandler, Router } from "express";
import { z } from "zod";
import { adjustmentService as service } from "..";
import { AppError } from "../../../../middleware/errorHandler";
import { controlsSchema, scopeSchema, settingsSchema } from "../domain/contracts";

const id = z.string().trim().min(1).max(200);
const chapterIds = z.array(id).min(1).max(100).refine(v => new Set(v).size === v.length, "章节不能重复。");
const preserve = z.array(z.string().trim().min(1).max(2000)).max(50);
const content = z.string().max(500000);
const instruction = z.string().trim().min(1).max(10000);
const decision = z.object({ chapterIds, preserve, status: z.enum(["active", "disabled"]) });
const params = (req: Request) => ({ novelId: id.parse(req.params.id), chapterId: req.params.chapterId ? id.parse(req.params.chapterId) : "" });
function key(req: Request) {
  const value = req.get("Idempotency-Key");
  if (!value || value.length > 200) throw new AppError("请为本次调整提供有效操作标识。", 400);
  return value;
}
function endpoint(run: (req: Request) => Promise<unknown>): RequestHandler {
  return async (req, res, next) => {
    try { res.json({ success: true, data: await run(req) }); }
    catch (error) {
      if (error instanceof AppError && error.details && typeof error.details === "object" && "errorCode" in error.details) {
        res.status(error.statusCode).json({ success: false, error: error.message, message: error.message, errorCode: error.details.errorCode });
      } else next(error);
    }
  };
}
function mutation(operation: string, run: (req: Request) => Promise<unknown>): RequestHandler {
  return endpoint(async req => service.store.once(params(req).novelId, `${operation}:${req.path}`, key(req), req.body, () => run(req)));
}

export function registerWritingAdjustmentRoutes(router: Router) {
  const base = "/:id", chapter = `${base}/chapters/:chapterId`;
  router.get(`${base}/writing-adjustments/workspace`, endpoint(req => service.workspace(params(req).novelId)));
  router.get(`${base}/writing-settings`, endpoint(req => service.settings(params(req).novelId, id.optional().parse(req.query.chapterId))));
  router.put(`${base}/writing-settings`, mutation("settings", req => service.saveSettings(params(req).novelId, z.object({ scope: scopeSchema, expectedRevision: z.number().int().min(0), settings: settingsSchema }).parse(req.body))));
  const preset = z.object({ name: z.string().trim().min(1).max(100), settings: settingsSchema, expectedRevision: z.number().int().min(1).optional() });
  router.post(`${base}/writing-presets`, mutation("preset", req => service.preset(params(req).novelId, preset.parse(req.body))));
  router.put(`${base}/writing-presets/:presetId`, mutation("preset", req => service.preset(params(req).novelId, preset.parse(req.body), id.parse(req.params.presetId))));
  router.post(`${base}/writing-requirements/resolve`, mutation("resolve", req => service.resolve(params(req).novelId, z.object({ scope: scopeSchema, overrides: controlsSchema.optional(), preserve: preserve.optional(), expectedSettingsRevision: z.number().int().min(0).optional() }).parse(req.body))));
  router.post(`${chapter}/editor/adjustment-preview`, mutation("preview", req => service.generate(params(req).novelId, params(req).chapterId, z.object({ requirementsId: id, operation: z.enum(["write", "rewrite"]), content: content.optional(), instruction: instruction.optional() }).parse(req.body))));
  router.post(`${chapter}/editor/drafts`, mutation("draft", req => service.saveDraft(params(req).novelId, params(req).chapterId, z.object({ content, expectedRevision: id, requirementsId: id.optional(), sourceCandidateId: id.optional() }).parse(req.body))));
  router.get(`${chapter}/editor/versions`, endpoint(async req => {
    const { novelId, chapterId } = params(req); await service.store.chapter(novelId, chapterId);
    const rows = await service.store.db.chapterEditVersion.findMany({ where: { novelId, chapterId, ...(req.query.requirementsId ? { requirementsId: id.parse(req.query.requirementsId) } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map(row => service.store.mapVersion(row));
  }));
  router.post(`${chapter}/editor/adjustment-review`, mutation("review", req => service.review(params(req).novelId, params(req).chapterId, z.object({ editVersionId: id }).parse(req.body))));
  router.post(`${chapter}/editor/adjustment-issues/:issueId`, mutation("issue", req => service.handleIssue(params(req).novelId, params(req).chapterId, id.parse(req.params.issueId), z.object({ reviewId: id, action: z.enum(["dismissed", "accepted_deviation"]), reason: z.string().trim().min(1).max(2000) }).parse(req.body))));
  router.post(`${chapter}/acceptances`, mutation("accept", req => service.accept(params(req).novelId, params(req).chapterId, z.object({ editVersionId: id, expectedRevision: id, reviewId: id.optional(), acceptedDeviationIds: z.array(id).max(100).optional() }).parse(req.body), key(req))));
  router.get(`${chapter}/acceptances/:acceptanceId`, endpoint(req => service.receipt(params(req).novelId, params(req).chapterId, id.parse(req.params.acceptanceId))));
  router.post(`${chapter}/acceptances/:acceptanceId/sync/retry`, mutation("retry", req => service.retry(params(req).novelId, params(req).chapterId, id.parse(req.params.acceptanceId))));
  router.post(`${chapter}/runtime/manual-edit`, mutation("handoff", async req => {
    const { novelId, chapterId } = params(req);
    const input = z.object({ action: z.enum(["begin", "complete"]), scope: scopeSchema.optional(), manualEditSessionId: id.optional() }).parse(req.body);
    await service.store.chapter(novelId, chapterId);
    if (input.action === "begin") {
      const chapters = await service.store.chapters(novelId, input.scope ?? { kind: "chapter", chapterId });
      if (!chapters.some(c => c.id === chapterId)) throw new AppError("交接范围必须包含当前章。", 400);
      return service.beginManual(novelId, { chapterIds: chapters.map(c => c.id) });
    }
    if (!input.manualEditSessionId) throw new AppError("请选择要完成的交接记录。", 400);
    const session = await service.store.db.manualEditSession.findFirst({ where: { id: input.manualEditSessionId, novelId } });
    if (!session || !(JSON.parse(session.scopeJson) as string[]).includes(chapterId)) throw new AppError("交接记录不属于当前章节。", 400);
    return service.completeManual(novelId, input.manualEditSessionId);
  }));
  router.post(`${base}/evidence/query`, mutation("evidence", req => service.evidence(params(req).novelId, z.object({ chapterId: id.optional(), characterIds: z.array(id).max(100).optional(), sourceKinds: z.array(z.enum(["accepted_prose", "plan", "setting", "candidate"])).optional(), query: instruction.optional(), cursor: z.string().max(20).optional(), limit: z.number().int().min(1).max(100).optional(), sourceRefs: z.array(id).max(100).optional() }).parse(req.body))));
  router.post(`${base}/writing-adjustments/plans/preview`, mutation("plan", req => service.previewPlan(params(req).novelId, z.object({ chapterIds, instruction, preserve }).parse(req.body))));
  router.post(`${base}/writing-adjustments/plans/:planId/accept`, mutation("plan-accept", req => service.acceptPlan(params(req).novelId, id.parse(req.params.planId), z.object({ acceptedChapterIds: chapterIds }).parse(req.body))));
  router.get(`${base}/writing-adjustments/lines`, endpoint(req => service.lines(params(req).novelId, z.object({ chapterId: id.optional(), characterId: id.optional() }).parse(req.query))));
  router.post(`${base}/writing-adjustments/lines/:eventId/preview`, mutation("line-preview", req => service.previewLine(params(req).novelId, id.parse(req.params.eventId), z.object({ expectedRevision: id, patch: z.object({ title: z.string().trim().min(1).max(300).optional(), summary: z.string().trim().min(1).max(10000).optional(), storyDayIndex: z.number().int().nullable().optional(), storyTimeLabel: z.string().max(300).nullable().optional(), participantIds: z.array(id).max(100).optional() }).strict() }).parse(req.body))));
  router.post(`${base}/writing-adjustments/lines/:candidateId/accept`, mutation("line-accept", req => service.acceptLine(params(req).novelId, id.parse(req.params.candidateId))));
  // These two extensions yield to the original router when adjustment is absent.
  router.post(`${base}/creative-decisions`, (req, res, next) => {
    if (!req.body?.adjustment) return next();
    return mutation("decision", r => service.createDecision(params(r).novelId, z.object({ category: z.literal("manual_adjustment").optional(), content: instruction, adjustment: decision }).parse(r.body)))(req, res, next);
  });
  router.put(`${base}/creative-decisions/:decisionId`, (req, res, next) => {
    if (!req.body?.adjustment) return next();
    return mutation("decision-update", r => service.updateDecision(params(r).novelId, id.parse(r.params.decisionId), z.object({ content: instruction.optional(), adjustment: decision.partial({ chapterIds: true, preserve: true }).extend({ expectedRevision: id }) }).parse(r.body)))(req, res, next);
  });
}

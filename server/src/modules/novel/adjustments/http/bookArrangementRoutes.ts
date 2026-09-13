import type { Request, RequestHandler, Router } from "express";
import { z } from "zod";
import { adjustmentService as service } from "..";
import { AppError } from "../../../../middleware/errorHandler";
import { arrangementChapterIdsSchema, arrangementDraftSchema } from "../application/BookArrangementService";

const id = z.string().trim().min(1).max(200);
const novelId = (req: Request) => id.parse(req.params.id);
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
  return endpoint(async req => {
    const key = req.get("Idempotency-Key")?.trim();
    if (!key || key.length > 200) throw new AppError("请为本次编排提供有效操作标识。", 400);
    return service.store.once(novelId(req), `book-arrangement:${operation}:${req.path}`, key, req.body, () => run(req));
  });
}

export function registerBookArrangementRoutes(router: Router) {
  const base = "/:id/book-arrangement";
  router.get(base, endpoint(req => service.arrangementWorkspace(novelId(req))));
  router.put(`${base}/draft`, mutation("draft", req => service.saveArrangementDraft(novelId(req), z.object({ expectedRevision: z.number().int().min(0), payload: arrangementDraftSchema }).strict().parse(req.body))));
  router.post(`${base}/preview`, mutation("preview", req => service.previewArrangement(novelId(req), z.object({ draftRevision: z.number().int().min(1), chapterIds: arrangementChapterIdsSchema }).strict().parse(req.body))));
  router.post(`${base}/volumes/preview`, mutation("volume-preview", req => service.previewArrangementVolumes(novelId(req), z.object({ draftRevision: z.number().int().min(1), volumeIds: arrangementChapterIdsSchema }).strict().parse(req.body))));
  router.post(`${base}/volumes/:candidateId/apply`, mutation("volume-apply", req => { z.object({}).strict().parse(req.body); return service.applyArrangementVolumes(novelId(req), id.parse(req.params.candidateId)); }));
  router.post(`${base}/:candidateId/apply`, mutation("apply", req => service.applyArrangement(novelId(req), id.parse(req.params.candidateId), z.object({ chapterIds: arrangementChapterIdsSchema }).strict().parse(req.body))));
}

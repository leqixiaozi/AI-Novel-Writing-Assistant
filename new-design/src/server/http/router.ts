import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { ZodError, type ZodType } from "zod";
import type { ApiEnvelope, FieldDefinition } from "../../common/contracts";
import {
  archiveCard,
  createCard,
  createCardType,
  getCard,
  getCardType,
  listCards,
  listCardTypeVersions,
  listCardTypes,
  listCardVersions,
  publishCardType,
  restoreCard,
  updateCard,
  updateCardType,
} from "../database/store";
import { getDatabaseRuntimeStatus } from "../database/runtime";
import {
  applyBookSync,
  createBook,
  getBook,
  listBooks,
  listTemplates,
  listTemplateVersions,
  previewBookSync,
  publishTemplate,
  saveTemplate,
} from "../database/templateStore";
import {
  listCardGroupForms,
  listCardGroupFormVersions,
  listDictionaries,
  listFormInstances,
  listRelationTypes,
  publishCardGroupForm,
  saveCardGroupForm,
  saveDictionary,
  saveFormInstance,
  saveRelationType,
} from "../database/compositionStore";
import { NewDesignError } from "../domain/errors";
import {
  createCardSchema,
  createCardTypeSchema,
  cardGroupFormInputSchema,
  bookInputSchema,
  dictionaryInputSchema,
  formInstanceInputSchema,
  relationTypeInputSchema,
  syncPreviewSchema,
  templateInputSchema,
  revisionSchema,
  updateCardSchema,
  updateCardTypeSchema,
} from "../domain/validation";

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => void handler(req, res).catch(next);
}

function body<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.body);
}

function success<T>(res: Response, data: T, status = 200): void {
  const envelope: ApiEnvelope<T> = { success: true, data };
  res.status(status).json(envelope);
}

function zodIssues(error: ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]));
}

function normalizeFields(fields: Array<Omit<FieldDefinition, "defaultValue"> & { defaultValue?: unknown }>): FieldDefinition[] {
  return fields.map((field) => ({ ...field, defaultValue: field.defaultValue ?? null }));
}

export function createNewDesignRouter(): Router {
  const router = Router();

  router.get("/health", asyncRoute(async (_req, res) => {
    success(res, await getDatabaseRuntimeStatus());
  }));

  router.get("/card-types", asyncRoute(async (req, res) => success(res, await listCardTypes(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/card-types", asyncRoute(async (req, res) => {
    const input = body(createCardTypeSchema, req);
    success(res, await createCardType({ ...input, fields: normalizeFields(input.fields) }, input.spaceId), 201);
  }));
  router.get("/card-types/:id", asyncRoute(async (req, res) => success(res, await getCardType(String(req.params.id)))));
  router.patch("/card-types/:id", asyncRoute(async (req, res) => {
    const input = body(updateCardTypeSchema, req);
    success(res, await updateCardType(String(req.params.id), { ...input, fields: normalizeFields(input.fields) }));
  }));
  router.post("/card-types/:id/publish", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await publishCardType(String(req.params.id), input.revision));
  }));
  router.get("/card-types/:id/versions", asyncRoute(async (req, res) => success(res, await listCardTypeVersions(String(req.params.id)))));

  router.get("/cards", asyncRoute(async (req, res) => {
    success(res, await listCards({
      cardTypeId: typeof req.query.cardTypeId === "string" ? req.query.cardTypeId : undefined,
      archived: req.query.archived === "true",
      spaceId: typeof req.query.spaceId === "string" ? req.query.spaceId : undefined,
    }));
  }));
  router.post("/cards", asyncRoute(async (req, res) => success(res, await createCard(body(createCardSchema, req)), 201)));
  router.get("/cards/:id", asyncRoute(async (req, res) => success(res, await getCard(String(req.params.id)))));
  router.patch("/cards/:id", asyncRoute(async (req, res) => success(res, await updateCard(String(req.params.id), body(updateCardSchema, req)))));
  router.post("/cards/:id/archive", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await archiveCard(String(req.params.id), input.revision));
  }));
  router.post("/cards/:id/restore", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await restoreCard(String(req.params.id), input.revision));
  }));
  router.get("/cards/:id/versions", asyncRoute(async (req, res) => success(res, await listCardVersions(String(req.params.id)))));

  router.get("/dictionaries", asyncRoute(async (req, res) => success(res, await listDictionaries(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/dictionaries", asyncRoute(async (req, res) => success(res, await saveDictionary(body(dictionaryInputSchema, req)), 201)));
  router.patch("/dictionaries/:id", asyncRoute(async (req, res) => {
    const input = body(dictionaryInputSchema, req);
    success(res, await saveDictionary({ ...input, id: String(req.params.id) }));
  }));

  router.get("/relation-types", asyncRoute(async (req, res) => success(res, await listRelationTypes(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/relation-types", asyncRoute(async (req, res) => success(res, await saveRelationType(body(relationTypeInputSchema, req)), 201)));
  router.patch("/relation-types/:id", asyncRoute(async (req, res) => {
    const input = body(relationTypeInputSchema, req);
    success(res, await saveRelationType({ ...input, id: String(req.params.id), revision: input.revision ?? 0 }));
  }));

  router.get("/card-group-forms", asyncRoute(async (req, res) => success(res, await listCardGroupForms(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/card-group-forms", asyncRoute(async (req, res) => success(res, await saveCardGroupForm(body(cardGroupFormInputSchema, req)), 201)));
  router.patch("/card-group-forms/:id", asyncRoute(async (req, res) => {
    const input = body(cardGroupFormInputSchema, req);
    success(res, await saveCardGroupForm({ ...input, id: String(req.params.id) }));
  }));
  router.post("/card-group-forms/:id/publish", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await publishCardGroupForm(String(req.params.id), input.revision));
  }));
  router.get("/card-group-forms/:id/versions", asyncRoute(async (req, res) => success(res, await listCardGroupFormVersions(String(req.params.id)))));

  router.get("/form-instances", asyncRoute(async (req, res) => {
    if (typeof req.query.spaceId !== "string") throw new NewDesignError("缺少数据空间。", 422);
    success(res, await listFormInstances(req.query.spaceId, typeof req.query.formId === "string" ? req.query.formId : undefined));
  }));
  router.post("/form-instances", asyncRoute(async (req, res) => success(res, await saveFormInstance(body(formInstanceInputSchema, req)), 201)));
  router.patch("/form-instances/:id", asyncRoute(async (req, res) => {
    const input = body(formInstanceInputSchema, req);
    success(res, await saveFormInstance({ ...input, id: String(req.params.id) }));
  }));

  router.get("/templates", asyncRoute(async (_req, res) => success(res, await listTemplates())));
  router.post("/templates", asyncRoute(async (req, res) => success(res, await saveTemplate(body(templateInputSchema, req)), 201)));
  router.patch("/templates/:id", asyncRoute(async (req, res) => {
    const input = body(templateInputSchema, req);
    success(res, await saveTemplate({ ...input, id: String(req.params.id) }));
  }));
  router.post("/templates/:id/publish", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await publishTemplate(String(req.params.id), input.revision));
  }));
  router.get("/templates/:id/versions", asyncRoute(async (req, res) => success(res, await listTemplateVersions(String(req.params.id)))));

  router.get("/books", asyncRoute(async (_req, res) => success(res, await listBooks())));
  router.post("/books", asyncRoute(async (req, res) => success(res, await createBook(body(bookInputSchema, req)), 201)));
  router.get("/books/:id", asyncRoute(async (req, res) => success(res, await getBook(String(req.params.id)))));
  router.post("/books/:id/sync-preview", asyncRoute(async (req, res) => {
    const input = body(syncPreviewSchema, req);
    success(res, await previewBookSync(String(req.params.id), input.targetVersionId));
  }));
  router.post("/book-syncs/:id/apply", asyncRoute(async (req, res) => success(res, await applyBookSync(String(req.params.id)))));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      const envelope: ApiEnvelope<null> = { success: false, error: "提交内容不完整或格式不正确。", issues: zodIssues(error) };
      res.status(422).json(envelope);
      return;
    }
    if (error instanceof NewDesignError) {
      const envelope: ApiEnvelope<null> = { success: false, error: error.message, issues: error.issues };
      res.status(error.status).json(envelope);
      return;
    }
    console.error("[new-design] request failed", error);
    const envelope: ApiEnvelope<null> = {
      success: false,
      error: error instanceof Error ? `新设计服务暂时不可用：${error.message}` : "新设计服务暂时不可用。",
    };
    res.status(500).json(envelope);
  });

  return router;
}

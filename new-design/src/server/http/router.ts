import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { ZodError, type ZodType } from "zod";
import type { ApiEnvelope, FieldDefinition } from "../../common/contracts";
import type { NewDesignAiGateway } from "../ai/gateway";
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
import { listCardTypeCategories, saveCardTypeCategory } from "../database/categoryStore";
import { installStrategyResource, listStrategyResources } from "../database/resourceStore";
import { getBookViewWorkspace, saveBookViewConfig, saveCharacterRelation, saveClueLifecycle, saveNarrativePlacement, saveStoryTimePosition } from "../database/bookViewStore";
import {
  applyFormAssist,
  beginFormAssist,
  beginSessionGeneration,
  completeBookCreation,
  createBookCreationSession,
  failFormAssist,
  failSessionGeneration,
  getBookCreationSession,
  getCardAssistContext,
  getSessionAiContext,
  listInspirationCandidates,
  saveDirectionCandidates,
  saveFormAssist,
  saveInitialCards,
  selectBookDirection,
} from "../database/bookCreationStore";
import {
  createCardSchema,
  createCardTypeSchema,
  cardGroupFormInputSchema,
  cardTypeCategoryInputSchema,
  applyFormAssistSchema,
  bookInputSchema,
  bookCreationSessionInputSchema,
  completeBookCreationSchema,
  dictionaryInputSchema,
  formInstanceInputSchema,
  formAssistSchema,
  relationTypeInputSchema,
  resourceInstallSchema,
  syncPreviewSchema,
  templateInputSchema,
  revisionSchema,
  selectDirectionSchema,
  updateCardSchema,
  updateCardTypeSchema,
  storyTimePositionSchema,
  narrativePlacementSchema,
  characterRelationSchema,
  clueLifecycleSchema,
  bookViewConfigSchema,
  bookViewKeySchema,
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

export function createNewDesignRouter(dependencies: { ai?: NewDesignAiGateway } = {}): Router {
  const router = Router();

  router.get("/health", asyncRoute(async (_req, res) => {
    success(res, await getDatabaseRuntimeStatus());
  }));

  router.get("/card-types", asyncRoute(async (req, res) => success(res, await listCardTypes(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.get("/card-type-categories", asyncRoute(async (_req, res) => success(res, await listCardTypeCategories())));
  router.post("/card-type-categories", asyncRoute(async (req, res) => success(res, await saveCardTypeCategory(body(cardTypeCategoryInputSchema, req)), 201)));
  router.patch("/card-type-categories/:id", asyncRoute(async (req, res) => success(res, await saveCardTypeCategory({ ...body(cardTypeCategoryInputSchema, req), id: String(req.params.id) }))));
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
  router.get("/books/:id/view-workspace", asyncRoute(async (req,res)=>success(res,await getBookViewWorkspace(String(req.params.id)))));
  router.put("/books/:id/story-time",asyncRoute(async(req,res)=>success(res,await saveStoryTimePosition(String(req.params.id),body(storyTimePositionSchema,req)))));
  router.put("/books/:id/narrative-placement",asyncRoute(async(req,res)=>success(res,await saveNarrativePlacement(String(req.params.id),body(narrativePlacementSchema,req)))));
  router.put("/books/:id/character-relation",asyncRoute(async(req,res)=>success(res,await saveCharacterRelation(String(req.params.id),body(characterRelationSchema,req)))));
  router.put("/books/:id/clue-lifecycle",asyncRoute(async(req,res)=>success(res,await saveClueLifecycle(String(req.params.id),body(clueLifecycleSchema,req)))));
  router.put("/books/:id/view-config/:key",asyncRoute(async(req,res)=>success(res,await saveBookViewConfig(String(req.params.id),bookViewKeySchema.parse(req.params.key),body(bookViewConfigSchema,req)))));
  router.post("/books/:id/sync-preview", asyncRoute(async (req, res) => {
    const input = body(syncPreviewSchema, req);
    success(res, await previewBookSync(String(req.params.id), input.targetVersionId));
  }));
  router.post("/book-syncs/:id/apply", asyncRoute(async (req, res) => success(res, await applyBookSync(String(req.params.id)))));

  router.get("/book-creation/inspirations", asyncRoute(async (_req, res) => success(res, await listInspirationCandidates())));
  router.get("/resources/strategies", asyncRoute(async (req, res) => success(res, await listStrategyResources({
    typeKey: typeof req.query.typeKey === "string" ? req.query.typeKey : undefined,
    archived: req.query.archived === "true",
    search: typeof req.query.search === "string" ? req.query.search : undefined,
  }))));
  router.post("/resources/strategies/:id/install", asyncRoute(async (req, res) => {
    const input = body(resourceInstallSchema, req);
    success(res, await installStrategyResource(input.bookId, String(req.params.id)), 201);
  }));
  router.post("/book-creation/sessions", asyncRoute(async (req, res) => success(res, await createBookCreationSession(body(bookCreationSessionInputSchema, req)), 201)));
  router.get("/book-creation/sessions/:id", asyncRoute(async (req, res) => success(res, await getBookCreationSession(String(req.params.id)))));
  router.post("/book-creation/sessions/:id/directions", asyncRoute(async (req, res) => {
    const sessionId = String(req.params.id);
    const batchId = await beginSessionGeneration(sessionId, "directions");
    try {
      if (!dependencies.ai) throw new Error("AI 服务尚未连接，请检查模型设置后重试。");
      const context = await getSessionAiContext(sessionId);
      const candidates = await dependencies.ai.generateDirections({
        method: context.session.method,
        bookName: context.session.bookName,
        sourceReference: context.session.sourceReference,
        sourceText: context.sourceText,
      });
      success(res, await saveDirectionCandidates(sessionId, batchId, candidates));
    } catch (error) {
      await failSessionGeneration(sessionId, batchId, "generate_directions", error);
      throw new NewDesignError(error instanceof Error ? error.message : "创作方向生成失败。", 502);
    }
  }));
  router.post("/book-creation/sessions/:id/select-direction", asyncRoute(async (req, res) => {
    const input = body(selectDirectionSchema, req);
    success(res, await selectBookDirection(String(req.params.id), input.directionId));
  }));
  router.post("/book-creation/sessions/:id/initial-content", asyncRoute(async (req, res) => {
    const sessionId = String(req.params.id);
    const batchId = await beginSessionGeneration(sessionId, "initial_content");
    try {
      if (!dependencies.ai) throw new Error("AI 服务尚未连接，请检查模型设置后重试。");
      const context = await getSessionAiContext(sessionId);
      const direction = context.session.directionCandidates.find((item) => item.id === context.session.selectedDirectionId);
      if (!direction) throw new NewDesignError("请先确认一个创作方向。", 422);
      const cards = await dependencies.ai.generateInitialContent({ direction, sourceText: context.sourceText, schemaTypes: context.schemaTypes });
      success(res, await saveInitialCards(sessionId, batchId, cards));
    } catch (error) {
      await failSessionGeneration(sessionId, batchId, "generate_initial_content", error);
      if (error instanceof NewDesignError) throw error;
      throw new NewDesignError(error instanceof Error ? error.message : "初始资料生成失败。", 502);
    }
  }));
  router.post("/book-creation/sessions/:id/complete", asyncRoute(async (req, res) => {
    success(res, await completeBookCreation(String(req.params.id), body(completeBookCreationSchema, req)));
  }));

  router.post("/books/:id/ai-assists", asyncRoute(async (req, res) => {
    const input = body(formAssistSchema, req);
    const context = await getCardAssistContext(String(req.params.id), input.cardId);
    if (context.card.revision !== input.baseRevision) throw new NewDesignError("资料已被修改，请刷新后重试。", 409);
    const batchId = await beginFormAssist({ bookId: String(req.params.id), cardId: input.cardId, formKey: input.formKey, instruction: input.instruction, baseRevision: input.baseRevision });
    try {
      if (!dependencies.ai) throw new Error("AI 服务尚未连接，请检查模型设置后重试。");
      const output = await dependencies.ai.assistForm({ bookName: context.bookName, formName: input.formName, cardTitle: context.card.title, currentValues: context.card.values, fields: context.fields, instruction: input.instruction });
      const allowed = new Set(context.fields.map((field) => field.key));
      const suggestions = Object.fromEntries(Object.entries(output).filter(([key]) => allowed.has(key)));
      success(res, await saveFormAssist(batchId, suggestions), 201);
    } catch (error) {
      await failFormAssist(batchId, error);
      throw new NewDesignError(error instanceof Error ? error.message : "AI 表单建议生成失败。", 502);
    }
  }));
  router.post("/ai-assists/:id/apply", asyncRoute(async (req, res) => {
    const input = body(applyFormAssistSchema, req);
    success(res, await applyFormAssist(String(req.params.id), input.fieldKeys, input.expectedRevision));
  }));

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

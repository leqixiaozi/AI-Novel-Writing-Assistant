import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { NewDesignAiGateway } from "../../ai/gateway";
import { generateBusinessFormAi, getBusinessFormAi, adoptBusinessFormAi, discardBusinessFormAi, confirmFormAiNewNode } from "../../database/formAssist";
import { formAiRequestSchema, formAiAdoptSchema, formAiDiscardSchema, formAiNewNodeSchema } from "../../domain/formAssist";
import { NewDesignError } from "../../domain/errors";

export function businessFormAiRouter(ai?:NewDesignAiGateway):Router{
  const router=Router();
  const route=(handler:(req:Parameters<RequestHandler>[0])=>Promise<unknown>):RequestHandler=>(req,res,next)=>{void handler(req).then(data=>res.json({success:true,data})).catch(next);};
  router.post("/books/:bookId/form-ai",route(req=>{const input=formAiRequestSchema.parse(req.body);if(input.target.bookId!==req.params.bookId)throw new NewDesignError("AI 请求不属于当前书籍。",422);return generateBusinessFormAi(input,ai);}));
  router.get("/books/:bookId/form-ai/:id",route(req=>getBusinessFormAi(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id))));
  router.post("/books/:bookId/form-ai/:id/adopt",route(req=>adoptBusinessFormAi(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id),formAiAdoptSchema.parse(req.body))));
  router.post("/books/:bookId/form-ai/:id/discard",route(req=>discardBusinessFormAi(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id),formAiDiscardSchema.parse(req.body).idempotencyKey)));
  router.post("/books/:bookId/form-ai/:id/new-node",route(req=>confirmFormAiNewNode(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id),formAiNewNodeSchema.parse(req.body))));
  return router;
}

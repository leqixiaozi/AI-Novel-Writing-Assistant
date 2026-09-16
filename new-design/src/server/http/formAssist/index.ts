import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { NewDesignAiGateway } from "../../ai/gateway";
import { generateBusinessFormAi, getBusinessFormAi, getBusinessFormAiByRequest, FormAiPreparationError, adoptBusinessFormAi, discardBusinessFormAi, confirmFormAiNewNode } from "../../database/formAssist";
import {AiExecutionError} from "../../ai";
import { formAiRequestSchema, formAiAdoptSchema, formAiDiscardSchema, formAiNewNodeSchema } from "../../domain/formAssist";
import { NewDesignError } from "../../domain/errors";

export function businessFormAiRouter(ai?:NewDesignAiGateway):Router{
  const router=Router();
  const route=(handler:(req:Parameters<RequestHandler>[0])=>Promise<unknown>):RequestHandler=>(req,res,next)=>{void Promise.resolve().then(()=>handler(req)).then(data=>res.json({success:true,data})).catch(error=>{
    if(error instanceof FormAiPreparationError){const problem=new AiExecutionError("准备资料提炼请求",error.message,error.status,null,error.issues);problem.recovery.mutationOutcome=error.mutationOutcome;problem.recovery.savedResult=error.mutationOutcome==="not_written"?"当前填写和参考资料保留；服务器确认未领取新生成请求。核对来源或模型配置后，再明确重新准备。":"当前填写、参考资料和原请求凭证保留；请先核对原请求，不再次调用模型。";next(problem);return;}next(error);
  });};
  router.post("/books/:bookId/form-ai",route(req=>{const input=formAiRequestSchema.parse(req.body);if(input.target.bookId!==req.params.bookId)throw new NewDesignError("AI 请求不属于当前书籍。",422);return generateBusinessFormAi(input,ai);}));
  router.get("/books/:bookId/form-ai/by-request/:key",route(req=>getBusinessFormAiByRequest(z.uuid().parse(req.params.bookId),z.string().trim().min(8).max(160).parse(req.params.key))));
  router.get("/books/:bookId/form-ai/:id",route(req=>getBusinessFormAi(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id))));
  router.post("/books/:bookId/form-ai/:id/adopt",route(req=>adoptBusinessFormAi(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id),formAiAdoptSchema.parse(req.body))));
  router.post("/books/:bookId/form-ai/:id/discard",route(req=>discardBusinessFormAi(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id),formAiDiscardSchema.parse(req.body).idempotencyKey)));
  router.post("/books/:bookId/form-ai/:id/new-node",route(req=>confirmFormAiNewNode(z.uuid().parse(req.params.bookId),z.uuid().parse(req.params.id),formAiNewNodeSchema.parse(req.body))));
  return router;
}

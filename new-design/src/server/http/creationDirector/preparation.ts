import type {Router,Response,NextFunction} from "express";
import {z} from "zod";
import {runCreationReviewAi,getCreationPreparationByKey,getCreationPreparationResult,listCreationPreparationBatches,
  adoptSavedCreationPreparation,getCreationPreparationAdoptionReceipt,releaseSavedCreationPreparation,endExpiredUnknownCreationPreparation,recoverSavedCreationPreparation,
  creationReviewAiInputSchema,adoptCreationPreparationInputSchema} from "../../application/creationReviewAi";
import {creationFailure,creationSessionId,creationRequestKey} from "./recovery";

const defaults={runCreationReviewAi,getCreationPreparationByKey,getCreationPreparationResult,listCreationPreparationBatches,
  adoptSavedCreationPreparation,getCreationPreparationAdoptionReceipt,releaseSavedCreationPreparation,endExpiredUnknownCreationPreparation,recoverSavedCreationPreparation};
const emptyCommand=z.object({}).strict();
const batchPrefix="/book-creation/creation-preparation-batches/:id";

/** Governed candidates stay separate from explicit review adoption and formal book creation. */
export function mountCreationPreparation(router:Router,dependencies:Partial<typeof defaults>={}){
  const application={...defaults,...dependencies};
  const respond=(sessionId:string|undefined,res:Response,next:NextFunction,step:string,run:()=>Promise<unknown>)=>{
    void Promise.resolve().then(run).then(data=>res.json({success:true,data})).catch(error=>next(creationFailure(sessionId,step,error,"原表单、候选批次及请求凭证保留；先读取原请求，保存结果可继续采用，未知结果不重复生成或开书。")));
  };
  router.post("/book-creation/sessions/:id/review-ai/prepare",(req,res,next)=>respond(String(req.params.id),res,next,"准备选中资料的 AI 候选",()=>application.runCreationReviewAi(creationSessionId.parse(String(req.params.id)),creationReviewAiInputSchema.parse(req.body))));
  router.get("/book-creation/sessions/:id/review-ai/by-key/:key",(req,res,next)=>respond(String(req.params.id),res,next,"核对原 AI 准备请求",()=>application.getCreationPreparationByKey(creationSessionId.parse(String(req.params.id)),creationRequestKey.parse(String(req.params.key)))));
  router.get("/book-creation/sessions/:id/review-ai/batches",(req,res,next)=>respond(String(req.params.id),res,next,"读取本次开书的 AI 保存结果",()=>application.listCreationPreparationBatches(creationSessionId.parse(String(req.params.id)))));
  router.get(batchPrefix,(req,res,next)=>respond(undefined,res,next,"读取 AI 候选批次",()=>application.getCreationPreparationResult(creationSessionId.parse(String(req.params.id)))));
  router.post(`${batchPrefix}/adopt`,(req,res,next)=>respond(undefined,res,next,"将勾选候选填入开书表单",()=>application.adoptSavedCreationPreparation(creationSessionId.parse(String(req.params.id)),adoptCreationPreparationInputSchema.parse(req.body))));
  router.get(`${batchPrefix}/adoptions/by-key/:key`,(req,res,next)=>respond(undefined,res,next,"核对原候选采用请求",()=>application.getCreationPreparationAdoptionReceipt(creationSessionId.parse(String(req.params.id)),creationRequestKey.parse(String(req.params.key)))));
  router.post(`${batchPrefix}/release-saved-result`,(req,res,next)=>respond(undefined,res,next,"保留旧候选并结束本次采用",()=>{emptyCommand.parse(req.body);return application.releaseSavedCreationPreparation(creationSessionId.parse(String(req.params.id)));}));
  router.post(`${batchPrefix}/recover-saved-result`,(req,res,next)=>respond(undefined,res,next,"继续保存已有 AI 结果",()=>{emptyCommand.parse(req.body);return application.recoverSavedCreationPreparation(creationSessionId.parse(String(req.params.id)));}));
  router.post(`${batchPrefix}/end-expired-unknown`,(req,res,next)=>respond(undefined,res,next,"明确结束已过期未知运行",()=>{emptyCommand.parse(req.body);return application.endExpiredUnknownCreationPreparation(creationSessionId.parse(String(req.params.id)));}));
}

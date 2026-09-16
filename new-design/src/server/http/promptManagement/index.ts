import {Router,type RequestHandler} from "express";
import {z} from "zod";
import {classifyPrompt,getPromptCatalog,savePrompt,reorderPromptGroups,createPromptCategory,revisePromptCategory,archivePromptCategory} from "../../database/promptManagement";
export function promptManagementRouter():Router{
  const router=Router(),route=(work:(req:Parameters<RequestHandler>[0])=>Promise<unknown>):RequestHandler=>(req,res,next)=>{void work(req).then(data=>res.json({success:true,data})).catch(next);};
  const category=z.object({name:z.string().trim().min(1).max(100),parentId:z.uuid().nullable().optional(),sortOrder:z.number().int().min(0).max(100000),idempotencyKey:z.string().min(8).max(200)});
  router.post("/prompt-management/categories",route(req=>createPromptCategory(category.extend({key:z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/)}).strict().parse(req.body))));
  router.patch("/prompt-management/categories/:id",route(req=>revisePromptCategory(z.uuid().parse(req.params.id),category.extend({expectedRevision:z.number().int().positive()}).strict().parse(req.body))));
  router.post("/prompt-management/categories/:id/archive",route(req=>archivePromptCategory(z.uuid().parse(req.params.id),z.object({expectedRevision:z.number().int().positive(),childMode:z.literal("promote"),idempotencyKey:z.string().min(8).max(200)}).strict().parse(req.body))));
  router.get("/prompt-management/catalog",route(()=>getPromptCatalog()));
  router.post("/prompt-management/categories/reorder",route(req=>reorderPromptGroups(z.object({parentId:z.uuid().nullable(),orderedIds:z.array(z.uuid()).min(1).max(100),expectedRevisions:z.record(z.string(),z.number().int().positive()),idempotencyKey:z.string().min(8).max(200)}).strict().parse(req.body))));
  router.post("/prompt-management/components",route(req=>savePrompt(z.object({cardId:z.uuid().nullable(),expectedRevision:z.number().int().positive().nullable(),title:z.string().trim().min(1).max(200),values:z.record(z.string(),z.unknown()),idempotencyKey:z.string().min(8).max(200)}).strict().parse(req.body))));
  router.post("/prompt-management/components/:id/classification",route(req=>classifyPrompt(z.uuid().parse(req.params.id),z.object({groupId:z.uuid(),expectedCardRevision:z.number().int().positive(),expectedGroupRevision:z.number().int().positive(),idempotencyKey:z.string().min(8).max(200)}).strict().parse(req.body))));
  return router;
}

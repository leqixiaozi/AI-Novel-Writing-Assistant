import {Router,type Request,type Response} from "express";
import {z} from "zod";
import * as application from "../../application/worldConsistency";
import {NewDesignError} from "../../domain/errors";
const uuid=z.string().uuid(),empty=z.object({}).strict();
class WorldInputError extends NewDesignError {readonly issues:Record<string,string>;constructor(paths:Array<Array<PropertyKey>>){super("本次请求的来源或填写格式无效；尚未执行此操作，原凭证与草稿保留。",422);const labels:Record<string,string>={requestKey:'原请求凭证',catalogHash:'正式来源版本凭证',cardIds:'资料选择',relationIds:'关系选择',recheckIssueId:'复查问题',authorWriteRequestKey:'原正常保存凭证',allowManualRevision:'人工修订确认'};this.issues=Object.fromEntries(paths.map((path,n)=>[`输入${n+1}`,`${labels[String(path[0])]??'来源或额外填写项'}${typeof path[1]==='number'?`第${path[1]+1}项`:''}格式不合格，请核对完整来源。`]));}}
function input<T>(schema:z.ZodType<T>,value:unknown):T {const result=schema.safeParse(value);if(!result.success)throw new WorldInputError(result.error.issues.map(issue=>issue.path));return result.data;}
export const worldRepairSavedSchema=z.object({requestKey:uuid,authorWriteRequestKey:uuid,allowManualRevision:z.boolean().optional()}).strict();
export function worldConsistencyRouter(){const router=Router(),base="/books/:bookId/world-consistency",book=(req:Request)=>input(uuid,req.params.bookId),id=(req:Request)=>input(uuid,req.params.id),key=(req:Request)=>input(uuid,req.params.key);
 function invoke(req:Request,res:Response,work:()=>Promise<unknown>){void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>{const validBook=uuid.safeParse(req.params.bookId),safeMessage=error instanceof NewDesignError?error.message:'世界检查回执尚未确认；原正式资料与已保存回复保留，请在来源页核对原请求。',recovery=error instanceof application.WorldConsistencyError?{...error.recovery}:error instanceof WorldInputError&&validBook.success?{...new application.WorldConsistencyError(validBook.data,'检查世界维护输入',error.message,'not_written',422,'此请求在入口格式检查时被拒绝，领域操作未执行；原资料、旧回执与草稿保留，不推断旧请求或原资料保存结果。').recovery}:validBook.success?{...new application.WorldConsistencyError(validBook.data,req.method==='GET'?'读取世界正式来源与原回执':'核对世界维护原操作',safeMessage,'unknown',error instanceof NewDesignError?error.status:503).recovery}:undefined;if(recovery&&req.method==="GET")delete (recovery as Partial<typeof recovery>).mutationOutcome;res.status(error instanceof NewDesignError?error.status:503).json({success:false,error:safeMessage,...(error instanceof WorldInputError?{issues:error.issues}:{}),...(recovery?{recovery}:{})});});}
 router.get(`${base}/workspace`,(req,res)=>invoke(req,res,()=>application.getWorldConsistencyWorkspace(book(req))));
 router.post(`${base}/runs`,(req,res)=>invoke(req,res,()=>application.runWorldConsistency(book(req),input(application.worldConsistencyInputSchema,req.body))));
 router.get(`${base}/by-key/:key`,(req,res)=>invoke(req,res,()=>application.getWorldConsistencyByKey(book(req),key(req))));
 router.get(`${base}/runs/:id`,(req,res)=>invoke(req,res,()=>application.getWorldConsistencyResult(book(req),id(req))));
 router.post(`${base}/runs/:id/import-saved`,(req,res)=>invoke(req,res,()=>{input(empty,req.body);return application.importSavedWorldConsistency(book(req),id(req));}));
 router.post(`${base}/runs/:id/release-saved`,(req,res)=>invoke(req,res,()=>{input(empty,req.body);return application.releaseSavedWorldConsistency(book(req),id(req));}));
 router.post(`${base}/runs/:id/end-expired-unknown`,(req,res)=>invoke(req,res,()=>{input(empty,req.body);return application.endExpiredUnknownWorldConsistency(book(req),id(req));}));
 router.get(`${base}/repairs/:id/draft`,(req,res)=>invoke(req,res,()=>application.getWorldConsistencyRepairDraft(book(req),id(req))));
 router.get(`${base}/repairs/:id/normal-save-receipt`,(req,res)=>invoke(req,res,()=>application.getWorldRepairNormalSaveReceipt(book(req),id(req))));
 router.post(`${base}/repairs/:id/saved`,(req,res)=>invoke(req,res,()=>application.recordWorldRepairSaved(book(req),id(req),input(worldRepairSavedSchema,req.body))));
 router.get(`${base}/repairs/:id/saved/by-key/:key`,(req,res)=>invoke(req,res,()=>application.getWorldRepairSavedReceipt(book(req),id(req),key(req))));return router;
}

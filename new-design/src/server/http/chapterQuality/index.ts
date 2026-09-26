import {Router,type Request,type Response} from 'express';
import {z} from 'zod';
import * as application from '../../application/chapterQuality';
import {startPreparedControlledChapterWritingRequest} from '../../application/productionDirector';
import {NewDesignError} from '../../domain/errors';
const uuid=z.string().uuid(),empty=z.object({}).strict(),repairSchema=z.object({candidateVersionId:uuid,expectedDocumentRevision:z.number().int().positive(),requestKey:uuid}).strict(),recordSchema=z.object({candidateVersionId:uuid,chapterWritingRequestId:uuid,requestKey:uuid}).strict();
export function chapterQualityRouter(){
 const router=Router(),base='/books/:bookId/chapter-quality',book=(req:Request)=>uuid.parse(req.params.bookId),id=(req:Request)=>uuid.parse(req.params.id);
 const invoke=(req:Request,res:Response,action:()=>Promise<unknown>)=>{void Promise.resolve().then(action).then(data=>res.json({success:true,data})).catch(error=>{const message=error instanceof NewDesignError?error.message:error instanceof z.ZodError?'诊断来源或输入格式无效，请保留原凭证核对。':'原诊断回执未确认，请核对同一原请求。';const valid=uuid.safeParse(req.params.bookId);res.status(error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503).json({success:false,error:message,recovery:{failedStep:req.method==='GET'?'读取原章节质量回执':'核对原章节质量操作',summary:message,savedResult:'原正文、问题、候选和已保存回复保留；未知结果只核对，不重复调用。',sourceRoute:valid.success?`/new-design/books/${valid.data}/writing`:'/new-design/books',actionLabel:'返回章节创作',...(req.method==='GET'?{}:{mutationOutcome:error instanceof application.ChapterQualityError?error.mutationOutcome:'unknown'})}});});};
 router.get(`${base}/documents/:id`,(req,res)=>invoke(req,res,()=>application.listChapterQualityReceipts(book(req),id(req))));
 router.get(`${base}/tension-curve`,(req,res)=>invoke(req,res,()=>application.readChapterTensionCurve(book(req))));
 router.post(`${base}/runs`,(req,res)=>invoke(req,res,()=>application.runChapterQuality(book(req),application.chapterQualityInputSchema.parse(req.body))));
 router.get(`${base}/by-key/:id`,(req,res)=>invoke(req,res,()=>application.getChapterQualityReceipt(book(req),undefined,id(req))));
 router.get(`${base}/runs/:id`,(req,res)=>invoke(req,res,()=>application.getChapterQualityReceipt(book(req),id(req))));
 router.post(`${base}/runs/:id/import-saved`,(req,res)=>invoke(req,res,()=>{empty.parse(req.body);return application.importChapterQualityOutput(book(req),id(req));}));
 router.post(`${base}/runs/:id/release-saved`,(req,res)=>invoke(req,res,()=>{empty.parse(req.body);return application.endChapterQuality(book(req),id(req),'saved');}));
 router.post(`${base}/runs/:id/end-expired-unknown`,(req,res)=>invoke(req,res,()=>{empty.parse(req.body);return application.endChapterQuality(book(req),id(req),'expired_unknown');}));
 router.get(`${base}/repairs/:id`,(req,res)=>invoke(req,res,()=>application.getChapterQualityRepairState(book(req),id(req))));
 router.get(`${base}/repairs/:id/records/:key`,(req,res)=>invoke(req,res,()=>application.getChapterQualityRepairRecord(book(req),id(req),uuid.parse(req.params.key))));
 router.post(`${base}/repairs/:id/generate`,(req,res)=>invoke(req,res,async()=>{const prepared=await application.prepareChapterQualityRepair(book(req),id(req),repairSchema.parse(req.body));return startPreparedControlledChapterWritingRequest(prepared.requestId);}));
 router.post(`${base}/repairs/:id/record`,(req,res)=>invoke(req,res,()=>application.recordChapterQualityRepair(book(req),id(req),recordSchema.parse(req.body))));
 return router;
}

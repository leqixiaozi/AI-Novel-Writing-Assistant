import {Router,type Request,type RequestHandler} from "express";
import {z} from "zod";
import {chapterCandidateSaveSchema,chapterWritingRequestSchema} from "../../domain/validation";
import {NewDesignError} from "../../domain/errors";
import {AiExecutionError} from "../../ai";
import {ChapterProductionError,endExpiredChapterProduction,endUnclaimedChapterProduction,endSavedReplyChapterProduction} from "../../database/chapterProduction";
import {ChapterCandidateWriteError,getChapterWritingWorkspace,listChapterWritingRequests,getChapterWritingRequest,saveChapterCandidate} from "../../database/chapterWriting";
import {getChapterDocument} from "../../database/chapterBodyStore";
import {createControlledChapterWritingRequest,completeSavedChapterWritingRequest,getSavedChapterWritingReply} from "../../application/productionDirector";

const uuid=z.string().uuid(),empty=z.object({}).strict();
const candidateSchema=chapterCandidateSaveSchema.strict(),writingSchema=chapterWritingRequestSchema.strict();
type Source={bookId:string;chapterCardId:string};
interface RouteContext {source:Source|null;resolveSource?:()=>Promise<Source>;}
export const chapterProductionFieldLabels:Record<string,string>={id:"章节来源",content:"正文",operationKind:"创作操作",baseVersionId:"人工候选来源",baseBodyVersionId:"AI 输入正文来源",expectedRevision:"正文修订",idempotencyKey:"原请求凭证",selectionStart:"选区开始位置",selectionEnd:"选区结束位置",instruction:"补充要求",createdBy:"操作者",bodyVersionId:"正文候选来源",planningVersionId:"采用章节计划",model:"创作模型",endpoint:"模型服务地址"};
/** Only fixed actual chapter links are emitted; arbitrary error routes are never forwarded. */
export function chapterProductionFailure(error:unknown,step:string,source:Source|null,write:boolean,allowTypedOutcome=true):AiExecutionError {
 const validation=error instanceof z.ZodError,issues=error instanceof NewDesignError?error.issues:validation?Object.fromEntries(error.issues.map(issue=>{const key=issue.path.join(".")||"id",label=chapterProductionFieldLabels[String(issue.path.at(-1)??"id")]??"填写位置";return [key,`${label}的来源、类型或必填值不完整，请核对后保留原填写。`];})):undefined;
 const failure=new AiExecutionError(error instanceof AiExecutionError?error.recovery.failedStep:step,error instanceof NewDesignError?error.message:validation?"本章填写信息不完整，请定位对应填写处核对。":"本章结果尚未确认，稿件与原请求保留，请只读核对对应来源。",error instanceof NewDesignError?error.status:validation?422:503,error instanceof AiExecutionError?error.category??null:null,issues);
 failure.recovery.savedResult=error instanceof AiExecutionError?error.recovery.savedResult:"人工稿件、原请求、已保存回复、已有候选及采用正文保留；读取不重生成、保存、采用或结算。";
 if(error instanceof AiExecutionError){failure.executionSnapshot=error.executionSnapshot;failure.transportReceipt=error.transportReceipt;}
 if(source&&uuid.safeParse(source.bookId).success&&uuid.safeParse(source.chapterCardId).success){failure.recovery.sourceRoute=`/new-design/books/${source.bookId}/writing?chapter=${source.chapterCardId}`;failure.recovery.actionLabel="返回章节创作";}else{failure.recovery.sourceRoute="/new-design/structure/maintenance";failure.recovery.actionLabel="打开运行维护";}
 // GET does not carry write outcomes. A later failed read cannot revoke an acknowledged commit.
 if(write)failure.recovery.mutationOutcome=allowTypedOutcome&&(error instanceof ChapterProductionError||error instanceof ChapterCandidateWriteError)?error.mutationOutcome:validation?"not_written":"unknown";
 return failure;
}

const defaultDependencies={getChapterWritingWorkspace,getChapterDocument,listChapterWritingRequests,getChapterWritingRequest,saveChapterCandidate,createControlledChapterWritingRequest,completeSavedChapterWritingRequest,endExpiredChapterProduction,endUnclaimedChapterProduction,endSavedReplyChapterProduction,getSavedChapterWritingReply};
export function chapterProductionRouter(dependencies:typeof defaultDependencies=defaultDependencies):Router {
 const router=Router();
 const documentSource=async(id:string):Promise<Source>=>{const document=await dependencies.getChapterDocument(id);if(document.id!==id)throw new NewDesignError("正文来源与指定章节不匹配，请保留原凭证。",409);return {bookId:document.bookId,chapterCardId:document.chapterCardId};};
 const requestSource=async(id:string):Promise<Source>=>{const request=await dependencies.getChapterWritingRequest(id),source=await documentSource(request.chapterDocumentId);if(request.id!==id||request.bookId!==source.bookId)throw new NewDesignError("生成请求与原章节来源不匹配，请只读核对。",409);return source;};
 const route=(step:string,write:boolean,handler:(req:Request,context:RouteContext)=>Promise<{data:unknown;status?:number}>,allowTypedOutcome=true):RequestHandler=>(req,res,next)=>{
  const context:RouteContext={source:null};
  // Parsing and invocation both live inside the promise, so synchronous schema errors are caught too.
  void Promise.resolve().then(()=>handler(req,context)).then(result=>res.status(result.status??200).json({success:true,data:result.data})).catch(async(error:unknown)=>{
   if(!context.source&&context.resolveSource){try{context.source=await context.resolveSource();}catch{/* Failure to read a source does not change the original mutation outcome. */}}
   next(chapterProductionFailure(error,step,context.source,write,allowTypedOutcome));
  });
 };
 router.get("/books/:id/chapter-writing",route("读取本书章节创作目录",false,async(req)=>({data:await dependencies.getChapterWritingWorkspace(uuid.parse(req.params.id))})));
 router.get("/chapter-documents/:id",route("读取本章正文与候选",false,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>documentSource(id);const document=await dependencies.getChapterDocument(id);context.source={bookId:document.bookId,chapterCardId:document.chapterCardId};return {data:document};}));
 router.get("/chapter-documents/:id/writing-requests",route("只读核对本章生成请求",false,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>documentSource(id);context.source=await documentSource(id);return {data:await dependencies.listChapterWritingRequests(id)};}));
 router.get("/chapter-writing-requests/:id",route("只读核对原生成请求",false,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>requestSource(id);const request=await dependencies.getChapterWritingRequest(id);context.source=await documentSource(request.chapterDocumentId);return {data:request};}));
 router.get("/chapter-writing-requests/:id/saved-reply",route("读取原已保存生成回复",false,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>requestSource(id);const reply=await dependencies.getSavedChapterWritingReply(id);if(reply.requestId!==id)throw new NewDesignError("原回复与指定请求不匹配，请保留原凭证并只读核对。",409);context.source={bookId:reply.bookId,chapterCardId:reply.chapterCardId};return {data:reply};}));
 router.post("/chapter-documents/:id/candidates",route("保存本章人工正文候选",true,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>documentSource(id);const input=candidateSchema.parse(req.body),saved=await dependencies.saveChapterCandidate(id,input);context.source={bookId:saved.bookId,chapterCardId:saved.chapterCardId};return {data:saved,status:201};}));
 router.post("/chapter-documents/:id/writing-requests",route("准备本章 AI 生成",true,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>documentSource(id);const input=writingSchema.parse(req.body),request=await dependencies.createControlledChapterWritingRequest(id,input);return {data:request,status:202};}));
 // This application path may commit a candidate before a later ledger transaction
 // fails. A local rollback cannot prove the entire recovery wrote nothing.
 router.post("/chapter-writing-requests/:id/complete-saved-result",route("恢复原已保存回复与生成回执",true,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>requestSource(id);empty.parse(req.body??{});return {data:await dependencies.completeSavedChapterWritingRequest(id)};},false));
 router.post("/chapter-writing-requests/:id/end-expired",route("明确结束过期原未知领取",true,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>requestSource(id);empty.parse(req.body??{});const source=await dependencies.getChapterWritingRequest(id);return {data:await dependencies.endExpiredChapterProduction(source.bookId,source.id)};}));
 router.post("/chapter-writing-requests/:id/end-unclaimed",route("明确结束尚未领取的原生成请求",true,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>requestSource(id);empty.parse(req.body??{});const source=await dependencies.getChapterWritingRequest(id);return {data:await dependencies.endUnclaimedChapterProduction(source.bookId,source.id)};}));
 router.post("/chapter-writing-requests/:id/retain-reply-and-end",route("保留原已保存回复并结束导入",true,async(req,context)=>{const id=uuid.parse(req.params.id);context.resolveSource=()=>requestSource(id);empty.parse(req.body??{});const source=await dependencies.getChapterWritingRequest(id);return {data:await dependencies.endSavedReplyChapterProduction(source.bookId,source.id)};}));
 return router;
}

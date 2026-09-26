import {Router} from "express";
import {z} from "zod";
import {uploadKnowledgeReference,parseKnowledgeReference} from "../../application/knowledgeReference";
import {getKnowledgeReferenceWorkspace,getKnowledgeReferenceItem,searchKnowledgeReferences,getKnowledgeArchivePreview,bindKnowledgeReference,archiveKnowledgeReference,readKnowledgeReferenceReceipt,KnowledgeReferenceError,knowledgeUploadSchema,knowledgeWriteSchema,knowledgeBindSchema,knowledgeArchiveSchema,knowledgeSearchSchema,knowledgeKeySchema,getKnowledgeContent,getKnowledgeReferenceCandidates,getKnowledgeReferenceTargets,adoptKnowledgeReferences,knowledgeContentSchema,knowledgeReferenceSchema} from "../../database/knowledgeReference";
import {NewDesignError} from "../../domain/errors";
import {AiExecutionError} from "../../ai";
const uuid=z.string().uuid();
function failure(bookId:string,step:string,error:unknown){const issues=error instanceof z.ZodError?Object.fromEntries(error.issues.map(issue=>[issue.path.join("."),"请核对中文选择、文件编码与允许范围。"] )):error instanceof NewDesignError?error.issues:undefined,result=new AiExecutionError(step,error instanceof NewDesignError?error.message:error instanceof z.ZodError?"知识输入格式无效，请核对标示位置。":"知识服务未确认操作结果，请保留输入并核对原请求。",error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,issues);if(error instanceof KnowledgeReferenceError)Object.assign(result.recovery,error.recovery);else{result.recovery.sourceRoute=`/new-design/knowledge?bookId=${bookId}`;result.recovery.actionLabel="返回知识参考";result.recovery.savedResult=error instanceof z.ZodError?"输入校验未通过，未执行写入；原资料保留。":"原文件和已保存记录保留，请先核对原请求结果。";result.recovery.mutationOutcome=error instanceof z.ZodError?"not_written":"unknown";}return result;}
/** Mount without a prefix on the main API router. */
export function createKnowledgeReferenceRouter(){const router=Router();
 function handle(step:string,action:(request:any)=>Promise<unknown>){return(request:any,response:any,next:any)=>{let bookId="";try{bookId=uuid.parse(request.params.bookId);}catch(error){next(failure(bookId,step,error));return;}void Promise.resolve().then(()=>action(request)).then(data=>response.json({success:true,data})).catch(error=>next(failure(bookId,step,error)));};}
 router.get("/books/:bookId/knowledge/workspace",handle("读取知识参考",request=>getKnowledgeReferenceWorkspace(request.params.bookId,request.query.before===undefined?undefined:uuid.parse(request.query.before))));
 router.get("/books/:bookId/knowledge/assets/:id",handle("读取知识参考详情",request=>getKnowledgeReferenceItem(request.params.bookId,uuid.parse(request.params.id))));
 router.get("/books/:bookId/knowledge/assets/:id/content",handle("查看知识正文",request=>getKnowledgeContent(request.params.bookId,uuid.parse(request.params.id),knowledgeContentSchema.parse(request.query))));
 router.get("/books/:bookId/knowledge/reference-candidates",handle("读取精确知识引用候选",request=>getKnowledgeReferenceCandidates(request.params.bookId)));
 router.get("/books/:bookId/knowledge/reference-targets",handle("读取真实上下文参考位置",request=>getKnowledgeReferenceTargets(request.params.bookId)));
 router.post("/books/:bookId/knowledge/references",handle("采用明确选择的知识参考",request=>adoptKnowledgeReferences(request.params.bookId,knowledgeReferenceSchema.parse(request.body))));
 router.get("/books/:bookId/knowledge/search",handle("检索知识正文",request=>searchKnowledgeReferences(request.params.bookId,knowledgeSearchSchema.parse(request.query).q)));
 router.post("/books/:bookId/knowledge/uploads",handle("上传知识参考",request=>uploadKnowledgeReference(request.params.bookId,knowledgeUploadSchema.parse(request.body))));
 router.post("/books/:bookId/knowledge/assets/:id/parse",handle("解析知识参考",request=>parseKnowledgeReference(request.params.bookId,uuid.parse(request.params.id),knowledgeWriteSchema.parse(request.body))));
 router.post("/books/:bookId/knowledge/assets/:id/bind",handle("绑定知识参考",request=>bindKnowledgeReference(request.params.bookId,uuid.parse(request.params.id),knowledgeBindSchema.parse(request.body))));
 router.get("/books/:bookId/knowledge/assets/:id/archive-preview",handle("核对归档影响",request=>getKnowledgeArchivePreview(request.params.bookId,uuid.parse(request.params.id))));
 router.post("/books/:bookId/knowledge/assets/:id/archive",handle("归档知识参考",request=>archiveKnowledgeReference(request.params.bookId,uuid.parse(request.params.id),knowledgeArchiveSchema.parse(request.body))));
 router.get("/books/:bookId/knowledge/receipts",handle("核对知识原请求",request=>readKnowledgeReferenceReceipt(request.params.bookId,knowledgeKeySchema.parse(request.query.requestKey))));return router;
}

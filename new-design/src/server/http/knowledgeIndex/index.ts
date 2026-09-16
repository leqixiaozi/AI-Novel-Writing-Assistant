import {Router,type Request,type Response} from "express";
import {z} from "zod";
import * as knowledge from "../../application/knowledgeIndex";
import {NewDesignError} from "../../domain/errors";

const uuid=z.string().uuid(),empty=z.object({}).strict();
class KnowledgeInputError extends Error {constructor(readonly validation:z.ZodError){super("本次输入未符合规格。");}}
function input<S extends z.ZodTypeAny>(schema:S,value:unknown):z.infer<S>{try{return schema.parse(value);}catch(error){if(error instanceof z.ZodError)throw new KnowledgeInputError(error);throw error;}}
const labels:Record<string,string>={bookId:"本书",id:"原操作",key:"原操作凭证",requestKey:"原操作凭证",connectionVersionId:"向量模型版本",profileVersionId:"嵌入规格版本",profileId:"嵌入规格",name:"规格名称",dimensions:"向量维度",maxChunkChars:"分块长度",overlapChars:"重叠长度",distanceMetric:"距离方式",normalize:"向量归一化",sources:"参考来源",assetId:"参考资料",sourceVersionId:"原件版本",parsedVersionId:"解析正文版本",checksum:"原版本校验",query:"检索内容",topK:"结果数量"};
function fail(req:Request,res:Response,step:string,error:unknown,pureWrite:boolean){
 const validated=error instanceof KnowledgeInputError,book=uuid.safeParse(req.params.bookId);
 const message=validated?"填写或原操作凭证不符合规格，请按标出的中文字段修正；原内容保留。":error instanceof NewDesignError?error.message:"服务响应尚未确认；原参考、规格和操作凭证保留，请核对原操作结果。";
 const issues=validated?Object.fromEntries(error.validation.issues.map(issue=>[issue.path.join("."),`${labels[String(issue.path.at(-1))]??labels[String(issue.path[0])]??"本次填写"}：不符合当前发布规格，请保留原稿后核对。`])):error instanceof NewDesignError?error.issues:undefined;
 const recovery:Record<string,unknown>=error instanceof knowledge.KnowledgeEmbeddingError?{...error.recovery}:{failedStep:step,summary:message,savedResult:"原参考资料、已保存规格、索引和原操作凭证保留。",actionLabel:book.success?"返回知识参考":"选择原书籍",sourceRoute:book.success?`/new-design/knowledge?bookId=${book.data}`:"/new-design/books"};
 // A read ACK never proves the preceding write or model call did not happen.
 if(req.method==="GET")delete recovery.mutationOutcome;
 else recovery.mutationOutcome=validated?"not_written":error instanceof knowledge.KnowledgePreparationError&&error.preparationNotWritten?"not_written":pureWrite&&error instanceof knowledge.KnowledgeEmbeddingError?error.recovery.mutationOutcome:"unknown";
 res.status(validated?422:error instanceof NewDesignError?error.status:503).json({success:false,error:message,...(issues?{issues}:{}),recovery});
}
export function knowledgeIndexRouter():Router{
 const router=Router(),base="/books/:bookId/knowledge-index";
 const book=(req:Request)=>input(uuid,req.params.bookId),id=(req:Request)=>input(uuid,req.params.id),key=(req:Request)=>input(uuid,req.params.key);
 const run=(req:Request,res:Response,step:string,work:()=>Promise<unknown>,pureWrite=false)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>fail(req,res,step,error,pureWrite));};
 router.get(`${base}/workspace`,(req,res)=>run(req,res,"读取本书嵌入规格与索引",()=>knowledge.getKnowledgeIndexWorkspace(book(req))));
 router.post(`${base}/profiles`,(req,res)=>run(req,res,"保存嵌入规格",()=>knowledge.createKnowledgeProfile(book(req),input(knowledge.createKnowledgeProfileSchema,req.body)),true));
 router.get(`${base}/profiles/by-key/:key`,(req,res)=>run(req,res,"核对原嵌入规格保存结果",()=>knowledge.getKnowledgeProfileByKey(book(req),key(req))));
 router.post(`${base}/prepare`,(req,res)=>run(req,res,"准备原参考正文索引",()=>knowledge.prepareKnowledgeIndex(book(req),input(knowledge.prepareKnowledgeIndexSchema,req.body)),true));
 router.get(`${base}/by-key/:key`,(req,res)=>run(req,res,"核对原索引准备结果",()=>knowledge.getKnowledgeIndexByKey(book(req),key(req))));
 router.post(`${base}/generations`,(req,res)=>run(req,res,"构建并启用本书索引",()=>knowledge.buildKnowledgeIndex(book(req),input(knowledge.buildKnowledgeIndexSchema,req.body)),true));
 router.get(`${base}/generations/by-key/:key`,(req,res)=>run(req,res,"核对原索引构建结果",()=>knowledge.getKnowledgeGenerationByKey(book(req),key(req))));
 router.get(`${base}/requests/:id`,(req,res)=>run(req,res,"核对原分块嵌入结果",()=>knowledge.getKnowledgeEmbeddingResult(book(req),id(req))));
 router.post(`${base}/requests/:id/execute`,(req,res)=>run(req,res,"生成原分块向量",()=>knowledge.executeKnowledgeEmbedding(book(req),id(req),input(knowledge.executeKnowledgeEmbeddingSchema,req.body))));
 router.post(`${base}/requests/:id/complete-saved`,(req,res)=>run(req,res,"完成已保留原向量的入库",()=>{input(empty,req.body);return knowledge.completeSavedKnowledgeEmbedding(book(req),id(req));}));
 router.post(`${base}/requests/:id/end-expired`,(req,res)=>run(req,res,"结束原超期嵌入尝试",()=>{input(empty,req.body);return knowledge.endExpiredKnowledgeEmbedding(book(req),id(req));}));
 router.post(`${base}/semantic`,(req,res)=>run(req,res,"执行本书语义检索",()=>knowledge.searchKnowledgeSemantic(book(req),input(knowledge.searchKnowledgeSemanticSchema,req.body))));
 router.get(`${base}/semantic/by-key/:key`,(req,res)=>run(req,res,"核对原语义检索结果",()=>knowledge.getKnowledgeSemanticByKey(book(req),key(req))));
 router.get(`${base}/semantic/:id`,(req,res)=>run(req,res,"读取原语义检索回执",()=>knowledge.getKnowledgeSemanticResult(book(req),id(req))));
 router.post(`${base}/semantic/:id/complete-saved`,(req,res)=>run(req,res,"完成已保留查询向量的检索",()=>{input(empty,req.body);return knowledge.completeSavedKnowledgeSemantic(book(req),id(req));}));
 router.post(`${base}/semantic/:id/end-expired`,(req,res)=>run(req,res,"结束原超期语义检索尝试",()=>{input(empty,req.body);return knowledge.endExpiredKnowledgeSemantic(book(req),id(req));}));
 return router;
}

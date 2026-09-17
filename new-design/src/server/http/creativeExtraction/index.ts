import {Router,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {prepareCreativeSchema,creativeCommandSchema,creativeRunSchema} from '../../../common/creativeExtraction';
import {getCreativeExtractionCatalog,prepareCreativeExtraction,readCreativeExtractionPreview,readCreativeExtractionByKey,executeCreativeExtractionCommand,readCreativeExtractionWriteReceipt,CreativeExtractionError} from '../../database/creativeExtraction';
import {runCreativeExtraction,completeSavedCreativeExtraction} from '../../application/creativeExtraction';
import {AiExecutionError} from '../../ai';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
const uuid=z.string().uuid(),key=z.string().trim().min(8).max(160);
const labels:Record<string,string>={bookId:'本书',mode:'创作专项',instruction:'中文要求',source:'参考来源',assetId:'知识参考',sourceVersionId:'原资料版本',parsedVersionId:'解析版本',checksum:'来源校验',start:'参考起始字位',end:'参考结束字位',typeId:'写法内容类型',typeVersionId:'正式内容规格',documentId:'目标章节',bodyVersionId:'原正文版本',expectedDocumentRevision:'正文目录代次',groupCount:'标题分组数',candidatesPerGroup:'每组标题数',requestKey:'原请求凭证',previewId:'原预览',candidateId:'精确候选',expectedPreviewRevision:'预览代次',title:'候选名称',content:'完整本章候选',values:'写法表单',expectedBookRevision:'书籍信息代次',confirm:'明确确认'};
function chineseIssues(error:z.ZodError){return Object.fromEntries(error.issues.map(issue=>[issue.path.join('.')||'form',`请核对“${issue.path.map(part=>typeof part==='number'?`第${part+1}项`:labels[String(part)]??String(part)).join('／')||'完整填写'}”的类型、必填项与允许范围。`]));}
export function creativeExtractionRouter(dependencies:ExecutionDependencies={}):Router{
 const router=Router();const respond=(response:Response,next:NextFunction,step:string,work:()=>Promise<unknown>,read=false)=>{void Promise.resolve().then(work).then(data=>response.json({success:true,data})).catch(error=>{
 if(error instanceof CreativeExtractionError){const wrapped=new AiExecutionError(error.recovery.failedStep,error.message,error.status,null,error.issues);Object.assign(wrapped.recovery,error.recovery,read?{mutationOutcome:undefined}:{});next(wrapped);}
 else if(error instanceof AiExecutionError)next(error);
 else if(error instanceof z.ZodError){const failure=new CreativeExtractionError('输入不完整，请核对标记位置；完整填写保留。',422,step,read?'unknown':'not_written',undefined,chineseIssues(error));const wrapped=new AiExecutionError(step,failure.message,422,null,failure.issues);Object.assign(wrapped.recovery,failure.recovery,read?{mutationOutcome:undefined}:{});next(wrapped);}
 else {const failure=new CreativeExtractionError('本次结果未读取，原输入和请求凭证保留；请返回来源页只读核对。',503,step,'unknown');const wrapped=new AiExecutionError(step,failure.message,503);Object.assign(wrapped.recovery,failure.recovery,read?{mutationOutcome:undefined}:{});next(wrapped);}
 });};
 router.get('/catalog/:bookId',(req,res,next)=>respond(res,next,'读取创作提炼参考与正式表单',()=>getCreativeExtractionCatalog(uuid.parse(req.params.bookId)),true));
 router.get('/by-key/:key',(req,res,next)=>respond(res,next,'核对原提炼预览回执',()=>readCreativeExtractionByKey(key.parse(req.params.key)),true));
 router.get('/commands/by-key/:key',(req,res,next)=>respond(res,next,'核对原候选保存与采用回执',()=>readCreativeExtractionWriteReceipt(key.parse(req.params.key)),true));
 router.post('/previews',(req,res,next)=>respond(res,next,'冻结创作提炼输入',()=>prepareCreativeExtraction(prepareCreativeSchema.parse(req.body))));
 router.get('/:id',(req,res,next)=>respond(res,next,'读取原创作提炼候选',()=>readCreativeExtractionPreview(uuid.parse(req.params.id)),true));
 router.post('/:id/run',(req,res,next)=>respond(res,next,'执行原创作提炼请求',()=>runCreativeExtraction(uuid.parse(req.params.id),creativeRunSchema.parse(req.body),dependencies)));
 router.post('/:id/complete-saved',(req,res,next)=>respond(res,next,'按原回复完成保存与运行回执',()=>{z.object({}).strict().parse(req.body);return completeSavedCreativeExtraction(uuid.parse(req.params.id));}));
 router.post('/:id/commands',(req,res,next)=>respond(res,next,'明确保存或采用审阅候选',()=>executeCreativeExtractionCommand(uuid.parse(req.params.id),creativeCommandSchema.parse(req.body))));
 return router;
}

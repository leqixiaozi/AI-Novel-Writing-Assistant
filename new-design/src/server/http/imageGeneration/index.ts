import {Router,type Request,type Response,type NextFunction} from "express";
import {z} from "zod";
import {imageGenerationInputSchema,imageConnectionInputSchema} from "../../../common/imageGeneration";
import type {AiRuntimeRecovery} from "../../../common/aiRuntime";
import {generateImageCandidate} from "../../application/imageGeneration";
import {getImageGenerationCatalog,readImageGenerationByKey,readImageGenerationResult,completeSavedImageGeneration,endExpiredImageGeneration,ImageGenerationError} from "../../database/imageGeneration";
import {getManagedImageConnectionCatalog,saveManagedImageConnection,readManagedImageConnectionSaveReceipt,readManagedImageConnectionVersion,ImageConfigurationError} from "../../database/modelManagement/imageGeneration";
import {NewDesignError} from "../../domain/errors";
const uuid=z.string().uuid(),empty=z.object({}).strict();
export class ImageHttpError extends NewDesignError {constructor(message:string,status:number,readonly recovery:AiRuntimeRecovery,issues?:Record<string,string>){super(message,status,issues);}}
export function imageGenerationRouter(){const router=Router();
 const run=(req:Request,res:Response,next:NextFunction,stage:string,work:()=>Promise<unknown>)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>{
  if(error instanceof ImageGenerationError){if(req.method==='GET')delete error.recovery.mutationOutcome;next(error);return;}
  const issues=error instanceof z.ZodError?Object.fromEntries(error.issues.map(issue=>[issue.path.join('.'),'请保留输入并核对此项图片规格。'])):error instanceof NewDesignError?error.issues:undefined;
  const book=uuid.safeParse(req.params.bookId??req.body?.bookId),message=error instanceof NewDesignError?error.message:error instanceof z.ZodError?'图片输入未符合规格，请核对已标识位置。':'原图片结果未读取，画面输入、原凭证与已保存回复保留。',status=error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503;
  if(book.success){const failure=new ImageGenerationError(message,status,book.data,stage,req.method==='GET'?undefined:error instanceof z.ZodError?'not_written':'unknown',issues);next(failure);return;}
  const configuration=req.path.startsWith('/models/'),failure=new ImageHttpError(message,status,{failedStep:stage,summary:message,savedResult:'当前画面填写、原请求和已有图片保留；不重新生成。',actionLabel:configuration?'打开新设计模型设置':'打开运行维护',sourceRoute:configuration?'/new-design/structure/models':'/new-design/structure/maintenance',...(req.method==='GET'?{}:{mutationOutcome:error instanceof ImageConfigurationError?error.mutationOutcome:error instanceof z.ZodError?'not_written':'unknown'})},issues);next(failure);
 });};
 router.get('/books/:bookId/image-generation/catalog',(req,res,next)=>run(req,res,next,'读取图片专属连接目录',()=>getImageGenerationCatalog(uuid.parse(String(req.params.bookId)))));
 router.post('/books/:bookId/image-generation/requests',(req,res,next)=>run(req,res,next,'生成并保存单图候选',()=>{const input=imageGenerationInputSchema.parse(req.body);if(input.bookId!==uuid.parse(String(req.params.bookId)))throw new NewDesignError('图片请求不属于当前书籍，未生成到其他书籍。',422);return generateImageCandidate(input);}));
 router.get('/books/:bookId/image-generation/by-key/:key',(req,res,next)=>run(req,res,next,'只读核对原图片请求',()=>readImageGenerationByKey(uuid.parse(String(req.params.bookId)),uuid.parse(String(req.params.key)))));
 router.get('/image-generation/requests/:id/result',(req,res,next)=>run(req,res,next,'读取原图片结果',()=>readImageGenerationResult(uuid.parse(String(req.params.id)))));
 router.post('/image-generation/requests/:id/complete-saved',(req,res,next)=>run(req,res,next,'继续保存原图片回复',()=>{empty.parse(req.body);return completeSavedImageGeneration(uuid.parse(String(req.params.id)));}));
 router.post('/image-generation/requests/:id/end-expired',(req,res,next)=>run(req,res,next,'结束过期未知图片领取',()=>{empty.parse(req.body);return endExpiredImageGeneration(uuid.parse(String(req.params.id)));}));
 router.get('/models/image-generation/catalog',(req,res,next)=>run(req,res,next,'读取专属图片模型配置',()=>getManagedImageConnectionCatalog()));
 router.post('/models/image-generation/connections',(req,res,next)=>run(req,res,next,'保存并启用专属图片连接',()=>saveManagedImageConnection(imageConnectionInputSchema.parse(req.body))));
 router.get('/models/image-generation/connections/by-request/:key',(req,res,next)=>run(req,res,next,'核对原图片连接保存回执',()=>readManagedImageConnectionSaveReceipt(uuid.parse(String(req.params.key)))));
 router.get('/models/image-generation/connections/:id',(req,res,next)=>run(req,res,next,'读取所选图片连接精确版本',()=>readManagedImageConnectionVersion(uuid.parse(String(req.params.id)))));
 return router;
}

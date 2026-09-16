import {Router,type NextFunction,type Request,type Response} from "express";
import {z} from "zod";
import {getVisualWorkspace,saveVisualUpload,executeVisualCommand,previewVisualChange,readVisualReceipt,readVisualPreviewByKey,getVisualImage,VisualSourceError} from "../../database/visualAssets";
import {NewDesignError} from "../../domain/errors";

const uuid=z.string().uuid(),key=z.string().trim().min(8).max(160);
const rawBook=(request:Request)=>typeof request.params.bookId==="string"?request.params.bookId:request.body&&typeof request.body.bookId==="string"?request.body.bookId:"";
export function visualAssetsRouter():Router{
 const router=Router();
 const run=(request:Request,response:Response,next:NextFunction,step:string,work:()=>Promise<unknown>)=>{
  void Promise.resolve().then(work).then(data=>response.json({success:true,data})).catch(error=>{
   if(error instanceof VisualSourceError){if(request.method==='GET')delete error.recovery.mutationOutcome;next(error);return;}
   const book=uuid.safeParse(rawBook(request));
   if(!book.success){next(new NewDesignError("本书图片来源凭证格式不正确，未读取或保存到其他书籍。",422));return;}
   const requestKey=key.safeParse(request.body?.requestKey);
   const issues=error instanceof z.ZodError?Object.fromEntries(error.issues.map(issue=>[String(issue.path[0]??"input"),"此项未符合本次原图片操作规格，请保留填写后修正。"] )):error instanceof NewDesignError?error.issues:undefined;
   const failure=new VisualSourceError(error instanceof NewDesignError?error.message:error instanceof z.ZodError?"本次图片输入未符合受控规格，请核对文件、名称及原版本凭证。":"图片来源结果未读取；原图、版本、原凭证和当前填写保留。",error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,book.data,requestKey.success?requestKey.data:null,error instanceof z.ZodError?'not_written':'unknown',step,issues);
   if(request.method==='GET')delete failure.recovery.mutationOutcome;
   next(failure);
  });
 };
 router.get("/books/:bookId/visual-assets",(req,res,next)=>run(req,res,next,"读取本书原图片目录",()=>getVisualWorkspace(uuid.parse(String(req.params.bookId)))));
 router.post("/visual-assets/uploads",(req,res,next)=>run(req,res,next,"保存本地图片候选版本",()=>saveVisualUpload(req.body)));
 router.post("/visual-assets/commands",(req,res,next)=>run(req,res,next,"保存图片说明、明确采用、绑定或归档",()=>executeVisualCommand(req.body)));
 router.post("/visual-assets/previews",(req,res,next)=>run(req,res,next,"保存图片影响预览",()=>previewVisualChange(req.body)));
 router.get("/books/:bookId/visual-assets/receipts/by-key/:key",(req,res,next)=>run(req,res,next,"只读核对原图片操作回执",()=>readVisualReceipt(uuid.parse(String(req.params.bookId)),key.parse(String(req.params.key)))));
 router.get("/books/:bookId/visual-assets/previews/by-key/:key",(req,res,next)=>run(req,res,next,"只读核对原图片影响预览",()=>readVisualPreviewByKey(uuid.parse(String(req.params.bookId)),key.parse(String(req.params.key)))));
 router.get("/books/:bookId/visual-assets/:assetId/versions/:versionId/content",(req,res,next)=>{
  void Promise.resolve().then(()=>getVisualImage(uuid.parse(String(req.params.bookId)),uuid.parse(String(req.params.assetId)),uuid.parse(String(req.params.versionId)))).then(content=>{
   res.setHeader("Content-Type",content.mimeType);res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Security-Policy","default-src 'none'; sandbox");res.setHeader("Cache-Control","private, no-cache");res.setHeader("ETag",`"${content.checksum}"`);res.setHeader("Content-Disposition","inline");res.send(content.bytes);
  }).catch(error=>{const book=uuid.safeParse(rawBook(req));if(!book.success){next(new NewDesignError('图片来源凭证格式不正确。',422));return;}const failure=new VisualSourceError(error instanceof NewDesignError?error.message:'原图片文件未读取，原版本保留；不使用其他图像代替。',error instanceof NewDesignError?error.status:503,book.data,null,'unknown','读取原图片精确版本内容');delete failure.recovery.mutationOutcome;next(failure);});
 });
 return router;
}

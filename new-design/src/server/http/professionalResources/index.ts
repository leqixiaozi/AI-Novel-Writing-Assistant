import {Router,type NextFunction,type Response} from "express";
import {z} from "zod";
import {getProfessionalCatalog,executeProfessionalCommand,readProfessionalReceipt,ProfessionalResourceError} from "../../database/professionalResources";
export function professionalResourcesRouter():Router{
 const router=Router(),respond=(response:Response,next:NextFunction,work:()=>Promise<unknown>,step:string)=>{void Promise.resolve().then(work).then(data=>response.json({success:true,data})).catch(error=>next(error instanceof ProfessionalResourceError?error:new ProfessionalResourceError("专业资源结果未读取；原资料与当前填写保留，请恢复连接后只读核对。",error instanceof z.ZodError?422:503,"not_written",null,step)));};
 router.get("/catalog",(_request,response,next)=>respond(response,next,getProfessionalCatalog,"读取专业创作资源"));
 router.post("/commands",(request,response,next)=>respond(response,next,()=>executeProfessionalCommand(request.body),"提交专业资源操作"));
 router.get("/commands/by-key/:key",(request,response,next)=>respond(response,next,()=>readProfessionalReceipt(z.string().trim().min(8).max(160).parse(String(request.params.key))),"核对原资源操作回执"));
 return router;
}

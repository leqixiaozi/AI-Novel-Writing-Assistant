import {Router,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {directorFollowupFilterSchema,directorFollowupKindSchema} from '../../../common/directorFollowup';
import {getDirectorFollowupWorkspace,getDirectorFollowupDetail,DirectorFollowupReadError} from '../../application/directorFollowup';
import {AiExecutionError} from '../../ai';
export function directorFollowupRouter():Router{const router=Router(),respond=(res:Response,next:NextFunction,step:string,work:()=>Promise<unknown>)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>{const failure=error instanceof DirectorFollowupReadError?error:error instanceof z.ZodError?new DirectorFollowupReadError(step,'选定书籍、记录或筛选凭证不完整；保留原视图，核对中文选项后重新读取。',422,Object.fromEntries(error.issues.map(issue=>[issue.path.join('.')||'filter','请核对此位置的精确来源与允许范围。']))):new DirectorFollowupReadError(step,'总控台只读结果尚未读取；原来源结果保留，请刷新本页核对。');const wrapped=new AiExecutionError(failure.recovery.failedStep,failure.message,failure.status,null,failure.issues);Object.assign(wrapped.recovery,failure.recovery);next(wrapped);});};
 router.get('/workspace',(req,res,next)=>respond(res,next,'读取跨书导演汇总',()=>getDirectorFollowupWorkspace(directorFollowupFilterSchema.parse(req.query))));
 router.get('/records/:kind/:id',(req,res,next)=>respond(res,next,'读取原跟进记录的精确版本',()=>getDirectorFollowupDetail(directorFollowupKindSchema.parse(req.params.kind),z.string().uuid().parse(req.params.id))));
 return router;}

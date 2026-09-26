import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {publicTitleInputSchema,publicTitleChoiceSchema} from '../../../common/publicTitles';
import {getPublicTitleWorkspace,getPublicTitleLibrary,readPublicTitleByKey,completePublicTitle,endExpiredPublicTitle,choosePublicTitle,readPublicTitleChoice,PublicTitleError} from '../../database/publicTitles';
import {runPublicTitles} from '../../application/publicTitles';
import {NewDesignError} from '../../domain/errors';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
export function publicTitlesRouter(dependencies:ExecutionDependencies={}){
 const router=Router(),uuid=z.string().uuid(),empty=z.object({}).strict(),page=z.object({before:uuid.optional()}).strict();
 const run=(req:Request,res:Response,next:NextFunction,work:()=>Promise<unknown>)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>next(error instanceof PublicTitleError?error:new PublicTitleError(error instanceof z.ZodError?'公共标题输入或选择不完整，原填写保留。':error instanceof NewDesignError?error.message:'原标题结果未确认，请保留原键只读核对。',error instanceof z.ZodError?422:error instanceof NewDesignError?error.status:503,error instanceof z.ZodError&&req.method==='POST'?'not_written':'unknown')));};
 router.get('/library',(req,res,next)=>run(req,res,next,()=>{return getPublicTitleLibrary(page.parse(req.query).before);}));
 router.get('/workspace',(req,res,next)=>run(req,res,next,()=>{return getPublicTitleWorkspace(page.parse(req.query).before);}));
 router.post('/requests',(req,res,next)=>run(req,res,next,()=>runPublicTitles(publicTitleInputSchema.parse(req.body),dependencies)));
 router.get('/by-key/:key',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.query);return readPublicTitleByKey(uuid.parse(String(req.params.key)));}));
 router.post('/:id/complete',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.body);return completePublicTitle(uuid.parse(String(req.params.id)));}));
 router.post('/:id/end-expired',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.body);return endExpiredPublicTitle(uuid.parse(String(req.params.id)));}));
 router.post('/choices',(req,res,next)=>run(req,res,next,()=>choosePublicTitle(publicTitleChoiceSchema.parse(req.body))));
 router.get('/choices/:key',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.query);return readPublicTitleChoice(uuid.parse(String(req.params.key)));}));
 return router;
}

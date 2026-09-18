import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {imageMaterialScopeSchema,imagePreparationInputSchema} from '../../../common/imagePreparation';
import {getImageMaterials,readImagePreparationByKey,completeImagePreparation,endExpiredImagePreparation,ImagePreparationError} from '../../database/imagePreparation';
import {runImagePreparation} from '../../application/imagePreparation';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
export function imagePreparationRouter(dependencies:ExecutionDependencies={}){const router=Router(),uuid=z.string().uuid(),empty=z.object({}).strict();
 const run=(req:Request,res:Response,next:NextFunction,work:()=>Promise<unknown>)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>next(error instanceof ImagePreparationError?error:new ImagePreparationError(error instanceof z.ZodError?'图片资料或画面填写不完整，保留原草稿。':'原图片优化结果未确认，请保留原键核对。',error instanceof z.ZodError?422:503,error instanceof z.ZodError&&req.method==='POST'?'not_written':'unknown')));};
 router.get('/materials',(req,res,next)=>run(req,res,next,()=>getImageMaterials(imageMaterialScopeSchema.parse(req.query))));
 router.post('/requests',(req,res,next)=>run(req,res,next,()=>runImagePreparation(imagePreparationInputSchema.parse(req.body),dependencies)));
 router.get('/by-key/:key',(req,res,next)=>run(req,res,next,()=>readImagePreparationByKey(uuid.parse(String(req.params.key)))));
 router.post('/:id/complete',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.body);return completeImagePreparation(uuid.parse(String(req.params.id)));}));
 router.post('/:id/end-expired',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.body);return endExpiredImagePreparation(uuid.parse(String(req.params.id)));}));return router;
}

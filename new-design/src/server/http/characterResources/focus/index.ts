import {Router} from 'express';
import {z} from 'zod';
import type {NewDesignAiGateway} from '../../../ai/gateway';
import {AiExecutionError} from '../../../ai';
import {resourceFocusSelectionSchema,resourceFocusRequestSchema} from '../../../../common/characterResources/focus';
import {previewResourceFocus,generateResourceFocus,readResourceFocusOriginal,getResourceFocusRecord,endUnknownResourceFocus,ResourceFocusWriteError} from '../../../database/characterResources/focus';
export function resourceFocusRouter(ai?:NewDesignAiGateway){
 const router=Router(),uuid=z.string().uuid(),base='/books/:bookId/characters/:characterId/resource-focus';
 const actorInput=(params:Record<string,string>,body:unknown)=>{const input=resourceFocusRequestSchema.parse(body);if(input.characterId!==uuid.parse(params.characterId))throw new ResourceFocusWriteError('原人物范围不属于当前人物页面。',422,'not_written');return input;};
 const fail=(error:unknown,next:(error:unknown)=>void)=>{if(error instanceof ResourceFocusWriteError||error instanceof z.ZodError){const problem=new AiExecutionError('核对人物资源建议',error instanceof ResourceFocusWriteError?error.message:'请核对人物、真实持有维度和完整原来源。',error instanceof ResourceFocusWriteError?error.status:422);problem.recovery.mutationOutcome=error instanceof ResourceFocusWriteError?error.mutationOutcome:'not_written';next(problem);}else next(error);};
 router.get(`${base}/preview`,(req,res,next)=>{void Promise.resolve().then(()=>{const {includeHistory,...selection}=resourceFocusSelectionSchema.extend({includeHistory:z.literal('true').optional()}).parse(req.query);return previewResourceFocus(uuid.parse(req.params.bookId),uuid.parse(req.params.characterId),selection,includeHistory==='true');}).then(data=>res.json({success:true,data})).catch(next);});
 router.post(base,(req,res,next)=>{void Promise.resolve().then(()=>generateResourceFocus(uuid.parse(req.params.bookId),actorInput(req.params,req.body),ai)).then(data=>res.json({success:true,data})).catch(error=>fail(error,next));});
 router.post(`${base}/original-receipt`,(req,res,next)=>{void Promise.resolve().then(()=>readResourceFocusOriginal(uuid.parse(req.params.bookId),actorInput(req.params,req.body))).then(data=>res.json({success:true,data})).catch(error=>fail(error,next));});
 router.post(`${base}/end-unknown`,(req,res,next)=>{void Promise.resolve().then(()=>{const body=z.object({confirm:z.literal(true),input:resourceFocusRequestSchema}).strict().parse(req.body);return endUnknownResourceFocus(uuid.parse(req.params.bookId),actorInput(req.params,body.input));}).then(data=>res.json({success:true,data})).catch(error=>fail(error,next));});
 router.get(`${base}/by-id/:requestKey`,(req,res,next)=>{void Promise.resolve().then(async()=>{const data=await getResourceFocusRecord(uuid.parse(req.params.bookId),uuid.parse(req.params.requestKey));if(data&&data.request.characterId!==uuid.parse(req.params.characterId))return null;return data;}).then(data=>res.json({success:true,data})).catch(next);});
 return router;
}

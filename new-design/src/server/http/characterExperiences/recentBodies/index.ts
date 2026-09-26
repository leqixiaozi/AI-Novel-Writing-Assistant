import {Router} from 'express';
import {z} from 'zod';
import type {NewDesignAiGateway} from '../../../ai/gateway';
import {AiExecutionError} from '../../../ai/runtime/errors';
import {recentBodySelectionSchema,recentBodySeriesSelectionSchema,recentBodyExperienceRequestSchema} from '../../../../common/characterExperiences/recentBodies';
import {RecentBodyExperienceWriteError,getRecentBodyExperienceWorkspace,previewRecentBodyExperiences,previewRecentBodyExperienceSeries,generateRecentBodyExperiences,readRecentBodyExperienceOriginal,getRecentBodyExperienceRecord,getRecentBodyExperienceDraft,endUnknownRecentBodyExperiences} from '../../../database/characterExperiences/recentBodies';
export function recentBodyExperiencesRouter(ai?:NewDesignAiGateway){const router=Router(),uuid=z.string().uuid(),base='/books/:bookId/character-experiences/recent-bodies';const send=(action:()=>Promise<unknown>,res:any,next:(error:unknown)=>void)=>{void Promise.resolve().then(action).then(data=>res.json({success:true,data})).catch(error=>{if(error instanceof RecentBodyExperienceWriteError||error instanceof z.ZodError){const problem=new AiExecutionError('核对最近正文人物时间',error instanceof z.ZodError?'请明确选择人物、采用正文和完整要求。':error.message,error instanceof z.ZodError?422:error.status);problem.recovery.mutationOutcome=error instanceof z.ZodError?'not_written':error.mutationOutcome;next(problem);}else next(error);});};
 router.get(`${base}/workspace`,(req,res,next)=>send(()=>getRecentBodyExperienceWorkspace(uuid.parse(req.params.bookId),z.object({characterId:uuid}).strict().parse(req.query).characterId),res,next));
 router.post(`${base}/series-preview`,(req,res,next)=>send(()=>previewRecentBodyExperienceSeries(uuid.parse(req.params.bookId),recentBodySeriesSelectionSchema.parse(req.body)),res,next));
 router.post(`${base}/preview`,(req,res,next)=>send(()=>previewRecentBodyExperiences(uuid.parse(req.params.bookId),recentBodySelectionSchema.parse(req.body)),res,next));
 router.post(base,(req,res,next)=>send(()=>generateRecentBodyExperiences(uuid.parse(req.params.bookId),recentBodyExperienceRequestSchema.parse(req.body),ai),res,next));
 router.post(`${base}/original-receipt`,(req,res,next)=>send(()=>readRecentBodyExperienceOriginal(uuid.parse(req.params.bookId),recentBodyExperienceRequestSchema.parse(req.body)),res,next));
 router.get(`${base}/by-id/:batchId`,(req,res,next)=>send(()=>getRecentBodyExperienceRecord(uuid.parse(req.params.bookId),uuid.parse(req.params.batchId)),res,next));
 router.post(`${base}/end-unknown`,(req,res,next)=>send(()=>{const input=z.object({confirm:z.literal(true),input:recentBodyExperienceRequestSchema}).strict().parse(req.body);return endUnknownRecentBodyExperiences(uuid.parse(req.params.bookId),input.input);},res,next));
 router.post(`${base}/:batchId/candidates/:candidateId/draft`,(req,res,next)=>send(()=>getRecentBodyExperienceDraft(uuid.parse(req.params.bookId),uuid.parse(req.params.batchId),uuid.parse(req.params.candidateId),z.object({eventId:uuid}).strict().parse(req.body).eventId),res,next));return router;
}

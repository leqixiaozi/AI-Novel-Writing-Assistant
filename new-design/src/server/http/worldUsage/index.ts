import {Router} from 'express';
import {z} from 'zod';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {AiExecutionError} from '../../ai';
import {getWorldUsageWorkspace,getWorldUsageCandidateByKey,getWorldUsageAdoptionByKey,prepareWorldUsageCandidate,adoptWorldUsageCandidate,WorldUsageError} from '../../database/worldUsage';
import {worldUsagePrepareInputSchema,worldUsageAdoptInputSchema} from '../../../common/worldUsage';

const uuid=z.string().uuid();
export function worldUsageRouter(ai?:NewDesignAiGateway):Router{
 const router=Router(),scope=(params:Record<string,string>)=>({bookId:uuid.parse(params.bookId),rootCardId:uuid.parse(params.rootCardId)});
 const fail=(error:unknown,next:(error:unknown)=>void)=>{if(error instanceof z.ZodError){const problem=new AiExecutionError('核对本书世界使用范围','提交字段不符合世界范围规格；原填写保留。',422,null,Object.fromEntries(error.issues.map(issue=>[issue.path.join('.')||'form',issue.message])));problem.recovery.mutationOutcome='not_written';next(problem);return;}if(error instanceof WorldUsageError){const problem=new AiExecutionError('核对本书世界使用范围',error.message,error.status);problem.recovery.mutationOutcome=error.mutationOutcome;problem.recovery.savedResult='原世界资料、候选、正式采用及请求凭证保留；只读核对，不换键重发模型。';next(problem);}else next(error);};
 router.get('/books/:bookId/world-usage/:rootCardId',(req,res,next)=>{void Promise.resolve().then(()=>{const value=scope(req.params);return getWorldUsageWorkspace(value.bookId,value.rootCardId);}).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/books/:bookId/world-usage/:rootCardId/candidates/by-key/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>{const value=scope(req.params);return getWorldUsageCandidateByKey(value.bookId,value.rootCardId,uuid.parse(req.params.requestKey));}).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/books/:bookId/world-usage/:rootCardId/adoptions/by-key/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>{const value=scope(req.params);return getWorldUsageAdoptionByKey(value.bookId,value.rootCardId,uuid.parse(req.params.requestKey));}).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/books/:bookId/world-usage/:rootCardId/candidates',(req,res,next)=>{void Promise.resolve().then(()=>{const value=scope(req.params),input=worldUsagePrepareInputSchema.parse(req.body);return prepareWorldUsageCandidate(value.bookId,value.rootCardId,input,ai);}).then(data=>res.status(201).json({success:true,data})).catch(error=>fail(error,next));});
 router.post('/books/:bookId/world-usage/:rootCardId/adopt',(req,res,next)=>{void Promise.resolve().then(()=>{const value=scope(req.params);return adoptWorldUsageCandidate(value.bookId,value.rootCardId,worldUsageAdoptInputSchema.parse(req.body));}).then(data=>res.status(201).json({success:true,data})).catch(error=>fail(error,next));});
 return router;
}

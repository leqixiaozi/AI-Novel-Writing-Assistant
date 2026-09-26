import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {characterAuthorInputSchema} from '../../../common/characterAuthor';
import {getCharacterAuthorWorkspace,readCharacterAuthorByKey,completeCharacterAuthor,endExpiredCharacterAuthor,CharacterAuthorError} from '../../database/characterAuthor';
import {runCharacterAuthor} from '../../application/characterAuthor';
import {NewDesignError} from '../../domain/errors';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
import {getCharacterAuthorInfluences,decideCharacterAuthorInfluence,readCharacterAuthorInfluenceDecision} from '../../database/characterAuthor/influences';
import {characterAuthorInfluenceCommandSchema} from '../../../common/characterAuthor';
export function characterAuthorRouter(dependencies:ExecutionDependencies={}){
 const router=Router(),uuid=z.string().uuid(),empty=z.object({}).strict(),query=z.object({bookId:uuid,cardId:uuid,cutoffBodyVersionId:uuid.optional()}).strict();
 const run=(req:Request,res:Response,next:NextFunction,work:()=>Promise<unknown>)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>next(error instanceof CharacterAuthorError||error instanceof NewDesignError&&'recovery' in error?error:new CharacterAuthorError(error instanceof z.ZodError?'人物谈话填写或来源范围不完整，请保留原消息。':error instanceof NewDesignError?error.message:'人物谈话原回执未确认，请保留原键核对。',error instanceof z.ZodError?422:error instanceof NewDesignError?error.status:503,error instanceof z.ZodError&&req.method==='POST'?'not_written':'unknown')));};
 router.get('/influences/workspace',(req,res,next)=>run(req,res,next,()=>{const input=query.omit({cutoffBodyVersionId:true}).parse(req.query);return getCharacterAuthorInfluences(input.bookId,input.cardId);}));
 router.get('/influences/decisions/:key',(req,res,next)=>run(req,res,next,()=>{const input=query.omit({cutoffBodyVersionId:true}).parse(req.query);return readCharacterAuthorInfluenceDecision(input.bookId,input.cardId,uuid.parse(String(req.params.key)));}));
 router.post('/influences/decisions',(req,res,next)=>run(req,res,next,()=>decideCharacterAuthorInfluence(characterAuthorInfluenceCommandSchema.parse(req.body))));
 router.get('/workspace',(req,res,next)=>run(req,res,next,()=>{const input=query.parse(req.query);return getCharacterAuthorWorkspace(input.bookId,input.cardId,input.cutoffBodyVersionId??null);}));
 router.post('/requests',(req,res,next)=>run(req,res,next,()=>runCharacterAuthor(characterAuthorInputSchema.parse(req.body),dependencies)));
 router.get('/by-key/:key',(req,res,next)=>run(req,res,next,()=>readCharacterAuthorByKey(uuid.parse(String(req.params.key)))));
 router.post('/:id/complete',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.body);return completeCharacterAuthor(uuid.parse(String(req.params.id)));}));
 router.post('/:id/end-expired',(req,res,next)=>run(req,res,next,()=>{empty.parse(req.body);return endExpiredCharacterAuthor(uuid.parse(String(req.params.id)));}));return router;
}

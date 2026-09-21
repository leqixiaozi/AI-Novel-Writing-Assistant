import {Router,type NextFunction,type Request,type Response} from 'express';
import {z,ZodError} from 'zod';
import type {NewDesignAiGateway} from '../../ai/gateway';
import * as application from '../../application/creativeHub';
import {creativeHubArchiveSchema,creativeHubRestoreSchema,creativeHubThreadCreateSchema,creativeHubThreadUpdateSchema,creativeHubTurnRequestSchema} from '../../../common/creativeHub';
import {NewDesignError} from '../../domain/errors';

const uuid=z.string().uuid();
const asyncRoute=(work:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void work(req,res).catch(next);};
const ok=(res:Response,data:unknown)=>res.json({success:true,data});

export function creativeHubRouter(ai?:NewDesignAiGateway){
  const router=Router(),base='/creative-hub/threads';
  router.get('/creative-hub/capability',asyncRoute(async(_req,res)=>ok(res,await application.getCreativeHubCapability())));
  router.get(base,asyncRoute(async(req,res)=>ok(res,await application.listCreativeHubThreads({includeArchived:req.query.includeArchived==='true'}))));
  router.post(base,asyncRoute(async(req,res)=>ok(res,await application.createCreativeHubThread(creativeHubThreadCreateSchema.parse(req.body)))));
  router.get(`${base}/:threadId`,asyncRoute(async(req,res)=>ok(res,await application.getCreativeHubThread(uuid.parse(req.params.threadId)))));
  router.patch(`${base}/:threadId`,asyncRoute(async(req,res)=>ok(res,await application.updateCreativeHubThread(uuid.parse(req.params.threadId),creativeHubThreadUpdateSchema.parse(req.body)))));
  router.delete(`${base}/:threadId`,asyncRoute(async(req,res)=>{const input=creativeHubArchiveSchema.parse(req.body);return ok(res,await application.archiveCreativeHubThread(uuid.parse(req.params.threadId),input.expectedRevision));}));
  router.post(`${base}/:threadId/restore`,asyncRoute(async(req,res)=>{const input=creativeHubRestoreSchema.parse(req.body);return ok(res,await application.restoreCreativeHubThread(uuid.parse(req.params.threadId),input.expectedRevision));}));
  router.get(`${base}/:threadId/state`,asyncRoute(async(req,res)=>ok(res,await application.readCreativeHubState(uuid.parse(req.params.threadId)))));
  router.get(`${base}/:threadId/history`,asyncRoute(async(req,res)=>ok(res,await application.listCreativeHubTurns(uuid.parse(req.params.threadId)))));
  router.post(`${base}/:threadId/turns`,asyncRoute(async(req,res)=>ok(res,await application.runCreativeHubTurn(uuid.parse(req.params.threadId),creativeHubTurnRequestSchema.parse(req.body),ai))));
  router.post(`${base}/:threadId/turns/:turnId/resume`,asyncRoute(async(req,res)=>{z.object({}).strict().parse(req.body);return ok(res,await application.resumeCreativeHubTurn(uuid.parse(req.params.threadId),uuid.parse(req.params.turnId),ai));}));
  router.use((error:unknown,_req:Request,res:Response,next:NextFunction)=>{if(error instanceof ZodError)return res.status(422).json({success:false,error:'创作中枢输入格式不合格；原会话与回执保留。',issues:Object.fromEntries(error.issues.map((issue,index)=>[`输入${index+1}`,issue.path.join('.')||issue.message]))});if(error instanceof NewDesignError)return res.status(error.status).json({success:false,error:error.message,...(error.issues?{issues:error.issues}:{})});next(error);});
  return router;
}

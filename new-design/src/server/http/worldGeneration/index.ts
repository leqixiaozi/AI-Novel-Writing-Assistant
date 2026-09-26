import {Router,type NextFunction,type Request,type Response} from 'express';
import {z} from 'zod';
import {worldGenerationCandidateSaveSchema,worldGenerationPublishSchema,worldGenerationRegenerateSchema,worldGenerationStartSchema} from '../../../common/worldGeneration';
import type {NewDesignAiGateway} from '../../ai/gateway';
import * as application from '../../application/worldGeneration';

const uuid=z.string().uuid();
const route=(work:(request:Request)=>Promise<unknown>,status=200)=>(request:Request,response:Response,next:NextFunction)=>{void work(request).then(data=>response.status(status).json({success:true,data})).catch(next);};

export function worldGenerationRouter(ai?:NewDesignAiGateway){
  const router=Router(),base='/world-generation/sessions';
  router.get('/world-generation/capability',route(()=>application.getWorldGenerationCapability()));
  router.get(base,route(()=>application.listWorldGenerationSessions()));
  router.get('/world-generation/requests/:requestKey',route(request=>application.readWorldGenerationOriginal(uuid.parse(request.params.requestKey))));
  router.post(base,route(request=>application.startWorldGeneration(worldGenerationStartSchema.parse(request.body)),201));
  router.get(`${base}/:sessionId`,route(request=>application.getWorldGenerationSession(uuid.parse(request.params.sessionId))));
  router.post(`${base}/:sessionId/candidates`,route(request=>application.saveWorldGenerationCandidate(uuid.parse(request.params.sessionId),worldGenerationCandidateSaveSchema.parse(request.body)),201));
  router.post(`${base}/:sessionId/regenerate`,route(request=>application.generateWorldCandidate(uuid.parse(request.params.sessionId),worldGenerationRegenerateSchema.parse(request.body),ai),201));
  router.post(`${base}/:sessionId/publish`,route(request=>application.publishWorldCandidate(uuid.parse(request.params.sessionId),worldGenerationPublishSchema.parse(request.body)),201));
  return router;
}

import {Router} from 'express';
import {z} from 'zod';
import {comicBibleAdoptionSchema,comicBibleProposalSchema} from '../../../common/comicBibles';
import {adoptComicBible,getComicBibleWorkspace,proposeComicBible,readComicBibleAdoptionOriginal,readComicBibleOriginal} from '../../database/comicBibles';

const uuid=z.string().uuid();
export function comicBiblesRouter(){const router=Router();
 router.get('/comic/projects/:projectId/bibles',(req,res,next)=>{void Promise.resolve().then(()=>getComicBibleWorkspace(uuid.parse(req.params.projectId))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/bible-requests/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicBibleOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/bible-adoptions/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicBibleAdoptionOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/bibles',(req,res,next)=>{void Promise.resolve().then(()=>proposeComicBible(uuid.parse(req.params.projectId),comicBibleProposalSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/bibles/:entityId/adoptions',(req,res,next)=>{void Promise.resolve().then(()=>adoptComicBible(uuid.parse(req.params.projectId),uuid.parse(req.params.entityId),comicBibleAdoptionSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 return router;}

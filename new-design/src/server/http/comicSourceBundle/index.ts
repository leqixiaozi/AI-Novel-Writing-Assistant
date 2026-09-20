import {Router} from 'express';
import {z} from 'zod';
import {comicSourceBundleAdoptionSchema,comicSourceBundleProposalSchema} from '../../../common/comicSourceBundle';
import {adoptComicSourceBundle,getComicSourceBundleWorkspace,proposeComicSourceBundle,readComicSourceBundleAdoptionOriginal,readComicSourceBundleOriginal} from '../../database/comicSourceBundle';

const uuid=z.string().uuid();
export function comicSourceBundleRouter(){const router=Router();
 router.get('/comic/projects/:projectId/source-bundle',(req,res,next)=>{void Promise.resolve().then(()=>getComicSourceBundleWorkspace(uuid.parse(req.params.projectId))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/source-bundle-requests/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicSourceBundleOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/source-bundle-adoptions/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicSourceBundleAdoptionOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/source-bundle',(req,res,next)=>{void Promise.resolve().then(()=>proposeComicSourceBundle(uuid.parse(req.params.projectId),comicSourceBundleProposalSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/source-bundle/adoptions',(req,res,next)=>{void Promise.resolve().then(()=>adoptComicSourceBundle(uuid.parse(req.params.projectId),comicSourceBundleAdoptionSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 return router;}

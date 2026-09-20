import {Router} from 'express';
import {z} from 'zod';
import {comicPanelAdoptionSchema,comicPanelProposalSchema} from '../../../common/comicPanels';
import {adoptComicPanelSet,getComicPanelWorkspace,proposeComicPanelSet,readComicPanelAdoptionOriginal,readComicPanelProposalOriginal} from '../../database/comicPanels';

const uuid=z.string().uuid();
export function comicPanelsRouter(){const router=Router();
 router.get('/comic/projects/:projectId/episodes/:episodeId/panels',(req,res,next)=>{void Promise.resolve().then(()=>getComicPanelWorkspace(uuid.parse(req.params.projectId),uuid.parse(req.params.episodeId))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/panel-requests/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicPanelProposalOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/panel-adoptions/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicPanelAdoptionOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/episodes/:episodeId/panels',(req,res,next)=>{void Promise.resolve().then(()=>proposeComicPanelSet(uuid.parse(req.params.projectId),uuid.parse(req.params.episodeId),comicPanelProposalSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/episodes/:episodeId/panel-adoptions',(req,res,next)=>{void Promise.resolve().then(()=>adoptComicPanelSet(uuid.parse(req.params.projectId),uuid.parse(req.params.episodeId),comicPanelAdoptionSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 return router;}

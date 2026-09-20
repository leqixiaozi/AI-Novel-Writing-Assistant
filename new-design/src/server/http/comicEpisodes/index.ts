import {Router} from 'express';
import {z} from 'zod';
import {comicEpisodeAdoptionSchema,comicEpisodeProposalSchema} from '../../../common/comicEpisodes';
import {adoptComicEpisode,getComicEpisodeWorkspace,proposeComicEpisode,readComicEpisodeAdoptionOriginal,readComicEpisodeOriginal} from '../../database/comicEpisodes';

const uuid=z.string().uuid();
export function comicEpisodesRouter(){const router=Router();
 router.get('/comic/projects/:projectId/episodes',(req,res,next)=>{void Promise.resolve().then(()=>getComicEpisodeWorkspace(uuid.parse(req.params.projectId))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/episode-requests/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicEpisodeOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/episode-adoptions/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicEpisodeAdoptionOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/episodes',(req,res,next)=>{void Promise.resolve().then(()=>proposeComicEpisode(uuid.parse(req.params.projectId),comicEpisodeProposalSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/episodes/:episodeId/adoptions',(req,res,next)=>{void Promise.resolve().then(()=>adoptComicEpisode(uuid.parse(req.params.projectId),uuid.parse(req.params.episodeId),comicEpisodeAdoptionSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 return router;}

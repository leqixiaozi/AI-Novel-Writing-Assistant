import {Router} from 'express';
import {z} from 'zod';
import {comicCreateSchema} from '../../../common/comicProjects';
import {createComicProject,getComicCapability,getComicProject,listComicProjects,readComicCreateOriginal} from '../../database/comicProjects';

const uuid=z.string().uuid();
export function comicProjectsRouter(){
 const router=Router();
 router.get('/comic/capability',(_req,res,next)=>{void getComicCapability().then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects',(_req,res,next)=>{void listComicProjects().then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId',(req,res,next)=>{void Promise.resolve().then(()=>getComicProject(uuid.parse(req.params.projectId))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/create-requests/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicCreateOriginal(uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/comic/projects',(req,res,next)=>{void Promise.resolve().then(()=>createComicProject(comicCreateSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 return router;
}

import {Router} from 'express';
import {z} from 'zod';
import {comicVisualAdoptionSchema,comicVisualUploadSchema} from '../../../common/comicVisualAssets';
import {adoptComicVisualVersion,getComicVisualWorkspace,readComicVisualAdoptionOriginal,readComicVisualContent,readComicVisualUploadOriginal,uploadComicVisualCandidate} from '../../database/comicVisualAssets';

const uuid=z.string().uuid();
export function comicVisualAssetsRouter(){const router=Router();
 router.get('/comic/projects/:projectId/visual-assets',(req,res,next)=>{void Promise.resolve().then(()=>getComicVisualWorkspace(uuid.parse(req.params.projectId),uuid.parse(req.query.bibleEntityId))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/visual-asset-requests/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicVisualUploadOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/visual-asset-adoptions/:requestKey',(req,res,next)=>{void Promise.resolve().then(()=>readComicVisualAdoptionOriginal(uuid.parse(req.params.projectId),uuid.parse(req.params.requestKey))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/visual-assets',(req,res,next)=>{void Promise.resolve().then(()=>uploadComicVisualCandidate(uuid.parse(req.params.projectId),comicVisualUploadSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 router.post('/comic/projects/:projectId/visual-assets/:assetId/adoptions',(req,res,next)=>{void Promise.resolve().then(()=>adoptComicVisualVersion(uuid.parse(req.params.projectId),uuid.parse(req.params.assetId),comicVisualAdoptionSchema.parse(req.body))).then(data=>res.status(201).json({success:true,data})).catch(next);});
 router.get('/comic/projects/:projectId/visual-assets/:assetId/versions/:versionId/content',(req,res,next)=>{void Promise.resolve().then(()=>readComicVisualContent(uuid.parse(req.params.projectId),uuid.parse(req.params.assetId),uuid.parse(req.params.versionId))).then(content=>{res.setHeader('Content-Type',content.mimeType);res.setHeader('Content-Length',String(content.bytes.length));res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.setHeader('Cache-Control','private, max-age=31536000, immutable');res.setHeader('ETag',`"${content.checksum}"`);res.setHeader('Content-Disposition','inline');res.send(content.bytes);}).catch(next);});
 return router;
}

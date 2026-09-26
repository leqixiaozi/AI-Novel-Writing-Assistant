import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {publicCharacterTrialSchema,publicPortraitCommandSchema} from '../../../common/publicCharacters';
import {runPublicCharacterTrial,type PublicCharacterExecutionDependencies} from '../../application/publicCharacters';
import {getPublicCharacterWorkspace,getPublicCharacterTrialByKey,getPublicCharacterTrial,completePublicCharacterTrial,endExpiredPublicCharacterTrial,getPublicPortraitImage,executePublicPortraitCommand,getPublicPortraitReceipt,PublicCharacterError} from '../../database/publicCharacters';
const uuid=z.string().uuid();
export function publicCharactersRouter(dependencies:PublicCharacterExecutionDependencies={}):Router{
 const router=Router();
 const run=(req:Request,res:Response,next:NextFunction,work:()=>Promise<unknown>)=>{void Promise.resolve().then(work).then(data=>res.json({success:true,data})).catch(error=>next(error instanceof PublicCharacterError?error:new PublicCharacterError(error instanceof z.ZodError?'公共角色选择或填写不完整；原填写保留。':'公共角色结果未读取，保留原请求只读核对。',error instanceof z.ZodError?422:503,error instanceof z.ZodError&&req.method==='POST'?'not_written':'unknown')));};
 router.get('/workspace',(req,res,next)=>run(req,res,next,()=>{const query=z.object({resource:uuid.optional(),version:uuid.optional()}).strict().parse(req.query);return getPublicCharacterWorkspace(query.resource,query.version);}));
 router.post('/trials',(req,res,next)=>run(req,res,next,()=>runPublicCharacterTrial(publicCharacterTrialSchema.parse(req.body),dependencies)));
 router.get('/trials/by-key/:key',(req,res,next)=>run(req,res,next,()=>getPublicCharacterTrialByKey(uuid.parse(String(req.params.key)))));
 router.get('/trials/:id',(req,res,next)=>run(req,res,next,()=>getPublicCharacterTrial(uuid.parse(String(req.params.id)))));
 router.post('/trials/:id/complete',(req,res,next)=>run(req,res,next,()=>{z.object({}).strict().parse(req.body);return completePublicCharacterTrial(uuid.parse(String(req.params.id)));}));
 router.post('/trials/:id/end-expired',(req,res,next)=>run(req,res,next,()=>{z.object({}).strict().parse(req.body);return endExpiredPublicCharacterTrial(uuid.parse(String(req.params.id)));}));
 router.post('/portraits/commands',(req,res,next)=>run(req,res,next,()=>executePublicPortraitCommand(publicPortraitCommandSchema.parse(req.body))));
 router.get('/portraits/commands/by-key/:key',(req,res,next)=>run(req,res,next,()=>getPublicPortraitReceipt(uuid.parse(String(req.params.key)))));
 router.get('/portraits/:id/image',(req,res,next)=>{void Promise.resolve().then(()=>getPublicPortraitImage(uuid.parse(String(req.params.id)))).then(image=>{res.set('Content-Type',image.mimeType);res.set('Cache-Control','private, no-cache');res.set('ETag',`"${image.checksum}"`);res.send(image.bytes);}).catch(error=>next(error instanceof PublicCharacterError?error:new PublicCharacterError('原公共角色图片未读取，历史与引用保留。')));});
 return router;
}

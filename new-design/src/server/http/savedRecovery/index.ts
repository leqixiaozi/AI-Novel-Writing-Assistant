import {Router} from 'express';
import {z} from 'zod';
import {recoveryTargetSchema} from '../../../common/savedRecovery';
import {getSavedRecoveryWorkspace,inspectSavedRecovery,recoverSavedSources} from '../../database/savedRecovery';
export function savedRecoveryRouter(){const router=Router();router.get('/',(req,res,next)=>{void Promise.resolve().then(()=>{const query=z.object({bookId:z.string().uuid().optional()}).strict().parse(req.query);return getSavedRecoveryWorkspace(query.bookId);}).then(data=>res.json({success:true,data})).catch(next);});router.get('/inspect',(req,res,next)=>{void Promise.resolve().then(()=>inspectSavedRecovery(recoveryTargetSchema.parse({...req.query,bookId:req.query.bookId??null}))).then(data=>res.json({success:true,data})).catch(next);});router.post('/complete-saved',(req,res,next)=>{void recoverSavedSources(req.body).then(data=>res.json({success:true,data})).catch(next);});return router;}

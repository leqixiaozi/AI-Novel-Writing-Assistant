import {Router} from 'express';
import {z} from 'zod';
import {characterImportInputSchema,characterImportCommitSchema} from '../../../common/characterImport';
import {getCharacterImportCatalog,getCharacterImportWorkspace,previewCharacterImport,importPublicCharacter,readCharacterImportOriginal,CharacterImportError} from '../../database/characterImport';
import {AiExecutionError} from '../../ai';
const uuid=z.string().uuid();
function failure(error:unknown,next:(error:unknown)=>void){if(error instanceof CharacterImportError||error instanceof z.ZodError){const problem=new AiExecutionError('核对公共角色导入',error instanceof CharacterImportError?error.message:'请明确公共版本、书内填写和完整字段映射。',error instanceof CharacterImportError?error.status:422,null,error instanceof CharacterImportError?error.issues:undefined);problem.recovery.mutationOutcome=error instanceof CharacterImportError?error.mutationOutcome:'not_written';problem.recovery.savedResult="原公共角色、书内资料与本次字段映射保留；只读核对原导入请求，不按重名合并。";problem.recovery.sourceRoute="/new-design/resources/characters";problem.recovery.actionLabel="返回公共角色导入";next(problem);}else next(error);}
/** These routes only read, including the full-command POST used to recover an
 * original receipt after the source or destination was archived. */
export function characterImportReadRouter(){const router=Router();
 router.get('/public-characters',(req,res,next)=>{void Promise.resolve().then(()=>{z.object({}).strict().parse(req.query);return getCharacterImportCatalog();}).then(data=>res.json({success:true,data})).catch(next);});
 router.get('/books/:bookId/character-import/workspace',(req,res,next)=>{void Promise.resolve().then(()=>{const query=z.object({resourceId:uuid,resourceVersionId:uuid}).strict().parse(req.query);return getCharacterImportWorkspace(uuid.parse(req.params.bookId),query.resourceId,query.resourceVersionId);}).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/books/:bookId/character-import/preview',(req,res,next)=>{void Promise.resolve().then(()=>previewCharacterImport(uuid.parse(req.params.bookId),characterImportInputSchema.parse(req.body))).then(data=>res.json({success:true,data})).catch(next);});
 router.post('/books/:bookId/character-import/original-receipt',(req,res,next)=>{void Promise.resolve().then(()=>readCharacterImportOriginal(uuid.parse(req.params.bookId),characterImportCommitSchema.parse(req.body))).then(data=>res.json({success:true,data})).catch(error=>failure(error,next));});
 return router;
}
export function characterImportWriteRouter(){const router=Router();router.post('/books/:bookId/character-import',(req,res,next)=>{void Promise.resolve().then(()=>importPublicCharacter(uuid.parse(req.params.bookId),characterImportCommitSchema.parse(req.body))).then(data=>res.json({success:true,data})).catch(error=>failure(error,next));});return router;}

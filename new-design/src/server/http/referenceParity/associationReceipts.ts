import {Router} from 'express';
import {z} from 'zod';
import {associationAddSchema,associationCreateAndAddSchema,associationRemoveSchema,associationRefreshSchema,associationReorderSchema,associationLocalValuesSchema,associationLocalFieldSchema} from '../../domain/validation';
import {readAssociationWriteReceipt} from '../../database/associations';
import {authorMaterialWriteSchema,readAuthorMaterialWriteReceipt} from '../../database/authorMaterials';
import {formHash} from '../../database/formAssist';
import {NewDesignError} from '../../domain/errors';
export function associationReceiptsRouter(){
 const router=Router();
 router.post('/books/:bookId/association-source-receipt',async(req,res,next)=>{try{
  const bookId=z.string().uuid().parse(req.params.bookId),command=z.object({cardId:z.string().uuid(),input:authorMaterialWriteSchema}).strict().parse(req.body);
  const receipt=await readAuthorMaterialWriteReceipt(bookId,command.input.requestKey);
  if(receipt&&(receipt.operation!=='update'||receipt.inputHash!==formHash({bookId,cardId:command.cardId,operation:'update',input:command.input})))throw new NewDesignError('原来源保存回执与完整输入不同，原凭证保留。',409);
  res.json({success:true,data:receipt});
 }catch(error){next(error);}});
 const schemas={add_existing:associationAddSchema,create_and_add:associationCreateAndAddSchema,remove:associationRemoveSchema,restore:associationRemoveSchema,refresh_source:associationRefreshSchema,reorder:associationReorderSchema,save_local:associationLocalValuesSchema,add_local_field:associationLocalFieldSchema};
 router.post('/books/:bookId/association-receipt',async(req,res,next)=>{try{
  const bookId=z.string().uuid().parse(req.params.bookId),command=z.object({operation:z.enum(['add_existing','create_and_add','remove','restore','refresh_source','reorder','save_local','add_local_field']),targetId:z.string().uuid(),input:z.unknown()}).strict().parse(req.body);
  const input=schemas[command.operation].parse(command.input);
  res.json({success:true,data:await readAssociationWriteReceipt(bookId,command.targetId,command.operation,input)});
 }catch(error){next(error);}});
 return router;
}

import type {PoolClient} from 'pg';
import type {ResourceLedgerSelection} from '../../../../common/characterResources';
import type {ResourceFocusSnapshot,ResourceFocusPreview} from '../../../../common/characterResources/focus';
import {resourceFocusSelectionSchema,resourceFocusEvidenceText,resourceFocusSchemaFor} from '../../../../common/characterResources/focus';
import {formAiFieldVisible} from '../../../../common/formAssist';
import {readProfessionalObjectsInTransaction} from '../../worldCharacterMaintenance';
import {formHash} from '../../formAssist';
import {assertFound,NewDesignError} from '../../../domain/errors';
import {getNewDesignPool} from '../../runtime';
import {readCharacterResourcesInTransaction} from '..';
import {z} from 'zod';
import {readCharacterResourceHistoryInTransaction} from '../history';

export async function freezeResourceFocusSources(db:PoolClient,bookId:string,characterId:string,selection:ResourceLedgerSelection,includeHistory=false):Promise<ResourceFocusPreview>{
 const ledger=await readCharacterResourcesInTransaction(db,bookId,characterId,selection);
 if(ledger.truncated)throw new NewDesignError('人物资源来源超过完整核对范围，未调用AI或自动省略资源。',422);
 const book=assertFound((await db.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],'本书不可用。');
 const result=await readProfessionalObjectsInTransaction(db,String(book.space_id),characterId,[characterId,...ledger.items.map(item=>item.resourceId)]);
 if(result.truncated)throw new NewDesignError('原档案来源未完整读取，未准备资源显示建议。',422);
 const objects=result.objects.map(object=>{
  const fields=object.fields.filter(item=>!item.field.hidden&&formAiFieldVisible(item.field,object.values));
  return{...object,fields,values:Object.fromEntries(fields.filter(item=>Object.hasOwn(object.values,item.field.key)).map(item=>[item.field.key,object.values[item.field.key]]))};
 });
 const evidenceSources=objects.flatMap(object=>object.fields.flatMap(item=>{const text=resourceFocusEvidenceText(object.values[item.field.key]);return text&&object.versionId?[{cardId:object.id,versionId:object.versionId,fieldKey:item.field.key,text}]:[];}));
 const history=includeHistory?await readCharacterResourceHistoryInTransaction(db,bookId,characterId,selection):undefined;
 if(history?.truncated)throw new NewDesignError('原确认历史超出完整判断范围，未调用AI或静默省略。',422);
 const snapshot:ResourceFocusSnapshot={contract:includeHistory?'character_resource_focus_v2':'character_resource_focus_v1',bookId,characterId,selection,ledger,objects,evidenceSources,...(history?{history}:{})};
 resourceFocusSchemaFor({snapshot,instruction:''});
 return{snapshot,sourceHash:formHash(snapshot)};
}
export async function previewResourceFocus(bookId:string,characterId:string,selection:ResourceLedgerSelection,includeHistory=false):Promise<ResourceFocusPreview>{
 z.string().uuid().parse(bookId);z.string().uuid().parse(characterId);const parsed=resourceFocusSelectionSchema.parse(selection),db=await(await getNewDesignPool()).connect();
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const preview=await freezeResourceFocusSources(db,bookId,characterId,parsed,includeHistory);await db.query('COMMIT');return preview;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

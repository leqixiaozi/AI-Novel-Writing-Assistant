import type {BookAssembly} from '../../../common/cardAssembly';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {findRecordCard} from '../recordCards';

export async function listBookTemplateImpact(templateId:string,targetVersionId:string){
  const db=await getNewDesignPool();
  const target=await findRecordCard(db,targetVersionId,'template_group_version');
  if(!target||String(target.template_id)!==templateId)throw new NewDesignError('目标发布版本不属于这份书籍模板。',404);
  const to=(target.payload as {assembly?:BookAssembly}).assembly;
  if(!to)throw new NewDesignError('目标版本不是书籍装配模板。',422);
  const result=await db.query('SELECT id,name,template_version_id,installed_payload FROM new_design.books WHERE template_id=$1 AND status=$2 ORDER BY name,id',[templateId,'active']);
  return result.rows.filter(row=>String(row.template_version_id)!==targetVersionId).map(row=>{
    const from=(row.installed_payload as {assembly?:BookAssembly}).assembly;
    return{
      bookId:String(row.id),bookName:String(row.name),fromTemplateVersionId:String(row.template_version_id),toTemplateVersionId:targetVersionId,
      rootChanged:from?.root.metaVersionId!==to.root.metaVersionId,
      modulesChanged:JSON.stringify(from?.modules??[])!==JSON.stringify(to.modules),
      standaloneChanged:JSON.stringify(from?.standalone??[])!==JSON.stringify(to.standalone),
      relationsChanged:JSON.stringify(from?.edges??[])!==JSON.stringify(to.edges),
      syncStatus:'awaiting_confirmation' as const,
    };
  });
}

import type {Pool,PoolClient} from "pg";
import {assertFound,NewDesignError} from "../../domain/errors";
import {findRecordCard,listRecordCards} from "../recordCards";
type Queryable=Pick<Pool,'query'>|Pick<PoolClient,'query'>;
/** An explicit book choice may pin a historical immutable private version. */
export async function resolveBookFormVersion(queryable:Queryable,spaceId:string,typeKey:string){
  const book=(await queryable.query("SELECT installed_payload->'activeForms'->>$2 selected FROM new_design.books WHERE space_id=$1",[spaceId,typeKey])).rows[0],selected=book?.selected;
  if(selected){
    const version=await findRecordCard(queryable,String(selected),'card_group_form_version',{includeArchived:true});
    const form=version?await findRecordCard(queryable,String(version.form_id),'card_group_form',{spaceId,includeArchived:true}):null;
    return assertFound(version&&form&&form.status==='published'&&version.definition?.primaryTypeKey===typeKey?{id:version.id,form_id:version.form_id}:null,'本书所选表单版本不可用，请明确选择已发布表单。');
  }
  const forms=(await listRecordCards(queryable,'card_group_form',{spaceId})).filter(form=>form.status==='published');
  const versions=await listRecordCards(queryable,'card_group_form_version');
  const rows=forms.flatMap(form=>versions.filter(version=>String(version.id)===String(form.current_version_id)&&version.definition?.primaryTypeKey===typeKey).map(version=>({id:version.id,form_id:form.id})));
  if(rows.length>1)throw new NewDesignError('本书有多份同类创作表单，请先明确选择要使用的版本。',422);
  return rows[0]??null;
}

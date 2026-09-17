import type {Pool,PoolClient} from "pg";
import {assertFound,NewDesignError} from "../../domain/errors";
type Queryable=Pick<Pool,'query'>|Pick<PoolClient,'query'>;
/** An explicit book choice may pin a historical immutable private version. */
export async function resolveBookFormVersion(queryable:Queryable,spaceId:string,typeKey:string){
  const book=(await queryable.query("SELECT installed_payload->'activeForms'->>$2 selected FROM new_design.books WHERE space_id=$1",[spaceId,typeKey])).rows[0],selected=book?.selected;
  if(selected){const row=(await queryable.query("SELECT version.id,version.form_id FROM new_design.card_group_form_versions version JOIN new_design.card_group_forms form ON form.id=version.form_id WHERE version.id=$1 AND form.space_id=$2 AND form.status='published' AND version.definition->>'primaryTypeKey'=$3",[selected,spaceId,typeKey])).rows[0];return assertFound(row,'本书所选表单版本不可用，请明确选择已发布表单。');}
  const rows=(await queryable.query("SELECT version.id,version.form_id FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id=$1 AND form.status='published' AND version.definition->>'primaryTypeKey'=$2",[spaceId,typeKey])).rows;
  if(rows.length>1)throw new NewDesignError('本书有多份同类创作表单，请先明确选择要使用的版本。',422);
  return rows[0]??null;
}

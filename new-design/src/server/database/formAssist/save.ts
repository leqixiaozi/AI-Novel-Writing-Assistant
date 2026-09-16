import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FormAssistSnapshot } from "../../../common/formAssist";
import { validateTreeSelection } from "../../../common/treePolicy";
import { NewDesignError } from "../../domain/errors";
import { formHash, freezeFormContext } from "./context";

export interface FormAiSaveExtras {aiDraftDecisionIds?:string[];tagIds?:string[];}
export async function verifyFormAiSave(db:PoolClient,input:{cardId:string;spaceId:string;cardTypeId:string;revision:number|null;typeVersionId:string;formVersionId:string|null;values:Record<string,unknown>}&FormAiSaveExtras):Promise<Record<string,any>[]> {
  const ids=input.aiDraftDecisionIds??[];
  if(new Set(ids).size!==ids.length)throw new NewDesignError("AI 来源不能重复。",422);
  const records:Record<string,any>[]=[];
  for(const id of ids){const row=(await db.query(`SELECT decision.*,batch.book_id,batch.card_id,batch.input_payload,batch.output_payload,book.space_id
    FROM new_design.form_ai_draft_decisions decision JOIN new_design.ai_generation_batches batch ON batch.id=decision.batch_id
    JOIN new_design.books book ON book.id=batch.book_id WHERE decision.id=$1 AND decision.decision='adopt' FOR UPDATE OF decision`,[id])).rows[0];
    if(!row||row.space_id!==input.spaceId)throw new NewDesignError("AI 来源不属于本书的确认草稿。",422);
    const snapshot=row.input_payload.snapshot as FormAssistSnapshot,target=snapshot.target;
    if(target.cardTypeId!==input.cardTypeId||target.typeVersionId!==input.typeVersionId||target.formVersionId!==input.formVersionId||target.cardId!== (input.revision===null?null:input.cardId)||target.cardRevision!==input.revision)throw new NewDesignError("AI 来源与这份资料的规格或修订不一致，请复核后重新生成。",409);
    if((await db.query("SELECT 1 FROM new_design.card_version_ai_draft_sources WHERE decision_id=$1",[id])).rows.length)throw new NewDesignError("这份 AI 来源已保存，请重新读取资料。",409);
    const current=await freezeFormContext(db,target,snapshot.values,snapshot.tagIds,snapshot.referenceCardIds??[]);
    if(current.sourceHash!==row.source_hash)throw new NewDesignError("AI 来源已过期，请复核后重新生成；本地草稿会保留。",409);
    records.push(row);
  }
  return records;
}
export async function recordFormAiSave(db:PoolClient,cardId:string,versionId:string,values:Record<string,unknown>,records:Record<string,any>[]):Promise<void>{
  for(const [key,value] of Object.entries(values))await db.query(`UPDATE new_design.card_field_origins SET current_value=$3::jsonb,
    confirmation_status=CASE WHEN current_value IS DISTINCT FROM $3::jsonb THEN 'user_content' ELSE confirmation_status END,updated_at=now() WHERE card_id=$1 AND field_key=$2`,[cardId,key,JSON.stringify(value??null)]);
  for(const row of records){await db.query("INSERT INTO new_design.card_version_ai_draft_sources(card_version_id,decision_id) VALUES($1,$2)",[versionId,row.id]);
    const candidate=row.output_payload.candidates.find((item:any)=>item.id===row.candidate_id);
    if(!candidate)throw new NewDesignError("AI 候选来源不完整，未保存资料。",409);
    for(const key of row.selected_field_keys){const original=candidate.values[key],current=key==="__title"?(await db.query("SELECT title FROM new_design.cards WHERE id=$1",[cardId])).rows[0]?.title:values[key],status=formHash(original??null)===formHash(current??null)?"confirmed":"user_content";
      await db.query(`INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,generation_batch_id,confirmation_status,original_value,current_value)
        VALUES($1,$2,$3,'ai',$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(card_id,field_key) DO UPDATE SET source_kind='ai',source_id=NULL,generation_batch_id=EXCLUDED.generation_batch_id,
        confirmation_status=EXCLUDED.confirmation_status,original_value=EXCLUDED.original_value,current_value=EXCLUDED.current_value,updated_at=now()`,[randomUUID(),cardId,key,row.batch_id,status,JSON.stringify(original??null),JSON.stringify(current??null)]);
    }
    await db.query("UPDATE new_design.ai_generation_batches SET status=CASE WHEN status='discarded' THEN status ELSE 'applied' END,revision=revision+1,updated_at=now() WHERE id=$1",[row.batch_id]);
  }
}
export async function saveFormDraftTags(db:PoolClient,cardId:string,versionId:string,spaceId:string,cardTypeId:string,tagIds:string[]):Promise<void>{
  if(new Set(tagIds).size!==tagIds.length)throw new NewDesignError("标签不能重复。",422);
  const selected=(await db.query("SELECT * FROM new_design.material_tags WHERE id=ANY($1::uuid[]) AND space_id=$2 AND status='active' FOR SHARE",[tagIds,spaceId])).rows;
  if(selected.length!==tagIds.length)throw new NewDesignError("标签已停用或不属于本书。",422);
  const bindings=(await db.query("SELECT dimension_id,config FROM new_design.card_type_tag_bindings WHERE card_type_id=$1 AND status='active'",[cardTypeId])).rows;
  for(const binding of bindings){const nodes=(await db.query("SELECT id,parent_id,status FROM new_design.material_tags WHERE dimension_id=$1",[binding.dimension_id])).rows.map(row=>({id:row.id,parentId:row.parent_id,status:row.status}));
    const ids=selected.filter(row=>row.dimension_id===binding.dimension_id).map(row=>row.id),checked=validateTreeSelection(nodes,binding.config.rule,ids);
    if(!checked.valid)throw new NewDesignError(`分类标签选择无效：${checked.message}`,422);
  }
  const previous=(await db.query("SELECT * FROM new_design.material_tag_memberships WHERE card_id=$1 AND status='active' FOR UPDATE",[cardId])).rows;
  const changes=[...selected.filter(tag=>!previous.some(row=>row.tag_id===tag.id)).map(tag=>({tag,status:"active"})),...previous.filter(row=>!tagIds.includes(row.tag_id)).map(row=>({tag:{id:row.tag_id},status:"ended"}))];
  for(const change of changes){const tag=(await db.query("SELECT current_version_id FROM new_design.material_tags WHERE id=$1",[change.tag.id])).rows[0],existing=(await db.query("SELECT * FROM new_design.material_tag_memberships WHERE tag_id=$1 AND card_id=$2 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",[change.tag.id,cardId])).rows[0];
    const membershipId=existing?.id??randomUUID(),revision=existing?Number(existing.revision)+1:1,membershipVersionId=randomUUID();
    if(existing)await db.query("UPDATE new_design.material_tag_memberships SET status=$2,revision=$3,current_version_id=NULL,updated_at=now() WHERE id=$1",[membershipId,change.status,revision]);
    else await db.query("INSERT INTO new_design.material_tag_memberships(id,space_id,tag_id,card_id,status,revision) VALUES($1,$2,$3,$4,$5,$6)",[membershipId,spaceId,change.tag.id,cardId,change.status,revision]);
    await db.query("INSERT INTO new_design.material_tag_membership_versions(id,membership_id,revision,tag_version_id,card_version_id,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'user')",[membershipVersionId,membershipId,revision,tag.current_version_id,versionId,change.status]);
    await db.query("UPDATE new_design.material_tag_memberships SET current_version_id=$2 WHERE id=$1",[membershipId,membershipVersionId]);
  }
}

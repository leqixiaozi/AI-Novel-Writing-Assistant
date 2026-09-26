import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FormAssistSnapshot } from "../../../common/formAssist";
import { validateTreeSelection } from "../../../common/treePolicy";
import { NewDesignError,assertFound } from "../../domain/errors";
import { formHash, freezeFormContext } from "./context";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from '../recordCards';

export interface FormAiSaveExtras {aiDraftDecisionIds?:string[];tagIds?:string[];}
export async function verifyFormAiSave(db:PoolClient,input:{cardId:string;spaceId:string;cardTypeId:string;revision:number|null;typeVersionId:string;formVersionId:string|null;values:Record<string,unknown>}&FormAiSaveExtras):Promise<Record<string,any>[]> {
  const ids=input.aiDraftDecisionIds??[];
  if(new Set(ids).size!==ids.length)throw new NewDesignError("AI 来源不能重复。",422);
  const records:Record<string,any>[]=[];
  for(const id of ids){
    const decision=await findRecordCard(db,id,'form_ai_draft_decision',{lock:true});
    const batch=decision?await findRecordCard(db,String(decision.batch_id),'ai_generation_batch'):null;
    const book=batch?(await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[batch.book_id])).rows[0]:null;
    const row=decision?.decision==='adopt'&&batch&&book?{...decision,candidate_id:String(decision.candidate_id),source_hash:String(decision.source_hash),book_id:batch.book_id,card_id:batch.card_id,input_payload:batch.input_payload,output_payload:batch.output_payload,space_id:book.space_id}:null;
    if(!row||row.space_id!==input.spaceId)throw new NewDesignError("AI 来源不属于本书的确认草稿。",422);
    const story=row.input_payload.contract==="story_workspace_ai_v1",slot=story?row.input_payload.snapshot.slots.find((slot:any)=>slot.id===row.candidate_id):null;
    if(story&&(!slot?.target||!["visible_prepare","visible_adjust"].includes(row.input_payload.snapshot.mode)))throw new NewDesignError("外显采用来源不完整。",409);
    const snapshot:Pick<FormAssistSnapshot,"target"|"values"|"tagIds"|"referenceCardIds"|"referenceKnowledgeSources">=story?{target:slot.target,values:slot.values,tagIds:[]}:row.input_payload.snapshot,target=snapshot.target;
    if(target.cardTypeId!==input.cardTypeId||target.typeVersionId!==input.typeVersionId||target.formVersionId!==input.formVersionId||target.cardId!== (input.revision===null?null:input.cardId)||target.cardRevision!==input.revision)throw new NewDesignError("AI 来源与这份资料的规格或修订不一致，请复核后重新生成。",409);
    if((await listRecordCards(db,'card_version_ai_draft_source',{where:{decision_id:id}})).length)throw new NewDesignError("这份 AI 来源已保存，请重新读取资料。",409);
    const current=await freezeFormContext(db,target,snapshot.values,snapshot.tagIds,snapshot.referenceCardIds??[],snapshot.referenceKnowledgeSources??[]);
    if(current.sourceHash!==row.source_hash)throw new NewDesignError("AI 来源已过期，请复核后重新生成；本地草稿会保留。",409);
    records.push(row);
  }
  return records;
}
export async function recordFormAiSave(db:PoolClient,cardId:string,versionId:string,values:Record<string,unknown>,records:Record<string,any>[]):Promise<void>{
  const card=assertFound((await db.query('SELECT space_id,title FROM new_design.cards WHERE id=$1',[cardId])).rows[0],'资料不存在。');
  const origins=await listRecordCards(db,'card_field_origin',{where:{card_id:cardId},lock:true}),now=new Date().toISOString();
  for(const [key,value] of Object.entries(values)){
    const prior=origins.find(row=>row.field_key===key);if(!prior)continue;
    const saved=await replaceRecordCard(db,{id:prior.id,spaceId:prior.recordSpaceId,typeKey:'card_field_origin',values:{...prior,current_value:value??null,confirmation_status:formHash(prior.current_value??null)!==formHash(value??null)?'user_content':prior.confirmation_status,updated_at:now}});
    origins[origins.indexOf(prior)]=saved;
  }
  for(const row of records){
    const sourceId=randomUUID();
    await createRecordCard(db,{id:sourceId,spaceId:String(card.space_id),typeKey:'card_version_ai_draft_source',title:'AI 草稿来源',values:{id:sourceId,card_version_id:versionId,decision_id:row.id}});
    const candidate=row.input_payload.contract==="story_workspace_ai_v1"?{values:row.output_payload.result?.candidates?.[row.candidate_id]}:row.output_payload.candidates.find((item:any)=>item.id===row.candidate_id);
    if(!candidate?.values)throw new NewDesignError("AI 候选来源不完整，未保存资料。",409);
    for(const key of row.selected_field_keys){
      const original=candidate.values[key],current=key==="__title"?card.title:values[key],status=formHash(original??null)===formHash(current??null)?'confirmed':'user_content';
      const prior=origins.find(origin=>origin.field_key===key),id=prior?.id??randomUUID();
      const fields={id,card_id:cardId,field_key:key,source_kind:'ai',source_id:null,generation_batch_id:row.batch_id,confirmation_status:status,original_value:original??null,current_value:current??null,updated_at:now};
      const saved=prior?await replaceRecordCard(db,{id,spaceId:prior.recordSpaceId,typeKey:'card_field_origin',values:{...prior,...fields}})
        :await createRecordCard(db,{id,spaceId:String(card.space_id),typeKey:'card_field_origin',title:key,values:{...fields,created_at:now}});
      if(prior)origins[origins.indexOf(prior)]=saved;else origins.push(saved);
    }
    const batch=assertFound(await findRecordCard(db,String(row.batch_id),'ai_generation_batch',{lock:true}),"AI 批次不存在。");
    await replaceRecordCard(db,{id:batch.id,spaceId:batch.recordSpaceId,typeKey:'ai_generation_batch',values:{...batch,status:batch.status==='discarded'?'discarded':'applied',revision:batch.revision+1,updated_at:now}});
  }
}
export async function saveFormDraftTags(db:PoolClient,cardId:string,versionId:string,spaceId:string,cardTypeId:string,tagIds:string[]):Promise<void>{
  if(new Set(tagIds).size!==tagIds.length)throw new NewDesignError("标签不能重复。",422);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`material-space:${spaceId}`]);
  const tags=await listRecordCards(db,'material_tag',{spaceId,includeArchived:true}),selected=tags.filter(row=>tagIds.includes(row.id)&&row.status==='active');
  if(selected.length!==tagIds.length)throw new NewDesignError("标签已停用或不属于本书。",422);
  const bindings=await listRecordCards(db,'card_type_tag_binding',{where:{card_type_id:cardTypeId,status:'active'}});
  for(const binding of bindings){
    const nodes=tags.filter(row=>row.dimension_id===binding.dimension_id).map(row=>({id:row.id,parentId:row.parent_id as string|null,status:row.status as 'active'|'archived'}));
    const ids=selected.filter(row=>row.dimension_id===binding.dimension_id).map(row=>row.id),checked=validateTreeSelection(nodes,binding.config.rule,ids);
    if(!checked.valid)throw new NewDesignError(`分类标签选择无效：${checked.message}`,422);
  }
  const memberships=await listRecordCards(db,'material_tag_membership',{where:{card_id:cardId},includeArchived:true,lock:true}),previous=memberships.filter(row=>row.status==='active');
  const changes=[...selected.filter(tag=>!previous.some(row=>row.tag_id===tag.id)).map(tag=>({tagId:tag.id,status:'active'})),...previous.filter(row=>!tagIds.includes(String(row.tag_id))).map(row=>({tagId:String(row.tag_id),status:'ended'}))];
  for(const change of changes){
    const tag=assertFound(tags.find(row=>row.id===change.tagId),'原标签不存在，未改写引用历史。');
    const existing=memberships.filter(row=>row.tag_id===change.tagId).sort((a,b)=>new Date(String(b.updated_at)).getTime()-new Date(String(a.updated_at)).getTime())[0];
    const id=existing?.id??randomUUID(),revision=existing?existing.revision+1:1,membershipVersionId=randomUUID(),now=new Date().toISOString();
    const values={...(existing??{}),id,space_id:spaceId,tag_id:change.tagId,card_id:cardId,status:change.status,revision,current_version_id:membershipVersionId,updated_at:now};
    if(existing)await replaceRecordCard(db,{id,spaceId:existing.recordSpaceId,typeKey:'material_tag_membership',values});
    else await createRecordCard(db,{id,spaceId,typeKey:'material_tag_membership',title:'资料标签',values:{...values,created_at:now,created_by:'user',updated_by:'user'}});
    await createRecordCard(db,{id:membershipVersionId,spaceId,typeKey:'material_tag_membership_version',title:'资料标签历史',values:{id:membershipVersionId,membership_id:id,revision,tag_version_id:tag.current_version_id,card_version_id:versionId,status:change.status,created_by:'user',created_at:now}});
  }
}

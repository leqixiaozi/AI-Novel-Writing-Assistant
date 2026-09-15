import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ContextManifest, ContextManifestEntry, ContextManifestExclusion, ContextManifestSlot, ContextSourceType } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { asDate, asText, stableHash } from "./integrity";

export type ContextEntryInput = Omit<ContextManifestEntry,"id"|"slotId"|"sourceSpaceId"|"contentHash">;
export type ContextExclusionInput = Omit<ContextManifestExclusion,"id"|"slotId">;
export interface ContextSlotInput {slotKey:string;tokenBudget?:number|null;entries:ContextEntryInput[];exclusions:ContextExclusionInput[];}
export interface ContextManifestInput {bookId:string;taskContractVersionId:string;nodeKey?:string|null;slots:ContextSlotInput[];createdBy?:string;}

type ResolvedReference={stableObjectId:string;exactVersionId:string|null;sourceSpaceId:string|null;contentHash:string;contentType:string};

function mapEntry(row:Record<string,unknown>):ContextManifestEntry{return{id:String(row.id),slotId:String(row.slot_id),sourceType:row.source_type as ContextSourceType,stableObjectId:String(row.stable_object_id),exactVersionId:asText(row.exact_version_id),sourceSpaceId:asText(row.source_space_id),contentHash:String(row.content_hash),inclusionReason:String(row.inclusion_reason),priority:Number(row.priority),tokenEstimate:Number(row.token_estimate),transformStatus:row.transform_status as ContextManifestEntry["transformStatus"],sortOrder:Number(row.sort_order)};}
function mapExclusion(row:Record<string,unknown>):ContextManifestExclusion{return{id:String(row.id),slotId:String(row.slot_id),sourceType:String(row.source_type),stableObjectId:asText(row.stable_object_id),exactVersionId:asText(row.exact_version_id),reasonCode:row.reason_code as ContextManifestExclusion["reasonCode"],reasonDetail:String(row.reason_detail),priority:row.priority===null?null:Number(row.priority),tokenEstimate:row.token_estimate===null?null:Number(row.token_estimate),sortOrder:Number(row.sort_order)};}

async function resolveReference(client:PoolClient,bookId:string,input:ContextEntryInput):Promise<ResolvedReference>{
  const exact=input.exactVersionId??null;
  let row:Record<string,unknown>|undefined;
  switch(input.sourceType){
    case "card_version":
    case "prompt_component": {
      row=(await client.query(`SELECT card.id AS stable_id,version.id AS exact_id,card.space_id,version.revision,version.type_version_id,version.title,version.values,type.type_key
        FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id JOIN new_design.card_types type ON type.id=card.card_type_id
        WHERE card.id=$1 AND version.id=$2 AND ($3='prompt_component' OR card.space_id=(SELECT space_id FROM new_design.books WHERE id=$4))`,[input.stableObjectId,exact,input.sourceType,bookId])).rows[0];
      if(row&&input.sourceType==="prompt_component"&&String(row.type_key)!=="prompt_component")row=undefined;
      if(row){const values=row.values as Record<string,unknown>;return{stableObjectId:String(row.stable_id),exactVersionId:String(row.exact_id),sourceSpaceId:String(row.space_id),contentHash:stableHash({revision:row.revision,typeVersionId:row.type_version_id,title:row.title,values}),contentType:input.sourceType==="prompt_component"?String(values.component_type??"prompt_component"):"card_version"};}
      break;
    }
    case "card_relation":
      if(exact)break;
      row=(await client.query("SELECT relation.*,book.space_id FROM new_design.card_relations relation JOIN new_design.books book ON book.space_id=relation.space_id WHERE relation.id=$1 AND book.id=$2 AND relation.status='active'",[input.stableObjectId,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.id),exactVersionId:null,sourceSpaceId:String(row.space_id),contentHash:stableHash({relationTypeId:row.relation_type_id,sourceCardId:row.source_card_id,targetCardId:row.target_card_id,properties:row.properties,revision:row.revision}),contentType:"card_relation"};
      break;
    case "body_version":
      row=(await client.query("SELECT version.*,book.space_id FROM new_design.chapter_body_versions version JOIN new_design.chapter_documents document ON document.id=version.chapter_document_id JOIN new_design.books book ON book.id=document.book_id WHERE document.id=$1 AND version.id=$2 AND book.id=$3 AND document.adopted_version_id=version.id AND version.archived_at IS NULL",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.chapter_document_id),exactVersionId:String(row.id),sourceSpaceId:String(row.space_id),contentHash:String(row.content_hash),contentType:"body_version"};
      break;
    case "text_anchor":
      row=(await client.query("SELECT anchor.*,book.space_id FROM new_design.chapter_text_anchors anchor JOIN new_design.chapter_documents document ON document.id=anchor.chapter_document_id JOIN new_design.books book ON book.id=anchor.book_id WHERE anchor.id=$1 AND anchor.body_version_id=$2 AND book.id=$3 AND document.adopted_version_id=anchor.body_version_id AND anchor.status='active'",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.id),exactVersionId:String(row.body_version_id),sourceSpaceId:String(row.space_id),contentHash:String(row.fragment_hash),contentType:"text_anchor"};
      break;
    case "planning_version":
      row=(await client.query("SELECT version.*,book.space_id FROM new_design.planning_versions version JOIN new_design.planning_objects object ON object.id=version.object_id JOIN new_design.books book ON book.id=object.book_id WHERE object.id=$1 AND version.id=$2 AND book.id=$3 AND object.adopted_version_id=version.id AND version.stale_at IS NULL",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.object_id),exactVersionId:String(row.id),sourceSpaceId:String(row.space_id),contentHash:String(row.content_hash),contentType:"planning_version"};
      break;
    case "canonical_fact":
      row=(await client.query("SELECT fact.*,book.space_id FROM new_design.canonical_facts fact JOIN new_design.books book ON book.id=fact.book_id WHERE fact.id=$1 AND fact.id=$2 AND book.id=$3 AND fact.status='confirmed'",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.id),exactVersionId:String(row.id),sourceSpaceId:String(row.space_id),contentHash:String(row.value_hash),contentType:"canonical_fact"};
      break;
    case "state_change":
      row=(await client.query("SELECT change.*,book.space_id FROM new_design.state_changes change JOIN new_design.books book ON book.id=change.book_id WHERE change.id=$1 AND change.id=$2 AND book.id=$3 AND change.status='active'",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.id),exactVersionId:String(row.id),sourceSpaceId:String(row.space_id),contentHash:stableHash({sequence:row.sequence,subjectKind:row.subject_kind,subjectId:row.subject_id,stateKey:row.state_key,before:row.before_json,after:row.after_json,reason:row.reason}),contentType:"state_change"};
      break;
    case "story_time":
      row=(await client.query("SELECT timing.*,book.space_id FROM new_design.story_event_timings timing JOIN new_design.books book ON book.id=timing.book_id WHERE timing.id=$1 AND timing.id=$2 AND book.id=$3 AND timing.status='active'",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.id),exactVersionId:String(row.id),sourceSpaceId:String(row.space_id),contentHash:stableHash({eventCardId:row.event_card_id,lifecycle:row.lifecycle,timeMode:row.time_mode,startInstant:row.start_instant,endInstant:row.end_instant,startLabel:row.start_label,endLabel:row.end_label,normalizedStart:row.normalized_start,normalizedEnd:row.normalized_end}),contentType:"story_time"};
      break;
    case "research_version":
      row=(await client.query(`SELECT version.*,record.id AS stable_id,book.space_id FROM new_design.research_record_versions version
        JOIN new_design.research_records record ON record.id=version.record_id JOIN new_design.books book ON book.id=$3
        WHERE record.id=$1 AND version.id=$2 AND version.run_status IN ('completed','partial') AND EXISTS(
          SELECT 1 FROM new_design.book_research_references ref WHERE ref.book_id=book.id AND (ref.research_version_id=version.id OR EXISTS(
            SELECT 1 FROM new_design.research_reference_pack_items item WHERE item.pack_version_id=ref.pack_version_id AND item.research_version_id=version.id))
        )`,[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.stable_id),exactVersionId:String(row.id),sourceSpaceId:String(row.space_id),contentHash:String(row.run_hash),contentType:"research_version"};
      break;
  }
  throw new NewDesignError(`上下文来源 ${input.sourceType}:${input.stableObjectId} 的书籍、状态或确切版本无效。`,422);
}

export async function getContextManifest(id:string):Promise<ContextManifest>{
  const pool=await getNewDesignPool(),row=assertFound((await pool.query("SELECT * FROM new_design.context_manifests WHERE id=$1",[id])).rows[0],"上下文清单不存在。"),slotRows=(await pool.query("SELECT * FROM new_design.context_manifest_slots WHERE manifest_id=$1 ORDER BY sort_order,id",[id])).rows,slots:ContextManifestSlot[]=[];
  for(const slot of slotRows){const [entries,exclusions]=await Promise.all([pool.query("SELECT * FROM new_design.context_manifest_entries WHERE slot_id=$1 ORDER BY sort_order,id",[slot.id]),pool.query("SELECT * FROM new_design.context_manifest_exclusions WHERE slot_id=$1 ORDER BY sort_order,id",[slot.id])]);slots.push({id:String(slot.id),slotKey:String(slot.slot_key),sortOrder:Number(slot.sort_order),required:Boolean(slot.required),tokenBudget:slot.token_budget===null?null:Number(slot.token_budget),entries:entries.rows.map(mapEntry),exclusions:exclusions.rows.map(mapExclusion)});}
  return{id:String(row.id),bookId:String(row.book_id),taskContractVersionId:String(row.task_contract_version_id),promptRecipeVersionId:String(row.prompt_recipe_version_id),nodeKey:asText(row.node_key),status:row.status,manifestHash:String(row.manifest_hash),createdBy:String(row.created_by),slots,createdAt:asDate(row.created_at)};
}

export async function createContextManifest(input:ContextManifestInput):Promise<ContextManifest>{
  const pool=await getNewDesignPool(),client=await pool.connect(),manifestId=randomUUID();
  try{
    await client.query("BEGIN");
    assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active'",[input.bookId])).rows[0],"书籍不存在或已归档。");
    const task=assertFound((await client.query(`SELECT version.*,contract.published_version_id FROM new_design.task_contract_versions version JOIN new_design.task_contracts contract ON contract.id=version.contract_id
      WHERE version.id=$1 AND (contract.published_version_id=version.id OR EXISTS(SELECT 1 FROM new_design.ai_contract_publications publication WHERE publication.entity_kind='task_contract' AND publication.to_version_id=version.id))`,[input.taskContractVersionId])).rows[0],"任务合同版本从未发布，不能生成上下文清单。");
    const recipeSlots=(await client.query("SELECT * FROM new_design.prompt_recipe_slots WHERE recipe_version_id=$1 ORDER BY sort_order,id",[task.prompt_recipe_version_id])).rows;
    const supplied=new Map(input.slots.map((slot)=>[slot.slotKey,slot]));
    if(supplied.size!==input.slots.length)throw new NewDesignError("上下文槽位 key 重复。",422);
    for(const key of supplied.keys())if(!recipeSlots.some((slot)=>String(slot.slot_key)===key))throw new NewDesignError(`上下文包含配方未声明的槽位“${key}”。`,422);
    const normalized:Array<{definition:Record<string,unknown>;input:ContextSlotInput;entries:ResolvedReference[]}>=[];
    let invalid=false;
    for(const definition of recipeSlots){
      const slot=supplied.get(String(definition.slot_key))??{slotKey:String(definition.slot_key),entries:[],exclusions:[]};
      const resolved:ResolvedReference[]=[];
      for(const entry of slot.entries){const ref=await resolveReference(client,input.bookId,entry);const allowed=definition.allowed_content_types as string[];if(!allowed.includes(ref.contentType)&&!allowed.includes(entry.sourceType))throw new NewDesignError(`来源类型“${ref.contentType}”不能放入槽位“${slot.slotKey}”。`,422);resolved.push(ref);}
      const total=slot.entries.reduce((sum,item)=>sum+item.tokenEstimate,0);if(slot.tokenBudget!==undefined&&slot.tokenBudget!==null&&total>slot.tokenBudget)throw new NewDesignError(`槽位“${slot.slotKey}”超过 Token 预算，请显式裁剪或排除候选。`,422);
      if(Boolean(definition.required)&&resolved.length===0){if(slot.exclusions.length===0)throw new NewDesignError(`必需槽位“${slot.slotKey}”为空且未记录排除原因。`,422);invalid=true;}
      normalized.push({definition, input:slot,entries:resolved});
    }
    const manifestHash=stableHash(normalized.map((slot)=>({slotKey:slot.input.slotKey,tokenBudget:slot.input.tokenBudget??null,entries:slot.input.entries.map((entry,index)=>({...entry,...slot.entries[index]})),exclusions:slot.input.exclusions})));
    await client.query("INSERT INTO new_design.context_manifests(id,book_id,task_contract_version_id,prompt_recipe_version_id,node_key,status,manifest_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[manifestId,input.bookId,input.taskContractVersionId,task.prompt_recipe_version_id,input.nodeKey??null,invalid?"invalid":"complete",manifestHash,input.createdBy??""]);
    for(const item of normalized){const slotId=randomUUID();await client.query("INSERT INTO new_design.context_manifest_slots(id,manifest_id,slot_key,sort_order,required,token_budget) VALUES($1,$2,$3,$4,$5,$6)",[slotId,manifestId,item.input.slotKey,item.definition.sort_order,item.definition.required,item.input.tokenBudget??null]);for(let index=0;index<item.input.entries.length;index++){const entry=item.input.entries[index],ref=item.entries[index];await client.query("INSERT INTO new_design.context_manifest_entries(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,source_space_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[randomUUID(),manifestId,slotId,entry.sourceType,ref.stableObjectId,ref.exactVersionId,ref.sourceSpaceId,ref.contentHash,entry.inclusionReason,entry.priority,entry.tokenEstimate,entry.transformStatus,entry.sortOrder]);}for(const exclusion of item.input.exclusions)await client.query("INSERT INTO new_design.context_manifest_exclusions(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,reason_code,reason_detail,priority,token_estimate,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[randomUUID(),manifestId,slotId,exclusion.sourceType,exclusion.stableObjectId,exclusion.exactVersionId,exclusion.reasonCode,exclusion.reasonDetail,exclusion.priority,exclusion.tokenEstimate,exclusion.sortOrder]);}
    await client.query("COMMIT");return getContextManifest(manifestId);
  }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505")throw new NewDesignError("上下文槽位顺序、来源或排除项重复。",409);throw error;}finally{client.release();}
}

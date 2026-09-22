import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ContextManifest, ContextManifestEntry, ContextManifestExclusion, ContextManifestSlot, ContextSourceType } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { asDate, asText, stableHash } from "./integrity";
import {resolveReadyKnowledgeVersion} from "../knowledgeReference";
import {findRecordCard,listRecordCards,type RecordCardDb} from "../recordCards";
import {hasContractPublication,insertContractRecord,readRecipeSlots} from "./records";

export type ContextEntryInput = Omit<ContextManifestEntry,"id"|"slotId"|"sourceSpaceId"|"contentHash">;
export type ContextExclusionInput = Omit<ContextManifestExclusion,"id"|"slotId">;
export interface ContextSlotInput {slotKey:string;tokenBudget?:number|null;entries:ContextEntryInput[];exclusions:ContextExclusionInput[];}
export interface ContextManifestInput {bookId:string;taskContractVersionId:string;nodeKey?:string|null;slots:ContextSlotInput[];createdBy?:string;}

type ResolvedReference={stableObjectId:string;exactVersionId:string|null;sourceSpaceId:string|null;contentHash:string;contentType:string};

function mapEntry(row:Record<string,unknown>):ContextManifestEntry{return{id:String(row.id),slotId:String(row.slot_id),sourceType:row.source_type as ContextSourceType,stableObjectId:String(row.stable_object_id),exactVersionId:asText(row.exact_version_id),sourceSpaceId:asText(row.source_space_id),contentHash:String(row.content_hash),inclusionReason:String(row.inclusion_reason),priority:Number(row.priority),tokenEstimate:Number(row.token_estimate),transformStatus:row.transform_status as ContextManifestEntry["transformStatus"],sortOrder:Number(row.sort_order),bindingVersionId:asText(row.binding_version_id),previewDecisionId:asText(row.preview_decision_id),sourceRevision:row.source_revision===null||row.source_revision===undefined?null:Number(row.source_revision),contentRole:(row.content_role??null) as ContextManifestEntry["contentRole"],layerLabel:String(row.layer_label??"")};}
function mapExclusion(row:Record<string,unknown>):ContextManifestExclusion{return{id:String(row.id),slotId:String(row.slot_id),sourceType:String(row.source_type),stableObjectId:asText(row.stable_object_id),exactVersionId:asText(row.exact_version_id),reasonCode:row.reason_code as ContextManifestExclusion["reasonCode"],reasonDetail:String(row.reason_detail),priority:row.priority===null?null:Number(row.priority),tokenEstimate:row.token_estimate===null?null:Number(row.token_estimate),sortOrder:Number(row.sort_order)};}

async function resolveReference(client:PoolClient,bookId:string,input:ContextEntryInput):Promise<ResolvedReference>{
  const exact=input.exactVersionId??null;
  let row:Record<string,unknown>|undefined;
  const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1",[bookId])).rows[0],"上下文所属书籍不存在。");
  switch(input.sourceType){
    case "asset_version":
      row=await resolveReadyKnowledgeVersion(client,bookId,input.stableObjectId,exact)??undefined;
      if(row){const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1",[bookId])).rows[0],"知识来源所属书籍不存在。");return{stableObjectId:String(row.parsed_asset_id),exactVersionId:String(row.parsed_version_id),sourceSpaceId:String(book.space_id),contentHash:String(row.checksum),contentType:"asset_version"};}
      break;
    case "card_version":
    case "prompt_component": {
      row=(await client.query(`SELECT card.id AS stable_id,version.id AS exact_id,card.space_id,version.revision,version.type_version_id,version.title,version.values,type.type_key
        FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id JOIN new_design.card_types type ON type.id=card.card_type_id
        WHERE card.id=$1 AND version.id=$2 AND NOT type.is_internal AND ($3='prompt_component' OR card.space_id=(SELECT space_id FROM new_design.books WHERE id=$4))`,[input.stableObjectId,exact,input.sourceType,bookId])).rows[0];
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
      row=(await client.query("SELECT anchor.*,book.space_id FROM new_design.text_anchors anchor JOIN new_design.chapter_documents document ON document.id=anchor.chapter_document_id JOIN new_design.books book ON book.id=anchor.book_id WHERE anchor.id=$1 AND anchor.body_version_id=$2 AND book.id=$3 AND document.adopted_version_id=anchor.body_version_id AND anchor.status='active'",[input.stableObjectId,exact,bookId])).rows[0];
      if(row)return{stableObjectId:String(row.id),exactVersionId:String(row.body_version_id),sourceSpaceId:String(row.space_id),contentHash:String(row.fragment_hash),contentType:"text_anchor"};
      break;
    case "planning_version": {
      if(!exact)break;
      const object=await findRecordCard(client,input.stableObjectId,"planning_object"),version=await findRecordCard(client,exact,"planning_version");
      if(object?.book_id===bookId&&version?.object_id===object.id&&object.adopted_version_id===version.id&&!version.stale_at)
        return{stableObjectId:object.id,exactVersionId:version.id,sourceSpaceId:String(book.space_id),contentHash:String(version.content_hash),contentType:"planning_version"};
      break;
    }
    case "canonical_fact":
    case "state_change":
    case "story_time": {
      if(exact!==input.stableObjectId)break;
      const kind=input.sourceType==="story_time"?"story_event_timing":input.sourceType;
      const record=await findRecordCard(client,input.stableObjectId,kind);
      if(!record||record.book_id!==bookId||record.status!==(kind==="canonical_fact"?"confirmed":"active"))break;
      const contentHash=kind==="canonical_fact"?String(record.value_hash):kind==="state_change"
        ?stableHash({sequence:record.sequence,subjectKind:record.subject_kind,subjectId:record.subject_id,stateKey:record.state_key,before:record.before_json,after:record.after_json,reason:record.reason})
        :stableHash({eventCardId:record.event_card_id,lifecycle:record.lifecycle,timeMode:record.time_mode,startInstant:record.start_instant,endInstant:record.end_instant,startLabel:record.start_label,endLabel:record.end_label,normalizedStart:record.normalized_start,normalizedEnd:record.normalized_end});
      return{stableObjectId:record.id,exactVersionId:record.id,sourceSpaceId:String(book.space_id),contentHash,contentType:input.sourceType};
    }
    case "research_version": {
      if(!exact)break;
      const version=await findRecordCard(client,exact,"research_record_version"),record=await findRecordCard(client,input.stableObjectId,"research_record");
      if(!record||version?.record_id!==record.id||!["completed","partial"].includes(version.run_status))break;
      const references=await listRecordCards(client,"book_research_reference",{where:{book_id:bookId}});
      let included=references.some(ref=>ref.research_version_id===version.id);
      for(const ref of references){if(included)break;if(ref.pack_version_id)included=(await listRecordCards(client,"research_reference_pack_item",{where:{pack_version_id:ref.pack_version_id,research_version_id:version.id}})).length>0;}
      if(included)return{stableObjectId:record.id,exactVersionId:version.id,sourceSpaceId:String(book.space_id),contentHash:String(version.run_hash),contentType:"research_version"};
      break;
    }
  }
  throw new NewDesignError(`上下文来源 ${input.sourceType}:${input.stableObjectId} 的书籍、状态或确切版本无效。`,422);
}

export async function readManifestSlots(db:RecordCardDb,id:string){
  return(await listRecordCards(db,"context_manifest_slot",{where:{manifest_id:id}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}
export async function readManifestExclusions(db:RecordCardDb,slotId:string){
  return(await listRecordCards(db,"context_manifest_exclusion",{where:{slot_id:slotId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}

export async function getContextManifest(id:string):Promise<ContextManifest>{
  const pool=await getNewDesignPool(),row=assertFound((await pool.query("SELECT * FROM new_design.context_manifests WHERE id=$1",[id])).rows[0],"上下文清单不存在。"),slotRows=await readManifestSlots(pool,id),slots:ContextManifestSlot[]=[];
  for(const slot of slotRows){const [entries,exclusions]=await Promise.all([pool.query("SELECT * FROM new_design.context_manifest_items WHERE slot_id=$1 ORDER BY sort_order,id",[slot.id]),readManifestExclusions(pool,String(slot.id))]);slots.push({id:String(slot.id),slotKey:String(slot.slot_key),sortOrder:Number(slot.sort_order),required:Boolean(slot.required),tokenBudget:slot.token_budget===null?null:Number(slot.token_budget),entries:entries.rows.map(mapEntry),exclusions:exclusions.map(mapExclusion)});}
  const retrievalRows=(await listRecordCards(pool,"context_manifest_retrieval_trace",{where:{manifest_id:id}})).sort((a,b)=>String(a.retrieval_run_id).localeCompare(String(b.retrieval_run_id)));
  return{id:String(row.id),bookId:String(row.book_id),taskContractVersionId:String(row.task_contract_version_id),promptRecipeVersionId:String(row.prompt_recipe_version_id),nodeKey:asText(row.node_key),status:row.status,manifestHash:String(row.manifest_hash),createdBy:String(row.created_by),slots,createdAt:asDate(row.created_at),previewId:asText(row.preview_id),volumeId:asText(row.volume_id),chapterId:asText(row.chapter_id),sceneId:asText(row.scene_id),taskGroup:asText(row.task_group),modelRouteSnapshotId:asText(row.model_route_snapshot_id),sourceSetHash:asText(row.source_set_hash),decisionSummary:(row.decision_summary??{}) as Record<string,unknown>,finalizedAt:row.finalized_at?asDate(row.finalized_at):null,retrievalTraces:retrievalRows.map((trace:Record<string,unknown>)=>({retrievalRunId:String(trace.retrieval_run_id),generationId:String(trace.generation_id),profileVersionId:String(trace.profile_version_id),returnedSourceCount:Number(trace.returned_source_count),traceHash:String(trace.trace_hash)}))};
}

export async function createContextManifest(input:ContextManifestInput):Promise<ContextManifest>{
  const pool=await getNewDesignPool(),client=await pool.connect(),manifestId=randomUUID();
  try{
    await client.query("BEGIN");
    assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active'",[input.bookId])).rows[0],"书籍不存在或已归档。");
    const task=assertFound((await client.query(`SELECT version.*,contract.published_version_id FROM new_design.task_contract_versions version JOIN new_design.task_contracts contract ON contract.id=version.contract_id
      WHERE version.id=$1`,[input.taskContractVersionId])).rows[0],"任务合同版本从未发布，不能生成上下文清单。");
    if(task.published_version_id!==task.id&&!await hasContractPublication(client,"task_contract",String(task.id)))throw new NewDesignError("任务合同版本从未发布，不能生成上下文清单。",422);
    const recipeSlots=await readRecipeSlots(client,String(task.prompt_recipe_version_id));
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
    for(const item of normalized){const slotId=randomUUID();await insertContractRecord(client,"context_manifest_slot",{id:slotId,manifest_id:manifestId,slot_key:item.input.slotKey,sort_order:item.definition.sort_order,required:item.definition.required,token_budget:item.input.tokenBudget??null});for(let index=0;index<item.input.entries.length;index++){const entry=item.input.entries[index],ref=item.entries[index];await client.query("INSERT INTO new_design.context_manifest_items(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,source_space_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[randomUUID(),manifestId,slotId,entry.sourceType,ref.stableObjectId,ref.exactVersionId,ref.sourceSpaceId,ref.contentHash,entry.inclusionReason,entry.priority,entry.tokenEstimate,entry.transformStatus,entry.sortOrder]);}for(const exclusion of item.input.exclusions)await insertContractRecord(client,"context_manifest_exclusion",{id:randomUUID(),manifest_id:manifestId,slot_id:slotId,source_type:exclusion.sourceType,stable_object_id:exclusion.stableObjectId,exact_version_id:exclusion.exactVersionId,reason_code:exclusion.reasonCode,reason_detail:exclusion.reasonDetail,priority:exclusion.priority,token_estimate:exclusion.tokenEstimate,sort_order:exclusion.sortOrder});}
    await client.query("COMMIT");return getContextManifest(manifestId);
  }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505")throw new NewDesignError("上下文槽位顺序、来源或排除项重复。",409);throw error;}finally{client.release();}
}

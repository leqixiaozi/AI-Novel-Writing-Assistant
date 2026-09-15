import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { InitialCardDraft, ResearchPrefillCard, ResearchReferencePack, ResearchReferencePackItem, ResearchReferencePackVersion, ResearchReusePreview, ResearchRecordType } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { getNewDesignPool } from "./runtime";
import type { TemplatePayload } from "./templateStore";

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function asObject(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function isBlank(value:unknown):boolean{return value===null||value===undefined||value===""||(Array.isArray(value)&&value.length===0);}

function mapPackItem(row:Record<string,unknown>):ResearchReferencePackItem{return{researchVersionId:String(row.research_version_id),recordId:String(row.record_id),recordTitle:String(row.record_title),recordType:row.record_type as ResearchRecordType,recordVersion:Number(row.record_version),purpose:String(row.purpose),weight:Number(row.weight),sortOrder:Number(row.sort_order),note:String(row.item_note??"")};}

export async function listReferencePacks():Promise<ResearchReferencePack[]>{
  const pool=await getNewDesignPool();
  const packs=await pool.query("SELECT pack.*,version.version AS current_version,(SELECT count(*) FROM new_design.research_reference_pack_versions item WHERE item.pack_id=pack.id)::int AS version_count FROM new_design.research_reference_packs pack LEFT JOIN new_design.research_reference_pack_versions version ON version.id=pack.current_version_id WHERE pack.status<>'archived' ORDER BY pack.updated_at DESC");
  return Promise.all(packs.rows.map(async(row)=>getReferencePack(String(row.id))));
}

export async function getReferencePack(id:string):Promise<ResearchReferencePack>{
  const pool=await getNewDesignPool();
  const pack=assertFound((await pool.query("SELECT pack.*,current.version AS current_version,(SELECT count(*) FROM new_design.research_reference_pack_versions item WHERE item.pack_id=pack.id)::int AS version_count FROM new_design.research_reference_packs pack LEFT JOIN new_design.research_reference_pack_versions current ON current.id=pack.current_version_id WHERE pack.id=$1",[id])).rows[0],"研究参考包不存在。");
  const versionRows=await pool.query("SELECT * FROM new_design.research_reference_pack_versions WHERE pack_id=$1 ORDER BY version DESC",[id]);
  const versions:ResearchReferencePackVersion[]=[];
  for(const version of versionRows.rows){const items=await pool.query("SELECT item.*,item.note AS item_note,record.id AS record_id,record.title AS record_title,record.record_type,run.version AS record_version FROM new_design.research_reference_pack_items item JOIN new_design.research_record_versions run ON run.id=item.research_version_id JOIN new_design.research_records record ON record.id=run.record_id WHERE item.pack_version_id=$1 ORDER BY item.sort_order,item.id",[version.id]);versions.push({id:String(version.id),packId:id,version:Number(version.version),note:String(version.note??""),items:items.rows.map(mapPackItem),createdAt:asDate(version.created_at)});}
  return{id:String(pack.id),name:String(pack.name),description:String(pack.description??""),status:pack.status,currentVersionId:pack.current_version_id?String(pack.current_version_id):null,currentVersion:pack.current_version===null?null:Number(pack.current_version),versionCount:Number(pack.version_count),revision:Number(pack.revision),versions,createdAt:asDate(pack.created_at),updatedAt:asDate(pack.updated_at)};
}

export async function publishReferencePack(input:{id?:string;name:string;description:string;note:string;revision?:number;items:Array<{researchVersionId:string;purpose:string;weight:number;note:string}>}):Promise<ResearchReferencePack>{
  if(!input.items.length)throw new NewDesignError("研究参考包至少需要一条已完成记录。",422);
  const pool=await getNewDesignPool(),client=await pool.connect(),packId=input.id??randomUUID();
  try{
    await client.query("BEGIN");
    if(input.id){const pack=assertFound((await client.query("SELECT * FROM new_design.research_reference_packs WHERE id=$1 AND status<>'archived' FOR UPDATE",[packId])).rows[0],"研究参考包不存在或已归档。");if(Number(pack.revision)!==input.revision)throw new NewDesignError("研究参考包已在其他页面更新，请刷新后再发布。",409);}
    else await client.query("INSERT INTO new_design.research_reference_packs(id,name,description,status) VALUES($1,$2,$3,'draft')",[packId,input.name,input.description]);
    const selected=[...new Set(input.items.map((item)=>item.researchVersionId))];
    const valid=await client.query("SELECT id FROM new_design.research_record_versions WHERE id=ANY($1::uuid[]) AND run_status IN ('completed','partial')",[selected]);
    if(valid.rowCount!==selected.length)throw new NewDesignError("参考包只能收录已完成或部分完成的研究版本。",422);
    const next=Number((await client.query("SELECT COALESCE(max(version),0)+1 AS version FROM new_design.research_reference_pack_versions WHERE pack_id=$1",[packId])).rows[0].version),versionId=randomUUID();
    await client.query("INSERT INTO new_design.research_reference_pack_versions(id,pack_id,version,note) VALUES($1,$2,$3,$4)",[versionId,packId,next,input.note]);
    for(const [index,item] of input.items.entries())await client.query("INSERT INTO new_design.research_reference_pack_items(id,pack_version_id,research_version_id,purpose,weight,sort_order,note) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),versionId,item.researchVersionId,item.purpose,item.weight,index,item.note]);
    await client.query("UPDATE new_design.research_reference_packs SET name=$2,description=$3,status='published',current_version_id=$4,revision=revision+1,updated_at=now() WHERE id=$1",[packId,input.name,input.description,versionId]);
    await client.query("COMMIT");return getReferencePack(packId);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

interface ResolvedSource {researchVersionId:string;recordId:string;title:string;type:ResearchRecordType;version:number;report:string;structuredResult:Record<string,unknown>;purpose:string;weight:number;evidenceIds:string[];}

async function resolveSources(researchVersionIds:string[],packVersionIds:string[]):Promise<{sources:ResolvedSource[];packSnapshots:Array<Record<string,unknown>>}>{
  const pool=await getNewDesignPool(),expanded:Array<{researchVersionId:string;purpose:string;weight:number}>=researchVersionIds.map((researchVersionId)=>({researchVersionId,purpose:"book_creation",weight:1})),packSnapshots:Array<Record<string,unknown>>=[];
  if(packVersionIds.length){const packs=await pool.query("SELECT version.id,version.version,version.note,pack.id AS pack_id,pack.name FROM new_design.research_reference_pack_versions version JOIN new_design.research_reference_packs pack ON pack.id=version.pack_id WHERE version.id=ANY($1::uuid[])",[packVersionIds]);if(packs.rowCount!==new Set(packVersionIds).size)throw new NewDesignError("选择的研究参考包版本不存在。",422);for(const pack of packs.rows){const items=await pool.query("SELECT research_version_id,purpose,weight FROM new_design.research_reference_pack_items WHERE pack_version_id=$1 ORDER BY sort_order",[pack.id]);packSnapshots.push({packId:String(pack.pack_id),packVersionId:String(pack.id),name:String(pack.name),version:Number(pack.version),note:String(pack.note??"")});for(const item of items.rows)expanded.push({researchVersionId:String(item.research_version_id),purpose:String(item.purpose),weight:Number(item.weight)});}}
  const merged=new Map<string,{purpose:string;weight:number}>();for(const item of expanded){const prior=merged.get(item.researchVersionId);if(!prior||item.weight>prior.weight)merged.set(item.researchVersionId,{purpose:item.purpose,weight:item.weight});}
  if(!merged.size)return{sources:[],packSnapshots};
  const rows=await pool.query("SELECT run.*,record.id AS record_id,record.title,record.record_type FROM new_design.research_record_versions run JOIN new_design.research_records record ON record.id=run.record_id WHERE run.id=ANY($1::uuid[]) AND run.run_status IN ('completed','partial')",[[...merged.keys()]]);
  if(rows.rowCount!==merged.size)throw new NewDesignError("只能选用已完成或部分完成的研究版本。",422);
  const evidence=await pool.query("SELECT id,research_version_id FROM new_design.research_evidence WHERE research_version_id=ANY($1::uuid[])",[[...merged.keys()]]),evidenceMap=new Map<string,string[]>();for(const row of evidence.rows)evidenceMap.set(String(row.research_version_id),[...(evidenceMap.get(String(row.research_version_id))??[]),String(row.id)]);
  return{sources:rows.rows.map((row)=>({researchVersionId:String(row.id),recordId:String(row.record_id),title:String(row.title),type:row.record_type,version:Number(row.version),report:String(row.report??""),structuredResult:asObject(row.structured_result),purpose:merged.get(String(row.id))!.purpose,weight:merged.get(String(row.id))!.weight,evidenceIds:evidenceMap.get(String(row.id))??[]})),packSnapshots};
}

export async function previewResearchReuse(input:{templateVersionId:string;researchVersionIds:string[];packVersionIds:string[];includeTemplateSeed:boolean}):Promise<ResearchReusePreview>{
  const pool=await getNewDesignPool(),template=assertFound((await pool.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1",[input.templateVersionId])).rows[0],"模板版本不存在。"),payload=template.payload as TemplatePayload;
  const resolved=await resolveSources(input.researchVersionIds,input.packVersionIds),typeMap=new Map(payload.cardTypes.map((item)=>[item.key,item])),base=new Map<string,InitialCardDraft>();
  if(input.includeTemplateSeed)for(const card of payload.seedCards)base.set(`${card.typeKey}\u0000${card.title}`,card);
  const candidateRows=resolved.sources.length?await pool.query("SELECT candidate.*,batch.research_version_id FROM new_design.research_candidates candidate JOIN new_design.research_candidate_batches batch ON batch.id=candidate.batch_id WHERE batch.research_version_id=ANY($1::uuid[]) AND candidate.status IN ('adopted','reference_only') ORDER BY candidate.created_at",[resolved.sources.map((item)=>item.researchVersionId)]):{rows:[]};
  const suggested=new Map<string,ResearchPrefillCard>(),conflicts:ResearchReusePreview["conflicts"]=[];
  for(const row of candidateRows.rows){const type=typeMap.get(String(row.target_type_key));if(!type)continue;const key=`${row.target_type_key}\u0000${row.title}`,values=asObject(row.values),validated=validateCardValues(type.fields,values);if(Object.keys(validated.issues).length)continue;const existing=base.get(key)??suggested.get(key);if(!existing){suggested.set(key,{typeKey:String(row.target_type_key),title:String(row.title),values:validated.values,researchVersionId:String(row.research_version_id),evidenceIds:Array.isArray(row.evidence_ids)?row.evidence_ids.map(String):[]});continue;}const fill:Record<string,unknown>={...existing.values};for(const [fieldKey,value] of Object.entries(validated.values)){if(isBlank(fill[fieldKey]))fill[fieldKey]=value;else if(!isBlank(value)&&JSON.stringify(fill[fieldKey])!==JSON.stringify(value))conflicts.push({typeKey:String(row.target_type_key),title:String(row.title),fieldKey,existingValue:fill[fieldKey],suggestedValue:value,reason:"已有内容保持不变，研究建议不会覆盖。"});}if(suggested.has(key))suggested.set(key,{...suggested.get(key)!,values:fill});else if(Object.keys(fill).some((fieldKey)=>JSON.stringify(fill[fieldKey])!==JSON.stringify(existing.values[fieldKey])))suggested.set(key,{typeKey:String(row.target_type_key),title:String(row.title),values:fill,researchVersionId:String(row.research_version_id),evidenceIds:Array.isArray(row.evidence_ids)?row.evidence_ids.map(String):[]});}
  const compiledSnapshot={compiledAt:new Date().toISOString(),sources:resolved.sources.map((item)=>({researchVersionId:item.researchVersionId,recordId:item.recordId,title:item.title,type:item.type,version:item.version,purpose:item.purpose,weight:item.weight,report:item.report,structuredResult:item.structuredResult,evidenceIds:item.evidenceIds})),packs:resolved.packSnapshots};
  return{researchVersionIds:[...new Set(input.researchVersionIds)],packVersionIds:[...new Set(input.packVersionIds)],compiledSnapshot,suggestedCards:[...suggested.values()],conflicts};
}

export async function listBookResearchReferences(bookId:string){const rows=await(await getNewDesignPool()).query("SELECT * FROM new_design.book_research_references WHERE book_id=$1 ORDER BY created_at",[bookId]);return rows.rows.map((row)=>({id:String(row.id),bookId:String(row.book_id),researchVersionId:row.research_version_id?String(row.research_version_id):null,packVersionId:row.pack_version_id?String(row.pack_version_id):null,purpose:String(row.purpose),compiledSnapshot:asObject(row.compiled_snapshot),createdAt:asDate(row.created_at)}));}

export async function persistSessionResearchSelections(client:PoolClient,sessionId:string,preview:ResearchReusePreview):Promise<void>{let order=0;for(const researchVersionId of preview.researchVersionIds)await client.query("INSERT INTO new_design.book_creation_research_selections(id,session_id,research_version_id,purpose,sort_order,compiled_snapshot) VALUES($1,$2,$3,'book_creation',$4,$5::jsonb)",[randomUUID(),sessionId,researchVersionId,order++,JSON.stringify(preview)]);for(const packVersionId of preview.packVersionIds)await client.query("INSERT INTO new_design.book_creation_research_selections(id,session_id,pack_version_id,purpose,sort_order,compiled_snapshot) VALUES($1,$2,$3,'book_creation',$4,$5::jsonb)",[randomUUID(),sessionId,packVersionId,order++,JSON.stringify(preview)]);}

export async function getSessionResearchReuse(sessionId:string):Promise<{preview:ResearchReusePreview;references:Array<{researchVersionId:string|null;packVersionId:string|null;purpose:string;compiledSnapshot:Record<string,unknown>}>}>{const rows=await(await getNewDesignPool()).query("SELECT * FROM new_design.book_creation_research_selections WHERE session_id=$1 ORDER BY sort_order",[sessionId]);if(!rows.rowCount)return{preview:{researchVersionIds:[],packVersionIds:[],compiledSnapshot:{sources:[],packs:[]},suggestedCards:[],conflicts:[]},references:[]};const preview=rows.rows[0].compiled_snapshot as ResearchReusePreview;return{preview,references:rows.rows.map((row)=>({researchVersionId:row.research_version_id?String(row.research_version_id):null,packVersionId:row.pack_version_id?String(row.pack_version_id):null,purpose:String(row.purpose),compiledSnapshot:asObject(row.compiled_snapshot)}))};}

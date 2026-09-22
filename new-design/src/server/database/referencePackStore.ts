import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { InitialCardDraft, ResearchPrefillCard, ResearchReferencePack, ResearchReferencePackItem, ResearchReferencePackVersion, ResearchReusePreview, ResearchRecordType } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { getNewDesignPool } from "./runtime";
import type { TemplatePayload } from "./templateStore";
import {createRecordCard,listRecordCards,requireRecordCard,replaceRecordCard,type RecordCardDb,type RecordCardRow} from "./recordCards";
import {DEFAULT_SPACE_ID} from "./store";

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function asObject(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function isBlank(value:unknown):boolean{return value===null||value===undefined||value===""||(Array.isArray(value)&&value.length===0);}

function mapPackItem(row:Record<string,unknown>):ResearchReferencePackItem{return{researchVersionId:String(row.research_version_id),recordId:String(row.record_id),recordTitle:String(row.record_title),recordType:row.record_type as ResearchRecordType,recordVersion:Number(row.record_version),purpose:String(row.purpose),weight:Number(row.weight),sortOrder:Number(row.sort_order),note:String(row.item_note??"")};}

async function packItems(db:RecordCardDb,versionId:string){return(await listRecordCards(db,'research_reference_pack_item',{where:{pack_version_id:versionId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));}
async function researchVersion(db:RecordCardDb,id:string){const run=await requireRecordCard(db,id,'research_record_version','研究版本不存在。');const record=await requireRecordCard(db,run.record_id,'research_record','研究记录不存在。',{includeArchived:true});return {...run,record_id:record.id,title:record.title,record_type:record.record_type};}
export async function listReferencePacks():Promise<ResearchReferencePack[]>{
 const rows=(await listRecordCards(await getNewDesignPool(),'research_reference_pack')).filter(row=>row.status!=='archived').sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
 return Promise.all(rows.map(row=>getReferencePack(row.id)));
}
export async function getReferencePack(id:string):Promise<ResearchReferencePack>{
 const db=await getNewDesignPool(),pack=await requireRecordCard(db,id,'research_reference_pack','研究参考包不存在。',{includeArchived:true});
 const rows=(await listRecordCards(db,'research_reference_pack_version',{where:{pack_id:id}})).sort((a,b)=>Number(b.version)-Number(a.version)),versions:ResearchReferencePackVersion[]=[];
 for(const version of rows){const items:ResearchReferencePackItem[]=[];for(const item of await packItems(db,version.id)){const run=await researchVersion(db,item.research_version_id);items.push(mapPackItem({...item,item_note:item.note,record_id:run.record_id,record_title:run.title,record_type:run.record_type,record_version:run.version}));}
 versions.push({id:version.id,packId:id,version:Number(version.version),note:String(version.note??''),items,createdAt:asDate(version.created_at)});}
 const current=rows.find(row=>row.id===pack.current_version_id);
 return{id:pack.id,name:pack.name,description:pack.description??'',status:pack.status,currentVersionId:pack.current_version_id??null,currentVersion:current?Number(current.version):null,versionCount:versions.length,revision:pack.revision,versions,createdAt:asDate(pack.created_at),updatedAt:asDate(pack.updated_at)};
}
export async function publishReferencePack(input:{id?:string;name:string;description:string;note:string;revision?:number;items:Array<{researchVersionId:string;purpose:string;weight:number;note:string}>}):Promise<ResearchReferencePack>{
 if(!input.items.length)throw new NewDesignError('研究参考包至少需要一条已完成记录。',422);
 const client=await(await getNewDesignPool()).connect(),packId=input.id??randomUUID();
 try{
  await client.query('BEGIN');
  let pack:RecordCardRow;
  if(input.id){pack=await requireRecordCard(client,packId,'research_reference_pack','研究参考包不存在或已归档。',{lock:true});if(pack.status==='archived')throw new NewDesignError('研究参考包不存在或已归档。',404);if(pack.revision!==input.revision)throw new NewDesignError('研究参考包已在其他页面更新，请刷新后再发布。',409);}
  else pack=await createRecordCard(client,{id:packId,spaceId:DEFAULT_SPACE_ID,typeKey:'research_reference_pack',title:input.name,values:{id:packId,name:input.name,description:input.description,status:'draft',revision:1,current_version_id:null}});
  for(const id of new Set(input.items.map(item=>item.researchVersionId))){const run=await researchVersion(client,id);if(!['completed','partial'].includes(run.run_status))throw new NewDesignError('参考包只能收录已完成或部分完成的研究版本。',422);}
  const versions=await listRecordCards(client,'research_reference_pack_version',{where:{pack_id:packId}}),next=Math.max(0,...versions.map(row=>Number(row.version)))+1,versionId=randomUUID();
  await createRecordCard(client,{id:versionId,spaceId:pack.recordSpaceId,typeKey:'research_reference_pack_version',title:input.name,values:{id:versionId,pack_id:packId,version:next,note:input.note}});
  for(const [index,item] of input.items.entries())await createRecordCard(client,{spaceId:pack.recordSpaceId,typeKey:'research_reference_pack_item',title:item.purpose,values:{pack_version_id:versionId,research_version_id:item.researchVersionId,purpose:item.purpose,weight:item.weight,sort_order:index,note:item.note}});
  await replaceRecordCard(client,{id:packId,spaceId:pack.recordSpaceId,typeKey:'research_reference_pack',title:input.name,values:{...pack,name:input.name,description:input.description,status:'published',current_version_id:versionId,revision:pack.revision+1,updated_at:new Date().toISOString()}});
  await client.query('COMMIT');return getReferencePack(packId);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

interface ResolvedSource {researchVersionId:string;recordId:string;title:string;type:ResearchRecordType;version:number;report:string;structuredResult:Record<string,unknown>;purpose:string;weight:number;evidenceIds:string[];}

async function resolveSources(researchVersionIds:string[],packVersionIds:string[]):Promise<{sources:ResolvedSource[];packSnapshots:Array<Record<string,unknown>>}>{
 const db=await getNewDesignPool(),expanded=researchVersionIds.map(researchVersionId=>({researchVersionId,purpose:'book_creation',weight:1})),packSnapshots:Array<Record<string,unknown>>=[];
 for(const id of new Set(packVersionIds)){
  const version=await requireRecordCard(db,id,'research_reference_pack_version','选择的研究参考包版本不存在。'),pack=await requireRecordCard(db,version.pack_id,'research_reference_pack','研究参考包不存在。',{includeArchived:true});
  packSnapshots.push({packId:pack.id,packVersionId:version.id,name:pack.name,version:Number(version.version),note:version.note??''});
  for(const item of await packItems(db,id))expanded.push({researchVersionId:item.research_version_id,purpose:item.purpose,weight:Number(item.weight)});
 }
 const merged=new Map<string,{purpose:string;weight:number}>();for(const item of expanded){const prior=merged.get(item.researchVersionId);if(!prior||item.weight>prior.weight)merged.set(item.researchVersionId,{purpose:item.purpose,weight:item.weight});}
 const sources:ResolvedSource[]=[];
 for(const [id,selection] of merged){const row=await researchVersion(db,id);if(!['completed','partial'].includes(row.run_status))throw new NewDesignError('只能选用已完成或部分完成的研究版本。',422);
 const evidence=await listRecordCards(db,'research_evidence',{where:{research_version_id:id}});
 sources.push({researchVersionId:id,recordId:row.record_id,title:row.title,type:row.record_type,version:Number(row.version),report:String(row.report??''),structuredResult:asObject(row.structured_result),...selection,evidenceIds:evidence.map(item=>item.id)});}
 return{sources,packSnapshots};
}

export async function previewResearchReuse(input:{templateVersionId:string;researchVersionIds:string[];packVersionIds:string[];includeTemplateSeed:boolean}):Promise<ResearchReusePreview>{
  const pool=await getNewDesignPool(),template=await requireRecordCard(pool,input.templateVersionId,"template_group_version","模板版本不存在。"),payload=template.payload as TemplatePayload;
  const resolved=await resolveSources(input.researchVersionIds,input.packVersionIds),typeMap=new Map(payload.cardTypes.map((item)=>[item.key,item])),base=new Map<string,InitialCardDraft>();
  if(input.includeTemplateSeed)for(const card of payload.seedCards)base.set(`${card.typeKey}\u0000${card.title}`,card);
  const candidateRows:{rows:Record<string,any>[]}={rows:[]};
  for(const source of resolved.sources){const batches=await listRecordCards(pool,'research_candidate_batch',{where:{research_version_id:source.researchVersionId}});for(const batch of batches){const rows=await listRecordCards(pool,'research_candidate',{where:{batch_id:batch.id}});for(const candidate of rows)if(['adopted','reference_only'].includes(candidate.status))candidateRows.rows.push({...candidate,research_version_id:source.researchVersionId});}}
  candidateRows.rows.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  const suggested=new Map<string,ResearchPrefillCard>(),conflicts:ResearchReusePreview["conflicts"]=[];
  for(const row of candidateRows.rows){const type=typeMap.get(String(row.target_type_key));if(!type)continue;const key=`${row.target_type_key}\u0000${row.title}`,values=asObject(row.values),validated=validateCardValues(type.fields,values);if(Object.keys(validated.issues).length)continue;const existing=base.get(key)??suggested.get(key);if(!existing){suggested.set(key,{typeKey:String(row.target_type_key),title:String(row.title),values:validated.values,researchVersionId:String(row.research_version_id),evidenceIds:Array.isArray(row.evidence_ids)?row.evidence_ids.map(String):[]});continue;}const fill:Record<string,unknown>={...existing.values};for(const [fieldKey,value] of Object.entries(validated.values)){if(isBlank(fill[fieldKey]))fill[fieldKey]=value;else if(!isBlank(value)&&JSON.stringify(fill[fieldKey])!==JSON.stringify(value))conflicts.push({typeKey:String(row.target_type_key),title:String(row.title),fieldKey,existingValue:fill[fieldKey],suggestedValue:value,reason:"已有内容保持不变，研究建议不会覆盖。"});}if(suggested.has(key))suggested.set(key,{...suggested.get(key)!,values:fill});else if(Object.keys(fill).some((fieldKey)=>JSON.stringify(fill[fieldKey])!==JSON.stringify(existing.values[fieldKey])))suggested.set(key,{typeKey:String(row.target_type_key),title:String(row.title),values:fill,researchVersionId:String(row.research_version_id),evidenceIds:Array.isArray(row.evidence_ids)?row.evidence_ids.map(String):[]});}
  const compiledSnapshot={compiledAt:new Date().toISOString(),sources:resolved.sources.map((item)=>({researchVersionId:item.researchVersionId,recordId:item.recordId,title:item.title,type:item.type,version:item.version,purpose:item.purpose,weight:item.weight,report:item.report,structuredResult:item.structuredResult,evidenceIds:item.evidenceIds})),packs:resolved.packSnapshots};
  return{researchVersionIds:[...new Set(input.researchVersionIds)],packVersionIds:[...new Set(input.packVersionIds)],compiledSnapshot,suggestedCards:[...suggested.values()],conflicts};
}

export async function listBookResearchReferences(bookId:string){const rows=await listRecordCards(await getNewDesignPool(),'book_research_reference',{where:{book_id:bookId}});return rows.map(row=>({id:row.id,bookId:row.book_id,researchVersionId:row.research_version_id??null,packVersionId:row.pack_version_id??null,purpose:row.purpose,compiledSnapshot:asObject(row.compiled_snapshot),createdAt:asDate(row.created_at)}));}
export async function persistSessionResearchSelections(client:PoolClient,sessionId:string,preview:ResearchReusePreview):Promise<void>{
 const session=await requireRecordCard(client,sessionId,'book_creation_session','开书流程不存在。');let order=0;
 const selections=[...preview.researchVersionIds.map(id=>({research_version_id:id,pack_version_id:null})),...preview.packVersionIds.map(id=>({research_version_id:null,pack_version_id:id}))];
 for(const selection of selections)await createRecordCard(client,{spaceId:session.recordSpaceId,typeKey:'book_creation_research_selection',title:'开书研究来源',values:{session_id:sessionId,...selection,purpose:'book_creation',sort_order:order++,compiled_snapshot:preview}});
}
export async function getSessionResearchReuse(sessionId:string):Promise<{preview:ResearchReusePreview;references:Array<{researchVersionId:string|null;packVersionId:string|null;purpose:string;compiledSnapshot:Record<string,unknown>}>}>{
 const rows=(await listRecordCards(await getNewDesignPool(),'book_creation_research_selection',{where:{session_id:sessionId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
 if(!rows.length)return{preview:{researchVersionIds:[],packVersionIds:[],compiledSnapshot:{sources:[],packs:[]},suggestedCards:[],conflicts:[]},references:[]};
 return{preview:rows[0].compiled_snapshot as ResearchReusePreview,references:rows.map(row=>({researchVersionId:row.research_version_id??null,packVersionId:row.pack_version_id??null,purpose:row.purpose,compiledSnapshot:asObject(row.compiled_snapshot)}))};
}

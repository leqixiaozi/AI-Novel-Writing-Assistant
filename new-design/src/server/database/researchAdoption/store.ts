import {createRecordCard,listRecordCards,requireRecordCard,replaceRecordCard,type RecordCardDb} from '../recordCards';
import {researchCandidateRows} from '../researchStore';
import { randomUUID } from "node:crypto";
import type { BookResearchAdoptionBatch, BookResearchAdoptionItem } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { stableHash } from "../aiContracts/integrity";
import { getNewDesignPool } from "../runtime";

type Row=Record<string,unknown>;
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const asObject=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function mapItem(row:Row):BookResearchAdoptionItem{return{id:String(row.id),sourceCandidateId:String(row.source_candidate_id),targetTypeKey:String(row.target_type_key),title:String(row.title),values:asObject(row.values),evidenceIds:Array.isArray(row.evidence_ids)?row.evidence_ids.map(String):[],decision:row.decision as BookResearchAdoptionItem["decision"],targetCardId:row.target_card_id?String(row.target_card_id):null,revision:Number(row.revision),sortOrder:Number(row.sort_order)};}

async function sourceState(row:Row):Promise<{label:string;update:boolean}>{
 const db=await getNewDesignPool(),research=row.source_kind==='research_version';
 const version=await requireRecordCard(db,String(row.source_id),research?'research_record_version':'research_reference_pack_version','研究来源版本不存在。');
 const source=await requireRecordCard(db,String(research?version.record_id:version.pack_id),research?'research_record':'research_reference_pack','研究来源不存在。',{includeArchived:true});
 return{label:String(research?source.title:source.name),update:String(source.current_version_id)!==String(row.source_id)};
}
async function mapBatch(row:Row):Promise<BookResearchAdoptionBatch>{
 const db=await getNewDesignPool(),items=(await listRecordCards(db,'book_research_adoption_item',{where:{batch_id:row.id}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id)).map(mapItem),source=await sourceState(row);
 return{id:String(row.id),bookId:String(row.book_id),sourceKind:row.source_kind as BookResearchAdoptionBatch['sourceKind'],sourceId:String(row.source_id),sourceLabel:source.label,sourceSnapshot:asObject(row.source_snapshot),sourceUpdateAvailable:source.update,status:row.status as BookResearchAdoptionBatch['status'],revision:Number(row.revision),items,createdBy:String(row.created_by),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}
async function sourceCandidates(sourceKind:BookResearchAdoptionBatch['sourceKind'],sourceId:string,candidateIds?:string[]):Promise<{rows:Row[];snapshot:Record<string,unknown>}>{
 const db=await getNewDesignPool();let rows:Row[],snapshot:Record<string,unknown>;
 if(sourceKind==='research_version'){
  const version=await requireRecordCard(db,sourceId,'research_record_version','研究版本不存在。'),record=await requireRecordCard(db,version.record_id,'research_record','研究记录不存在。',{includeArchived:true});
  if(!['completed','partial'].includes(version.run_status))throw new NewDesignError('只能采用已完成或部分完成的研究版本。',422);
  rows=await researchCandidateRows(db,[sourceId]);snapshot={kind:sourceKind,sourceId,recordId:record.id,label:record.title,version:Number(version.version),runHash:version.run_hash};
 }else{
  const version=await requireRecordCard(db,sourceId,'research_reference_pack_version','参考包版本不存在。'),pack=await requireRecordCard(db,version.pack_id,'research_reference_pack','参考包不存在。',{includeArchived:true});
  const items=(await listRecordCards(db,'research_reference_pack_item',{where:{pack_version_id:sourceId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
  const raw:Row[]=[];for(const item of items)raw.push(...await researchCandidateRows(db,[item.research_version_id]));
  rows=[...new Map(raw.map(row=>[String(row.id),row])).values()];snapshot={kind:sourceKind,sourceId,packId:pack.id,label:pack.name,version:Number(version.version),note:version.note??''};
 }
 if(candidateIds?.length){const requested=new Set(candidateIds);rows=rows.filter(row=>requested.has(String(row.id)));if(rows.length!==requested.size)throw new NewDesignError('部分候选不属于所选研究版本。',422);}
 return{rows,snapshot:{...snapshot,candidateIds:rows.map(row=>String(row.id)),candidateHash:stableHash(rows.map(row=>({id:row.id,revision:row.revision,values:row.values})))}};
}
export async function createBookResearchAdoptionPreview(input:{bookId:string;sourceKind:BookResearchAdoptionBatch['sourceKind'];sourceId:string;candidateIds?:string[];idempotencyKey:string;createdBy?:string}):Promise<BookResearchAdoptionBatch>{
 const db=await getNewDesignPool(),requestHash=stableHash({bookId:input.bookId,sourceKind:input.sourceKind,sourceId:input.sourceId,candidateIds:[...(input.candidateIds??[])].sort()}),where={book_id:input.bookId,idempotency_key:input.idempotencyKey};
 const existing=(await listRecordCards(db,'book_research_adoption_batch',{where}))[0];
 if(existing){if(existing.request_hash!==requestHash)throw new NewDesignError('幂等键对应另一份研究采用请求。',409);return mapBatch(existing);}
 const source=await sourceCandidates(input.sourceKind,input.sourceId,input.candidateIds);if(!source.rows.length)throw new NewDesignError('该研究版本没有可采用的资料提案。',422);
 const client=await db.connect(),id=randomUUID();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`research-preview:${input.bookId}:${input.idempotencyKey}`]);
  const repeated=(await listRecordCards(client,'book_research_adoption_batch',{where}))[0];
  if(repeated){if(repeated.request_hash!==requestHash)throw new NewDesignError('幂等键对应另一份研究采用请求。',409);await client.query('COMMIT');return mapBatch(repeated);}
  const book=assertFound((await client.query("SELECT id,space_id FROM new_design.books WHERE id=$1 AND status='active' FOR SHARE",[input.bookId])).rows[0],'书籍不存在或已归档。');
  const row=await createRecordCard(client,{id,spaceId:book.space_id,typeKey:'book_research_adoption_batch',title:'研究采用预览',values:{id,...where,source_kind:input.sourceKind,source_id:input.sourceId,source_snapshot:source.snapshot,request_hash:requestHash,created_by:input.createdBy??'user',status:'draft',revision:1}});
  for(const [index,candidate] of source.rows.entries())await createRecordCard(client,{spaceId:book.space_id,typeKey:'book_research_adoption_item',title:String(candidate.title),values:{batch_id:id,source_candidate_id:candidate.id,target_type_key:candidate.target_type_key,title:candidate.title,values:candidate.values??{},evidence_ids:candidate.evidence_ids??[],sort_order:index,updated_by:input.createdBy??'user',decision:'pending',revision:1,target_card_id:null}});
  await createRecordCard(client,{spaceId:book.space_id,typeKey:'book_research_adoption_event',title:'研究采用预览',values:{batch_id:id,action:'preview',detail:{sourceKind:input.sourceKind,sourceId:input.sourceId,candidateCount:source.rows.length},idempotency_key:input.idempotencyKey,actor:input.createdBy??'user'}});
  await client.query('COMMIT');return mapBatch(row);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function getBookResearchAdoptionBatch(id:string,bookId?:string):Promise<BookResearchAdoptionBatch>{
 const row=await requireRecordCard(await getNewDesignPool(),id,'book_research_adoption_batch','研究采用预览不存在。');
 if(bookId&&row.book_id!==bookId)throw new NewDesignError('研究采用预览不存在。',404);return mapBatch(row);
}
export async function listBookResearchAdoptionBatches(bookId:string):Promise<BookResearchAdoptionBatch[]>{
 const rows=(await listRecordCards(await getNewDesignPool(),'book_research_adoption_batch',{where:{book_id:bookId}})).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))||b.id.localeCompare(a.id)).slice(0,50);
 return Promise.all(rows.map(mapBatch));
}
export async function reviseBookResearchAdoptionItem(id:string,input:{bookId:string;title:string;values:Record<string,unknown>;decision:BookResearchAdoptionItem['decision'];expectedRevision:number;actor?:string}):Promise<BookResearchAdoptionBatch>{
 const client=await(await getNewDesignPool()).connect();
 try{
  await client.query('BEGIN');const initial=await requireRecordCard(client,id,'book_research_adoption_item','研究提案不存在。'),batch=await requireRecordCard(client,initial.batch_id,'book_research_adoption_batch','研究采用预览不存在。',{lock:true}),item=await requireRecordCard(client,id,'book_research_adoption_item','研究提案不存在。',{lock:true});
  if(batch.book_id!==input.bookId)throw new NewDesignError('研究提案不属于当前书籍。',404);
  if(batch.status!=='draft'||item.revision!==input.expectedRevision)throw new NewDesignError('研究提案已变化或不可编辑，请刷新。',409);
  await replaceRecordCard(client,{id,spaceId:item.recordSpaceId,typeKey:'book_research_adoption_item',title:input.title,values:{...item,title:input.title,values:input.values,decision:input.decision,revision:item.revision+1,updated_by:input.actor??'user',updated_at:new Date().toISOString()}});
  await replaceRecordCard(client,{id:batch.id,spaceId:batch.recordSpaceId,typeKey:'book_research_adoption_batch',values:{...batch,revision:batch.revision+1,updated_at:new Date().toISOString()}});
  await createRecordCard(client,{spaceId:batch.recordSpaceId,typeKey:'book_research_adoption_event',title:'研究提案决定',values:{batch_id:batch.id,action:input.decision==='pending'?'edit':'decide',detail:{itemId:id,decision:input.decision},idempotency_key:`item:${id}:${input.expectedRevision}`,actor:input.actor??'user'}});
  await client.query('COMMIT');return getBookResearchAdoptionBatch(batch.id,input.bookId);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

import {createRecordCard,findRecordCard,listRecordCards,requireRecordCard,replaceRecordCard,type RecordCardDb,type RecordCardRow} from './recordCards';
import {DEFAULT_SPACE_ID} from './store';
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ResearchCandidate, ResearchDocument, ResearchDocumentVersion, ResearchEvidence, ResearchRecordDetail, ResearchRecordSummary, ResearchRecordType, ResearchRecordVersion, ResearchRunStatus } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { getNewDesignPool } from "./runtime";

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function asObject(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function hash(value:string):string{return createHash("sha256").update(value).digest("hex");}

function mapDocumentVersion(row:Record<string,unknown>):ResearchDocumentVersion{return{id:String(row.id),documentId:String(row.document_id),version:Number(row.version),content:String(row.content),contentHash:String(row.content_hash),characterCount:Number(row.character_count),createdAt:asDate(row.created_at)};}
function mapDocument(row:Record<string,unknown>):ResearchDocument{return{id:String(row.document_id),title:String(row.title),sourceKind:row.source_kind as ResearchDocument["sourceKind"],sourceUrl:String(row.source_url??""),status:row.status as ResearchDocument["status"],revision:Number(row.revision),currentVersion:mapDocumentVersion(row),versionCount:Number(row.version_count),createdAt:asDate(row.document_created_at),updatedAt:asDate(row.updated_at)};}
function mapVersion(row:Record<string,unknown>):ResearchRecordVersion{return{id:String(row.id),recordId:String(row.record_id),version:Number(row.version),parentVersionId:row.parent_version_id?String(row.parent_version_id):null,sourceScope:asObject(row.source_scope),templateKey:String(row.template_key),templateVersion:Number(row.template_version),runStatus:row.run_status as ResearchRunStatus,progress:Number(row.progress),budgetTokens:row.budget_tokens===null?null:Number(row.budget_tokens),usedTokens:Number(row.used_tokens),promptSnapshot:asObject(row.prompt_snapshot),modelSnapshot:asObject(row.model_snapshot),inputSnapshot:asObject(row.input_snapshot),structuredResult:asObject(row.structured_result),report:String(row.report??""),lastError:String(row.last_error??""),cancelRequested:Boolean(row.cancel_requested),runHash:String(row.run_hash),createdAt:asDate(row.created_at),completedAt:row.completed_at?asDate(row.completed_at):null};}
function mapSummary(row:Record<string,unknown>):ResearchRecordSummary{return{id:String(row.record_id),type:row.record_type as ResearchRecordType,title:String(row.title),sourceDocumentVersionId:row.source_document_version_id?String(row.source_document_version_id):null,tags:Array.isArray(row.tags)?row.tags.map(String):[],favorite:Boolean(row.favorite),notes:String(row.notes??""),status:row.record_status as ResearchRecordSummary["status"],revision:Number(row.record_revision),currentVersion:mapVersion(row),versionCount:Number(row.version_count),usageCount:Number(row.usage_count),createdAt:asDate(row.record_created_at),updatedAt:asDate(row.record_updated_at)};}
function mapEvidence(row:Record<string,unknown>):ResearchEvidence{return{id:String(row.id),researchVersionId:String(row.research_version_id),sourceDocumentVersionId:row.source_document_version_id?String(row.source_document_version_id):null,fieldPath:String(row.field_path),excerpt:String(row.excerpt),startOffset:row.start_offset===null?null:Number(row.start_offset),endOffset:row.end_offset===null?null:Number(row.end_offset),certainty:row.certainty as ResearchEvidence["certainty"],note:String(row.note??"")};}
function mapCandidate(row:Record<string,unknown>):ResearchCandidate{return{id:String(row.id),batchId:String(row.batch_id),researchVersionId:String(row.research_version_id),targetTypeKey:String(row.target_type_key),title:String(row.title),values:asObject(row.values),relationCandidates:Array.isArray(row.relation_candidates)?row.relation_candidates:[],evidenceIds:Array.isArray(row.evidence_ids)?row.evidence_ids.map(String):[],mergeKey:String(row.merge_key??""),confidence:row.confidence===null?null:Number(row.confidence),status:row.status as ResearchCandidate["status"],revision:Number(row.revision)};}

export async function researchCandidateRows(db:RecordCardDb,versionIds:string[]){
 const rows:RecordCardRow[]=[];
 for(const versionId of versionIds)for(const batch of await listRecordCards(db,'research_candidate_batch',{where:{research_version_id:versionId}}))for(const candidate of await listRecordCards(db,'research_candidate',{where:{batch_id:batch.id}}))rows.push({...candidate,research_version_id:versionId});
 return rows.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id));
}
async function researchSummary(db:RecordCardDb,record:RecordCardRow){
 const versions=await listRecordCards(db,'research_record_version',{where:{record_id:record.id}}),version=assertFound(versions.find(row=>row.id===record.current_version_id),'研究当前版本不存在。');
 const references=await listRecordCards(db,'book_research_reference',{where:{research_version_id:version.id}}),candidates=await researchCandidateRows(db,[version.id]);let usage=references.length;
 for(const candidate of candidates)usage+=(await listRecordCards(db,'research_candidate_adoption',{where:{candidate_id:candidate.id}})).length;
 return mapSummary({...version,record_id:record.id,record_type:record.record_type,title:record.title,source_document_version_id:record.source_document_version_id,tags:record.tags,favorite:record.favorite,notes:record.notes,record_status:record.status,record_revision:record.revision,record_created_at:record.created_at,record_updated_at:record.updated_at,version_count:versions.length,usage_count:usage});
}

export async function createResearchDocument(input:{title:string;content:string;sourceKind:ResearchDocument["sourceKind"];sourceUrl:string}):Promise<ResearchDocument>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{await client.query("BEGIN");const documentId=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.research_documents(id,title,source_kind,source_url) VALUES($1,$2,$3,$4)",[documentId,input.title,input.sourceKind,input.sourceUrl]);await client.query("INSERT INTO new_design.research_document_versions(id,document_id,version,content,content_hash,character_count) VALUES($1,$2,1,$3,$4,$5)",[versionId,documentId,input.content,hash(input.content),input.content.length]);await client.query("UPDATE new_design.research_documents SET current_version_id=$2 WHERE id=$1",[documentId,versionId]);await client.query("COMMIT");return assertFound((await listResearchDocuments()).find((item)=>item.id===documentId),"参考文本创建后无法读取。");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function addResearchDocumentVersion(documentId:string,input:{content:string;revision:number}):Promise<ResearchDocument>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{await client.query("BEGIN");const document=assertFound((await client.query("SELECT * FROM new_design.research_documents WHERE id=$1 AND status='active' FOR UPDATE",[documentId])).rows[0],"参考文本不存在或已归档。");if(Number(document.revision)!==input.revision)throw new NewDesignError("参考文本已在其他页面更新，请刷新后重试。",409);const next=Number((await client.query("SELECT COALESCE(max(version),0)+1 AS version FROM new_design.research_document_versions WHERE document_id=$1",[documentId])).rows[0].version),versionId=randomUUID();await client.query("INSERT INTO new_design.research_document_versions(id,document_id,version,content,content_hash,character_count) VALUES($1,$2,$3,$4,$5,$6)",[versionId,documentId,next,input.content,hash(input.content),input.content.length]);await client.query("UPDATE new_design.research_documents SET current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[documentId,versionId]);await client.query("COMMIT");return assertFound((await listResearchDocuments()).find((item)=>item.id===documentId),"参考文本新版本无法读取。");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function listResearchDocuments():Promise<ResearchDocument[]>{const pool=await getNewDesignPool();const result=await pool.query(`SELECT document.id AS document_id,document.title,document.source_kind,document.source_url,document.status,document.revision,document.created_at AS document_created_at,document.updated_at,version.*,(SELECT count(*) FROM new_design.research_document_versions item WHERE item.document_id=document.id)::int AS version_count FROM new_design.research_documents document JOIN new_design.research_document_versions version ON version.id=document.current_version_id WHERE document.status='active' ORDER BY document.updated_at DESC`);return result.rows.map(mapDocument);}

export async function getResearchDocumentVersion(versionId:string):Promise<{documentId:string;title:string;sourceKind:ResearchDocument["sourceKind"];sourceUrl:string;version:ResearchDocumentVersion}>{const row=assertFound((await(await getNewDesignPool()).query("SELECT document.id AS document_id,document.title,document.source_kind,document.source_url,version.* FROM new_design.research_document_versions version JOIN new_design.research_documents document ON document.id=version.document_id WHERE version.id=$1",[versionId])).rows[0],"参考文本版本不存在。");return{documentId:String(row.document_id),title:String(row.title),sourceKind:row.source_kind,sourceUrl:String(row.source_url??""),version:mapDocumentVersion(row)};}
export async function listResearchDocumentVersions(documentId:string):Promise<ResearchDocumentVersion[]>{const result=await(await getNewDesignPool()).query("SELECT * FROM new_design.research_document_versions WHERE document_id=$1 ORDER BY version DESC",[documentId]);return result.rows.map(mapDocumentVersion);}

export async function listResearchRecords(input:{type?:ResearchRecordType;archived?:boolean;favorite?:boolean;search?:string}={}):Promise<ResearchRecordSummary[]>{
 const db=await getNewDesignPool();
 const ids=(await db.query(`SELECT COALESCE((version.values->>'id')::uuid,card.id) id
  FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='research_record'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  WHERE version.values->>'status'=$1 AND ($2::text IS NULL OR version.values->>'record_type'=$2)
   AND (NOT $3::boolean OR version.values->>'favorite'='true')
   AND ($4::text IS NULL OR version.values->>'title' ILIKE $4 OR version.values->>'notes' ILIKE $4)
  ORDER BY (version.values->>'favorite')::boolean DESC,COALESCE((version.values->>'updated_at')::timestamptz,card.updated_at) DESC`,[input.archived?'archived':'active',input.type??null,input.favorite??false,input.search?`%${input.search}%`:null])).rows;
 return Promise.all(ids.map(async row=>researchSummary(db,await requireRecordCard(db,row.id,'research_record','研究记录不存在。',{includeArchived:true}))));
}
export async function getResearchRecord(id:string):Promise<ResearchRecordDetail>{
 const db=await getNewDesignPool(),record=await requireRecordCard(db,id,'research_record','研究记录不存在。',{includeArchived:true}),summary=await researchSummary(db,record);
 const versions=(await listRecordCards(db,'research_record_version',{where:{record_id:id}})).sort((a,b)=>Number(b.version)-Number(a.version)),versionIds=versions.map(row=>row.id),evidence:RecordCardRow[]=[];
 for(const versionId of versionIds)evidence.push(...await listRecordCards(db,'research_evidence',{where:{research_version_id:versionId}}));
 evidence.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.field_path).localeCompare(String(b.field_path)));
 return{...summary,versions:versions.map(mapVersion),evidence:evidence.map(mapEvidence),candidates:(await researchCandidateRows(db,versionIds)).map(mapCandidate)};
}
export async function getBookAnalysisRequestByKey(requestKey:string,db?:Pick<PoolClient,'query'>):Promise<{recordId:string;versionId:string;version:number;inputHash:string}|null>{
 const rows=await listRecordCards(db??await getNewDesignPool(),'research_record_version',{where:{template_key:'new_design.research.book_analysis',source_scope:{requestKey}}});
 if(rows.length>1)throw new NewDesignError('原拆书请求对应多份运行记录，请保留原凭证并人工核对。',409);
 const row=rows[0];return row?{recordId:row.record_id,versionId:row.id,version:Number(row.version),inputHash:String(row.source_scope?.inputHash??'')}:null;
}
export async function updateResearchRecord(id:string,input:{title:string;tags:string[];favorite:boolean;notes:string;revision:number;status?:'active'|'archived'}):Promise<ResearchRecordSummary>{
 const client=await(await getNewDesignPool()).connect();
 try{await client.query('BEGIN');const row=await requireRecordCard(client,id,'research_record','研究记录不存在。',{lock:true,includeArchived:true});
 if(row.revision!==input.revision)throw new NewDesignError('研究记录已在其他页面更新，请刷新后重试。',409);
 const updated=await replaceRecordCard(client,{id,spaceId:row.recordSpaceId,typeKey:'research_record',title:input.title,values:{...row,title:input.title,tags:input.tags,favorite:input.favorite,notes:input.notes,status:input.status??row.status,revision:row.revision+1,updated_at:new Date().toISOString()}});
 const result=await researchSummary(client,updated);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export interface ResearchRunInput {type:ResearchRecordType;title:string;sourceDocumentVersionId?:string|null;sourceScope?:Record<string,unknown>;templateKey:string;templateVersion:number;budgetTokens?:number|null;promptSnapshot?:Record<string,unknown>;modelSnapshot?:Record<string,unknown>;inputSnapshot?:Record<string,unknown>;parentVersionId?:string|null;recordId?:string;}

export async function createResearchRun(client:PoolClient,input:ResearchRunInput):Promise<{recordId:string;versionId:string;version:number}>{
 const recordId=input.recordId??randomUUID();let record:RecordCardRow,version=1;
 if(input.recordId){record=await requireRecordCard(client,input.recordId,'research_record','研究记录不存在或已归档。',{lock:true});if(record.status!=='active')throw new NewDesignError('研究记录不存在或已归档。',404);version=Math.max(0,...(await listRecordCards(client,'research_record_version',{where:{record_id:record.id}})).map(row=>Number(row.version)))+1;}
 else{
  if(input.sourceDocumentVersionId&&!((await client.query('SELECT 1 FROM new_design.research_document_versions WHERE id=$1',[input.sourceDocumentVersionId])).rowCount))throw new NewDesignError('参考文本版本不存在。',422);
  record=await createRecordCard(client,{id:recordId,spaceId:DEFAULT_SPACE_ID,typeKey:'research_record',title:input.title,values:{id:recordId,record_type:input.type,title:input.title,source_document_version_id:input.sourceDocumentVersionId??null,status:'active',tags:[],favorite:false,notes:'',revision:1,current_version_id:null}});
 }
 if(input.parentVersionId)await requireRecordCard(client,input.parentVersionId,'research_record_version','上次研究版本不存在。');
 const versionId=randomUUID(),snapshot={sourceScope:input.sourceScope??{},promptSnapshot:input.promptSnapshot??{},modelSnapshot:input.modelSnapshot??{},inputSnapshot:input.inputSnapshot??{}};
 await createRecordCard(client,{id:versionId,spaceId:record.recordSpaceId,typeKey:'research_record_version',title:input.title,values:{id:versionId,record_id:recordId,version,parent_version_id:input.parentVersionId??null,source_scope:snapshot.sourceScope,template_key:input.templateKey,template_version:input.templateVersion,run_status:'queued',progress:0,budget_tokens:input.budgetTokens??null,used_tokens:0,prompt_snapshot:snapshot.promptSnapshot,model_snapshot:snapshot.modelSnapshot,input_snapshot:snapshot.inputSnapshot,structured_result:{},report:'',last_error:'',cancel_requested:false,completed_at:null,run_hash:hash(JSON.stringify({recordId,version,...snapshot}))}});
 await replaceRecordCard(client,{id:recordId,spaceId:record.recordSpaceId,typeKey:'research_record',values:{...record,current_version_id:versionId,updated_at:new Date().toISOString()}});
 return{recordId,versionId,version};
}
export async function setResearchRunState(client:PoolClient,versionId:string,input:{status:ResearchRunStatus;progress:number;usedTokens?:number;structuredResult?:Record<string,unknown>;report?:string;lastError?:string;promptSnapshot?:Record<string,unknown>;modelSnapshot?:Record<string,unknown>}):Promise<void>{
 const row=await requireRecordCard(client,versionId,'research_record_version','研究版本不存在。',{lock:true});
 await replaceRecordCard(client,{id:versionId,spaceId:row.recordSpaceId,typeKey:'research_record_version',values:{...row,run_status:input.status,progress:input.progress,used_tokens:input.usedTokens??row.used_tokens,structured_result:input.structuredResult??row.structured_result,report:input.report??row.report,last_error:input.lastError??row.last_error,prompt_snapshot:input.promptSnapshot??row.prompt_snapshot,model_snapshot:input.modelSnapshot??row.model_snapshot,completed_at:['completed','partial','failed','cancelled'].includes(input.status)?new Date().toISOString():row.completed_at}});
}

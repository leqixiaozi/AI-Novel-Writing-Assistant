import {findRecordCard,listRecordCards,type RecordCardRow} from '../recordCards';
import {planningRow,planningVersion,patchPlanningRecord,insertPlanningRecord,planningOperation,lockPlanningBook,newPlanningObject,validatePlanningReference,planningReferences} from './records';
import {invalidatePlanningDownstream} from './invalidation';
import {readStoryFormat} from "../../../common/storyFormat";
import {AiExecutionError} from "../../ai/runtime/errors";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ForeshadowPlanAction, PlanningAdoption, PlanningExecutionMode, PlanningImpact, PlanningLevel, PlanningObject, PlanningReference, PlanningReferenceRole, PlanningTreeNode, PlanningVersion, PlanningVersionAction, PlanningVersionContext, PlanningVersionSource } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import {assertWorldUsageScopesCurrent} from '../worldUsage';
import {worldUsageCreativeScopesSchema} from '../../../common/worldUsage';

type ReferenceInput={role:PlanningReferenceRole;cardId:string;cardVersionId:string;action?:ForeshadowPlanAction|null;note?:string;sortOrder:number};
type VersionInput={content:Record<string,unknown>;source:PlanningVersionSource;executionMode:PlanningExecutionMode;references:ReferenceInput[];baseVersionId?:string|null;basedOnParentVersionId?:string|null;sourceBodyVersionId?:string|null;createdBy?:string;idempotencyKey:string};
type CreateInput=VersionInput&{bookId:string;level:PlanningLevel;parentObjectId?:string|null;cardId?:string|null;title:string;sortOrder:number};
function planningWriteFailure(error:unknown,rolledBack:boolean,committing:boolean){const result=new AiExecutionError('保存规划候选',error instanceof NewDesignError?error.message:'原规划保存结果待核对，请保留填写与请求。',error instanceof NewDesignError?error.status:503,null,error instanceof NewDesignError?error.issues:undefined);result.recovery.mutationOutcome=rolledBack&&!committing?'not_written':'unknown';return result;}
const asDate=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const asText=(value:unknown)=>value===null||value===undefined?null:String(value);
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}
const contentHash=(value:unknown)=>createHash("sha256").update(stable(value),"utf8").digest("hex");

function mapVersion(row:Record<string,unknown>):PlanningVersion{return{id:String(row.id),objectId:String(row.object_id),bookId:String(row.book_id),version:Number(row.version),baseVersionId:asText(row.base_version_id),basedOnParentVersionId:asText(row.based_on_parent_version_id),source:row.source as PlanningVersionSource,status:row.status as PlanningVersion["status"],executionMode:row.execution_mode as PlanningExecutionMode,content:row.content as Record<string,unknown>,contentHash:String(row.content_hash),sourceBodyVersionId:asText(row.source_body_version_id),references:[],createdBy:String(row.created_by),staleAt:row.stale_at?asDate(row.stale_at):null,staleReason:String(row.stale_reason),createdAt:asDate(row.created_at)};}
function mapReference(row:Record<string,unknown>):PlanningReference{return{id:String(row.id),planningVersionId:String(row.planning_version_id),role:row.reference_role as PlanningReferenceRole,cardId:String(row.card_id),cardVersionId:String(row.card_version_id),cardTypeKey:String(row.type_key),cardTypeName:String(row.type_name),title:String(row.title),action:asText(row.action_key) as ForeshadowPlanAction|null,note:String(row.note),sortOrder:Number(row.sort_order)};}
function mapAdoption(row:Record<string,unknown>):PlanningAdoption{return{id:String(row.id),objectId:String(row.object_id),bookId:String(row.book_id),fromVersionId:asText(row.from_version_id),toVersionId:String(row.to_version_id),action:row.action as PlanningAdoption["action"],objectRevision:Number(row.object_revision),source:row.source as PlanningAdoption["source"],actor:String(row.actor),contentHash:String(row.content_hash),idempotencyKey:String(row.idempotency_key),createdAt:asDate(row.created_at)};}
function mapAction(row:Record<string,unknown>):PlanningVersionAction{return{id:String(row.id),objectId:String(row.object_id),versionId:String(row.version_id),action:row.action as PlanningVersionAction["action"],actor:String(row.actor),note:String(row.note),createdAt:asDate(row.created_at)};}
function mapImpact(row:Record<string,unknown>):PlanningImpact{return{id:String(row.id),bookId:String(row.book_id),adoptionId:String(row.adoption_id),sourceObjectId:String(row.source_object_id),sourceFromVersionId:String(row.source_from_version_id),sourceToVersionId:String(row.source_to_version_id),targetKind:row.target_kind as PlanningImpact["targetKind"],targetId:String(row.target_id),status:row.status as PlanningImpact["status"],reason:String(row.reason),createdAt:asDate(row.created_at),resolvedAt:row.resolved_at?asDate(row.resolved_at):null};}

async function validateParentBasis(client:PoolClient,object:Record<string,unknown>,basisId:string|null|undefined,allowDraftParent=false):Promise<string|null>{
  if(object.level==="story"){if(basisId)throw new NewDesignError("故事总计划不能引用父级规划版本。",422);return null;}
  const parent=await planningRow(client,String(object.parent_object_id));
  if(parent.book_id!==object.book_id)throw new NewDesignError('父级规划不属于当前书籍。',422);
  const requiredParentVersion=allowDraftParent?parent.current_version_id:parent.adopted_version_id;
  if(!requiredParentVersion)throw new NewDesignError("请先明确保存父级规划版本，再创建子级规划。",409);
  if(!basisId)throw new NewDesignError("子级规划必须记录所依据的父级采用版本。",422);
  if(String(requiredParentVersion)!==basisId)throw new NewDesignError("父级依据版本发生变化，请刷新后重新生成或编辑子计划。",409);
  const version=await planningVersion(client,basisId,String(parent.id));
  if(version.stale_at)throw new NewDesignError("父级采用版本正在等待复核，不能作为新的规划依据。",409);
  return basisId;
}

async function validateBodySource(client:PoolClient,object:Record<string,unknown>,source:PlanningVersionSource,bodyVersionId:string|null|undefined):Promise<string|null>{
  if(source!=="body_revision"){if(bodyVersionId)throw new NewDesignError("只有正文反向修正规划时才能记录正文版本。",422);return null;}
  if(!bodyVersionId)throw new NewDesignError("正文反向修正规划必须记录当前采用正文版本。",422);
  if(object.level!=="chapter"&&object.level!=="scene")throw new NewDesignError("正文只能反向修正章节或场景计划。",422);
  const chapterObject=object.level==="chapter"?object:await planningRow(client,String(object.parent_object_id));
  const row=await client.query("SELECT document.adopted_version_id FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions version ON version.chapter_document_id=document.id WHERE document.book_id=$1 AND document.chapter_card_id=$2 AND version.id=$3",[object.book_id,chapterObject.card_id,bodyVersionId]);
  if(!row.rowCount||String(row.rows[0].adopted_version_id??"")!==bodyVersionId)throw new NewDesignError("只能依据当前采用的章节正文创建规划修正候选。",409);
  return bodyVersionId;
}

async function insertVersion(client:PoolClient,object:Record<string,unknown>,number:number,input:VersionInput,action:"create"|"edit",allowDraftParent=false):Promise<PlanningVersion>{
  if(input.content.title!==undefined&&(typeof input.content.title!=='string'||!input.content.title.trim()||input.content.title.trim().length>500))throw new NewDesignError('请填写有效规划名称。',422);
  if(input.content.storyFormat!==undefined&&(object.level!=='story'||!readStoryFormat(input.content.storyFormat)))throw new NewDesignError("\u4f5c\u54c1\u5f62\u5f0f\u53ea\u80fd\u4fdd\u5b58\u5728\u6545\u4e8b\u603b\u7eb2\uff0c\u8bf7\u6838\u5bf9\u957f\u77ed\u7bc7\u4e0e\u76ee\u6807\u5b57\u6570\u3002",422);
  if(input.content.storyFormatSourceId!==undefined){
   const sourceRecord=await findRecordCard(client,String(input.content.storyFormatSourceId),'book_content_source'),source=sourceRecord?.book_id===object.book_id&&sourceRecord.confirmation_status==='confirmed'?{format:sourceRecord.source_payload?.storyFormat}:null;
   if(object.level!=='story'||!source||JSON.stringify(readStoryFormat(source.format))!==JSON.stringify(readStoryFormat(input.content.storyFormat))||!readStoryFormat(input.content.storyFormat))throw new NewDesignError("\u5e26\u5165\u7684\u5f00\u4e66\u5f62\u5f0f\u4e0e\u539f\u786e\u8ba4\u6765\u6e90\u4e0d\u4e00\u81f4\uff1b\u4eba\u5de5\u4fee\u6539\u540e\u9700\u4f5c\u4e3a\u65b0\u5019\u9009\u6838\u5bf9\u3002",409);
  }
  const basis=await validateParentBasis(client,object,input.basedOnParentVersionId,allowDraftParent);
  const bodyVersion=await validateBodySource(client,object,input.source,input.sourceBodyVersionId);
  let base:string|null=input.baseVersionId??(object.current_version_id?String(object.current_version_id):null);
  const baseVersion=base?await planningVersion(client,base,String(object.id)):null;
  const status=input.source==="ai"||base&&String(baseVersion?.status)==="proposed"?"proposed":"draft";
  const duplicateRefs=new Set(input.references.map(item=>`${item.role}:${item.cardId}:${item.action??""}`));if(duplicateRefs.size!==input.references.length)throw new NewDesignError("同一用途不能重复选择相同资料。",422);
  const id=randomUUID(),hash=contentHash({content:input.content,executionMode:input.executionMode,references:input.references.map(item=>({role:item.role,cardId:item.cardId,cardVersionId:item.cardVersionId,action:item.action??null,note:item.note??"",sortOrder:item.sortOrder}))});
  const row=await insertPlanningRecord(client,String(object.book_id),'planning_version',{id,object_id:object.id,version:number,base_version_id:base,based_on_parent_version_id:basis,source:input.source,status,execution_mode:input.executionMode,content:input.content,content_hash:hash,source_body_version_id:bodyVersion,created_by:input.createdBy??'',stale_at:null,stale_reason:''});
  for(const reference of input.references){
    await validatePlanningReference(client,String(object.book_id),reference);
    await insertPlanningRecord(client,String(object.book_id),'planning_version_reference',{planning_version_id:id,planning_object_id:object.id,reference_role:reference.role,card_id:reference.cardId,card_version_id:reference.cardVersionId,action_key:reference.action??null,note:reference.note??'',sort_order:reference.sortOrder});
  }
  if(base&&status==='proposed'&&baseVersion?.status==='proposed')await patchPlanningRecord(client,base,'planning_version',{status:'superseded'});
  await patchPlanningRecord(client,String(object.id),'planning_object',{current_version_id:id,revision:Number(object.revision)+(action==='edit'?1:0),updated_at:new Date().toISOString()});
  await insertPlanningRecord(client,String(object.book_id),'planning_version_action',{object_id:object.id,version_id:id,action,actor:input.createdBy??(input.source==='ai'?'ai':'user'),note:action==='create'?'建立规划初版。':'追加规划修订版本。'});
  return mapVersion(row);
}

export async function getPlanningObject(id:string):Promise<PlanningObject>{
 const db=await getNewDesignPool(),row=await planningRow(db,id);
 const [versions,adoptions,actions,references]=await Promise.all([
  listRecordCards(db,'planning_version',{where:{object_id:id}}),
  listRecordCards(db,'planning_adoption',{where:{object_id:id}}),
  listRecordCards(db,'planning_version_action',{where:{object_id:id}}),
  planningReferences(db,{planning_object_id:id}),
 ]);
 versions.sort((a,b)=>Number(b.version)-Number(a.version));adoptions.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
 const mappedReferences=references.map(mapReference),mapped=versions.map(version=>({...mapVersion(version),references:mappedReferences.filter(ref=>ref.planningVersionId===version.id)})),current=assertFound(mapped.find(version=>version.id===row.current_version_id),'规划当前版本不存在。'),adopted=row.adopted_version_id?assertFound(mapped.find(version=>version.id===row.adopted_version_id),'规划采用版本不存在。'):null;
 return{id:row.id,bookId:row.book_id,level:row.level,parentObjectId:asText(row.parent_object_id),cardId:asText(row.card_id),title:row.title,sortOrder:Number(row.sort_order),status:row.status as PlanningObject['status'],currentVersionId:current.id,adoptedVersionId:adopted?.id??null,revision:row.revision,currentVersion:current,adoptedVersion:adopted,versions:mapped,adoptions:adoptions.map(mapAdoption),actions:actions.map(mapAction),createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)};
}

async function lockedPlanningObject(client:PoolClient,id:string){const row=await planningRow(client,id);await lockPlanningBook(client,row.book_id);return planningRow(client,id,'planning_object',true);}
async function nextVersionNumber(client:PoolClient,id:string){return Math.max(0,...(await listRecordCards(client,'planning_version',{where:{object_id:id}})).map(row=>Number(row.version)))+1;}
async function operationEvent(client:PoolClient,object:Record<string,any>,versionId:string,action:string,hash:string,key:string,actor:string,expectedRevision:number|null,resultRevision:number){
 return insertPlanningRecord(client,String(object.book_id),'planning_operation_event',{object_id:object.id,version_id:versionId,action,expected_revision:expectedRevision,result_revision:resultRevision,request_hash:hash,idempotency_key:key,actor});
}

export async function createPlanningObject(input:CreateInput):Promise<PlanningObject>{
 const client=await(await getNewDesignPool()).connect();let committing=false;
 try{await client.query('BEGIN');const result=await createPlanningObjectInTransaction(client,input);committing=true;await client.query('COMMIT');return getPlanningObject(result.objectId);}
 catch(error){const rolledBack=await client.query('ROLLBACK').then(()=>true,()=>false);throw planningWriteFailure(error,rolledBack,committing);}finally{client.release();}
}

/** Initial installation uses the same writer in its caller-owned transaction. */
export async function createPlanningObjectInTransaction(client:PoolClient,input:CreateInput,options:{allowDraftParent?:boolean}={}):Promise<{objectId:string;versionId:string}>{
 await lockPlanningBook(client,input.bookId);
 const hash=contentHash(input),prior=await planningOperation(client,{book_id:input.bookId,idempotency_key:input.idempotencyKey});
 if(prior){if(prior.request_hash!==hash)throw new NewDesignError('幂等键已用于不同的规划请求。',409);return{objectId:prior.object_id,versionId:prior.version_id};}
 const row=await newPlanningObject(client,input,randomUUID()),version=await insertVersion(client,row,1,input,'create',options.allowDraftParent??false);
 await operationEvent(client,row,version.id,'create',hash,input.idempotencyKey,input.createdBy??'user',null,1);
 return{objectId:row.id,versionId:version.id};
}
export async function adoptInitialPlanningVersionInTransaction(client:PoolClient,objectId:string,versionId:string,key:string,actor='user'):Promise<void>{
 const object=await lockedPlanningObject(client,objectId),version=await planningVersion(client,versionId,objectId);
 if(object.status!=='active'||object.adopted_version_id||object.revision!==1||version.stale_at||!['draft','proposed'].includes(version.status))throw new NewDesignError('只能在安装事务中明确采用未采用的正式规划初版。',409);
 await validateParentBasis(client,object,version.based_on_parent_version_id);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`planning-adoption:${key}`]);
 if((await listRecordCards(client,'planning_adoption',{where:{idempotency_key:key}})).length)throw new NewDesignError('原采用键已经使用。',409);
 await patchPlanningRecord(client,versionId,'planning_version',{status:'adopted'});
 await patchPlanningRecord(client,objectId,'planning_object',{adopted_version_id:versionId,revision:2,updated_at:new Date().toISOString()});
 await insertPlanningRecord(client,object.book_id,'planning_adoption',{object_id:objectId,from_version_id:null,to_version_id:versionId,action:'adopt',object_revision:2,source:'user',actor,content_hash:version.content_hash,idempotency_key:key});
}
export async function addPlanningVersion(objectId:string,input:VersionInput&{expectedRevision:number}):Promise<PlanningObject>{
 const client=await(await getNewDesignPool()).connect();let committing=false;
 try{await client.query('BEGIN');await addPlanningVersionInTransaction(client,objectId,input);committing=true;await client.query('COMMIT');return getPlanningObject(objectId);}
 catch(error){const rolledBack=await client.query('ROLLBACK').then(()=>true,()=>false);throw planningWriteFailure(error,rolledBack,committing);}finally{client.release();}
}
export async function addPlanningVersionInTransaction(client:PoolClient,objectId:string,input:VersionInput&{expectedRevision:number}):Promise<{objectId:string;versionId:string;revision:number}>{
 const object=await lockedPlanningObject(client,objectId),hash=contentHash({objectId,...input}),prior=await planningOperation(client,{book_id:object.book_id,idempotency_key:input.idempotencyKey});
 if(prior){if(prior.request_hash!==hash||prior.object_id!==objectId)throw new NewDesignError('原键已用于不同的规划修订。',409);await planningVersion(client,prior.version_id,objectId);return{objectId,versionId:prior.version_id,revision:Number(prior.result_revision)};}
 if(object.status!=='active')throw new NewDesignError('归档的规划不能新增候选。',409);if(object.revision!==input.expectedRevision)planningConflict(object);
 const version=await insertVersion(client,object,await nextVersionNumber(client,objectId),input,'edit'),revision=object.revision+1;
 await operationEvent(client,object,version.id,'revise',hash,input.idempotencyKey,input.createdBy??'user',input.expectedRevision,revision);
 return{objectId,versionId:version.id,revision};
}
export async function rejectPlanningVersion(objectId:string,input:{versionId:string;expectedRevision:number;idempotencyKey:string;actor?:string;note?:string}):Promise<PlanningObject>{
 const client=await(await getNewDesignPool()).connect();
 try{
  await client.query('BEGIN');const object=await lockedPlanningObject(client,objectId),hash=contentHash({objectId,...input}),prior=await planningOperation(client,{book_id:object.book_id,idempotency_key:input.idempotencyKey});
  if(prior){if(prior.request_hash!==hash)throw new NewDesignError('幂等键已用于不同的驳回请求。',409);}
  else{
   if(object.status!=='active')throw new NewDesignError('归档的规划不能处理候选。',409);if(object.revision!==input.expectedRevision)planningConflict(object);
   const version=await planningVersion(client,input.versionId,objectId);if(!['draft','proposed'].includes(version.status))throw new NewDesignError('只有尚未采用的候选版本可以驳回。',409);
   await patchPlanningRecord(client,input.versionId,'planning_version',{status:'rejected'});
   await patchPlanningRecord(client,objectId,'planning_object',{revision:object.revision+1,updated_at:new Date().toISOString()});
   await insertPlanningRecord(client,object.book_id,'planning_version_action',{object_id:objectId,version_id:input.versionId,action:'reject',actor:input.actor??'user',note:input.note??''});
   await operationEvent(client,object,input.versionId,'reject',hash,input.idempotencyKey,input.actor??'user',input.expectedRevision,object.revision+1);
  }
  await client.query('COMMIT');return getPlanningObject(objectId);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

function planningConflict(object:Record<string,unknown>):never{throw new NewDesignError("规划已被其他页面修改，本地填写内容已保留，请对照服务器版本后重试。",409,{serverRevision:String(object.revision),serverVersionId:String(object.current_version_id)});}

async function validatePlanningAiWorldUsage(client:PoolClient,bookId:string,versionId:string){
 const events=await listRecordCards(client,'planning_operation_event',{where:{book_id:bookId,version_id:versionId}}),keys=new Set(events.map(row=>row.idempotency_key));
 const runs=(await listRecordCards(client,'planning_ai_candidate_run',{where:{book_id:bookId}})).filter(row=>keys.has('planning-ai:'+row.id));
 if(runs.length>1)throw new NewDesignError('规划候选对应多个世界范围来源，不能猜测采用依据。',409);
 const source=runs[0]?.source_snapshot;if(source&&Object.hasOwn(source,'worldUsage'))await assertWorldUsageScopesCurrent(client,bookId,worldUsageCreativeScopesSchema.parse(source.worldUsage));
}
export async function adoptPlanningVersionInTransaction(client:PoolClient,objectId:string,input:{versionId:string;expectedRevision:number;idempotencyKey:string;source?:'user'|'system'|'import';actor?:string}):Promise<{objectId:string;versionId:string;revision:number}>{
 const object=await lockedPlanningObject(client,objectId);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`planning-adoption:${input.idempotencyKey}`]);
 const repeated=(await listRecordCards(client,'planning_adoption',{where:{idempotency_key:input.idempotencyKey}}))[0];
 if(repeated){if(repeated.object_id!==objectId||repeated.to_version_id!==input.versionId)throw new NewDesignError('原规划采用键不能改变对象或确切版本。',409);return{objectId,versionId:input.versionId,revision:Number(repeated.object_revision)};}
 if(object.status!=='active')throw new NewDesignError('归档的规划不能采用候选。',409);if(object.revision!==input.expectedRevision)planningConflict(object);
 const target=await planningVersion(client,input.versionId,objectId);
 if(target.status==='rejected'||target.stale_at)throw new NewDesignError('已驳回或待复核的规划版本不能直接采用。',409);
 await validatePlanningAiWorldUsage(client,object.book_id,input.versionId);
 await validateParentBasis(client,object,asText(target.based_on_parent_version_id));
 const fromId=asText(object.adopted_version_id),adoptionId=randomUUID(),revision=object.revision+1;let action:PlanningAdoption['action']='adopt';
 if(fromId===input.versionId)action='readopt';
 else if(fromId){const from=await planningVersion(client,fromId,objectId);if(Number(target.version)<Number(from.version))action='rollback';await patchPlanningRecord(client,fromId,'planning_version',{status:'superseded'});}
 await patchPlanningRecord(client,input.versionId,'planning_version',{status:'adopted',stale_at:null,stale_reason:''});
 const selectedTitle=typeof target.content?.title==='string'?target.content.title.trim():String(object.title);if(!selectedTitle||selectedTitle.length>500)throw new NewDesignError('待采用规划名称无效。',422);
 await patchPlanningRecord(client,objectId,'planning_object',{adopted_version_id:input.versionId,title:selectedTitle,revision,updated_at:new Date().toISOString()});
 if(object.level==='chapter')await client.query("UPDATE new_design.chapter_documents SET title=$3,revision=revision+1,updated_at=now() WHERE book_id=$1 AND chapter_card_id=$2 AND status='active' AND title IS DISTINCT FROM $3",[object.book_id,object.card_id,selectedTitle]);
 await insertPlanningRecord(client,object.book_id,'planning_adoption',{id:adoptionId,object_id:objectId,from_version_id:fromId,to_version_id:input.versionId,action,object_revision:revision,source:input.source??'user',actor:input.actor??'user',content_hash:target.content_hash,idempotency_key:input.idempotencyKey});
 if(fromId&&fromId!==input.versionId)await invalidatePlanningDownstream(client,object,fromId,input.versionId,adoptionId);
 return{objectId,versionId:input.versionId,revision};
}
export async function adoptPlanningVersion(objectId:string,input:{versionId:string;expectedRevision:number;idempotencyKey:string;source?:'user'|'system'|'import';actor?:string}):Promise<PlanningObject>{
 const client=await(await getNewDesignPool()).connect();
 try{await client.query('BEGIN');await adoptPlanningVersionInTransaction(client,objectId,input);await client.query('COMMIT');return getPlanningObject(objectId);}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function setPlanningObjectArchived(objectId:string,input:{expectedRevision:number;idempotencyKey:string;archived:boolean;actor?:string;note?:string}):Promise<PlanningObject>{
 const client=await(await getNewDesignPool()).connect(),action=input.archived?'archive':'restore',hash=contentHash({objectId,...input,action});
 try{
  await client.query('BEGIN');const object=await lockedPlanningObject(client,objectId),prior=await planningOperation(client,{book_id:object.book_id,idempotency_key:input.idempotencyKey});
  if(prior){if(prior.request_hash!==hash)throw new NewDesignError('幂等键已用于不同的规划归档请求。',409);}
  else{
   if(object.revision!==input.expectedRevision)planningConflict(object);
   const status=input.archived?'archived':'active';if(object.status===status)throw new NewDesignError(input.archived?'规划已归档。':'规划已恢复。',409);
   if(input.archived&&(await listRecordCards(client,'planning_object',{where:{parent_object_id:objectId,status:'active'}})).length)throw new NewDesignError('请先归档下级规划，再归档当前规划。',409);
   if(!input.archived&&object.parent_object_id&&(await planningRow(client,object.parent_object_id)).status!=='active')throw new NewDesignError('请先恢复上级规划。',409);
   await patchPlanningRecord(client,objectId,'planning_object',{status,revision:object.revision+1,updated_at:new Date().toISOString()});
   await insertPlanningRecord(client,object.book_id,'planning_version_action',{object_id:objectId,version_id:object.current_version_id,action,actor:input.actor??'user',note:input.note??''});
   await operationEvent(client,object,object.current_version_id,action,hash,input.idempotencyKey,input.actor??'user',input.expectedRevision,object.revision+1);
  }
  await client.query('COMMIT');return getPlanningObject(objectId);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function getAdoptedPlanningTree(bookId:string):Promise<PlanningTreeNode|null>{
 const rows=(await listRecordCards(await getNewDesignPool(),'planning_object',{where:{book_id:bookId,status:'active'}})).filter(row=>row.adopted_version_id).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
 if(!rows.length)return null;
 const objects=await Promise.all(rows.map(row=>getPlanningObject(row.id))),nodes=new Map(objects.map(object=>[object.id,{object,children:[]} as PlanningTreeNode]));let root:PlanningTreeNode|null=null;
 for(const node of nodes.values()){if(!node.object.parentObjectId)root=node;else nodes.get(node.object.parentObjectId)?.children.push(node);}return root;
}
export async function getPlanningVersionContext(versionId:string):Promise<PlanningVersionContext>{
 const db=await getNewDesignPool(),row=await planningVersion(db,versionId),object=await getPlanningObject(row.object_id),version=assertFound(object.versions.find(item=>item.id===versionId),'规划版本不存在。'),ancestors:PlanningVersionContext['ancestors']=[],seen=new Set<string>([versionId]);
 let basis=version.basedOnParentVersionId;
 while(basis){if(seen.has(basis))throw new NewDesignError('规划依据存在循环，请核对来源。',409);seen.add(basis);const row=await planningVersion(db,basis),ancestorObject=await getPlanningObject(row.object_id),ancestorVersion=assertFound(ancestorObject.versions.find(item=>item.id===basis),'祖先规划版本不存在。');ancestors.unshift({object:ancestorObject,version:ancestorVersion});basis=ancestorVersion.basedOnParentVersionId;}
 const childRows=await listRecordCards(db,'planning_version',{where:{based_on_parent_version_id:versionId}}),children:PlanningVersionContext['children']=[];
 for(const row of childRows){const childObject=await getPlanningObject(row.object_id),childVersion=assertFound(childObject.versions.find(item=>item.id===row.id),'子规划版本不存在。');children.push({object:childObject,version:childVersion});}
 return{version,object,ancestors,children};
}
export async function listStalePlanningVersions(bookId:string):Promise<PlanningVersion[]>{
 const rows=(await listRecordCards(await getNewDesignPool(),'planning_version',{where:{book_id:bookId}})).filter(row=>row.stale_at).sort((a,b)=>String(b.stale_at).localeCompare(String(a.stale_at))||a.id.localeCompare(b.id)),result:PlanningVersion[]=[];
 for(const row of rows){const object=await getPlanningObject(row.object_id),version=object.versions.find(item=>item.id===row.id);if(version)result.push(version);}return result;
}
export async function listPlanningAdoptions(objectId:string):Promise<PlanningAdoption[]>{return(await listRecordCards(await getNewDesignPool(),'planning_adoption',{where:{object_id:objectId}})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id)).map(mapAdoption);}
export async function listPlanningImpacts(bookId:string,status?:PlanningImpact['status']):Promise<PlanningImpact[]>{return(await listRecordCards(await getNewDesignPool(),'planning_impact',{where:{book_id:bookId,...(status?{status}:{})}})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id)).map(mapImpact);}

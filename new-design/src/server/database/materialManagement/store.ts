import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  BookViewKey,
  CardArchiveImpactItem,
  CardArchivePreview,
  CardArchiveReceipt,
  CardSummary,
  MaterialFilterCondition,
  MaterialFilterNode,
  MaterialGroup,
  MaterialManagementWorkspace,
  MaterialQueryPage,
  MaterialSortRule,
  MaterialTag,
  SmartMaterialView,
} from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { stableHash } from "../aiContracts/integrity";
import { getNewDesignPool } from "../runtime";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard,type RecordCardDb,type RecordCardRow} from '../recordCards';
import {recordWorkflowAction} from '../cardWorkflow';

type ScopeInput={bookId?:string;spaceId?:string};
type Scope={spaceId:string;bookId:string|null};
type ActorInput={actor?:string;visibility?:"space"|"private"};
type TagInput=ActorInput&{key:string;name:string;aliases:string[];color?:string|null;metadata:Record<string,unknown>;dimensionId?:string;parentId?:string|null;sortOrder?:number;idempotencyKey:string};
type TagRevisionInput=Omit<TagInput,"key">&{expectedRevision:number};
type GroupInput=ActorInput&{key:string;name:string;parentId?:string|null;sortOrder:number;idempotencyKey:string};
type GroupRevisionInput=ActorInput&{name:string;parentId?:string|null;sortOrder:number;expectedRevision:number;idempotencyKey:string};
type SmartViewInput=ActorInput&{key:string;name:string;description:string;baseViewKey?:BookViewKey|null;filter:MaterialFilterNode;sort:MaterialSortRule[];grouping:{field?:string};displayColumns:string[];layout:{mode:"list"|"table";[key:string]:unknown};idempotencyKey:string};
type SmartViewRevisionInput=Omit<SmartViewInput,"key"|"baseViewKey">&{expectedRevision:number};

const ACTOR="user";
function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function asArray<T>(value:unknown):T[]{return Array.isArray(value)?value as T[]:[];}

async function resolveScope(client:PoolClient,input:ScopeInput):Promise<Scope>{
  if(Boolean(input.bookId)===Boolean(input.spaceId))throw new NewDesignError("必须且只能指定书籍或公共资源空间。",422);
  if(input.bookId){const book=assertFound((await client.query("SELECT id,space_id,status FROM new_design.books WHERE id=$1",[input.bookId])).rows[0],"书籍不存在。");if(book.status!=="active")throw new NewDesignError("书籍已归档，不能修改资料组织。",409);return{bookId:String(book.id),spaceId:String(book.space_id)};}
  const space=assertFound((await client.query("SELECT id FROM new_design.card_spaces WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM new_design.books WHERE space_id=card_spaces.id)",[input.spaceId])).rows[0],"公共资源空间不存在，或该空间属于一本书。");return{bookId:null,spaceId:String(space.id)};
}

function mapTag(row:Record<string,unknown>):MaterialTag{return{id:String(row.id),spaceId:String(row.space_id),key:String(row.tag_key),name:String(row.name),aliases:asArray<string>(row.aliases),color:row.color?String(row.color):null,metadata:(row.metadata??{}) as Record<string,unknown>,dimensionId:row.dimension_id?String(row.dimension_id):null,parentId:row.parent_id?String(row.parent_id):null,sortOrder:Number(row.sort_order??1000),path:asArray<unknown>(row.path_node_ids).map((id,index)=>({id:String(id),name:String(asArray<unknown>(row.path_names)[index]??row.name)})),childCount:Number(row.child_count??0),status:row.status as MaterialTag["status"],revision:Number(row.revision),currentVersionId:String(row.current_version_id),visibility:row.visibility as MaterialTag["visibility"],memberCount:Number(row.member_count??0),updatedAt:asDate(row.updated_at)};}
function mapGroup(row:Record<string,unknown>):MaterialGroup{return{id:String(row.id),spaceId:String(row.space_id),bookId:row.book_id?String(row.book_id):null,key:String(row.group_key),name:String(row.name),parentId:row.parent_id?String(row.parent_id):null,sortOrder:Number(row.sort_order),status:row.status as MaterialGroup["status"],revision:Number(row.revision),currentVersionId:String(row.current_version_id),visibility:row.visibility as MaterialGroup["visibility"],memberCount:Number(row.member_count??0),updatedAt:asDate(row.updated_at)};}
function mapView(row:Record<string,unknown>):SmartMaterialView{return{id:String(row.id),spaceId:String(row.space_id),bookId:row.book_id?String(row.book_id):null,key:String(row.view_key),baseViewKey:(row.base_view_key??null) as BookViewKey|null,name:String(row.name),description:String(row.description??""),filter:row.filter_ast as MaterialFilterNode,sort:asArray<MaterialSortRule>(row.sort_config),grouping:(row.grouping??{}) as {field?:string},displayColumns:asArray<string>(row.display_columns),layout:(row.layout??{mode:"list"}) as SmartMaterialView["layout"],status:row.status as SmartMaterialView["status"],revision:Number(row.revision),version:Number(row.version),currentVersionId:String(row.current_version_id),visibility:row.visibility as SmartMaterialView["visibility"],updatedAt:asDate(row.updated_at)};}

type MaterialKind='tag'|'group'|'smart_view';
const MATERIAL_TYPES={
  tag:{head:'material_tag',version:'material_tag_version',owner:'tag_id',key:'tag_key',dependency:'tag_version',fields:['name','aliases','color','metadata','path_node_ids','path_names']},
  group:{head:'material_group',version:'material_group_version',owner:'group_id',key:'group_key',dependency:'material_group_version',fields:['name']},
  smart_view:{head:'smart_view',version:'smart_view_version',owner:'smart_view_id',key:'view_key',dependency:'smart_view_version',fields:['version','name','description','filter_ast','sort_config','grouping','display_columns','layout']},
} as const;

async function materialRows(db:RecordCardDb,kind:MaterialKind,spaceId?:string,id?:string):Promise<RecordCardRow[]>{
  const spec=MATERIAL_TYPES[kind];
  const rows=id?[await findRecordCard(db,id,spec.head,{spaceId,includeArchived:true})].filter((row):row is RecordCardRow=>!!row):await listRecordCards(db,spec.head,{spaceId,includeArchived:true});
  const versions=new Map((await listRecordCards(db,spec.version,{includeArchived:true})).map(row=>[row.id,row]));
  const memberships=kind==='smart_view'?[]:await listRecordCards(db,`material_${kind}_membership`,{spaceId,where:{status:'active'}});
  const children=kind==='tag'?await listRecordCards(db,'material_tag',{spaceId,where:{status:'active'}}):[];
  return rows.map(row=>{
    const version=assertFound(versions.get(String(row.current_version_id)),"资料组织的正式版本不存在。");
    return{...row,...Object.fromEntries(spec.fields.map(field=>[field,version[field]])),
      member_count:memberships.filter(member=>member[spec.owner]===row.id).length,
      child_count:children.filter(child=>child.parent_id===row.id).length};
  });
}
async function materialRow(db:RecordCardDb,kind:MaterialKind,id:string,spaceId?:string):Promise<RecordCardRow>{
  return assertFound((await materialRows(db,kind,spaceId,id))[0],"资料组织对象不存在或不属于当前空间。");
}
async function saveMaterial(client:PoolClient,scope:Scope,kind:MaterialKind,id:string,head:Record<string,unknown>,content:Record<string,unknown>,actor:string,prior?:RecordCardRow):Promise<string>{
  const spec=MATERIAL_TYPES[kind],versionId=randomUUID(),revision=prior?prior.revision+1:1,now=new Date().toISOString();
  const values={...(prior??{}),...head,id,space_id:scope.spaceId,current_version_id:versionId,revision,updated_by:actor,updated_at:now};
  if(prior)await replaceRecordCard(client,{id,spaceId:prior.recordSpaceId,typeKey:spec.head,title:String(content.name),values});
  else await createRecordCard(client,{id,spaceId:scope.spaceId,typeKey:spec.head,title:String(content.name),values:{status:'active',created_by:actor,created_at:now,...values}});
  await createRecordCard(client,{id:versionId,spaceId:scope.spaceId,typeKey:spec.version,title:String(content.name),values:{id:versionId,[spec.owner]:id,version:revision,...content,created_by:actor,created_at:now}});
  await client.query("SELECT new_design.register_dependency_resource($1,$2,$3)",[spec.dependency,id,versionId]);
  return versionId;
}

export async function getMaterialManagementWorkspace(input:ScopeInput):Promise<MaterialManagementWorkspace>{
  const client=await(await getNewDesignPool()).connect();
  try{
    const scope=await resolveScope(client,input);
    const [tags,groups,views,tagMembers,groupMembers,cards]=await Promise.all([
      materialRows(client,'tag',scope.spaceId),materialRows(client,'group',scope.spaceId),materialRows(client,'smart_view',scope.spaceId),
      listRecordCards(client,'material_tag_membership',{spaceId:scope.spaceId,where:{status:'active'}}),
      listRecordCards(client,'material_group_membership',{spaceId:scope.spaceId,where:{status:'active'}}),
      client.query("SELECT id FROM new_design.cards WHERE space_id=$1",[scope.spaceId]),
    ]);
    const byStatusName=(a:RecordCardRow,b:RecordCardRow)=>a.status.localeCompare(b.status)||String(a.name).localeCompare(String(b.name));
    return{spaceId:scope.spaceId,bookId:scope.bookId,tags:tags.sort(byStatusName).map(mapTag),
      groups:groups.sort((a,b)=>a.status.localeCompare(b.status)||String(a.parent_id??'').localeCompare(String(b.parent_id??''))||Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name))).map(mapGroup),
      views:views.sort(byStatusName).map(mapView),
      memberships:cards.rows.map(card=>({cardId:String(card.id),tagIds:[...new Set(tagMembers.filter(row=>row.card_id===card.id).map(row=>String(row.tag_id)))],groupIds:[...new Set(groupMembers.filter(row=>row.card_id===card.id).map(row=>String(row.group_id)))]}))};
  }finally{client.release();}
}

async function existingEvent(client:PoolClient,spaceId:string,idempotencyKey:string){
  // One space lock also serializes tree moves and protects absent membership/key checks.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`material-space:${spaceId}`]);
  const row=(await client.query("SELECT id,payload,created_at FROM new_design.card_version_actions WHERE action_key LIKE 'material.%' AND payload->>'space_id'=$1 AND payload->>'idempotency_key'=$2",[spaceId,idempotencyKey])).rows[0];
  return row?{...row.payload,id:row.id,created_at:row.created_at}:null;
}
async function addEvent(client:PoolClient,scope:Scope,input:{kind:string;subjectId:string;action:string;expectedRevision?:number;versionId?:string|null;detail?:Record<string,unknown>;idempotencyKey:string;actor?:string}){
  const kind:MaterialKind=input.kind.startsWith('tag')?'tag':input.kind.startsWith('group')?'group':'smart_view';
  const subject=assertFound(await findRecordCard(client,input.subjectId,MATERIAL_TYPES[kind].head,{spaceId:scope.spaceId,includeArchived:true}),"操作对象不存在。");
  await recordWorkflowAction(client,{cardId:subject.recordCardId,actionKey:`material.${input.kind}.${input.action}`,payload:{space_id:scope.spaceId,book_id:scope.bookId,subject_kind:input.kind,subject_id:input.subjectId,action:input.action,expected_revision:input.expectedRevision??null,result_version_id:input.versionId??null,detail:input.detail??{},idempotency_key:input.idempotencyKey,created_by:input.actor??ACTOR}});
}

async function ensureDefaultTagDimension(client:PoolClient,spaceId:string):Promise<string>{
  const existing=(await listRecordCards(client,'material_tag_dimension',{where:{owner_space_id:spaceId,dimension_key:'default_tags'}}))[0];
  if(existing)return existing.id;
  const id=randomUUID(),versionId=randomUUID(),now=new Date().toISOString();
  await createRecordCard(client,{id,spaceId,typeKey:'material_tag_dimension',title:'通用标签',values:{id,dimension_key:'default_tags',name:'通用标签',description:'兼容常用标签的默认维度。',scope:'book',owner_space_id:spaceId,current_version_id:versionId,status:'active',read_only:false,revision:1,created_by:ACTOR,updated_by:ACTOR,created_at:now,updated_at:now}});
  await createRecordCard(client,{id:versionId,spaceId,typeKey:'material_tag_dimension_version',title:'通用标签',values:{id:versionId,dimension_id:id,version:1,name:'通用标签',description:'兼容常用标签的默认维度。',status:'active',created_by:ACTOR,created_at:now}});
  return id;
}

async function tagPath(client:PoolClient,id:string):Promise<{ids:string[];names:string[]}>{
  const ids:string[]=[],names:string[]=[],seen=new Set<string>();let current:string|null=id;
  while(current){
    if(seen.has(current))throw new NewDesignError("标签树不能形成循环。",422);seen.add(current);
    const tag=assertFound(await findRecordCard(client,current,'material_tag',{includeArchived:true}),"标签父节点不存在。");
    const version=assertFound(await findRecordCard(client,String(tag.current_version_id),'material_tag_version'),"标签正式版本不存在。");
    ids.unshift(tag.id);names.unshift(String(version.name));current=tag.parent_id??null;
  }
  return{ids,names};
}

async function validateMaterialParent(client:PoolClient,scope:Scope,kind:'tag'|'group',id:string,parentId:string|null,dimensionId?:string):Promise<void>{
  const seen=new Set([id]);let current=parentId;
  while(current){
    if(seen.has(current))throw new NewDesignError("资料组织树不能形成循环。",422);seen.add(current);
    const parent=assertFound(await findRecordCard(client,current,MATERIAL_TYPES[kind].head,{spaceId:scope.spaceId}),"上级对象不属于当前空间。");
    if(kind==='tag'&&parent.dimension_id!==dimensionId)throw new NewDesignError("标签上级必须在同一维度中。",422);
    if(kind==='group'&&(parent.book_id??null)!==scope.bookId)throw new NewDesignError("分组上级必须属于同一本书。",422);
    if(kind==='group'&&parent.status!=='active')throw new NewDesignError("已归档分组不能作为上级。",409);
    current=parent.parent_id??null;
  }
}
async function refreshTagDescendantPaths(client:PoolClient,ancestorId:string,actor:string):Promise<void>{
  const ancestor=assertFound(await findRecordCard(client,ancestorId,'material_tag'),"标签不存在。");
  const tags=await listRecordCards(client,'material_tag',{spaceId:String(ancestor.space_id),includeArchived:true});
  const queue=[ancestorId],seen=new Set(queue);
  while(queue.length){
    const parentId=queue.shift()!;
    for(const row of tags.filter(tag=>tag.parent_id===parentId).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))){
      if(seen.has(row.id))throw new NewDesignError("标签树不能形成循环。",422);seen.add(row.id);queue.push(row.id);
      const current=assertFound(await findRecordCard(client,String(row.current_version_id),'material_tag_version'),"标签正式版本不存在。"),path=await tagPath(client,parentId);
      await saveMaterial(client,{spaceId:String(row.space_id),bookId:null},'tag',row.id,{},{
        name:current.name,aliases:current.aliases,color:current.color,metadata:current.metadata??{},status:row.status,parent_id:row.parent_id,sort_order:row.sort_order,path_node_ids:[...path.ids,row.id],path_names:[...path.names,current.name],
      },actor,row);
    }
  }
}

async function uniqueMaterialKey(client:PoolClient,scope:Scope,kind:MaterialKind,key:string):Promise<void>{
  const spec=MATERIAL_TYPES[kind];
  if((await listRecordCards(client,spec.head,{spaceId:scope.spaceId,includeArchived:true,where:{[spec.key]:key}})).length)throw new NewDesignError("资料组织标识已存在。",409);
}

export async function createMaterialTag(scopeInput:ScopeInput,input:TagInput):Promise<MaterialTag>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput),duplicate=await existingEvent(client,scope.spaceId,input.idempotencyKey);
    if(duplicate){const result=mapTag(await materialRow(client,'tag',String(duplicate.subject_id),scope.spaceId));await client.query("COMMIT");return result;}
    await uniqueMaterialKey(client,scope,'tag',input.key);
    const id=randomUUID(),dimensionId=input.dimensionId??await ensureDefaultTagDimension(client,scope.spaceId),actor=input.actor??ACTOR;
    const dimension=assertFound(await findRecordCard(client,dimensionId,'material_tag_dimension'),"标签维度不存在。");
    if(dimension.owner_space_id!==scope.spaceId||dimension.status!=='active')throw new NewDesignError("标签维度不属于当前空间或已归档。",409);
    await validateMaterialParent(client,scope,'tag',id,input.parentId??null,dimensionId);
    const path=input.parentId?await tagPath(client,input.parentId):{ids:[],names:[]};
    const versionId=await saveMaterial(client,scope,'tag',id,{tag_key:input.key,dimension_id:dimensionId,parent_id:input.parentId??null,sort_order:input.sortOrder??1000,visibility:input.visibility??'space'},{
      name:input.name,aliases:input.aliases,color:input.color??null,metadata:input.metadata,status:'active',parent_id:input.parentId??null,sort_order:input.sortOrder??1000,path_node_ids:[...path.ids,id],path_names:[...path.names,input.name],
    },actor);
    await addEvent(client,scope,{kind:'tag',subjectId:id,action:'create',versionId,idempotencyKey:input.idempotencyKey,actor});
    const result=mapTag(await materialRow(client,'tag',id,scope.spaceId));await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function reviseMaterialTag(scopeInput:ScopeInput,id:string,input:TagRevisionInput,status?:"active"|"archived"):Promise<MaterialTag>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput);
    if(await existingEvent(client,scope.spaceId,input.idempotencyKey)){const result=mapTag(await materialRow(client,'tag',id,scope.spaceId));await client.query("COMMIT");return result;}
    const row=assertFound(await findRecordCard(client,id,'material_tag',{spaceId:scope.spaceId,lock:true}),"标签不存在。");
    if(row.revision!==input.expectedRevision)throw new NewDesignError("标签已被其他页面修改，请刷新后重试。",409);
    const nextStatus=status??row.status,parentId=input.parentId===undefined?row.parent_id:input.parentId,sortOrder=input.sortOrder??Number(row.sort_order),actor=input.actor??ACTOR;
    await validateMaterialParent(client,scope,'tag',id,parentId??null,String(row.dimension_id));
    const path=parentId?await tagPath(client,String(parentId)):{ids:[],names:[]};
    const versionId=await saveMaterial(client,scope,'tag',id,{status:nextStatus,parent_id:parentId,sort_order:sortOrder,visibility:input.visibility??row.visibility},{
      name:input.name,aliases:input.aliases,color:input.color??null,metadata:input.metadata,status:nextStatus,parent_id:parentId,sort_order:sortOrder,path_node_ids:[...path.ids,id],path_names:[...path.names,input.name],
    },actor,row);
    await refreshTagDescendantPaths(client,id,actor);
    await addEvent(client,scope,{kind:'tag',subjectId:id,action:nextStatus!==row.status?nextStatus==='archived'?'archive':'restore':parentId!==row.parent_id?'move':'revise',expectedRevision:input.expectedRevision,versionId,idempotencyKey:input.idempotencyKey,actor,detail:{organizationOnly:true}});
    const result=mapTag(await materialRow(client,'tag',id,scope.spaceId));await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function changeMemberships(client:PoolClient,scope:Scope,kind:'tag'|'group',subjectId:string,input:{cardIds:string[];action:'add'|'remove';actor?:string}):Promise<void>{
  const spec=MATERIAL_TYPES[kind],subject=assertFound(await findRecordCard(client,subjectId,spec.head,{spaceId:scope.spaceId,lock:true}),"标签或分组不存在。");
  if(subject.status!=='active')throw new NewDesignError("标签或分组已归档。",409);
  const actor=input.actor??ACTOR,typeKey=`material_${kind}_membership`;
  for(const cardId of [...new Set(input.cardIds)]){
    const card=assertFound((await client.query("SELECT id,current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2",[cardId,scope.spaceId])).rows[0],"资料不属于当前空间。");
    const membership=(await listRecordCards(client,typeKey,{spaceId:scope.spaceId,where:{[spec.owner]:subjectId,card_id:cardId},includeArchived:true,lock:true})).sort((a,b)=>asDate(b.created_at).localeCompare(asDate(a.created_at)))[0];
    if(input.action==='add'&&membership?.status==='active'||input.action==='remove'&&membership?.status!=='active')continue;
    const id=membership?.id??randomUUID(),revision=membership?membership.revision+1:1,versionId=randomUUID(),status=input.action==='add'?'active':'ended',now=new Date().toISOString();
    const values={...(membership??{}),id,space_id:scope.spaceId,[spec.owner]:subjectId,card_id:cardId,status,revision,current_version_id:versionId,...(kind==='group'?{is_primary:false,sort_order:membership?.sort_order??1000}:{}),updated_by:actor,updated_at:now};
    if(membership)await replaceRecordCard(client,{id,spaceId:membership.recordSpaceId,typeKey,values});
    else await createRecordCard(client,{id,spaceId:scope.spaceId,typeKey,title:'资料组织引用',values:{created_by:actor,created_at:now,...values}});
    await createRecordCard(client,{id:versionId,spaceId:scope.spaceId,typeKey:`${typeKey}_version`,title:'资料组织引用历史',values:{id:versionId,membership_id:id,revision,[`${kind}_version_id`]:subject.current_version_id,card_version_id:card.current_version_id,...(kind==='group'?{sort_order:membership?.sort_order??1000}:{}),status,created_by:actor,created_at:now}});
  }
}
export async function bulkChangeTagMemberships(scopeInput:ScopeInput,input:{tagId:string;cardIds:string[];action:"add"|"remove";idempotencyKey:string;actor?:string}):Promise<MaterialManagementWorkspace>{
  const client=await(await getNewDesignPool()).connect();
  try{await client.query("BEGIN");const scope=await resolveScope(client,scopeInput);
    if(!await existingEvent(client,scope.spaceId,input.idempotencyKey)){
      await changeMemberships(client,scope,'tag',input.tagId,input);
      await addEvent(client,scope,{kind:'tag_membership',subjectId:input.tagId,action:input.action==='add'?'add_member':'remove_member',idempotencyKey:input.idempotencyKey,actor:input.actor,detail:{cardIds:[...new Set(input.cardIds)]}});
    }await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getMaterialManagementWorkspace(scopeInput);
}

export async function createMaterialGroup(scopeInput:ScopeInput,input:GroupInput):Promise<MaterialGroup>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput),duplicate=await existingEvent(client,scope.spaceId,input.idempotencyKey);
    if(duplicate){const result=mapGroup(await materialRow(client,'group',String(duplicate.subject_id),scope.spaceId));await client.query("COMMIT");return result;}
    await uniqueMaterialKey(client,scope,'group',input.key);
    const id=randomUUID(),actor=input.actor??ACTOR;await validateMaterialParent(client,scope,'group',id,input.parentId??null);
    const versionId=await saveMaterial(client,scope,'group',id,{book_id:scope.bookId,group_key:input.key,parent_id:input.parentId??null,sort_order:input.sortOrder,visibility:input.visibility??'space'},{
      name:input.name,parent_id:input.parentId??null,sort_order:input.sortOrder,status:'active',
    },actor);
    await addEvent(client,scope,{kind:'group',subjectId:id,action:'create',versionId,idempotencyKey:input.idempotencyKey,actor});
    const result=mapGroup(await materialRow(client,'group',id,scope.spaceId));await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function reviseMaterialGroup(scopeInput:ScopeInput,id:string,input:GroupRevisionInput):Promise<MaterialGroup>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput);
    if(await existingEvent(client,scope.spaceId,input.idempotencyKey)){const result=mapGroup(await materialRow(client,'group',id,scope.spaceId));await client.query("COMMIT");return result;}
    const row=assertFound(await findRecordCard(client,id,'material_group',{spaceId:scope.spaceId,lock:true}),"分组不存在。");
    if(row.revision!==input.expectedRevision)throw new NewDesignError("分组已被其他页面修改，请刷新后重试。",409);
    const parentId=input.parentId??null,actor=input.actor??ACTOR;
    await validateMaterialParent(client,scope,'group',id,parentId);
    const versionId=await saveMaterial(client,scope,'group',id,{parent_id:parentId,sort_order:input.sortOrder,visibility:input.visibility??row.visibility},{
      name:input.name,parent_id:parentId,sort_order:input.sortOrder,status:row.status,
    },actor,row);
    await addEvent(client,scope,{kind:'group',subjectId:id,action:parentId!==row.parent_id?'move':input.sortOrder!==Number(row.sort_order)?'reorder':'revise',expectedRevision:input.expectedRevision,versionId,idempotencyKey:input.idempotencyKey,actor});
    const result=mapGroup(await materialRow(client,'group',id,scope.spaceId));await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
async function versionGroupStatus(client:PoolClient,scope:Scope,row:RecordCardRow,status:"active"|"archived",actor:string):Promise<string>{
  const current=assertFound(await findRecordCard(client,String(row.current_version_id),'material_group_version'),"分组版本不存在。");
  return saveMaterial(client,scope,'group',row.id,{status,parent_id:row.parent_id},{name:current.name,parent_id:row.parent_id,sort_order:row.sort_order,status},actor,row);
}
export async function archiveMaterialGroup(scopeInput:ScopeInput,id:string,input:{expectedRevision:number;childMode:"promote"|"archive_tree";idempotencyKey:string;actor?:string}):Promise<MaterialManagementWorkspace>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput);
    if(!await existingEvent(client,scope.spaceId,input.idempotencyKey)){
      const row=assertFound(await findRecordCard(client,id,'material_group',{spaceId:scope.spaceId,lock:true}),"分组不存在。");
      if(row.revision!==input.expectedRevision)throw new NewDesignError("分组已被其他页面修改，请刷新后重试。",409);
      const actor=input.actor??ACTOR,groups=await listRecordCards(client,'material_group',{spaceId:scope.spaceId,where:{status:'active'},lock:true});
      if(input.childMode==='promote'){
        for(const child of groups.filter(group=>group.parent_id===id))await versionGroupStatus(client,scope,{...child,parent_id:row.parent_id},'active',actor);
      }else{
        const queue=[id],seen=new Set(queue);
        while(queue.length){
          const parentId=queue.shift()!;
          for(const child of groups.filter(group=>group.parent_id===parentId)){
            if(seen.has(child.id))throw new NewDesignError("分组树不能形成循环。",422);seen.add(child.id);queue.push(child.id);
            await versionGroupStatus(client,scope,child,'archived',actor);
          }
        }
      }
      const versionId=await versionGroupStatus(client,scope,row,'archived',actor);
      await addEvent(client,scope,{kind:'group',subjectId:id,action:input.childMode==='promote'?'promote_children':'archive_tree',expectedRevision:input.expectedRevision,versionId,idempotencyKey:input.idempotencyKey,actor,detail:{organizationOnly:true}});
    }await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getMaterialManagementWorkspace(scopeInput);
}
export async function bulkChangeGroupMemberships(scopeInput:ScopeInput,input:{groupId:string;cardIds:string[];action:"add"|"remove";idempotencyKey:string;actor?:string}):Promise<MaterialManagementWorkspace>{
  const client=await(await getNewDesignPool()).connect();
  try{await client.query("BEGIN");const scope=await resolveScope(client,scopeInput);
    if(!await existingEvent(client,scope.spaceId,input.idempotencyKey)){
      await changeMemberships(client,scope,'group',input.groupId,input);
      await addEvent(client,scope,{kind:'group_membership',subjectId:input.groupId,action:input.action==='add'?'add_member':'remove_member',idempotencyKey:input.idempotencyKey,actor:input.actor,detail:{cardIds:[...new Set(input.cardIds)]}});
    }await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getMaterialManagementWorkspace(scopeInput);
}

export async function createSmartMaterialView(scopeInput:ScopeInput,input:SmartViewInput):Promise<SmartMaterialView>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput),duplicate=await existingEvent(client,scope.spaceId,input.idempotencyKey);
    if(duplicate){const result=mapView(await materialRow(client,'smart_view',String(duplicate.subject_id),scope.spaceId));await client.query("COMMIT");return result;}
    await uniqueMaterialKey(client,scope,'smart_view',input.key);
    const id=randomUUID(),actor=input.actor??ACTOR;
    const versionId=await saveMaterial(client,scope,'smart_view',id,{book_id:scope.bookId,view_key:input.key,base_view_key:input.baseViewKey??null,visibility:input.visibility??'space'},{
      name:input.name,description:input.description,filter_ast:input.filter,sort_config:input.sort,grouping:input.grouping,display_columns:input.displayColumns,layout:input.layout,copied_from_version_id:null,
    },actor);
    await addEvent(client,scope,{kind:'smart_view',subjectId:id,action:'create',versionId,idempotencyKey:input.idempotencyKey,actor});
    const result=mapView(await materialRow(client,'smart_view',id,scope.spaceId));await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function reviseSmartMaterialView(scopeInput:ScopeInput,id:string,input:SmartViewRevisionInput,status?:"active"|"archived",copiedFromVersionId?:string|null):Promise<SmartMaterialView>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput);
    if(await existingEvent(client,scope.spaceId,input.idempotencyKey)){const result=mapView(await materialRow(client,'smart_view',id,scope.spaceId));await client.query("COMMIT");return result;}
    const row=assertFound(await findRecordCard(client,id,'smart_view',{spaceId:scope.spaceId,lock:true}),"智能视图不存在。");
    if(row.revision!==input.expectedRevision)throw new NewDesignError("智能视图已被其他页面修改，请刷新后重试。",409);
    const nextStatus=status??row.status,actor=input.actor??ACTOR;
    const versionId=await saveMaterial(client,scope,'smart_view',id,{status:nextStatus,visibility:input.visibility??row.visibility},{
      name:input.name,description:input.description,filter_ast:input.filter,sort_config:input.sort,grouping:input.grouping,display_columns:input.displayColumns,layout:input.layout,copied_from_version_id:copiedFromVersionId??null,
    },actor,row);
    await addEvent(client,scope,{kind:'smart_view',subjectId:id,action:nextStatus!==row.status?nextStatus==='archived'?'archive':'restore':'revise',expectedRevision:input.expectedRevision,versionId,idempotencyKey:input.idempotencyKey,actor,detail:{queryDefinitionOnly:true}});
    const result=mapView(await materialRow(client,'smart_view',id,scope.spaceId));await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function copySmartMaterialView(scopeInput:ScopeInput,id:string,input:{key:string;name:string;idempotencyKey:string;actor?:string}):Promise<SmartMaterialView>{
  const workspace=await getMaterialManagementWorkspace(scopeInput),source=assertFound(workspace.views.find(view=>view.id===id),"智能视图不存在或不属于当前空间。");
  return createSmartMaterialView(scopeInput,{key:input.key,name:input.name,description:source.description,baseViewKey:null,filter:source.filter,sort:source.sort,grouping:source.grouping,displayColumns:source.displayColumns,layout:source.layout,idempotencyKey:input.idempotencyKey,actor:input.actor});
}

const CONDITION_SQL:Partial<Record<MaterialFilterCondition["field"],Partial<Record<MaterialFilterCondition["operator"],(index:number)=>string>>>>={
  content_type:{equals:i=>`type.type_key=$${i}`,not_equals:i=>`type.type_key<>$${i}`,in:i=>`type.type_key=ANY($${i}::text[])`,not_in:i=>`NOT(type.type_key=ANY($${i}::text[]))`},
  card_status:{equals:i=>`card.status=$${i}`,in:i=>`card.status=ANY($${i}::text[])`},
  story_time:{gte:i=>`time.start_order>=$${i}::numeric`,lte:i=>`time.start_order<=$${i}::numeric`,between:i=>`time.start_order BETWEEN ($${i}::jsonb->>0)::numeric AND ($${i}::jsonb->>1)::numeric`,exists:()=>`time.card_id IS NOT NULL`,not_exists:()=>`time.card_id IS NULL`},
  relation_exists:{exists:()=>`EXISTS(SELECT 1 FROM new_design.card_relations relation WHERE relation.status='active' AND (relation.source_card_id=card.id OR relation.target_card_id=card.id))`,not_exists:()=>`NOT EXISTS(SELECT 1 FROM new_design.card_relations relation WHERE relation.status='active' AND (relation.source_card_id=card.id OR relation.target_card_id=card.id))`},
  source:{equals:i=>`current_version.source=$${i}`,in:i=>`current_version.source=ANY($${i}::text[])`},
  updated_at:{gte:i=>`card.updated_at>=$${i}::timestamptz`,lte:i=>`card.updated_at<=$${i}::timestamptz`,between:i=>`card.updated_at BETWEEN ($${i}::jsonb->>0)::timestamptz AND ($${i}::jsonb->>1)::timestamptz`},
};
function hasField(node:MaterialFilterNode,field:MaterialFilterCondition["field"]):boolean{return node.kind==="condition"?node.field===field:node.items.some(item=>hasField(item,field));}
type ReadFilterRecords=(typeKey:string)=>Promise<RecordCardRow[]>;
async function compileFilter(node:MaterialFilterNode,params:unknown[],records:ReadFilterRecords):Promise<string>{
  if(node.kind==="group"){
    if(!node.items.length)return "TRUE";
    const parts:string[]=[];for(const item of node.items)parts.push(await compileFilter(item,params,records));
    return `(${parts.join(node.operator==="and"?" AND ":" OR ")})`;
  }
  const factory=CONDITION_SQL[node.field]?.[node.operator];
  if(factory){
    if(!['exists','not_exists'].includes(node.operator))params.push(node.operator==="between"?JSON.stringify(node.value):node.value);
    return factory(params.length);
  }
  const allowed=node.field==='tag'?['equals','in','exists','not_exists']:node.field==='association_exists'?['exists','not_exists']:['equals','in'];
  if(!allowed.includes(node.operator))throw new NewDesignError(`筛选字段 ${node.field} 不支持 ${node.operator}。`,422);
  const values=new Set((Array.isArray(node.value)?node.value:[node.value]).map(String)),ids=new Set<string>();
  const add=(value:unknown)=>{if(typeof value==='string')ids.add(value);};
  if(node.field==='tag'){
    const memberships=(await records('material_tag_membership')).filter(row=>row.status==='active');
    if(['exists','not_exists'].includes(node.operator))memberships.forEach(row=>add(row.card_id));
    else{
      const tags=await records('material_tag'),byId=new Map(tags.map(row=>[row.id,row]));
      const versions=new Map((await records('material_tag_version')).map(row=>[row.id,row]));
      const selected=new Set(tags.filter(tag=>tag.status==='active'&&asArray<string>(versions.get(String(tag.current_version_id))?.path_node_ids).some(id=>values.has(id)||values.has(String(byId.get(id)?.tag_key)))).map(tag=>tag.id));
      memberships.filter(row=>selected.has(String(row.tag_id))).forEach(row=>add(row.card_id));
    }
  }else if(node.field==='canonical_status'){
    for(const row of await records('canonical_fact'))if(values.has(String(row.status))){add(row.subject_card_id);add(row.object_card_id);}
  }else if(node.field==='candidate_status'){
    const candidates=new Set((await records('research_candidate')).filter(row=>values.has(String(row.status))).map(row=>row.id));
    for(const row of await records('research_candidate_adoption'))if(candidates.has(String(row.candidate_id)))add(row.target_card_id);
  }else if(node.field==='chapter'){
    values.forEach(add);for(const row of await records('narrative_placement'))if(row.status==='active'&&values.has(String(row.chapter_card_id)))add(row.subject_card_id);
  }else if(node.field==='volume'){
    values.forEach(add);for(const row of await records('planning_object'))if(row.status==='active'&&(values.has(row.id)||values.has(String(row.parent_object_id))))add(row.card_id);
  }else if(node.field==='association_exists'){
    for(const row of await records('card_mount'))if(row.status==='active')add(row.card_id);
  }else throw new NewDesignError(`筛选字段 ${node.field} 不支持 ${node.operator}。`,422);
  // Values are bound parameters; arbitrary filter contents never become SQL.
  params.push([...ids]);
  const match=`card.id::text=ANY($${params.length}::text[])`;
  return node.operator==='not_exists'?`NOT(${match})`:`(${match})`;
}
const SORT_SQL:Record<MaterialSortRule["field"],string>={title:"card.title",content_type:"type.name",updated_at:"card.updated_at",created_at:"card.created_at",story_time:"time.start_order"};

export async function queryMaterials(scopeInput:ScopeInput,input:{viewId?:string;filter?:MaterialFilterNode;sort?:MaterialSortRule[];cursor?:string;limit?:number}):Promise<MaterialQueryPage>{
  const client=await(await getNewDesignPool()).connect();
  try{
    const scope=await resolveScope(client,scopeInput);
    let filter=input.filter??({kind:"group",operator:"and",items:[]} as MaterialFilterNode),sort=input.sort??[{field:"updated_at",direction:"desc"} as MaterialSortRule];
    if(input.viewId){const view=await materialRow(client,'smart_view',input.viewId,scope.spaceId);if(view.status!=='active')throw new NewDesignError("智能视图已归档。",404);filter=view.filter_ast;sort=asArray<MaterialSortRule>(view.sort_config);}
    const cache=new Map<string,Promise<RecordCardRow[]>>();
    const records:ReadFilterRecords=typeKey=>{if(!cache.has(typeKey))cache.set(typeKey,listRecordCards(client,typeKey,{includeArchived:true}));return cache.get(typeKey)!;};
    const params:unknown[]=[scope.spaceId],parts=[await compileFilter(filter,params,records)];
    if(!hasField(filter,"card_status"))parts.unshift("card.status='active'");
    if(input.cursor){params.push(input.cursor);parts.push(`card.id>$${params.length}::uuid`);}
    const where=parts.join(" AND "),limit=Math.min(100,Math.max(1,input.limit??40));
    const order=sort.slice(0,3).map(rule=>{
      if(!SORT_SQL[rule.field]||!['asc','desc'].includes(rule.direction))throw new NewDesignError("资料排序规则无效。",422);
      return `${SORT_SQL[rule.field]} ${rule.direction.toUpperCase()} NULLS LAST`;
    }).concat("card.id ASC").join(",");
    const timeJoin=`LEFT JOIN LATERAL (
      SELECT timing.values->>'card_id' card_id,(timing.values->>'start_order')::numeric start_order
      FROM new_design.cards timing JOIN new_design.card_types timing_type ON timing_type.id=timing.card_type_id AND timing_type.type_key='story_time_position'
      WHERE timing.values->>'card_id'=card.id::text AND timing.values->>'space_id'=card.space_id::text
    ) time ON TRUE`;
    const from=`FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal
      JOIN new_design.card_versions current_version ON current_version.id=card.current_version_id ${timeJoin}`;
    const count=await client.query(`SELECT LEAST(count(*),10001) total ${from} WHERE card.space_id=$1 AND ${where}`,params);
    params.push(limit+1);
    const rows=(await client.query(`SELECT card.*,type.type_key,type.name card_type_name,version.version type_version,time.start_order story_time_start ${from}
      JOIN new_design.card_type_versions version ON version.id=card.type_version_id
      WHERE card.space_id=$1 AND ${where} ORDER BY ${order} LIMIT $${params.length}`,params)).rows;
    const tags=(await materialRows(client,'tag',scope.spaceId)).filter(row=>row.status==='active').sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    const groups=(await materialRows(client,'group',scope.spaceId)).filter(row=>row.status==='active').sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name)));
    const tagMembers=(await records('material_tag_membership')).filter(row=>row.status==='active'),groupMembers=(await records('material_group_membership')).filter(row=>row.status==='active');
    const items=rows.slice(0,limit).map(row=>({...mapCard(row),typeKey:String(row.type_key),
      tagIds:tags.filter(tag=>tagMembers.some(member=>member.tag_id===tag.id&&member.card_id===row.id)).map(tag=>tag.id),
      groupIds:groups.filter(group=>groupMembers.some(member=>member.group_id===group.id&&member.card_id===row.id)).map(group=>group.id),
      storyTimeStart:row.story_time_start==null?null:Number(row.story_time_start)}));
    return{items,nextCursor:rows.length>limit?items.at(-1)?.id??null:null,totalCapped:Number(count.rows[0]?.total??0)};
  }finally{client.release();}
}

async function buildArchiveImpacts(client:PoolClient,scope:Scope,cardId:string):Promise<CardArchiveImpactItem[]>{
  const impacts:CardArchiveImpactItem[]=[];
  const append=(key:string,label:string,level:CardArchiveImpactItem["level"],rows:Array<{id:string;label:string}>)=>{
    if(rows.length)impacts.push({key,label,level,count:rows.length,samples:rows.sort((a,b)=>a.id.localeCompare(b.id)).slice(0,6)});
  };
  const read=async(typeKey:string,predicate:(row:RecordCardRow)=>boolean,label:(row:RecordCardRow)=>unknown)=>(await listRecordCards(client,typeKey,{includeArchived:true})).filter(predicate).map(row=>({id:row.id,label:String(label(row)??'')}));
  append('primary_forms','以此资料为主项的创作表单','blocking',await read('card_group_form_instance',row=>row.primary_card_id===cardId,row=>row.title));
  append('mounts','创作表单中的关联引用','risk',await read('card_mount',row=>row.card_id===cardId&&row.status==='active',row=>row.slot_key));
  append('relations','资料关系','risk',(await client.query("SELECT id,relation_type_id::text label FROM new_design.card_relations WHERE (source_card_id=$1 OR target_card_id=$1) AND status='active'",[cardId])).rows);
  append('canonical_facts','正式事实','recompute',await read('canonical_fact',row=>(row.subject_card_id===cardId||row.object_card_id===cardId)&&['proposed','confirmed','stale'].includes(row.status),row=>row.predicate));
  append('story_timings','故事时间','recompute',await read('story_event_timing',row=>(row.event_card_id===cardId||row.relative_to_event_card_id===cardId)&&row.status==='active',row=>row.start_label??row.time_mode));
  append('narrative','章节与正文位置','risk',await read('narrative_placement',row=>[row.subject_card_id,row.chapter_card_id,row.scene_card_id].includes(cardId)&&row.status==='active',row=>row.role));
  append('text_anchors','正文锚点','risk',(await client.query("SELECT id,role label FROM new_design.text_anchors WHERE subject_card_id=$1 OR chapter_card_id=$1 OR scene_card_id=$1",[cardId])).rows);
  append('state_changes','状态变化记录','recompute',await read('state_change',row=>row.subject_kind==='card'&&row.subject_id===cardId||row.cause_event_card_id===cardId,row=>row.state_key));
  append('knowledge','角色与读者认知记录','recompute',[
    ...await read('knowledge_state_change',row=>row.holder_card_id===cardId,row=>row.holder_key),
    ...await read('epistemic_claim',row=>row.subject_card_id===cardId||row.object_card_id===cardId,row=>row.predicate),
  ]);
  append('planning','卷章场景规划','blocking',await read('planning_object',row=>row.card_id===cardId&&row.status==='active',row=>row.title));
  append('research_adoptions','研究提案采用记录','information',await read('research_candidate_adoption',row=>row.target_card_id===cardId,row=>row.action));
  append('assets','附加素材','risk',(await client.query("SELECT id,label FROM new_design.asset_links WHERE owner_kind='card_version' AND owner_stable_id=$1 AND status='active'",[cardId])).rows);
  append('dependencies','待重新计算的下游资料','recompute',(await client.query("SELECT edge.id,resource.resource_kind label FROM new_design.dependency_resources source JOIN new_design.dependency_edges edge ON edge.source_resource_id=source.id AND edge.status='active' JOIN new_design.dependency_resources resource ON resource.id=edge.derived_resource_id WHERE source.resource_kind='card_version' AND source.stable_object_id=$1",[cardId])).rows);
  append('tags_groups','标签与分组引用','information',[
    ...await read('material_tag_membership',row=>row.card_id===cardId&&row.status==='active',()=>'组织引用'),
    ...await read('material_group_membership',row=>row.card_id===cardId&&row.status==='active',()=>'组织引用'),
  ]);
  return impacts;
}

export async function previewCardArchive(scopeInput:ScopeInput,cardId:string,input:{expectedRevision:number;actor?:string}):Promise<CardArchivePreview>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const scope=await resolveScope(client,scopeInput),card=assertFound((await client.query("SELECT id,revision,status FROM new_design.cards WHERE id=$1 AND space_id=$2",[cardId,scope.spaceId])).rows[0],"资料不存在。");
    if(card.status!=='active')throw new NewDesignError("资料处于归档状态。",409);
    if(Number(card.revision)!==input.expectedRevision)throw new NewDesignError("资料已更新，请重新生成归档影响预览。",409);
    const impacts=await buildArchiveImpacts(client,scope,cardId),snapshot={spaceId:scope.spaceId,bookId:scope.bookId,cardId,expectedRevision:input.expectedRevision,impacts};
    const snapshotHash=stableHash(snapshot),confirmationToken=randomUUID(),tokenHash=createHash('sha256').update(confirmationToken).digest('hex');
    const blockingCount=impacts.filter(item=>item.level==='blocking').reduce((sum,item)=>sum+item.count,0),riskCount=impacts.filter(item=>item.level==='risk').reduce((sum,item)=>sum+item.count,0),recomputeCount=impacts.filter(item=>item.level==='recompute').reduce((sum,item)=>sum+item.count,0);
    const decision=blockingCount?'blocked':riskCount||recomputeCount?'risk_confirmation':'ready',id=randomUUID(),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
    await createRecordCard(client,{id,spaceId:scope.spaceId,typeKey:'card_archive_preview',title:'资料归档影响预览',values:{id,space_id:scope.spaceId,book_id:scope.bookId,card_id:cardId,expected_revision:input.expectedRevision,dependency_snapshot:snapshot,snapshot_hash:snapshotHash,confirmation_token_hash:tokenHash,decision,expires_at:expiresAt,consumed_at:null,created_by:input.actor??ACTOR,created_at:new Date().toISOString()}});
    await client.query("COMMIT");
    return{id,spaceId:scope.spaceId,bookId:scope.bookId,cardId,expectedRevision:input.expectedRevision,snapshotHash,confirmationToken,decision,expiresAt,impacts,blockingCount,riskCount,recomputeCount};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

function mapCard(row:Record<string,unknown>):CardSummary{return{id:String(row.id),cardTypeId:String(row.card_type_id),cardTypeName:String(row.card_type_name),title:String(row.title),status:row.status as CardSummary["status"],revision:Number(row.revision),typeVersionId:String(row.type_version_id),typeVersion:Number(row.type_version),values:row.values as Record<string,unknown>,createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at),archivedAt:row.archived_at?asDate(row.archived_at):null};}
async function writeCardStatusVersion(client:PoolClient,card:Record<string,unknown>,status:"active"|"archived",actor:string){
  const versionId=randomUUID(),nextRevision=Number(card.revision)+1,source=status==='archived'?'archive':'restore';
  await client.query(`INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source,form_version_id,form_resolution_kind)
    SELECT $1,card.id,$2,card.type_version_id,card.title,card.values,$3,previous.form_version_id,previous.form_resolution_kind
    FROM new_design.cards card JOIN new_design.card_versions previous ON previous.id=card.current_version_id WHERE card.id=$4`,[versionId,nextRevision,source,card.id]);
  const localValues=await listRecordCards(client,'card_version_local_value',{where:{card_version_id:card.current_version_id}});
  for(const local of localValues){
    const id=randomUUID();await createRecordCard(client,{id,spaceId:String(card.space_id),typeKey:'card_version_local_value',title:'局部填写快照',values:{id,card_version_id:versionId,field_definition_id:local.field_definition_id,field_definition_version_id:local.field_definition_version_id,value:local.value}});
  }
  await client.query("UPDATE new_design.cards SET status=$2,revision=$3,current_version_id=$4,updated_at=now(),archived_at=CASE WHEN $2='archived' THEN now() ELSE NULL END WHERE id=$1",[card.id,status,nextRevision,versionId]);
  const oldResource=String((await client.query("SELECT new_design.register_dependency_resource('card_version',$1,$2) id",[card.id,card.current_version_id])).rows[0].id),newResource=String((await client.query("SELECT new_design.register_dependency_resource('card_version',$1,$2) id",[card.id,versionId])).rows[0].id),changeId=randomUUID();
  await client.query("SELECT new_design.invalidate_registered_resource($1,$2,$3,'manual',$4,$5,$6)",[oldResource,newResource,status==='archived'?"资料归档，依赖此资料的结果需要复核。":"资料恢复使用，依赖结果需要复核。",changeId,`card-${source}:${changeId}`,status==='archived'?'invalid':'stale']);
  return{versionId,nextRevision,actor};
}
async function readArchiveReceipt(client:PoolClient,scope:Scope,cardId:string,key:string,hash:string):Promise<CardArchiveReceipt|null>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`card-archive:${scope.spaceId}:${key}`]);
  const action=(await client.query("SELECT * FROM new_design.card_version_actions WHERE action_key IN ('card.archive','card.restore') AND payload->>'space_id'=$1 AND payload->>'idempotency_key'=$2",[scope.spaceId,key])).rows[0];
  if(!action)return null;
  if(String(action.card_id)!==cardId||action.input_hash!==hash)throw new NewDesignError("此请求键已用于其他归档操作，请读取原结果。",409);
  return assertFound(action.receipt,"原归档操作缺少结果回执，请核对原记录。") as CardArchiveReceipt;
}
async function archiveReceipt(client:PoolClient,scope:Scope,cardId:string,key:string,hash:string,result:{versionId:string;nextRevision:number},input:{fromStatus:string;toStatus:string;expectedRevision:number;riskAccepted:boolean;previewId?:string;snapshotHash?:string;actor?:string}):Promise<CardArchiveReceipt>{
  const saved=assertFound((await client.query(`SELECT card.*,type.name card_type_name,version.version type_version FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=card.type_version_id WHERE card.id=$1`,[cardId])).rows[0],"操作后资料不可读取。");
  const id=randomUUID(),createdAt=new Date().toISOString(),receipt={id,card:mapCard(saved),riskAccepted:input.riskAccepted,createdAt};
  await recordWorkflowAction(client,{id,createdAt,cardId,cardVersionId:result.versionId,actionKey:input.toStatus==='archived'?'card.archive':'card.restore',inputHash:hash,receipt,payload:{preview_id:input.previewId??null,space_id:scope.spaceId,book_id:scope.bookId,card_id:cardId,from_status:input.fromStatus,to_status:input.toStatus,from_revision:input.expectedRevision,to_revision:result.nextRevision,snapshot_hash:input.snapshotHash??null,risk_accepted:input.riskAccepted,idempotency_key:key,created_by:input.actor??ACTOR}});
  return receipt;
}
export async function confirmCardArchive(scopeInput:ScopeInput,cardId:string,input:{previewId:string;confirmationToken:string;snapshotHash:string;expectedRevision:number;acceptRisk:boolean;idempotencyKey:string;actor?:string}):Promise<CardArchiveReceipt>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput),hash=stableHash({operation:'archive',cardId,...input});
    const prior=await readArchiveReceipt(client,scope,cardId,input.idempotencyKey,hash);
    if(prior){await client.query("COMMIT");return prior;}
    const preview=assertFound(await findRecordCard(client,input.previewId,'card_archive_preview',{spaceId:scope.spaceId,lock:true}),"归档影响预览不存在。");
    if(preview.card_id!==cardId)throw new NewDesignError("归档影响预览不属于当前资料。",404);
    if(preview.consumed_at||new Date(String(preview.expires_at)).getTime()<=Date.now())throw new NewDesignError("归档影响预览已过期，请重新检查。",409);
    if(preview.snapshot_hash!==input.snapshotHash||preview.confirmation_token_hash!==createHash('sha256').update(input.confirmationToken).digest('hex'))throw new NewDesignError("归档确认凭据不匹配，请重新检查。",409);
    const card=assertFound((await client.query("SELECT * FROM new_design.cards WHERE id=$1 AND space_id=$2 FOR UPDATE",[cardId,scope.spaceId])).rows[0],"资料不存在。");
    if(card.status!=='active'||Number(card.revision)!==input.expectedRevision||Number(preview.expected_revision)!==input.expectedRevision)throw new NewDesignError("资料已更新，请重新生成归档影响预览。",409);
    const impacts=await buildArchiveImpacts(client,scope,cardId),snapshot={spaceId:scope.spaceId,bookId:scope.bookId,cardId,expectedRevision:input.expectedRevision,impacts};
    if(stableHash(snapshot)!==input.snapshotHash)throw new NewDesignError("引用关系已经变化，请重新生成归档影响预览。",409);
    if(preview.decision==='blocked')throw new NewDesignError("此资料仍是创作表单主项，需先调整表单后再归档。",409);
    if(preview.decision==='risk_confirmation'&&!input.acceptRisk)throw new NewDesignError("此资料仍有引用或待重算影响，请确认风险后再归档。",422);
    const result=await writeCardStatusVersion(client,card,'archived',input.actor??ACTOR);
    await replaceRecordCard(client,{id:preview.id,spaceId:preview.recordSpaceId,typeKey:'card_archive_preview',values:{...preview,consumed_at:new Date().toISOString()}});
    const receipt=await archiveReceipt(client,scope,cardId,input.idempotencyKey,hash,result,{fromStatus:'active',toStatus:'archived',expectedRevision:input.expectedRevision,riskAccepted:input.acceptRisk,previewId:preview.id,snapshotHash:input.snapshotHash,actor:input.actor});
    await client.query("COMMIT");return receipt;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function restoreArchivedCard(scopeInput:ScopeInput,cardId:string,input:{expectedRevision:number;idempotencyKey:string;actor?:string}):Promise<CardArchiveReceipt>{
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const scope=await resolveScope(client,scopeInput),hash=stableHash({operation:'restore',cardId,...input});
    const prior=await readArchiveReceipt(client,scope,cardId,input.idempotencyKey,hash);
    if(prior){await client.query("COMMIT");return prior;}
    const card=assertFound((await client.query("SELECT * FROM new_design.cards WHERE id=$1 AND space_id=$2 FOR UPDATE",[cardId,scope.spaceId])).rows[0],"资料不存在。");
    if(card.status!=='archived')throw new NewDesignError("资料未归档，无需恢复。",409);
    if(Number(card.revision)!==input.expectedRevision)throw new NewDesignError("资料已被其他页面修改，请刷新后重试。",409);
    const result=await writeCardStatusVersion(client,card,'active',input.actor??ACTOR);
    const receipt=await archiveReceipt(client,scope,cardId,input.idempotencyKey,hash,result,{fromStatus:'archived',toStatus:'active',expectedRevision:input.expectedRevision,riskAccepted:false,actor:input.actor});
    await client.query("COMMIT");return receipt;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

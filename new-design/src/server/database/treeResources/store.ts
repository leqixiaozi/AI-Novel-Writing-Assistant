import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CardTypeTagBinding, FieldDefinition, MaterialTag, StandardFieldSemantic, TagDimension, TreeImpactPreview, TreeSelectionRule } from "../../../common/contracts";
import { validateTreeSelection } from "../../../common/treePolicy";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from "../recordCards";

const SYSTEM_SPACE_ID="00000000-0000-4000-8000-000000000001";

function asDate(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function asArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function generatedKey(prefix: string): string { return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`; }

type Queryable=Pick<PoolClient,"query">;

function selectedDictionaryNodeIds(field:FieldDefinition,value:unknown):string[]{
  if(field.optionSource?.kind!=="dictionary_tree")return[];
  if(field.type==="select")return typeof value==="string"&&value?[value]:[];
  return Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"&&item.length>0):[];
}

export async function validateDictionaryTreeBindings(client:Queryable,fields:FieldDefinition[]):Promise<Record<string,string>>{
  const issues:Record<string,string>={};
  for(const field of fields){
    const source=field.optionSource;
    if(source?.kind!=="dictionary_tree")continue;
    const dictionary=await findRecordCard(client,source.dictionaryId,"dictionary_definition",{includeArchived:true});
    if(!dictionary||dictionary.status==='archived'){issues[field.key]=`${field.name}绑定的字典不存在或已停用。`;continue;}
    if(source.rule.rootNodeId){
      const root=await findRecordCard(client,source.rule.rootNodeId,"dictionary_item",{includeArchived:true});
      if(!root||String(root.dictionary_id)!==source.dictionaryId||root.status!=='active')issues[field.key]=`${field.name}的范围起点不属于所选字典，或已停用。`;
    }
  }
  return issues;
}

export async function validateDictionaryTreeValues(client:Queryable,fields:FieldDefinition[],values:Record<string,unknown>):Promise<Record<string,string>>{
  const issues:Record<string,string>={};
  for(const field of fields){
    const source=field.optionSource;
    if(source?.kind!=="dictionary_tree")continue;
    const selectedIds=selectedDictionaryNodeIds(field,values[field.key]);
    const result=(await listRecordCards(client,"dictionary_item",{includeArchived:true})).filter(item=>String(item.dictionary_id)===source.dictionaryId);
    const nodes=result.map(row=>({id:String(row.id),parentId:row.parent_id?String(row.parent_id):null,status:row.status as "active"|"archived"}));
    const validation=validateTreeSelection(nodes,source.rule,selectedIds);
    if(!validation.valid)issues[field.key]=`${field.name}${validation.message??"的选择无效。"}`;
  }
  return issues;
}

export async function snapshotDictionaryTreeValues(client:Queryable,fields:FieldDefinition[],values:Record<string,unknown>,cardVersionId:string):Promise<void>{
  for(const field of fields){
    const source=field.optionSource;
    if(source?.kind!=="dictionary_tree")continue;
    const selectedIds=selectedDictionaryNodeIds(field,values[field.key]);
    if(!selectedIds.length)continue;
    const items=(await listRecordCards(client,"dictionary_item",{includeArchived:true})).filter(item=>String(item.dictionary_id)===source.dictionaryId&&selectedIds.includes(String(item.id))),versions=await listRecordCards(client,"dictionary_item_version",{includeArchived:true});
    const byId=new Map(items.map(row=>[String(row.id),asArray<unknown>(versions.find(version=>String(version.id)===String(row.current_version_id))?.path_labels).map(String)]));
    const displayPaths=selectedIds.map(id=>byId.get(id)??[]);
    const id=randomUUID();await createRecordCard(client,{id,spaceId:SYSTEM_SPACE_ID,typeKey:"card_tree_value_snapshot",title:`字典取值快照 ${field.key}`,values:{id,card_version_id:cardVersionId,field_key:field.key,tree_kind:"dictionary",node_ids:selectedIds,display_paths:displayPaths,created_at:new Date().toISOString()}});
  }
}

function mapTag(row: Record<string, unknown>): MaterialTag {
  const ids=asArray<unknown>(row.path_node_ids),names=asArray<unknown>(row.path_names);
  return {id:String(row.id),spaceId:String(row.space_id),key:String(row.tag_key),name:String(row.name),aliases:asArray<string>(row.aliases),color:row.color?String(row.color):null,metadata:(row.metadata??{}) as Record<string,unknown>,dimensionId:String(row.dimension_id),parentId:row.parent_id?String(row.parent_id):null,sortOrder:Number(row.sort_order),path:ids.map((id,index)=>({id:String(id),name:String(names[index]??row.name)})),childCount:Number(row.child_count??0),status:row.status as MaterialTag["status"],revision:Number(row.revision),currentVersionId:String(row.current_version_id),visibility:row.visibility as MaterialTag["visibility"],memberCount:Number(row.member_count??0),updatedAt:asDate(row.updated_at)};
}

async function tagsForDimensions(client: Pick<PoolClient,"query">,dimensionIds:string[]):Promise<Map<string,MaterialTag[]>>{
  const grouped=new Map<string,MaterialTag[]>();
  if(!dimensionIds.length)return grouped;
  const tags=(await listRecordCards(client,'material_tag',{includeArchived:true})).filter(tag=>dimensionIds.includes(String(tag.dimension_id)));
  const versions=await listRecordCards(client,'material_tag_version',{includeArchived:true});
  const memberships=await listRecordCards(client,'material_tag_membership',{where:{status:'active'}});
  const versionById=new Map(versions.map(version=>[version.id,version]));
  const rows=tags.flatMap(tag=>{
    const version=versionById.get(String(tag.current_version_id));if(!version)return [];
    return [{...tag,name:version.name,aliases:version.aliases,color:version.color,metadata:version.metadata,path_node_ids:version.path_node_ids,path_names:version.path_names,
      child_count:tags.filter(child=>child.parent_id===tag.id&&child.status==='active').length,
      member_count:memberships.filter(item=>item.tag_id===tag.id).length}];
  }).sort((a,b)=>String(a.dimension_id).localeCompare(String(b.dimension_id))||String(a.parent_id??'').localeCompare(String(b.parent_id??''))||Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name)));
  for(const row of rows){const id=String(row.dimension_id);grouped.set(id,[...(grouped.get(id)??[]),mapTag(row)]);}
  return grouped;
}

export async function listTagDimensions(spaceId?:string):Promise<TagDimension[]>{
  const pool=await getNewDesignPool();
  const rows=(await listRecordCards(pool,'material_tag_dimension',{where:{owner_space_id:spaceId??null}})).filter(row=>row.status!=='archived').sort((a,b)=>String(a.scope).localeCompare(String(b.scope))||String(a.name).localeCompare(String(b.name)));
  const tags=await tagsForDimensions(pool,rows.map(row=>row.id));
  return rows.map(row=>({id:String(row.id),key:String(row.dimension_key),name:String(row.name),description:String(row.description??""),scope:row.scope as TagDimension["scope"],ownerSpaceId:row.owner_space_id?String(row.owner_space_id):null,sourceDimensionId:row.source_dimension_id?String(row.source_dimension_id):null,status:row.status as TagDimension["status"],revision:Number(row.revision),readOnly:Boolean(row.read_only),nodes:tags.get(String(row.id))??[],createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)}));
}

export async function saveTagDimension(input:{id?:string;name:string;description:string;scope:TagDimension["scope"];ownerSpaceId?:string|null;revision?:number;readOnly?:boolean}):Promise<TagDimension>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  const id=input.id??randomUUID();
  try{await client.query("BEGIN");
    const current=input.id?assertFound(await findRecordCard(client,id,'material_tag_dimension',{includeArchived:true,lock:true}),'标签维度不存在。'):null;
    if(current&&Number(current.revision)!==input.revision)throw new NewDesignError('标签维度已更新，请刷新。',409);
    if(current?.read_only)throw new NewDesignError('系统标签维度不能修改。',422);
    const versionId=randomUUID(),now=new Date().toISOString(),spaceId=current?.recordSpaceId??input.ownerSpaceId??SYSTEM_SPACE_ID;
    const values={...(current??{id,dimension_key:generatedKey('dimension'),scope:input.scope,owner_space_id:input.ownerSpaceId??null,read_only:input.readOnly??false,status:'active',created_by:'user',created_at:now}),name:input.name,description:input.description,revision:Number(current?.revision??0)+1,current_version_id:versionId,updated_by:'user',updated_at:now};
    await createRecordCard(client,{id:versionId,spaceId,typeKey:'material_tag_dimension_version',title:input.name,values:{id:versionId,dimension_id:id,version:values.revision,name:input.name,description:input.description,status:values.status,created_by:'user',created_at:now}});
    if(current)await replaceRecordCard(client,{id,spaceId,typeKey:'material_tag_dimension',title:input.name,values});
    else await createRecordCard(client,{id,spaceId,typeKey:'material_tag_dimension',title:input.name,values});
    await client.query("COMMIT");
    return assertFound((await listTagDimensions(input.ownerSpaceId??undefined)).find(item=>item.id===id),"标签维度保存后读取失败。");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function descendantCount(client:PoolClient,typeKey:'dictionary_item'|'material_tag',nodeId:string):Promise<number>{
  const nodes=await listRecordCards(client,typeKey,{includeArchived:true});
  const seen=new Set([nodeId]),pending=[nodeId];
  while(pending.length){const parent=pending.pop()!;for(const node of nodes)if(node.parent_id===parent&&!seen.has(node.id)){seen.add(node.id);pending.push(node.id);}}
  return seen.size-1;
}

export async function previewTreeNodeChange(kind:"dictionary"|"tag",nodeId:string,action:"move"|"archive"):Promise<TreeImpactPreview>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{const descendants=await descendantCount(client,kind==='dictionary'?'dictionary_item':'material_tag',nodeId);
    const directReferenceCount=kind==='dictionary'
      ?(await listRecordCards(client,'card_tree_value_snapshot',{includeArchived:true})).filter(row=>asArray<string>(row.node_ids).includes(nodeId)).length
      :(await listRecordCards(client,'material_tag_membership',{where:{tag_id:nodeId,status:'active'}})).length+(await listRecordCards(client,'material_tag_target_membership',{where:{tag_id:nodeId,status:'active'}})).length;
    const fieldResult=kind==="dictionary"?await client.query("SELECT count(*) count FROM new_design.card_type_versions WHERE fields::text LIKE '%'||$1||'%'",[nodeId]):{rows:[{count:0}]};
    const affectedFieldCount=Number(fieldResult.rows[0].count);
    return{treeKind:kind,nodeId,action,descendantCount:descendants,directReferenceCount,affectedFieldCount,affectedCardCount:directReferenceCount,canApply:true,messages:[descendants?`包含 ${descendants} 个下级节点。`:"没有下级节点。",directReferenceCount?`当前有 ${directReferenceCount} 处正式引用；历史快照会保留。`:"当前没有正式引用。"]};
  }finally{client.release();}
}

export async function listStandardFieldSemantics():Promise<StandardFieldSemantic[]>{
  const rows=await listRecordCards(await getNewDesignPool(),'standard_field_semantic',{where:{status:'active'}});
  return rows.sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(row=>({id:String(row.id),name:String(row.name),description:String(row.description??""),dataType:row.data_type as StandardFieldSemantic["dataType"],recommendedDictionaryId:row.recommended_dictionary_id?String(row.recommended_dictionary_id):null,applicableTypeKeys:asArray<string>(row.applicable_type_keys),allowedSelectionModes:asArray<StandardFieldSemantic["allowedSelectionModes"][number]>(row.allowed_selection_modes),settlementSuggestion:row.settlement_suggestion as StandardFieldSemantic["settlementSuggestion"],status:row.status as StandardFieldSemantic["status"],revision:Number(row.revision)}));
}

export async function saveStandardFieldSemantic(input:Omit<StandardFieldSemantic,'id'|'status'|'revision'>&{id?:string;revision?:number}):Promise<StandardFieldSemantic>{
  const client=await(await getNewDesignPool()).connect(),id=input.id??randomUUID();
  try{
    await client.query('BEGIN');
    const current=input.id?await findRecordCard(client,id,'standard_field_semantic',{includeArchived:true,lock:true}):null;
    if(input.id&&(!current||Number(current.revision)!==input.revision))throw new NewDesignError('标准字段语义已更新，请刷新。',409);
    if(input.recommendedDictionaryId&&!await findRecordCard(client,input.recommendedDictionaryId,'dictionary_definition',{includeArchived:true}))throw new NewDesignError('推荐字典不存在。',422);
    const now=new Date().toISOString(),spaceId=current?.recordSpaceId??SYSTEM_SPACE_ID;
    const values={...(current??{id,semantic_key:generatedKey('field'),status:'active',created_at:now}),name:input.name,description:input.description,data_type:input.dataType,recommended_dictionary_id:input.recommendedDictionaryId,applicable_type_keys:input.applicableTypeKeys,allowed_selection_modes:input.allowedSelectionModes,settlement_suggestion:input.settlementSuggestion,revision:Number(current?.revision??0)+1,updated_at:now};
    if(current)await replaceRecordCard(client,{id,spaceId,typeKey:'standard_field_semantic',title:input.name,values});
    else await createRecordCard(client,{id,spaceId,typeKey:'standard_field_semantic',title:input.name,values});
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return assertFound((await listStandardFieldSemantics()).find(item=>item.id===id),'标准字段语义保存后读取失败。');
}

const DEFAULT_RULE:TreeSelectionRule={mode:"multiple",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:0,maxSelections:null};

export async function listCardTypeTagBindings(cardTypeId:string):Promise<CardTypeTagBinding[]>{
  const db=await getNewDesignPool(),rows=await listRecordCards(db,'card_type_tag_binding',{where:{card_type_id:cardTypeId,status:'active'}}),dimensions=await listRecordCards(db,'material_tag_dimension',{includeArchived:true});
  return rows.flatMap(row=>{
    const dimension=dimensions.find(item=>item.id===row.dimension_id);if(!dimension)return [];
    const config=(row.config??{}) as Partial<CardTypeTagBinding>&{rule?:Partial<TreeSelectionRule>};
    return [{id:row.id,cardTypeId:String(row.card_type_id),dimensionId:String(row.dimension_id),dimensionName:String(dimension.name),rule:{...DEFAULT_RULE,...config.rule},required:Boolean(config.required),displayArea:config.displayArea??'metadata',includeInFilters:config.includeInFilters??true,includeInAiContext:config.includeInAiContext??true,revision:Number(row.revision)}];
  }).sort((a,b)=>a.dimensionName.localeCompare(b.dimensionName));
}

export async function saveCardTypeTagBinding(input:Omit<CardTypeTagBinding,'id'|'dimensionName'|'revision'>&{id?:string;revision?:number}):Promise<CardTypeTagBinding>{
  const client=await(await getNewDesignPool()).connect(),id=input.id??randomUUID();
  const config={rule:input.rule,required:input.required,displayArea:input.displayArea,includeInFilters:input.includeInFilters,includeInAiContext:input.includeInAiContext};
  try{
    await client.query('BEGIN');
    const target=assertFound((await client.query("SELECT space_id FROM new_design.card_types WHERE id=$1 AND status<>'archived' FOR UPDATE",[input.cardTypeId])).rows[0],'内容类型不存在。');
    const dimension=assertFound(await findRecordCard(client,input.dimensionId,'material_tag_dimension',{lock:true}),'标签维度不存在。');
    if(dimension.status!=='active')throw new NewDesignError('标签维度已停用。',422);
    if(dimension.owner_space_id&&String(dimension.owner_space_id)!==String(target.space_id))throw new NewDesignError('只能绑定本书或系统提供的标签维度。',422);
    if(input.rule.rootNodeId){const root=await findRecordCard(client,input.rule.rootNodeId,'material_tag',{includeArchived:true});if(!root||root.dimension_id!==input.dimensionId||root.status!=='active')throw new NewDesignError('选择范围的起点不属于这个标签维度，或已停用。',422);}
    const current=input.id?await findRecordCard(client,id,'card_type_tag_binding',{includeArchived:true,lock:true}):null;
    if(input.id&&(!current||Number(current.revision)!==input.revision))throw new NewDesignError('标签维度绑定已更新，请刷新。',409);
    if(current&&(current.card_type_id!==input.cardTypeId||current.dimension_id!==input.dimensionId))throw new NewDesignError('原绑定不能改为其他内容类型或维度。',409);
    if(!current&&(await listRecordCards(client,'card_type_tag_binding',{includeArchived:true,where:{card_type_id:input.cardTypeId,dimension_id:input.dimensionId}})).length)throw new NewDesignError('此标签维度已绑定，请修改原绑定。',409);
    const revision=Number(current?.revision??0)+1,versionId=randomUUID(),now=new Date().toISOString(),spaceId=String(target.space_id);
    await createRecordCard(client,{id:versionId,spaceId,typeKey:'card_type_tag_binding_version',title:'标签维度绑定历史',values:{id:versionId,binding_id:id,version:revision,config,status:'active',created_by:'user',created_at:now}});
    const values={...(current??{id,card_type_id:input.cardTypeId,dimension_id:input.dimensionId,status:'active',created_at:now}),config,revision,current_version_id:versionId,updated_at:now};
    if(current)await replaceRecordCard(client,{id,spaceId:current.recordSpaceId,typeKey:'card_type_tag_binding',title:String(dimension.name),values});
    else await createRecordCard(client,{id,spaceId,typeKey:'card_type_tag_binding',title:String(dimension.name),values});
    await client.query('COMMIT');
    return assertFound((await listCardTypeTagBindings(input.cardTypeId)).find(item=>item.id===id),'标签维度绑定保存失败。');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

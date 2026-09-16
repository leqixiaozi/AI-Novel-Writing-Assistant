import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CardTypeTagBinding, FieldDefinition, MaterialTag, StandardFieldSemantic, TagDimension, TreeImpactPreview, TreeSelectionRule } from "../../../common/contracts";
import { validateTreeSelection } from "../../../common/treePolicy";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";

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
    const dictionary=(await client.query("SELECT id FROM new_design.dictionary_definitions WHERE id=$1 AND status<>'archived'",[source.dictionaryId])).rows[0];
    if(!dictionary){issues[field.key]=`${field.name}绑定的字典不存在或已停用。`;continue;}
    if(source.rule.rootNodeId){
      const root=(await client.query("SELECT id FROM new_design.dictionary_items WHERE id=$1 AND dictionary_id=$2 AND status='active'",[source.rule.rootNodeId,source.dictionaryId])).rows[0];
      if(!root)issues[field.key]=`${field.name}的范围起点不属于所选字典，或已停用。`;
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
    const result=await client.query("SELECT id,parent_id,status FROM new_design.dictionary_items WHERE dictionary_id=$1",[source.dictionaryId]);
    const nodes=result.rows.map(row=>({id:String(row.id),parentId:row.parent_id?String(row.parent_id):null,status:row.status as "active"|"archived"}));
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
    const result=await client.query(`SELECT item.id,version.path_labels FROM new_design.dictionary_items item
      JOIN new_design.dictionary_item_versions version ON version.id=item.current_version_id
      WHERE item.dictionary_id=$1 AND item.id=ANY($2::uuid[])`,[source.dictionaryId,selectedIds]);
    const byId=new Map(result.rows.map(row=>[String(row.id),asArray<unknown>(row.path_labels).map(String)]));
    const displayPaths=selectedIds.map(id=>byId.get(id)??[]);
    await client.query("INSERT INTO new_design.card_tree_value_snapshots(id,card_version_id,field_key,tree_kind,node_ids,display_paths) VALUES($1,$2,$3,'dictionary',$4,$5::jsonb)",[randomUUID(),cardVersionId,field.key,selectedIds,JSON.stringify(displayPaths)]);
  }
}

function mapTag(row: Record<string, unknown>): MaterialTag {
  const ids=asArray<unknown>(row.path_node_ids),names=asArray<unknown>(row.path_names);
  return {id:String(row.id),spaceId:String(row.space_id),key:String(row.tag_key),name:String(row.name),aliases:asArray<string>(row.aliases),color:row.color?String(row.color):null,metadata:(row.metadata??{}) as Record<string,unknown>,dimensionId:String(row.dimension_id),parentId:row.parent_id?String(row.parent_id):null,sortOrder:Number(row.sort_order),path:ids.map((id,index)=>({id:String(id),name:String(names[index]??row.name)})),childCount:Number(row.child_count??0),status:row.status as MaterialTag["status"],revision:Number(row.revision),currentVersionId:String(row.current_version_id),visibility:row.visibility as MaterialTag["visibility"],memberCount:Number(row.member_count??0),updatedAt:asDate(row.updated_at)};
}

async function tagsForDimensions(client: Pick<PoolClient,"query">,dimensionIds:string[]):Promise<Map<string,MaterialTag[]>>{
  const grouped=new Map<string,MaterialTag[]>();
  if(!dimensionIds.length)return grouped;
  const result=await client.query(`SELECT tag.*,version.name,version.aliases,version.color,version.metadata,version.path_node_ids,version.path_names,
    (SELECT count(*) FROM new_design.material_tags child WHERE child.parent_id=tag.id AND child.status='active') child_count,
    (SELECT count(*) FROM new_design.material_tag_memberships membership WHERE membership.tag_id=tag.id AND membership.status='active') member_count
    FROM new_design.material_tags tag JOIN new_design.material_tag_versions version ON version.id=tag.current_version_id
    WHERE tag.dimension_id=ANY($1::uuid[]) ORDER BY tag.dimension_id,tag.parent_id NULLS FIRST,tag.sort_order,version.name`,[dimensionIds]);
  for(const row of result.rows){const id=String(row.dimension_id);grouped.set(id,[...(grouped.get(id)??[]),mapTag(row)]);}
  return grouped;
}

export async function listTagDimensions(spaceId?:string):Promise<TagDimension[]>{
  const pool=await getNewDesignPool();
  const result=await pool.query(`SELECT * FROM new_design.material_tag_dimensions WHERE status<>'archived' AND ${spaceId?"owner_space_id=$1":"owner_space_id IS NULL"} ORDER BY scope,name`,spaceId?[spaceId]:[]);
  const tags=await tagsForDimensions(pool as unknown as Pick<PoolClient,"query">,result.rows.map(row=>String(row.id)));
  return result.rows.map(row=>({id:String(row.id),key:String(row.dimension_key),name:String(row.name),description:String(row.description??""),scope:row.scope as TagDimension["scope"],ownerSpaceId:row.owner_space_id?String(row.owner_space_id):null,sourceDimensionId:row.source_dimension_id?String(row.source_dimension_id):null,status:row.status as TagDimension["status"],revision:Number(row.revision),readOnly:Boolean(row.read_only),nodes:tags.get(String(row.id))??[],createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)}));
}

export async function saveTagDimension(input:{id?:string;name:string;description:string;scope:TagDimension["scope"];ownerSpaceId?:string|null;revision?:number;readOnly?:boolean}):Promise<TagDimension>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  const id=input.id??randomUUID();
  try{await client.query("BEGIN");
    if(input.id){const current=assertFound((await client.query("SELECT * FROM new_design.material_tag_dimensions WHERE id=$1 FOR UPDATE",[id])).rows[0],"标签维度不存在。");if(Number(current.revision)!==input.revision)throw new NewDesignError("标签维度已更新，请刷新。",409);if(current.read_only)throw new NewDesignError("系统标签维度不能修改。",422);await client.query("UPDATE new_design.material_tag_dimensions SET name=$2,description=$3,revision=revision+1,updated_at=now() WHERE id=$1",[id,input.name,input.description]);}
    else await client.query("INSERT INTO new_design.material_tag_dimensions(id,dimension_key,name,description,scope,owner_space_id,read_only,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,'user','user')",[id,generatedKey("dimension"),input.name,input.description,input.scope,input.ownerSpaceId??null,input.readOnly??false]);
    const row=assertFound((await client.query("SELECT * FROM new_design.material_tag_dimensions WHERE id=$1",[id])).rows[0],"标签维度保存失败。"),versionId=randomUUID();
    await client.query("INSERT INTO new_design.material_tag_dimension_versions(id,dimension_id,version,name,description,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'user')",[versionId,id,row.revision,row.name,row.description,row.status]);
    await client.query("UPDATE new_design.material_tag_dimensions SET current_version_id=$2 WHERE id=$1",[id,versionId]);
    await client.query("COMMIT");
    return assertFound((await listTagDimensions(input.ownerSpaceId??undefined)).find(item=>item.id===id),"标签维度保存后读取失败。");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function descendantCount(client:PoolClient,table:"dictionary_items"|"material_tags",nodeId:string):Promise<number>{
  const result=await client.query(`WITH RECURSIVE tree AS (SELECT id FROM new_design.${table} WHERE parent_id=$1 UNION ALL SELECT child.id FROM new_design.${table} child JOIN tree parent ON child.parent_id=parent.id) SELECT count(*) count FROM tree`,[nodeId]);
  return Number(result.rows[0].count);
}

export async function previewTreeNodeChange(kind:"dictionary"|"tag",nodeId:string,action:"move"|"archive"):Promise<TreeImpactPreview>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{const table=kind==="dictionary"?"dictionary_items":"material_tags",descendants=await descendantCount(client,table,nodeId);
    const referenceResult=kind==="dictionary"
      ? await client.query("SELECT count(*) count FROM new_design.card_tree_value_snapshots WHERE $1=ANY(node_ids)",[nodeId])
      : await client.query("SELECT (SELECT count(*) FROM new_design.material_tag_memberships WHERE tag_id=$1 AND status='active')+(SELECT count(*) FROM new_design.material_tag_target_memberships WHERE tag_id=$1 AND status='active') count",[nodeId]);
    const fieldResult=kind==="dictionary"?await client.query("SELECT count(*) count FROM new_design.card_type_versions WHERE fields::text LIKE '%'||$1||'%'",[nodeId]):{rows:[{count:0}]};
    const directReferenceCount=Number(referenceResult.rows[0].count),affectedFieldCount=Number(fieldResult.rows[0].count);
    return{treeKind:kind,nodeId,action,descendantCount:descendants,directReferenceCount,affectedFieldCount,affectedCardCount:directReferenceCount,canApply:true,messages:[descendants?`包含 ${descendants} 个下级节点。`:"没有下级节点。",directReferenceCount?`当前有 ${directReferenceCount} 处正式引用；历史快照会保留。`:"当前没有正式引用。"]};
  }finally{client.release();}
}

export async function listStandardFieldSemantics():Promise<StandardFieldSemantic[]>{const result=await(await getNewDesignPool()).query("SELECT * FROM new_design.standard_field_semantics WHERE status='active' ORDER BY name");return result.rows.map(row=>({id:String(row.id),name:String(row.name),description:String(row.description??""),dataType:row.data_type as StandardFieldSemantic["dataType"],recommendedDictionaryId:row.recommended_dictionary_id?String(row.recommended_dictionary_id):null,applicableTypeKeys:asArray<string>(row.applicable_type_keys),allowedSelectionModes:asArray<StandardFieldSemantic["allowedSelectionModes"][number]>(row.allowed_selection_modes),settlementSuggestion:row.settlement_suggestion as StandardFieldSemantic["settlementSuggestion"],status:row.status as StandardFieldSemantic["status"],revision:Number(row.revision)}));}

export async function saveStandardFieldSemantic(input:Omit<StandardFieldSemantic,"id"|"status"|"revision">&{id?:string;revision?:number}):Promise<StandardFieldSemantic>{const pool=await getNewDesignPool(),id=input.id??randomUUID();if(input.id){const row=(await pool.query("UPDATE new_design.standard_field_semantics SET name=$2,description=$3,data_type=$4,recommended_dictionary_id=$5,applicable_type_keys=$6,allowed_selection_modes=$7,settlement_suggestion=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$9 RETURNING *",[id,input.name,input.description,input.dataType,input.recommendedDictionaryId,input.applicableTypeKeys,input.allowedSelectionModes,input.settlementSuggestion,input.revision])).rows[0];if(!row)throw new NewDesignError("标准字段语义已更新，请刷新。",409);}else await pool.query("INSERT INTO new_design.standard_field_semantics(id,semantic_key,name,description,data_type,recommended_dictionary_id,applicable_type_keys,allowed_selection_modes,settlement_suggestion) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,generatedKey("field"),input.name,input.description,input.dataType,input.recommendedDictionaryId,input.applicableTypeKeys,input.allowedSelectionModes,input.settlementSuggestion]);return assertFound((await listStandardFieldSemantics()).find(item=>item.id===id),"标准字段语义保存后读取失败。");}

const DEFAULT_RULE:TreeSelectionRule={mode:"multiple",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:0,maxSelections:null};

export async function listCardTypeTagBindings(cardTypeId:string):Promise<CardTypeTagBinding[]>{const result=await(await getNewDesignPool()).query(`SELECT binding.*,dimension.name dimension_name FROM new_design.card_type_tag_bindings binding JOIN new_design.material_tag_dimensions dimension ON dimension.id=binding.dimension_id WHERE binding.card_type_id=$1 AND binding.status='active' ORDER BY dimension.name`,[cardTypeId]);return result.rows.map(row=>{const config=(row.config??{}) as Partial<CardTypeTagBinding>&{rule?:Partial<TreeSelectionRule>};return{id:String(row.id),cardTypeId:String(row.card_type_id),dimensionId:String(row.dimension_id),dimensionName:String(row.dimension_name),rule:{...DEFAULT_RULE,...config.rule},required:Boolean(config.required),displayArea:config.displayArea??"metadata",includeInFilters:config.includeInFilters??true,includeInAiContext:config.includeInAiContext??true,revision:Number(row.revision)};});}

export async function saveCardTypeTagBinding(input:Omit<CardTypeTagBinding,"id"|"dimensionName"|"revision">&{id?:string;revision?:number}):Promise<CardTypeTagBinding>{const pool=await getNewDesignPool(),client=await pool.connect(),id=input.id??randomUUID(),config={rule:input.rule,required:input.required,displayArea:input.displayArea,includeInFilters:input.includeInFilters,includeInAiContext:input.includeInAiContext};try{await client.query("BEGIN");const target=assertFound((await client.query("SELECT type.space_id,dimension.owner_space_id FROM new_design.card_types type JOIN new_design.material_tag_dimensions dimension ON dimension.id=$2 AND dimension.status='active' WHERE type.id=$1 AND type.status<>'archived'",[input.cardTypeId,input.dimensionId])).rows[0],"内容类型或标签维度不存在。");if(target.owner_space_id&&String(target.owner_space_id)!==String(target.space_id))throw new NewDesignError("只能绑定本书或系统提供的标签维度。",422);if(input.rule.rootNodeId&&!((await client.query("SELECT 1 FROM new_design.material_tags WHERE id=$1 AND dimension_id=$2 AND status='active'",[input.rule.rootNodeId,input.dimensionId])).rowCount))throw new NewDesignError("选择范围的起点不属于这个标签维度，或已停用。",422);let revision=1;if(input.id){const row=(await client.query("UPDATE new_design.card_type_tag_bindings SET config=$2::jsonb,revision=revision+1,current_version_id=NULL,updated_at=now() WHERE id=$1 AND revision=$3 RETURNING revision",[id,JSON.stringify(config),input.revision])).rows[0];if(!row)throw new NewDesignError("标签维度绑定已更新，请刷新。",409);revision=Number(row.revision);}else await client.query("INSERT INTO new_design.card_type_tag_bindings(id,card_type_id,dimension_id,config) VALUES($1,$2,$3,$4::jsonb)",[id,input.cardTypeId,input.dimensionId,JSON.stringify(config)]);const versionId=randomUUID();await client.query("INSERT INTO new_design.card_type_tag_binding_versions(id,binding_id,version,config,status,created_by) VALUES($1,$2,$3,$4::jsonb,'active','user')",[versionId,id,revision,JSON.stringify(config)]);await client.query("UPDATE new_design.card_type_tag_bindings SET current_version_id=$2 WHERE id=$1",[id,versionId]);await client.query("COMMIT");return assertFound((await listCardTypeTagBindings(input.cardTypeId)).find(item=>item.id===id),"标签维度绑定保存失败。");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

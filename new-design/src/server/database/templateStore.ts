import {syncPreconditions,assertSyncPreconditions,installedSyncPayload,additiveSyncFields,installNonSettlementFields,formSlots,relationDefinition} from "./referenceParity";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { BookCreationReviewCard, BookSummary, BookViewKey, CardGroupFormDefinition, FieldDefinition, InitialCardDraft, ResearchPrefillCard, TemplateGroupSummary, TemplateGroupVersion, TemplateSyncPreview } from "../../common/contracts";
import type { StrategyResourceDraft } from "./resourceStore";
import { NewDesignError, assertFound } from "../domain/errors";
import {validateCardValues,fieldDefinitionSchema} from "../domain/validation";
import { getNewDesignPool } from "./runtime";
import { snapshotDictionaryTreeValues, validateDictionaryTreeValues } from "./treeResources";
import {structureWriteHash,executeStructureWrite} from "./structureWrites";
import {initializeProjectRuleInTransaction} from './bookshelf/initialize';

interface PayloadType { sourceId:string;sourceVersionId:string;key:string;name:string;description:string;categoryKey?:string;capabilities:string[];fields:FieldDefinition[];sortOrder:number; }
interface PayloadDictionary { sourceId:string;key:string;name:string;description:string;items:Array<{sourceId:string;parentSourceId:string|null;key:string;label:string;description:string;value:Record<string,unknown>;sortOrder:number}>; }
interface PayloadTagDimension {sourceId:string;key:string;name:string;description:string;nodes:Array<{sourceId:string;parentSourceId:string|null;key:string;name:string;description:string;aliases:string[];color:string|null;metadata:Record<string,unknown>;sortOrder:number}>;}
interface PayloadTagBinding {sourceTypeId:string;sourceDimensionId:string;config:Record<string,unknown>;}
interface PayloadRelation { statePolicy?:{settlementCapability:"disabled";stateMode:"none"};sourceId:string;sourceRevision?:number;sourceVersion?:import("../../common/referenceParity").FrozenDefinitionReference;key:string;name:string;description:string;direction:"directed"|"undirected";sourceTypeKeys:string[];targetTypeKeys:string[];sourceMax:number|null;targetMax:number|null;propertiesSchema:unknown[]; }
interface PayloadForm { sourceId:string;sourceVersionId:string;key:string;name:string;description:string;definition:CardGroupFormDefinition; }
interface PayloadCard { sourceId:string;typeKey:string;title:string;values:Record<string,unknown>; }
interface PayloadViewConfig { key:BookViewKey;name:string;config:Record<string,unknown>; }
const DEFAULT_VIEW_CONFIGS:PayloadViewConfig[]=[
  {key:"chapters",name:"章节",config:{groupBy:"chapter",sort:"chapter_order",display:"list",expanded:[]}},
  {key:"characters",name:"角色",config:{groupBy:"story_role",sort:"title",display:"list",expanded:[]}},
  {key:"relations",name:"关系",config:{groupBy:"relation_type",sort:"title",display:"list",expanded:[]}},
  {key:"events",name:"事件／时间",config:{groupBy:"story_time",sort:"start_order",display:"list",defaultRange:"all",expanded:[]}},
  {key:"clues",name:"线索／伏笔",config:{groupBy:"lifecycle",sort:"updated_desc",display:"list",expanded:[]}},
  {key:"props",name:"物品流转",config:{groupBy:"prop",sort:"story_order",display:"list",expanded:[]}},
  {key:"states",name:"状态变化",config:{groupBy:"chapter",sort:"story_order",display:"list",expanded:[]}},
  {key:"rules",name:"世界规则",config:{groupBy:"rule",sort:"title",display:"list",expanded:[]}},
  {key:"comparison",name:"全文对照",config:{groupBy:"chapter",sort:"chapter_order",display:"list",expanded:[]}},
  {key:"quality",name:"质量",config:{groupBy:"quality_kind",sort:"severity",display:"list",expanded:[]}},
  {key:"world",name:"世界",config:{groupBy:"card_type",sort:"title",display:"list",expanded:[]}},
  {key:"resources",name:"资源",config:{groupBy:"card_type",sort:"updated_desc",display:"list",expanded:[]}},
];
export interface TemplatePayload {defaultFormKeys?:Record<string,string>;activeForms?:Record<string,string>; cardTypes:PayloadType[];dictionaries:PayloadDictionary[];tagDimensions?:PayloadTagDimension[];tagBindings?:PayloadTagBinding[];relationTypes:PayloadRelation[];forms:PayloadForm[];seedCards:PayloadCard[];viewConfigs?:PayloadViewConfig[];menu:{defaultPage:string;pages:string[]}; }

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function mapTemplate(row:Record<string,unknown>):TemplateGroupSummary{return{id:String(row.id),key:String(row.template_key),name:String(row.name),description:String(row.description??""),status:row.status as TemplateGroupSummary["status"],revision:Number(row.revision),currentVersion:row.current_version==null?null:Number(row.current_version),currentVersionId:row.current_version_id?String(row.current_version_id):null,draftConfig:row.draft_config as Record<string,unknown>,createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)};}
function completeViewConfigs(viewConfigs:PayloadViewConfig[]|undefined):PayloadViewConfig[]{const configured=new Map((viewConfigs??[]).map((view)=>[view.key,view]));return DEFAULT_VIEW_CONFIGS.map((fallback)=>configured.get(fallback.key)??fallback);}
function remapDictionaryTreeFields(fields:FieldDefinition[],dictionaryIds:Map<string,string>,itemIds:Map<string,string>):FieldDefinition[]{return fields.map(field=>field.optionSource?.kind==="dictionary_tree"?{...field,optionSource:{...field.optionSource,dictionaryId:dictionaryIds.get(field.optionSource.dictionaryId)??field.optionSource.dictionaryId,rule:{...field.optionSource.rule,rootNodeId:field.optionSource.rule.rootNodeId?(itemIds.get(field.optionSource.rule.rootNodeId)??field.optionSource.rule.rootNodeId):null}}}:field);}
function remapTagBindingConfig(config:Record<string,unknown>,tagIds:Map<string,string>):Record<string,unknown>{const rule=config.rule&&typeof config.rule==="object"?config.rule as Record<string,unknown>:null;if(!rule||typeof rule.rootNodeId!=="string")return config;return{...config,rule:{...rule,rootNodeId:tagIds.get(rule.rootNodeId)??rule.rootNodeId}};}

export async function listTemplates():Promise<TemplateGroupSummary[]>{const result=await(await getNewDesignPool()).query(`SELECT template.*,version.version AS current_version FROM new_design.template_groups template LEFT JOIN new_design.template_group_versions version ON version.id=template.current_version_id WHERE template.status<>'archived' ORDER BY template.updated_at DESC`);return result.rows.map(mapTemplate);}
export async function listTemplateVersions(templateId:string):Promise<TemplateGroupVersion[]>{const result=await(await getNewDesignPool()).query("SELECT * FROM new_design.template_group_versions WHERE template_id=$1 ORDER BY version DESC",[templateId]);return result.rows.map((row)=>({id:String(row.id),version:Number(row.version),payload:row.payload as Record<string,unknown>,createdAt:asDate(row.created_at)}));}

export async function saveTemplate(input:{id?:string;key:string;name:string;description:string;draftConfig:Record<string,unknown>;revision?:number;requestKey?:string}):Promise<TemplateGroupSummary>{
  const {requestKey,...payload}=input;
  return executeStructureWrite("template","save",requestKey,payload,async(client)=>{
    const id=input.id??randomUUID();
    if(input.id){const updated=await client.query(`UPDATE new_design.template_groups SET name=$2,description=$3,draft_config=$4::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$5 AND status<>'archived' RETURNING id`,[id,input.name,input.description,JSON.stringify(input.draftConfig),input.revision]);if(!updated.rows[0])throw new NewDesignError("模板组已在其他页面更新；当前草稿保留，请重新读取目录后核对正式修订。",409);}
    else await client.query(`INSERT INTO new_design.template_groups(id,template_key,name,description,draft_config,status) VALUES($1,$2,$3,$4,$5::jsonb,'draft')`,[id,input.key,input.name,input.description,JSON.stringify(input.draftConfig)]);
    return mapTemplate(assertFound((await client.query(`SELECT template.*,version.version AS current_version FROM new_design.template_groups template LEFT JOIN new_design.template_group_versions version ON version.id=template.current_version_id WHERE template.id=$1`,[id])).rows[0],"无法核对本次模板保存结果。"));
  });
}

async function buildPayload(client:PoolClient,config:Record<string,unknown>):Promise<TemplatePayload>{
  const requested=Array.isArray(config.cardTypeIds)?config.cardTypeIds.filter((id):id is string=>typeof id==="string"):[];
  const typeResult=await client.query(`SELECT type.*,version.id AS source_version_id,version.fields,category.category_key FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id LEFT JOIN new_design.card_type_categories category ON category.id=type.category_id WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.status='published' ${requested.length?"AND type.id=ANY($1::uuid[])":"AND type.is_system"} ORDER BY type.sort_order`,requested.length?[requested]:[]);
  const dictionaryResult=await client.query("SELECT * FROM new_design.dictionary_definitions WHERE scope='system' AND status='published' ORDER BY name");
  const relationResult=await client.query("SELECT * FROM new_design.relation_types WHERE scope='system' AND status='published' ORDER BY name");
  const formResult=await client.query(`SELECT form.*,version.id AS source_version_id,version.definition FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id IS NULL AND form.status='published' ORDER BY form.name`);
  const dictionaries:PayloadDictionary[]=[];
  for(const dictionary of dictionaryResult.rows){const items=await client.query("SELECT * FROM new_design.dictionary_items WHERE dictionary_id=$1 AND status='active' ORDER BY sort_order",[dictionary.id]);dictionaries.push({sourceId:String(dictionary.id),key:String(dictionary.dictionary_key),name:String(dictionary.name),description:String(dictionary.description??""),items:items.rows.map(item=>({sourceId:String(item.id),parentSourceId:item.parent_id?String(item.parent_id):null,key:String(item.item_key),label:String(item.label),description:String(item.description??""),value:item.value as Record<string,unknown>,sortOrder:Number(item.sort_order)}))});}
  const dimensionResult=await client.query("SELECT * FROM new_design.material_tag_dimensions WHERE status='active' AND scope IN ('system','template') ORDER BY name"),tagDimensions:PayloadTagDimension[]=[];
  for(const dimension of dimensionResult.rows){const nodes=await client.query(`SELECT tag.*,version.name,version.aliases,version.color,version.metadata FROM new_design.material_tags tag JOIN new_design.material_tag_versions version ON version.id=tag.current_version_id WHERE tag.dimension_id=$1 AND tag.status='active' ORDER BY tag.sort_order`,[dimension.id]);tagDimensions.push({sourceId:String(dimension.id),key:String(dimension.dimension_key),name:String(dimension.name),description:String(dimension.description??""),nodes:nodes.rows.map(node=>({sourceId:String(node.id),parentSourceId:node.parent_id?String(node.parent_id):null,key:String(node.tag_key),name:String(node.name),description:String((node.metadata as Record<string,unknown>)?.description??""),aliases:node.aliases as string[],color:node.color?String(node.color):null,metadata:node.metadata as Record<string,unknown>,sortOrder:Number(node.sort_order)}))});}
  const bindingResult=await client.query("SELECT binding.*,type.id source_type_id FROM new_design.card_type_tag_bindings binding JOIN new_design.card_types type ON type.id=binding.card_type_id WHERE binding.status='active' AND type.id=ANY($1::uuid[])",[typeResult.rows.map(type=>type.id)]),tagBindings=bindingResult.rows.map(row=>({sourceTypeId:String(row.source_type_id),sourceDimensionId:String(row.dimension_id),config:row.config as Record<string,unknown>}));
  let seedCards:PayloadCard[]=[];if(typeof config.seedSpaceId==="string"){const cards=await client.query(`SELECT card.*,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active'`,[config.seedSpaceId]);seedCards=cards.rows.map(card=>({sourceId:String(card.id),typeKey:String(card.type_key),title:String(card.title),values:card.values as Record<string,unknown>}));}
  return{cardTypes:typeResult.rows.map(type=>({sourceId:String(type.id),sourceVersionId:String(type.source_version_id),key:String(type.type_key),name:String(type.name),description:String(type.description??""),categoryKey:type.category_key?String(type.category_key):undefined,capabilities:type.semantic_capabilities as string[],fields:type.fields as FieldDefinition[],sortOrder:Number(type.sort_order)})),dictionaries,tagDimensions,tagBindings,relationTypes:relationResult.rows.map(relation=>({sourceId:String(relation.id),key:String(relation.relation_key),name:String(relation.name),description:String(relation.description??""),direction:relation.direction,sourceTypeKeys:relation.source_type_keys,targetTypeKeys:relation.target_type_keys,sourceMax:relation.source_max==null?null:Number(relation.source_max),targetMax:relation.target_max==null?null:Number(relation.target_max),propertiesSchema:relation.properties_schema})),forms:formResult.rows.map(form=>({sourceId:String(form.id),sourceVersionId:String(form.source_version_id),key:String(form.form_key),name:String(form.name),description:String(form.description??""),definition:form.definition as CardGroupFormDefinition})),seedCards,viewConfigs:DEFAULT_VIEW_CONFIGS,menu:{defaultPage:"creative-forms",pages:["creative-forms","all-cards","book-views"]}};
}

export async function publishTemplate(id:string,revision:number,requestKey?:string):Promise<TemplateGroupSummary>{
  return executeStructureWrite("template","publish",requestKey,{id,revision},async(client)=>{
    const template=assertFound((await client.query("SELECT * FROM new_design.template_groups WHERE id=$1 AND status<>'archived' FOR UPDATE",[id])).rows[0],"模板组不存在。");
    if(Number(template.revision)!==revision)throw new NewDesignError("模板组已在其他页面更新；当前草稿保留，请重新读取目录后核对正式修订。",409);
    const payload=await buildPayload(client,template.draft_config as Record<string,unknown>),version=Number((await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM new_design.template_group_versions WHERE template_id=$1",[id])).rows[0].version),versionId=randomUUID();
    await client.query("INSERT INTO new_design.template_group_versions(id,template_id,version,payload) VALUES($1,$2,$3,$4::jsonb)",[versionId,id,version,JSON.stringify(payload)]);
    const row=assertFound((await client.query("UPDATE new_design.template_groups SET status='published',current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[id,versionId])).rows[0],"无法核对模板发布结果。");
    return mapTemplate({...row,current_version:version});
  });
}

function mapBook(row:Record<string,unknown>):BookSummary{return{id:String(row.id),spaceId:String(row.space_id),key:String(row.book_key),name:String(row.name),description:String(row.description??""),status:row.status as BookSummary["status"],templateId:String(row.template_id),templateName:String(row.template_name),templateVersionId:String(row.template_version_id),templateVersion:Number(row.template_version),revision:Number(row.revision),cardCount:Number(row.card_count??0),formCount:Number(row.form_count??0),createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)};}
export async function listBooks():Promise<BookSummary[]>{const result=await(await getNewDesignPool()).query(`SELECT book.*,template.name AS template_name,version.version AS template_version,(SELECT count(*) FROM new_design.cards card WHERE card.space_id=book.space_id AND card.status='active') AS card_count,(SELECT count(*) FROM new_design.card_group_forms form WHERE form.space_id=book.space_id AND form.status='published') AS form_count FROM new_design.books book JOIN new_design.template_groups template ON template.id=book.template_id JOIN new_design.template_group_versions version ON version.id=book.template_version_id WHERE book.status='active' ORDER BY book.updated_at DESC`);return result.rows.map(mapBook);}
export async function getBook(id:string):Promise<BookSummary>{return assertFound((await listBooks()).find((book)=>book.id===id),"书籍不存在。");}

interface CreateBookOrigin {
  sessionId?: string;
  method: string;
  sourceReference: string;
  sourcePayload: Record<string, unknown>;
  generationBatchId?: string;
}

export interface CreateBookOptions {
  includeTemplateSeed?: boolean;
  initialCards?: InitialCardDraft[];
  reviewCards?: BookCreationReviewCard[];
  resourceCards?: StrategyResourceDraft[];
  researchCards?: ResearchPrefillCard[];
  researchReferences?: Array<{researchVersionId:string|null;packVersionId:string|null;purpose:string;compiledSnapshot:Record<string,unknown>}>;
  origin?: CreateBookOrigin;
}

export interface InstalledBookPayload {
 cards:Map<string,{cardId:string;cardVersionId:string}>;
 dictionaryIds:Map<string,string>;dictionaryItemIds:Map<string,string>;
 relationTypeIds:Map<string,string>;
}

async function installPayload(
  client: PoolClient,
  bookId: string,
  spaceId: string,
  payload: TemplatePayload,
  options: CreateBookOptions,
): Promise<InstalledBookPayload> {
  const reviewCardIds=new Map<string,{cardId:string;cardVersionId:string}>(),relationTypeIds=new Map<string,string>();
  const dictionaryIds=new Map<string,string>(),dictionaryItemIds=new Map<string,string>();
  for(const dictionary of payload.dictionaries){
    const dictionaryId=randomUUID();dictionaryIds.set(dictionary.sourceId,dictionaryId);
    await client.query(`INSERT INTO new_design.dictionary_definitions (id,dictionary_key,name,description,scope,owner_space_id,status,source_dictionary_id) VALUES ($1,$2,$3,$4,'book',$5,'published',$6)`,[dictionaryId,dictionary.key,dictionary.name,dictionary.description,spaceId,dictionary.sourceId]);
    const itemIds=new Map(dictionary.items.map(item=>[item.sourceId,randomUUID()]));
    for(const [sourceId,itemId] of itemIds)dictionaryItemIds.set(sourceId,itemId);
    for(const item of dictionary.items)await client.query(`INSERT INTO new_design.dictionary_items(id,dictionary_id,item_key,label,description,value,sort_order,status,source_item_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'active',$8)`,[itemIds.get(item.sourceId),dictionaryId,item.key,item.label,item.description??"",JSON.stringify(item.value??{}),item.sortOrder,item.sourceId]);
    for(const item of dictionary.items)if(item.parentSourceId)await client.query("UPDATE new_design.dictionary_items SET parent_id=$2 WHERE id=$1",[itemIds.get(item.sourceId),itemIds.get(item.parentSourceId)]);
    for(const item of dictionary.items){const itemId=itemIds.get(item.sourceId)!,versionId=randomUUID(),path=(await client.query(`WITH RECURSIVE parents AS (SELECT id,parent_id,label,ARRAY[id]::uuid[] ids,ARRAY[label]::text[] labels FROM new_design.dictionary_items WHERE id=$1 UNION ALL SELECT parent.id,parent.parent_id,parent.label,ARRAY[parent.id]::uuid[]||child.ids,ARRAY[parent.label]::text[]||child.labels FROM new_design.dictionary_items parent JOIN parents child ON child.parent_id=parent.id) SELECT ids,labels FROM parents WHERE parent_id IS NULL`,[itemId])).rows[0];await client.query("INSERT INTO new_design.dictionary_item_versions(id,item_id,version,label,description,parent_id,sort_order,value,status,path_node_ids,path_labels,created_by) SELECT $1,id,1,label,description,parent_id,sort_order,value,status,$3,$4,'template_install' FROM new_design.dictionary_items WHERE id=$2",[versionId,itemId,path.ids,path.labels]);await client.query("UPDATE new_design.dictionary_items SET current_version_id=$2 WHERE id=$1",[itemId,versionId]);}
  }
  const typeIds = new Map<string, { typeId: string; versionId: string }>(),installedFieldsByType=new Map<string,FieldDefinition[]>();
  for (const type of payload.cardTypes) {
    const typeId = randomUUID();
    const versionId = randomUUID();
    typeIds.set(type.key, { typeId, versionId });
    const category = type.categoryKey ? (await client.query("SELECT id FROM new_design.card_type_categories WHERE category_key=$1 AND status='active'", [type.categoryKey])).rows[0] : null;
    const fields=remapDictionaryTreeFields(type.fields,dictionaryIds,dictionaryItemIds);
    installedFieldsByType.set(type.key,fields);
    await client.query(`INSERT INTO new_design.card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,source_card_type_id,source_type_version_id,category_id) VALUES ($1,$2,$3,$4,$5,'published',1,NULL,$6::jsonb,false,$7,$8::jsonb,$9,$10,$11)`, [typeId, spaceId, type.key, type.name, type.description, JSON.stringify(fields), type.sortOrder, JSON.stringify(type.capabilities), type.sourceId, type.sourceVersionId, category?.id ?? null]);
    await client.query("INSERT INTO new_design.card_type_versions (id,card_type_id,version,fields) VALUES ($1,$2,1,$3::jsonb)", [versionId, typeId, JSON.stringify(fields)]);
    await client.query("UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1", [typeId, versionId]);
    await installNonSettlementFields(client,spaceId,type.key,fields);
  }
  const dimensionIds=new Map<string,string>(),tagIds=new Map<string,string>();
  for(const dimension of payload.tagDimensions??[]){const dimensionId=randomUUID(),dimensionVersionId=randomUUID(),nodeById=new Map(dimension.nodes.map(node=>[node.sourceId,node]));dimensionIds.set(dimension.sourceId,dimensionId);await client.query("INSERT INTO new_design.material_tag_dimensions(id,dimension_key,name,description,scope,owner_space_id,source_dimension_id,current_version_id,created_by,updated_by) VALUES($1,$2,$3,$4,'book',$5,$6,NULL,'template_install','template_install')",[dimensionId,dimension.key,dimension.name,dimension.description??"",spaceId,dimension.sourceId]);await client.query("INSERT INTO new_design.material_tag_dimension_versions(id,dimension_id,version,name,description,status,created_by) VALUES($1,$2,1,$3,$4,'active','template_install')",[dimensionVersionId,dimensionId,dimension.name,dimension.description??""]);await client.query("UPDATE new_design.material_tag_dimensions SET current_version_id=$2 WHERE id=$1",[dimensionId,dimensionVersionId]);for(const node of dimension.nodes)tagIds.set(node.sourceId,randomUUID());for(const node of dimension.nodes)await client.query("INSERT INTO new_design.material_tags(id,space_id,tag_key,dimension_id,parent_id,sort_order,visibility,source_tag_id,created_by,updated_by) VALUES($1,$2,$3,$4,NULL,$5,'space',$6,'template_install','template_install')",[tagIds.get(node.sourceId),spaceId,node.key,dimensionId,node.sortOrder,node.sourceId]);for(const node of dimension.nodes)if(node.parentSourceId)await client.query("UPDATE new_design.material_tags SET parent_id=$2 WHERE id=$1",[tagIds.get(node.sourceId),tagIds.get(node.parentSourceId)]);for(const node of dimension.nodes){const nodeId=tagIds.get(node.sourceId)!,versionId=randomUUID(),sourcePath:PayloadTagDimension["nodes"]=[];let current:PayloadTagDimension["nodes"][number]|undefined=node;while(current){sourcePath.unshift(current);current=current.parentSourceId?nodeById.get(current.parentSourceId):undefined;}await client.query("INSERT INTO new_design.material_tag_versions(id,tag_id,version,name,aliases,color,metadata,status,parent_id,sort_order,path_node_ids,path_names,created_by) VALUES($1,$2,1,$3,$4,$5,$6::jsonb,'active',$7,$8,$9,$10,'template_install')",[versionId,nodeId,node.name,node.aliases??[],node.color??null,JSON.stringify({...node.metadata,description:node.description??""}),node.parentSourceId?tagIds.get(node.parentSourceId):null,node.sortOrder,sourcePath.map(item=>tagIds.get(item.sourceId)),sourcePath.map(item=>item.name)]);await client.query("UPDATE new_design.material_tags SET current_version_id=$2 WHERE id=$1",[nodeId,versionId]);}}
  for(const binding of payload.tagBindings??[]){const targetType=payload.cardTypes.find(item=>item.sourceId===binding.sourceTypeId),mappedType=targetType?typeIds.get(targetType.key):undefined,dimensionId=dimensionIds.get(binding.sourceDimensionId);if(!mappedType||!dimensionId)continue;const bindingId=randomUUID(),versionId=randomUUID(),config=remapTagBindingConfig(binding.config,tagIds);await client.query("INSERT INTO new_design.card_type_tag_bindings(id,card_type_id,dimension_id,config,current_version_id) VALUES($1,$2,$3,$4::jsonb,NULL)",[bindingId,mappedType.typeId,dimensionId,JSON.stringify(config)]);await client.query("INSERT INTO new_design.card_type_tag_binding_versions(id,binding_id,version,config,status,created_by) VALUES($1,$2,1,$3::jsonb,'active','template_install')",[versionId,bindingId,JSON.stringify(config)]);await client.query("UPDATE new_design.card_type_tag_bindings SET current_version_id=$2 WHERE id=$1",[bindingId,versionId]);}
  for (const relation of payload.relationTypes) {const relationId=randomUUID();relationTypeIds.set(relation.sourceId,relationId);if(!Array.isArray(relation.propertiesSchema))throw new NewDesignError(`模板关系“${relation.name}”缺少完整正式字段规格，请选择已完善的模板版本。`,422,{[`relationTypes.${relation.sourceId}`]:"请核对正式模板关系规格。"});const fields:FieldDefinition[]=[];for(const [index,value] of relation.propertiesSchema.entries()){const raw=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null,result=raw?fieldDefinitionSchema.strict().safeParse({...raw,order:raw.order??index}):null;if(!result?.success)throw new NewDesignError(`模板关系“${relation.name}”含未知字段，不会自动发布；请核对正式模板规格。`,422,{[`relationTypes.${relation.sourceId}`]:"请完善真实字段规格后重新选择模板版本。"});fields.push({...result.data,defaultValue:result.data.defaultValue??null} as FieldDefinition);}const propertiesSchema=remapDictionaryTreeFields(fields,dictionaryIds,dictionaryItemIds);await client.query(`INSERT INTO new_design.relation_types (id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status,source_relation_type_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'book',$10,$11::jsonb,'published',$12)`, [relationId, relation.key, relation.name, relation.description, relation.direction, relation.sourceTypeKeys, relation.targetTypeKeys, relation.sourceMax, relation.targetMax, spaceId, JSON.stringify(propertiesSchema), relation.sourceId]);}
  for(const relation of payload.relationTypes)if(relation.statePolicy?.settlementCapability==="disabled"&&relation.statePolicy.stateMode==="none")await client.query("INSERT INTO new_design.state_relation_capabilities(space_id,relation_key,settlement_capability,state_mode) VALUES($1,$2,'disabled','none') ON CONFLICT DO NOTHING",[spaceId,relation.key]);
  for(const view of completeViewConfigs(payload.viewConfigs))await client.query("INSERT INTO new_design.book_view_configs(id,book_id,view_key,config) VALUES($1,$2,$3,$4::jsonb)",[randomUUID(),bookId,view.key,JSON.stringify(view.config)]);
  const activeForms:Record<string,string>={};
  const sourceTemplateVersionId=String((await client.query("SELECT template_version_id FROM new_design.books WHERE id=$1",[bookId])).rows[0].template_version_id);
  for (const form of payload.forms) {
    const formId = randomUUID();
    const versionId = randomUUID();
    const definition=structuredClone(form.definition);
    const dictionaryMappings:NonNullable<CardGroupFormDefinition['installation']>['dictionaryMappings']=[];
    for(const slot of formSlots(definition)){
      const bindings=slot.localFields.filter(field=>field.optionSource?.kind==='dictionary_tree');
      for(const field of bindings){const binding=field.optionSource!;if(binding.kind!=='dictionary_tree')continue;const origin=payload.dictionaries.find(item=>item.sourceId===binding.dictionaryId);if(!origin)throw new NewDesignError('表单字典来源不在冻结模板中。',422);
        if(!dictionaryMappings.some(mapping=>mapping.sourceId===origin.sourceId)){const targetId=dictionaryIds.get(origin.sourceId)!;const nodes=(await client.query("SELECT id,source_item_id,current_version_id FROM new_design.dictionary_items WHERE dictionary_id=$1 AND status='active'",[targetId])).rows;
          dictionaryMappings.push({sourceId:origin.sourceId,sourceVersion:{kind:'template_snapshot',versionId:sourceTemplateVersionId,definitionHash:structureWriteHash(origin)},targetId,nodes:nodes.map(node=>({sourceId:String(node.source_item_id),targetId:String(node.id),targetVersionId:String(node.current_version_id)}))});}}
      slot.localFields=remapDictionaryTreeFields(slot.localFields.map((field,index)=>({...field,description:field.description??"",options:field.options??[],group:field.group??"",order:field.order??index,defaultValue:field.defaultValue??null})),dictionaryIds,dictionaryItemIds);
    }
    const relationMappings:NonNullable<CardGroupFormDefinition['installation']>['relationMappings']=[];
    for(const key of [...new Set(formSlots(definition).map(slot=>slot.relationTypeKey).filter((key):key is string=>!!key))]){const origin=payload.relationTypes.find(item=>item.key===key),targetId=origin?relationTypeIds.get(origin.sourceId):undefined;if(!origin||!targetId)throw new NewDesignError('表单关系来源不在冻结模板中。',422);const rule=relationDefinition((await client.query('SELECT * FROM new_design.relation_types WHERE id=$1',[targetId])).rows[0]);const sourceRule={key:origin.key,name:origin.name,description:origin.description,direction:origin.direction,sourceTypeKeys:origin.sourceTypeKeys,targetTypeKeys:origin.targetTypeKeys,sourceMax:origin.sourceMax,targetMax:origin.targetMax,propertiesSchema:origin.propertiesSchema};relationMappings.push({key,targetKey:key,sourceId:origin.sourceId,sourceVersion:{kind:'template_snapshot',versionId:sourceTemplateVersionId,definitionHash:structureWriteHash(sourceRule)},targetId,targetDefinitionHash:structureWriteHash(rule)});}
    definition.installation={sourceTemplateVersionId,sourceFormId:form.sourceId,sourceFormVersionId:form.sourceVersionId,sourceDefinitionHash:structureWriteHash(form.definition),previousFormVersionId:null,typeMappings:[...new Set(formSlots(definition).flatMap(slot=>slot.allowedTypeKeys))].map(key=>{const origin=payload.cardTypes.find(type=>type.key===key),target=typeIds.get(key);if(!origin||!target)throw new NewDesignError('表单类型来源不在冻结模板中。',422);return{key,sourceId:origin.sourceId,sourceVersionId:origin.sourceVersionId,targetId:target.typeId,targetVersionId:target.versionId};}),relationMappings,dictionaryMappings};
    await client.query(`INSERT INTO new_design.card_group_forms (id,space_id,form_key,name,description,status,revision,current_version_id,draft_definition,is_system,source_form_id,source_form_version_id) VALUES ($1,$2,$3,$4,$5,'published',1,NULL,$6::jsonb,false,$7,$8)`, [formId, spaceId, form.key, form.name, form.description, JSON.stringify(definition), form.sourceId, form.sourceVersionId]);
    await client.query("INSERT INTO new_design.card_group_form_versions (id,form_id,version,definition) VALUES ($1,$2,1,$3::jsonb)", [versionId, formId, JSON.stringify(definition)]);
    await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2 WHERE id=$1", [formId, versionId]);
    if(payload.defaultFormKeys?.[form.definition.primaryTypeKey]===form.key)activeForms[form.definition.primaryTypeKey]=versionId;
  }
  if(Object.keys(activeForms).length)await client.query("UPDATE new_design.books SET installed_payload=$2::jsonb WHERE id=$1",[bookId,JSON.stringify({...payload,activeForms})]);
  const remapTreeValues=(fields:FieldDefinition[],values:Record<string,unknown>):Record<string,unknown>=>{
    const next={...values};
    for(const field of fields){
      if(field.optionSource?.kind!=="dictionary_tree")continue;
      const value=next[field.key];
      if(typeof value==="string")next[field.key]=dictionaryItemIds.get(value)??value;
      else if(Array.isArray(value))next[field.key]=value.map(item=>typeof item==="string"?(dictionaryItemIds.get(item)??item):item);
    }
    return next;
  };
  const cards = options.reviewCards?.map((card)=>({card,sourceKind:card.sourceKind==="manual"?"user" as const:card.sourceKind,sourceId:card.sourceId,sourceVersionId:card.sourceVersionId,originalTitle:card.originalTitle,originalValues:card.originalValues,reviewed:true}))??[
    ...(options.includeTemplateSeed === false ? [] : payload.seedCards.map((card) => ({ card, sourceKind: "template" as const, sourceId: card.sourceId, sourceVersionId: null,originalTitle:card.title,originalValues:card.values,reviewed:false }))),
    ...(options.initialCards ?? []).map((card) => ({ card, sourceKind: "ai" as const, sourceId: null, sourceVersionId: null,originalTitle:card.title,originalValues:card.values,reviewed:false })),
    ...(options.resourceCards ?? []).map((card) => ({ card, sourceKind: "resource" as const, sourceId: card.sourceCardId, sourceVersionId: card.sourceVersionId,originalTitle:card.title,originalValues:card.values,reviewed:false })),
  ];
  const installedCards=new Map<string,{id:string;typeVersionId:string;title:string;values:Record<string,unknown>;revision:number}>();
  for (const prepared of cards) {
    const { card, sourceKind } = prepared;
    const confirmation = prepared.reviewed?"confirmed":sourceKind === "ai" ? "ai_draft" : sourceKind === "template" ? "template_suggestion" : sourceKind==="user"?"user_content":"confirmed";
    const type = assertFound(typeIds.get(card.typeKey), `模板缺少卡片类型 ${card.typeKey}。`);
    const fields=assertFound(installedFieldsByType.get(card.typeKey),`模板缺少类型定义 ${card.typeKey}。`);
    const allowedKeys = new Set(fields.map((field) => field.key));
    const filteredValues = remapTreeValues(fields,Object.fromEntries(Object.entries(card.values).filter(([key]) => allowedKeys.has(key))));
    const validated = validateCardValues(fields, filteredValues);
    if ((prepared.reviewed || sourceKind !== "template") && Object.keys(validated.issues).length) {
      throw new NewDesignError(`${sourceKind === "ai" ? "AI 生成的" : "选用的创作策略"}“${card.title}”未满足模板字段要求。`, 422, validated.issues);
    }
    const values = sourceKind === "template" && !prepared.reviewed ? filteredValues : validated.values;
    const treeIssues=await validateDictionaryTreeValues(client,fields,values);
    if(Object.keys(treeIssues).length)throw new NewDesignError(`“${card.title}”引用了当前模板中不可用的字典项。`,422,treeIssues);
    const cardId = randomUUID();
    const versionId = randomUUID();
    await client.query(`INSERT INTO new_design.cards (id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES ($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)`, [cardId, spaceId, type.typeId, card.title, type.versionId, JSON.stringify(values)]);
    await client.query(`INSERT INTO new_design.card_versions (id,card_id,revision,type_version_id,title,values,source) VALUES ($1,$2,1,$3,$4,$5::jsonb,'create')`, [versionId, cardId, type.versionId, card.title, JSON.stringify(values)]);
    await snapshotDictionaryTreeValues(client,fields,values,versionId);
    await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1", [cardId, versionId]);
    if(prepared.reviewed){const reviewId=(card as BookCreationReviewCard).id;if(!reviewId||reviewCardIds.has(reviewId))throw new NewDesignError("审阅对象编号缺失或重复，不能按标题映射正式资料。",422);reviewCardIds.set(reviewId,{cardId,cardVersionId:versionId});}
    installedCards.set(`${card.typeKey}\u0000${card.title}`,{id:cardId,typeVersionId:type.versionId,title:card.title,values,revision:1});
    for (const [fieldKey, value] of [["$title", card.title] as const, ...Object.entries(values)]) {
      const originalValue=fieldKey==="$title"?prepared.originalTitle:prepared.originalValues[fieldKey];
      const fieldBatchId=(card as BookCreationReviewCard).aiFieldBatchIds?.[fieldKey];
      if(fieldBatchId&&!(await client.query(`SELECT 1 FROM new_design.ai_generation_batches batch
        WHERE batch.id=$1 AND batch.session_id=$2 AND (batch.status='review' OR (
          batch.status='applied' AND batch.stage='review_adopted' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(batch.preparation_adoption_receipts) adoption
            CROSS JOIN LATERAL jsonb_array_elements(adoption->'receipt'->'session'->'reviewCards') reviewed
            WHERE adoption->'receipt'->>'batchId'=batch.id::text
              AND reviewed->>'id'=$3 AND reviewed->>'typeKey'=$4
              AND reviewed->'aiFieldBatchIds'->>$5=batch.id::text
              AND (CASE WHEN $5='$title' THEN reviewed->'title' ELSE reviewed->'values'->$5 END)=$6::jsonb
          )))`,[fieldBatchId,options.origin?.sessionId??null,(card as BookCreationReviewCard).id??null,card.typeKey,fieldKey,JSON.stringify(fieldKey==="$title"?card.title:card.values[fieldKey]??null)])).rowCount)throw new NewDesignError("开书 AI 来源不属于当前创建会话，未创建书籍。",409);
      await client.query(`INSERT INTO new_design.card_field_origins (id,card_id,field_key,source_kind,source_id,generation_batch_id,confirmation_status,original_value,current_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`, [randomUUID(), cardId, fieldKey, fieldBatchId?"ai":sourceKind, fieldBatchId?null:prepared.sourceId, fieldBatchId??(sourceKind === "ai" ? options.origin?.generationBatchId ?? null : null), confirmation, JSON.stringify(originalValue??null),JSON.stringify(value)]);
    }
    if (sourceKind === "resource" && prepared.sourceId && prepared.sourceVersionId) {
      await client.query(`INSERT INTO new_design.resource_adoptions (id,resource_card_id,resource_version_id,book_id,target_card_id,action,snapshot) VALUES ($1,$2,$3,$4,$5,'install_snapshot',$6::jsonb)`, [randomUUID(), prepared.sourceId, prepared.sourceVersionId, bookId, cardId, JSON.stringify({ typeKey: card.typeKey, title: card.title, values })]);
    }
  }
  for(const card of options.researchCards??[]){
    const type=assertFound(typeIds.get(card.typeKey),`模板缺少卡片类型 ${card.typeKey}。`),fields=assertFound(installedFieldsByType.get(card.typeKey),`模板缺少类型定义 ${card.typeKey}。`),allowedKeys=new Set(fields.map((field)=>field.key)),suggested=remapTreeValues(fields,Object.fromEntries(Object.entries(card.values).filter(([key])=>allowedKeys.has(key)))),key=`${card.typeKey}\u0000${card.title}`,existing=installedCards.get(key);
    if(existing){const values={...existing.values};const adopted:string[]=[];for(const [fieldKey,value] of Object.entries(suggested))if(values[fieldKey]===null||values[fieldKey]===undefined||values[fieldKey]===""||(Array.isArray(values[fieldKey])&&values[fieldKey].length===0)){values[fieldKey]=value;adopted.push(fieldKey);}if(!adopted.length)continue;const treeIssues=await validateDictionaryTreeValues(client,fields,values);if(Object.keys(treeIssues).length)throw new NewDesignError(`研究建议“${card.title}”引用了不可用的字典项。`,422,treeIssues);const nextRevision=existing.revision+1,versionId=randomUUID();await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit')",[versionId,existing.id,nextRevision,existing.typeVersionId,existing.title,JSON.stringify(values)]);await snapshotDictionaryTreeValues(client,fields,values,versionId);await client.query("UPDATE new_design.cards SET values=$2::jsonb,revision=$3,current_version_id=$4,updated_at=now() WHERE id=$1",[existing.id,JSON.stringify(values),nextRevision,versionId]);for(const fieldKey of adopted)await client.query("INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES($1,$2,$3,'research',$4,'confirmed',$5::jsonb,$5::jsonb) ON CONFLICT(card_id,field_key) DO UPDATE SET source_kind='research',source_id=EXCLUDED.source_id,confirmation_status='confirmed',original_value=EXCLUDED.original_value,current_value=EXCLUDED.current_value,updated_at=now()",[randomUUID(),existing.id,fieldKey,card.researchVersionId,JSON.stringify(values[fieldKey])]);installedCards.set(key,{...existing,values,revision:nextRevision});continue;}
    const validated=validateCardValues(fields,suggested);if(Object.keys(validated.issues).length)throw new NewDesignError(`研究建议“${card.title}”未满足模板字段要求。`,422,validated.issues);const treeIssues=await validateDictionaryTreeValues(client,fields,validated.values);if(Object.keys(treeIssues).length)throw new NewDesignError(`研究建议“${card.title}”引用了不可用的字典项。`,422,treeIssues);const cardId=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)",[cardId,spaceId,type.typeId,card.title,type.versionId,JSON.stringify(validated.values)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[versionId,cardId,type.versionId,card.title,JSON.stringify(validated.values)]);await snapshotDictionaryTreeValues(client,fields,validated.values,versionId);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,versionId]);for(const [fieldKey,value]of [["$title",card.title],...Object.entries(validated.values)])await client.query("INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES($1,$2,$3,'research',$4,'confirmed',$5::jsonb,$5::jsonb)",[randomUUID(),cardId,fieldKey,card.researchVersionId,JSON.stringify(value)]);installedCards.set(key,{id:cardId,typeVersionId:type.versionId,title:card.title,values:validated.values,revision:1});
  }
  return{cards:reviewCardIds,dictionaryIds,dictionaryItemIds,relationTypeIds};
}

export async function getBookInTransaction(client:PoolClient,id:string):Promise<BookSummary>{const row=(await client.query(`SELECT book.*,template.name template_name,version.version template_version,(SELECT count(*) FROM new_design.cards card WHERE card.space_id=book.space_id AND card.status='active') card_count,(SELECT count(*) FROM new_design.card_group_forms form WHERE form.space_id=book.space_id AND form.status='published') form_count FROM new_design.books book JOIN new_design.template_groups template ON template.id=book.template_id JOIN new_design.template_group_versions version ON version.id=book.template_version_id WHERE book.id=$1`,[id])).rows[0];return mapBook(assertFound(row,"书籍不可用。"));}

export async function createBookInTransaction(client:PoolClient,input:{key:string;name:string;description:string;templateVersionId:string},options:CreateBookOptions={}):Promise<{book:BookSummary;installed:InstalledBookPayload;payload:TemplatePayload}>{
 const id=randomUUID(),spaceId=randomUUID(),version=assertFound((await client.query("SELECT * FROM new_design.template_group_versions WHERE id=$1",[input.templateVersionId])).rows[0],"模板版本不存在。"),template=assertFound((await client.query("SELECT * FROM new_design.template_groups WHERE id=$1",[version.template_id])).rows[0],"模板组不存在。"),payload=version.payload as TemplatePayload;
 await client.query("INSERT INTO new_design.card_spaces(id,space_key,name) VALUES($1,$2,$3)",[spaceId,`book_${input.key}`,input.name]);
 await client.query("INSERT INTO new_design.books(id,space_id,book_key,name,description,template_id,template_version_id,installed_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[id,spaceId,input.key,input.name,input.description,template.id,version.id,JSON.stringify(payload)]);
 const installed=await installPayload(client,id,spaceId,payload,options);
 await initializeProjectRuleInTransaction(client,id,randomUUID());
 for(const reference of options.researchReferences??[])await client.query("INSERT INTO new_design.book_research_references(id,book_id,research_version_id,pack_version_id,purpose,compiled_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[randomUUID(),id,reference.researchVersionId,reference.packVersionId,reference.purpose,JSON.stringify(reference.compiledSnapshot)]);
 if(options.origin)await client.query("INSERT INTO new_design.book_content_sources(id,book_id,session_id,method,source_reference,source_payload,confirmation_status) VALUES($1,$2,$3,$4,$5,$6::jsonb,'confirmed')",[randomUUID(),id,options.origin.sessionId??null,options.origin.method,options.origin.sourceReference,JSON.stringify(options.origin.sourcePayload)]);
 return{book:await getBookInTransaction(client,id),installed,payload};
}

export async function createBook(
  input: { key: string; name: string; description: string; templateVersionId: string },
  options: CreateBookOptions = {},
): Promise<BookSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  const id = randomUUID();
  const spaceId = randomUUID();
  try {
    await client.query("BEGIN");
    const version = assertFound((await client.query("SELECT * FROM new_design.template_group_versions WHERE id=$1", [input.templateVersionId])).rows[0], "模板版本不存在。");
    const template = assertFound((await client.query("SELECT * FROM new_design.template_groups WHERE id=$1", [version.template_id])).rows[0], "模板组不存在。");
    const payload = version.payload as TemplatePayload;
    await client.query("INSERT INTO new_design.card_spaces (id,space_key,name) VALUES ($1,$2,$3)", [spaceId, `book_${input.key}`, input.name]);
    await client.query(`INSERT INTO new_design.books (id,space_id,book_key,name,description,template_id,template_version_id,installed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [id, spaceId, input.key, input.name, input.description, template.id, version.id, JSON.stringify(payload)]);
    await installPayload(client, id, spaceId, payload, options);
    await initializeProjectRuleInTransaction(client,id,randomUUID());
    for(const reference of options.researchReferences??[])await client.query("INSERT INTO new_design.book_research_references(id,book_id,research_version_id,pack_version_id,purpose,compiled_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[randomUUID(),id,reference.researchVersionId,reference.packVersionId,reference.purpose,JSON.stringify(reference.compiledSnapshot)]);
    if (options.origin) {
      await client.query(`INSERT INTO new_design.book_content_sources (id,book_id,session_id,method,source_reference,source_payload,confirmation_status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'confirmed')`, [randomUUID(), id, options.origin.sessionId ?? null, options.origin.method, options.origin.sourceReference, JSON.stringify(options.origin.sourcePayload)]);
      if(options.origin.sessionId){
        const published=await client.query("UPDATE new_design.book_creation_sessions SET status='completed',stage='ready',progress=100,book_id=$2,error_message=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND status='creating' AND book_id IS NULL RETURNING id",[options.origin.sessionId,id]);
        if(!published.rowCount)throw new NewDesignError("当前开书会话已变化，书籍未重复创建。",409);
        const usedBatches=[...new Set([options.origin.generationBatchId,...(options.reviewCards??[]).flatMap(card=>Object.values(card.aiFieldBatchIds??{}))].filter((id):id is string=>Boolean(id)))];
        if(usedBatches.length)await client.query("UPDATE new_design.ai_generation_batches SET status='applied',updated_at=now() WHERE id=ANY($1::uuid[]) AND session_id=$2 AND status='review'",[usedBatches,options.origin.sessionId]);
      }
    }
    await client.query("COMMIT");
    return await getBook(id);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("书籍标识已存在。", 409);
    throw error;
  } finally {
    client.release();
  }
}

function compareFields(installed:TemplatePayload,target:TemplatePayload,bookTypes:Array<{key:string;fields:FieldDefinition[]}>):Pick<TemplateSyncPreview,"additions"|"conflicts">{const additions:TemplateSyncPreview["additions"]=[],conflicts:TemplateSyncPreview["conflicts"]=[];const oldByKey=new Map(installed.cardTypes.map((type)=>[type.key,type]));const bookByKey=new Map(bookTypes.map((type)=>[type.key,type]));for(const nextType of target.cardTypes){const old=oldByKey.get(nextType.key);const book=bookByKey.get(nextType.key);if(!old||!book)continue;const oldFields=new Map(old.fields.map((field)=>[field.key,field]));const bookFields=new Map(book.fields.map((field)=>[field.key,field]));const safe:FieldDefinition[]=[];for(const field of nextType.fields){const prior=oldFields.get(field.key);if(!prior){if(field.required){conflicts.push({typeKey:nextType.key,fieldKey:field.key,reason:"模板新增字段为必填，不能同步。"});}else if(bookFields.has(field.key)){conflicts.push({typeKey:nextType.key,fieldKey:field.key,reason:"书内已经存在同名稳定键。"});}else safe.push(field);}else if(JSON.stringify(prior)!==JSON.stringify(field)){conflicts.push({typeKey:nextType.key,fieldKey:field.key,reason:"模板修改了已有字段，书内不会被覆盖。"});}}if(safe.length)additions.push({typeKey:nextType.key,fields:safe});}return{additions,conflicts};}

function compareTrees(installed:TemplatePayload,target:TemplatePayload,conflicts:TemplateSyncPreview["conflicts"]):NonNullable<TemplateSyncPreview["treeAdditions"]>{
  const dictionaries:NonNullable<TemplateSyncPreview["treeAdditions"]>["dictionaries"]=[],tagDimensions:NonNullable<TemplateSyncPreview["treeAdditions"]>["tagDimensions"]=[],tagBindings:NonNullable<TemplateSyncPreview["treeAdditions"]>["tagBindings"]=[];
  const oldDictionaries=new Map(installed.dictionaries.map(item=>[item.sourceId,item]));
  for(const dictionary of target.dictionaries){const prior=oldDictionaries.get(dictionary.sourceId);if(!prior){dictionaries.push(dictionary);continue;}const oldNodes=new Map(prior.items.map(item=>[item.sourceId,item])),items:PayloadDictionary["items"]=[];for(const node of dictionary.items){const old=oldNodes.get(node.sourceId);if(!old)items.push(node);else if(JSON.stringify(old)!==JSON.stringify(node))conflicts.push({typeKey:"字典树",fieldKey:node.label,reason:"模板修改了已有字典节点，本书不会被覆盖。"});}if(items.length)dictionaries.push(dictionary);}
  const oldDimensions=new Map((installed.tagDimensions??[]).map(item=>[item.sourceId,item]));
  for(const dimension of target.tagDimensions??[]){const prior=oldDimensions.get(dimension.sourceId);if(!prior){tagDimensions.push(dimension);continue;}const oldNodes=new Map(prior.nodes.map(item=>[item.sourceId,item])),nodes:PayloadTagDimension["nodes"]=[];for(const node of dimension.nodes){const old=oldNodes.get(node.sourceId);if(!old)nodes.push(node);else if(JSON.stringify(old)!==JSON.stringify(node))conflicts.push({typeKey:"标签树",fieldKey:node.name,reason:"模板修改了已有标签节点，本书不会被覆盖。"});}if(nodes.length)tagDimensions.push(dimension);}
  const oldBindings=new Map((installed.tagBindings??[]).map(item=>[`${item.sourceTypeId}:${item.sourceDimensionId}`,item]));
  for(const binding of target.tagBindings??[]){const key=`${binding.sourceTypeId}:${binding.sourceDimensionId}`,prior=oldBindings.get(key);if(!prior)tagBindings.push(binding);else if(JSON.stringify(prior.config)!==JSON.stringify(binding.config))conflicts.push({typeKey:"标签规则",fieldKey:key,reason:"模板修改了已有标签选择规则，本书不会被覆盖。"});}
  return{dictionaries,tagDimensions,tagBindings};
}

export async function previewBookSync(bookId:string,targetVersionId:string):Promise<TemplateSyncPreview>{
  const pool=await getNewDesignPool();
  const book=assertFound((await pool.query("SELECT * FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");
  const target=assertFound((await pool.query("SELECT * FROM new_design.template_group_versions WHERE id=$1 AND template_id=$2",[targetVersionId,book.template_id])).rows[0],"目标模板版本不存在。");
  const types=await pool.query("SELECT type.id,type.current_version_id,type.revision,type.type_key,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id=$1",[book.space_id]);
  const installed=book.installed_payload as TemplatePayload,next=target.payload as TemplatePayload;
  const comparison=compareFields(installed,next,types.rows.map((row)=>({key:String(row.type_key),fields:row.fields as FieldDefinition[]})));
  const treeAdditions=compareTrees(installed,next,comparison.conflicts),id=randomUUID();
  await pool.query(`INSERT INTO new_design.book_template_syncs (id,book_id,from_template_version_id,to_template_version_id,additions,tree_additions,conflicts,status) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'previewed')`,[id,bookId,book.template_version_id,targetVersionId,JSON.stringify(comparison.additions),JSON.stringify({...treeAdditions,preconditions:syncPreconditions(book,types.rows,targetVersionId,comparison.additions,treeAdditions,comparison.conflicts)}),JSON.stringify(comparison.conflicts)]);
  return{id,bookId,fromTemplateVersionId:String(book.template_version_id),toTemplateVersionId:targetVersionId,...comparison,treeAdditions,status:"previewed"};
}

export async function readBookTemplateSync(syncId:string):Promise<TemplateSyncPreview|null>{
  const row=(await(await getNewDesignPool()).query("SELECT * FROM new_design.book_template_syncs WHERE id=$1",[syncId])).rows[0];
  return row?{id:String(row.id),bookId:String(row.book_id),fromTemplateVersionId:String(row.from_template_version_id),toTemplateVersionId:String(row.to_template_version_id),additions:row.additions as TemplateSyncPreview["additions"],treeAdditions:row.tree_additions as TemplateSyncPreview["treeAdditions"],conflicts:row.conflicts as TemplateSyncPreview["conflicts"],status:row.status as TemplateSyncPreview["status"]}:null;
}

async function applyTreeAdditions(client:PoolClient,spaceId:string,treeAdditions:NonNullable<TemplateSyncPreview["treeAdditions"]>):Promise<void>{
  for(const dictionary of treeAdditions.dictionaries){
    let definition=(await client.query("SELECT id FROM new_design.dictionary_definitions WHERE owner_space_id=$1 AND source_dictionary_id=$2 FOR UPDATE",[spaceId,dictionary.sourceId])).rows[0];
    if(!definition){definition={id:randomUUID()};await client.query("INSERT INTO new_design.dictionary_definitions(id,dictionary_key,name,description,scope,owner_space_id,status,source_dictionary_id) VALUES($1,$2,$3,$4,'book',$5,'published',$6)",[definition.id,dictionary.key,dictionary.name,dictionary.description,spaceId,dictionary.sourceId]);}
    const existing=await client.query("SELECT id,source_item_id FROM new_design.dictionary_items WHERE dictionary_id=$1",[definition.id]),itemIds=new Map(existing.rows.filter(row=>row.source_item_id).map(row=>[String(row.source_item_id),String(row.id)]));
    for(const item of dictionary.items)if(!itemIds.has(item.sourceId))itemIds.set(item.sourceId,randomUUID());
    for(const item of dictionary.items){const itemId=itemIds.get(item.sourceId)!;if((await client.query("SELECT 1 FROM new_design.dictionary_items WHERE id=$1",[itemId])).rowCount)continue;await client.query("INSERT INTO new_design.dictionary_items(id,dictionary_id,item_key,label,description,value,sort_order,status,source_item_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'active',$8)",[itemId,definition.id,item.key,item.label,item.description??"",JSON.stringify(item.value??{}),item.sortOrder,item.sourceId]);}
    for(const item of dictionary.items)if(item.parentSourceId)await client.query("UPDATE new_design.dictionary_items SET parent_id=$2 WHERE id=$1",[itemIds.get(item.sourceId),itemIds.get(item.parentSourceId)]);
    for(const item of dictionary.items){const itemId=itemIds.get(item.sourceId)!,hasVersion=await client.query("SELECT 1 FROM new_design.dictionary_items WHERE id=$1 AND current_version_id IS NOT NULL",[itemId]);if(hasVersion.rowCount)continue;const path=(await client.query(`WITH RECURSIVE parents AS (SELECT id,parent_id,label,ARRAY[id]::uuid[] ids,ARRAY[label]::text[] labels FROM new_design.dictionary_items WHERE id=$1 UNION ALL SELECT parent.id,parent.parent_id,parent.label,ARRAY[parent.id]::uuid[]||child.ids,ARRAY[parent.label]::text[]||child.labels FROM new_design.dictionary_items parent JOIN parents child ON child.parent_id=parent.id) SELECT ids,labels FROM parents WHERE parent_id IS NULL`,[itemId])).rows[0],versionId=randomUUID();await client.query("INSERT INTO new_design.dictionary_item_versions(id,item_id,version,label,description,parent_id,sort_order,value,status,path_node_ids,path_labels,created_by) SELECT $1,id,1,label,description,parent_id,sort_order,value,status,$3,$4,'template_sync' FROM new_design.dictionary_items WHERE id=$2",[versionId,itemId,path.ids,path.labels]);await client.query("UPDATE new_design.dictionary_items SET current_version_id=$2 WHERE id=$1",[itemId,versionId]);}
  }
  for(const dimension of treeAdditions.tagDimensions){
    let target=(await client.query("SELECT id FROM new_design.material_tag_dimensions WHERE owner_space_id=$1 AND source_dimension_id=$2 FOR UPDATE",[spaceId,dimension.sourceId])).rows[0];
    if(!target){const dimensionId=randomUUID(),versionId=randomUUID();target={id:dimensionId};await client.query("INSERT INTO new_design.material_tag_dimensions(id,dimension_key,name,description,scope,owner_space_id,source_dimension_id,created_by,updated_by) VALUES($1,$2,$3,$4,'book',$5,$6,'template_sync','template_sync')",[dimensionId,dimension.key,dimension.name,dimension.description,spaceId,dimension.sourceId]);await client.query("INSERT INTO new_design.material_tag_dimension_versions(id,dimension_id,version,name,description,status,created_by) VALUES($1,$2,1,$3,$4,'active','template_sync')",[versionId,dimensionId,dimension.name,dimension.description]);await client.query("UPDATE new_design.material_tag_dimensions SET current_version_id=$2 WHERE id=$1",[dimensionId,versionId]);}
    const existing=await client.query("SELECT id,source_tag_id FROM new_design.material_tags WHERE dimension_id=$1",[target.id]),tagIds=new Map(existing.rows.filter(row=>row.source_tag_id).map(row=>[String(row.source_tag_id),String(row.id)])),nodeById=new Map(dimension.nodes.map(node=>[node.sourceId,node]));
    for(const node of dimension.nodes)if(!tagIds.has(node.sourceId))tagIds.set(node.sourceId,randomUUID());
    const insertedTagIds=new Set<string>();
    for(const node of dimension.nodes){const nodeId=tagIds.get(node.sourceId)!;if((await client.query("SELECT 1 FROM new_design.material_tags WHERE id=$1",[nodeId])).rowCount)continue;insertedTagIds.add(nodeId);await client.query("INSERT INTO new_design.material_tags(id,space_id,tag_key,dimension_id,sort_order,visibility,source_tag_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'space',$6,'template_sync','template_sync')",[nodeId,spaceId,node.key,target.id,node.sortOrder,node.sourceId]);}
    for(const node of dimension.nodes)if(node.parentSourceId&&insertedTagIds.has(tagIds.get(node.sourceId)!))await client.query("UPDATE new_design.material_tags SET parent_id=$2 WHERE id=$1",[tagIds.get(node.sourceId),tagIds.get(node.parentSourceId)]);
    for(const node of dimension.nodes){const nodeId=tagIds.get(node.sourceId)!,hasVersion=await client.query("SELECT 1 FROM new_design.material_tags WHERE id=$1 AND current_version_id IS NOT NULL",[nodeId]);if(hasVersion.rowCount)continue;const sourcePath:PayloadTagDimension["nodes"]=[];let current:PayloadTagDimension["nodes"][number]|undefined=node;while(current){sourcePath.unshift(current);current=current.parentSourceId?nodeById.get(current.parentSourceId):undefined;}const versionId=randomUUID();await client.query("INSERT INTO new_design.material_tag_versions(id,tag_id,version,name,aliases,color,metadata,status,parent_id,sort_order,path_node_ids,path_names,created_by) VALUES($1,$2,1,$3,$4,$5,$6::jsonb,'active',$7,$8,$9,$10,'template_sync')",[versionId,nodeId,node.name,node.aliases,node.color,JSON.stringify({...node.metadata,description:node.description}),node.parentSourceId?tagIds.get(node.parentSourceId):null,node.sortOrder,sourcePath.map(item=>tagIds.get(item.sourceId)),sourcePath.map(item=>item.name)]);await client.query("UPDATE new_design.material_tags SET current_version_id=$2 WHERE id=$1",[nodeId,versionId]);}
  }
  for(const binding of treeAdditions.tagBindings){const targetType=(await client.query("SELECT id FROM new_design.card_types WHERE space_id=$1 AND source_card_type_id=$2",[spaceId,binding.sourceTypeId])).rows[0],targetDimension=(await client.query("SELECT id FROM new_design.material_tag_dimensions WHERE owner_space_id=$1 AND source_dimension_id=$2",[spaceId,binding.sourceDimensionId])).rows[0];if(!targetType||!targetDimension)continue;if((await client.query("SELECT 1 FROM new_design.card_type_tag_bindings WHERE card_type_id=$1 AND dimension_id=$2 AND status='active'",[targetType.id,targetDimension.id])).rowCount)continue;const mappedTags=await client.query("SELECT id,source_tag_id FROM new_design.material_tags WHERE dimension_id=$1 AND source_tag_id IS NOT NULL",[targetDimension.id]),tagIds=new Map(mappedTags.rows.map(row=>[String(row.source_tag_id),String(row.id)])),config=remapTagBindingConfig(binding.config,tagIds),bindingId=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.card_type_tag_bindings(id,card_type_id,dimension_id,config) VALUES($1,$2,$3,$4::jsonb)",[bindingId,targetType.id,targetDimension.id,JSON.stringify(config)]);await client.query("INSERT INTO new_design.card_type_tag_binding_versions(id,binding_id,version,config,status,created_by) VALUES($1,$2,1,$3::jsonb,'active','template_sync')",[versionId,bindingId,JSON.stringify(config)]);await client.query("UPDATE new_design.card_type_tag_bindings SET current_version_id=$2 WHERE id=$1",[bindingId,versionId]);}
}

async function remapTreeFieldsForBook(client:PoolClient,spaceId:string,fields:FieldDefinition[]):Promise<FieldDefinition[]>{
  const dictionaryRows=await client.query("SELECT id,source_dictionary_id FROM new_design.dictionary_definitions WHERE owner_space_id=$1 AND source_dictionary_id IS NOT NULL",[spaceId]),dictionaryIds=new Map(dictionaryRows.rows.map(row=>[String(row.source_dictionary_id),String(row.id)]));
  const itemRows=await client.query("SELECT item.id,item.source_item_id FROM new_design.dictionary_items item JOIN new_design.dictionary_definitions dictionary ON dictionary.id=item.dictionary_id WHERE dictionary.owner_space_id=$1 AND item.source_item_id IS NOT NULL",[spaceId]),itemIds=new Map(itemRows.rows.map(row=>[String(row.source_item_id),String(row.id)]));
  return remapDictionaryTreeFields(fields,dictionaryIds,itemIds);
}

export async function applyBookSync(syncId:string):Promise<TemplateSyncPreview>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const sync=assertFound((await client.query("SELECT * FROM new_design.book_template_syncs WHERE id=$1 FOR UPDATE",[syncId])).rows[0],"同步建议不存在。");
    if(sync.status==='applied'){const saved=sync.tree_additions?.receipt;if(!saved)throw new NewDesignError("原升级缺少当次结果回执，请保留原凭证核对。",409);await client.query("COMMIT");return saved as TemplateSyncPreview;}
    if(sync.status!=="previewed")throw new NewDesignError("此同步建议已经处理。",409);
    const book=assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 FOR UPDATE",[sync.book_id])).rows[0],"书籍不存在。");
    const actualTypes=await client.query("SELECT id,current_version_id,revision FROM new_design.card_types WHERE space_id=$1 FOR UPDATE",[book.space_id]);
    assertSyncPreconditions(sync,book,actualTypes.rows);
    const treeAdditions=(sync.tree_additions??{dictionaries:[],tagDimensions:[],tagBindings:[]}) as NonNullable<TemplateSyncPreview["treeAdditions"]>;
    await applyTreeAdditions(client,String(book.space_id),treeAdditions);
    for(const addition of sync.additions as TemplateSyncPreview["additions"]){
      const type=assertFound((await client.query("SELECT * FROM new_design.card_types WHERE space_id=$1 AND type_key=$2 FOR UPDATE",[book.space_id,addition.typeKey])).rows[0],`书内缺少“${addition.typeKey}”内容类型。`);
      const publishedFields=(await client.query("SELECT fields FROM new_design.card_type_versions WHERE id=$1",[type.current_version_id])).rows[0].fields as FieldDefinition[];
      if(structureWriteHash(type.draft_fields)!==structureWriteHash(publishedFields))throw new NewDesignError("书内填写规格有未发布草稿，请先处理草稿再预览新增。",409);
      const mappedFields=await remapTreeFieldsForBook(client,String(book.space_id),addition.fields),fields=additiveSyncFields(publishedFields,mappedFields);
      const version=Number((await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM new_design.card_type_versions WHERE card_type_id=$1",[type.id])).rows[0].version),versionId=randomUUID();
      await client.query("INSERT INTO new_design.card_type_versions (id,card_type_id,version,fields) VALUES ($1,$2,$3,$4::jsonb)",[versionId,type.id,version,JSON.stringify(fields)]);
      await client.query("UPDATE new_design.card_types SET draft_fields=$2::jsonb,current_version_id=$3,revision=revision+1,updated_at=now() WHERE id=$1",[type.id,JSON.stringify(fields),versionId]);
      await installNonSettlementFields(client,String(book.space_id),String(type.type_key),mappedFields);
    }
    const target=assertFound((await client.query("SELECT * FROM new_design.template_group_versions WHERE id=$1",[sync.to_template_version_id])).rows[0],"目标模板版本不存在。");
    await client.query("UPDATE new_design.books SET template_version_id=$2,installed_payload=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[book.id,target.id,JSON.stringify(installedSyncPayload(book.installed_payload as TemplatePayload,sync.additions as TemplateSyncPreview["additions"],treeAdditions))]);
    const result:TemplateSyncPreview={id:syncId,bookId:String(sync.book_id),fromTemplateVersionId:String(sync.from_template_version_id),toTemplateVersionId:String(sync.to_template_version_id),additions:sync.additions as TemplateSyncPreview["additions"],treeAdditions:{dictionaries:treeAdditions.dictionaries,tagDimensions:treeAdditions.tagDimensions,tagBindings:treeAdditions.tagBindings},conflicts:sync.conflicts as TemplateSyncPreview["conflicts"],status:"applied"};
    await client.query("UPDATE new_design.book_template_syncs SET status='applied',applied_at=now(),tree_additions=$2::jsonb WHERE id=$1",[syncId,JSON.stringify({...treeAdditions,receipt:result})]);
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

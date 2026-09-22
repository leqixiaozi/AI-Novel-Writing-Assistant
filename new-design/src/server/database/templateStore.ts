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
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard,type RecordCardDb,type RecordCardRow} from './recordCards';
import {recordWorkflowAction} from './cardWorkflow';

const SYSTEM_SPACE_ID='00000000-0000-4000-8000-000000000001';

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

export async function listTemplates():Promise<TemplateGroupSummary[]>{
  const db=await getNewDesignPool();
  const [templates,versions]=await Promise.all([listRecordCards(db,'template_group'),listRecordCards(db,'template_group_version')]);
  const byId=new Map(versions.map(row=>[row.id,row]));
  return templates.filter(row=>row.status!=='archived').sort((a,b)=>asDate(b.updated_at).localeCompare(asDate(a.updated_at)))
    .map(row=>mapTemplate({...row,current_version:byId.get(String(row.current_version_id))?.version??null}));
}
export async function listTemplateVersions(templateId:string):Promise<TemplateGroupVersion[]>{
  const rows=await listRecordCards(await getNewDesignPool(),'template_group_version',{where:{template_id:templateId}});
  return rows.sort((a,b)=>Number(b.version)-Number(a.version)).map(row=>({id:row.id,version:Number(row.version),payload:row.payload,createdAt:asDate(row.created_at)}));
}

export async function saveTemplate(input:{id?:string;key:string;name:string;description:string;draftConfig:Record<string,unknown>;revision?:number;requestKey?:string}):Promise<TemplateGroupSummary>{
  const {requestKey,...payload}=input;
  return executeStructureWrite("template","save",requestKey,payload,async(client)=>{
    const id=input.id??randomUUID(),now=new Date().toISOString();
    let row:RecordCardRow;
    if(input.id){
      const prior=await findRecordCard(client,id,'template_group',{lock:true});
      if(!prior||prior.status==='archived'||Number(prior.revision)!==input.revision)throw new NewDesignError("模板组已在其他页面更新；当前草稿保留，请重新读取目录后核对正式修订。",409);
      row=await replaceRecordCard(client,{id,spaceId:prior.recordSpaceId,typeKey:'template_group',title:input.name,values:{...prior,name:input.name,description:input.description,draft_config:input.draftConfig,revision:prior.revision+1,updated_at:now}});
    }else{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`template-key:${input.key}`]);
      if((await listRecordCards(client,'template_group',{includeArchived:true,where:{template_key:input.key}})).length)throw new NewDesignError("模板标识已存在。",409);
      row=await createRecordCard(client,{id,spaceId:SYSTEM_SPACE_ID,typeKey:'template_group',title:input.name,values:{id,template_key:input.key,name:input.name,description:input.description,draft_config:input.draftConfig,status:'draft',revision:1,current_version_id:null,created_at:now,updated_at:now}});
    }
    const version=row.current_version_id?await findRecordCard(client,String(row.current_version_id),'template_group_version'):null;
    return mapTemplate({...row,current_version:version?.version??null});
  });
}

async function buildPayload(client:PoolClient,config:Record<string,unknown>):Promise<TemplatePayload>{
  const requested=Array.isArray(config.cardTypeIds)?config.cardTypeIds.filter((id):id is string=>typeof id==="string"):[];
  const typeResult=await client.query(`SELECT type.*,version.id AS source_version_id,version.fields
    FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id
    WHERE type.space_id=$1 AND type.status='published' AND NOT type.is_internal ${requested.length?"AND type.id=ANY($2::uuid[])":"AND type.is_system"} ORDER BY type.sort_order`,requested.length?[SYSTEM_SPACE_ID,requested]:[SYSTEM_SPACE_ID]);
  const categories=new Map((await listRecordCards(client,'card_type_category')).map(row=>[row.id,row]));
  const dictionaryRows=await listRecordCards(client,'dictionary_definition',{where:{scope:'system',status:'published'}});
  const relationResult=await client.query("SELECT * FROM new_design.relation_types WHERE scope='system' AND status='published' ORDER BY name");
  const forms=await listRecordCards(client,'card_group_form',{where:{space_id:null,status:'published'}});
  const formVersions=new Map((await listRecordCards(client,'card_group_form_version')).map(row=>[row.id,row]));
  const dictionaries:PayloadDictionary[]=[];
  for(const dictionary of dictionaryRows.sort((a,b)=>String(a.name).localeCompare(String(b.name)))){
    const items=await listRecordCards(client,'dictionary_item',{where:{dictionary_id:dictionary.id,status:'active'}});
    dictionaries.push({sourceId:dictionary.id,key:dictionary.dictionary_key,name:dictionary.name,description:dictionary.description??"",items:items.sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)).map(item=>({sourceId:item.id,parentSourceId:item.parent_id??null,key:item.item_key,label:item.label,description:item.description??"",value:item.value,sortOrder:Number(item.sort_order)}))});
  }
  const dimensions=(await listRecordCards(client,'material_tag_dimension',{where:{status:'active'}})).filter(row=>['system','template'].includes(row.scope));
  const tagVersions=new Map((await listRecordCards(client,'material_tag_version')).map(row=>[row.id,row])),tagDimensions:PayloadTagDimension[]=[];
  for(const dimension of dimensions.sort((a,b)=>String(a.name).localeCompare(String(b.name)))){
    const nodes=await listRecordCards(client,'material_tag',{where:{dimension_id:dimension.id,status:'active'}});
    tagDimensions.push({sourceId:dimension.id,key:dimension.dimension_key,name:dimension.name,description:dimension.description??"",nodes:nodes.sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)).map(node=>{
      const version=assertFound(tagVersions.get(String(node.current_version_id)),"标签正式版本不存在。");
      return{sourceId:node.id,parentSourceId:node.parent_id??null,key:node.tag_key,name:version.name,description:version.metadata?.description??"",aliases:version.aliases??[],color:version.color??null,metadata:version.metadata??{},sortOrder:Number(node.sort_order)};
    })});
  }
  const typeIds=new Set(typeResult.rows.map(row=>String(row.id)));
  const tagBindings=(await listRecordCards(client,'card_type_tag_binding',{where:{status:'active'}})).filter(row=>typeIds.has(String(row.card_type_id))).map(row=>({sourceTypeId:String(row.card_type_id),sourceDimensionId:String(row.dimension_id),config:row.config as Record<string,unknown>}));
  let seedCards:PayloadCard[]=[];
  if(typeof config.seedSpaceId==="string"){
    const cards=await client.query(`SELECT card.*,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active' AND NOT type.is_internal`,[config.seedSpaceId]);
    seedCards=cards.rows.map(card=>({sourceId:String(card.id),typeKey:String(card.type_key),title:String(card.title),values:card.values}));
  }
  return{
    cardTypes:typeResult.rows.map(type=>({sourceId:String(type.id),sourceVersionId:String(type.source_version_id),key:String(type.type_key),name:String(type.name),description:String(type.description??""),categoryKey:categories.get(String(type.category_id))?.category_key,capabilities:type.semantic_capabilities,fields:type.fields,sortOrder:Number(type.sort_order)})),
    dictionaries,tagDimensions,tagBindings,
    relationTypes:relationResult.rows.map(relation=>({sourceId:String(relation.id),key:String(relation.relation_key),name:String(relation.name),description:String(relation.description??""),direction:relation.direction,sourceTypeKeys:relation.source_type_keys,targetTypeKeys:relation.target_type_keys,sourceMax:relation.source_max==null?null:Number(relation.source_max),targetMax:relation.target_max==null?null:Number(relation.target_max),propertiesSchema:relation.properties_schema})),
    forms:forms.sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(form=>{const version=assertFound(formVersions.get(String(form.current_version_id)),"表单正式版本不存在。");return{sourceId:form.id,sourceVersionId:version.id,key:form.form_key,name:form.name,description:form.description??"",definition:version.definition as CardGroupFormDefinition};}),
    seedCards,viewConfigs:DEFAULT_VIEW_CONFIGS,menu:{defaultPage:"creative-forms",pages:["creative-forms","all-cards","book-views"]},
  };
}

export async function publishTemplate(id:string,revision:number,requestKey?:string):Promise<TemplateGroupSummary>{
  return executeStructureWrite("template","publish",requestKey,{id,revision},async(client)=>{
    const template=assertFound(await findRecordCard(client,id,'template_group',{lock:true}),"模板组不存在。");
    if(template.status==='archived'||template.revision!==revision)throw new NewDesignError("模板组已在其他页面更新；当前草稿保留，请重新读取目录后核对正式修订。",409);
    const payload=await buildPayload(client,template.draft_config),versions=await listRecordCards(client,'template_group_version',{where:{template_id:id}});
    const version=Math.max(0,...versions.map(row=>Number(row.version)))+1,versionId=randomUUID(),now=new Date().toISOString();
    await createRecordCard(client,{id:versionId,spaceId:template.recordSpaceId,typeKey:'template_group_version',title:template.name,values:{id:versionId,template_id:id,version,payload,created_at:now}});
    const row=await replaceRecordCard(client,{id,spaceId:template.recordSpaceId,typeKey:'template_group',values:{...template,status:'published',current_version_id:versionId,revision:revision+1,updated_at:now}});
    return mapTemplate({...row,current_version:version});
  });
}

function mapBook(row:Record<string,unknown>):BookSummary{return{id:String(row.id),spaceId:String(row.space_id),key:String(row.book_key),name:String(row.name),description:String(row.description??""),status:row.status as BookSummary["status"],templateId:String(row.template_id),templateName:String(row.template_name),templateVersionId:String(row.template_version_id),templateVersion:Number(row.template_version),revision:Number(row.revision),cardCount:Number(row.card_count??0),formCount:Number(row.form_count??0),createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)};}
export async function bookSummaries(db:RecordCardDb,id?:string):Promise<BookSummary[]>{
  const books=await db.query(`SELECT book.*,(SELECT count(*) FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=book.space_id AND card.status='active' AND NOT type.is_internal) card_count FROM new_design.books book WHERE ($1::uuid IS NULL AND book.status='active') OR book.id=$1 ORDER BY book.updated_at DESC`,[id??null]);
  const [templates,versions,forms]=await Promise.all([listRecordCards(db,'template_group',{includeArchived:true}),listRecordCards(db,'template_group_version'),listRecordCards(db,'card_group_form',{where:{status:'published'}})]);
  const templateById=new Map(templates.map(row=>[row.id,row])),versionById=new Map(versions.map(row=>[row.id,row]));
  return books.rows.map(book=>mapBook({...book,template_name:assertFound(templateById.get(String(book.template_id)),"书籍模板不存在。").name,template_version:assertFound(versionById.get(String(book.template_version_id)),"书籍模板版本不存在。").version,form_count:forms.filter(form=>form.space_id===book.space_id).length}));
}
export async function listBooks():Promise<BookSummary[]>{return bookSummaries(await getNewDesignPool());}
export async function getBook(id:string):Promise<BookSummary>{return assertFound((await listBooks()).find(book=>book.id===id),"书籍不存在。");}

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
  await applyTreeAdditions(client,spaceId,{dictionaries:payload.dictionaries,tagDimensions:payload.tagDimensions??[],tagBindings:[]},'template_install');
  const installedDictionaries=await listRecordCards(client,'dictionary_definition',{where:{owner_space_id:spaceId}});
  for(const dictionary of installedDictionaries){
    if(dictionary.source_dictionary_id)dictionaryIds.set(String(dictionary.source_dictionary_id),dictionary.id);
    for(const item of await listRecordCards(client,'dictionary_item',{where:{dictionary_id:dictionary.id}}))if(item.source_item_id)dictionaryItemIds.set(String(item.source_item_id),item.id);
  }
  const typeIds = new Map<string, { typeId: string; versionId: string }>(),installedFieldsByType=new Map<string,FieldDefinition[]>();
  for (const type of payload.cardTypes) {
    const typeId = randomUUID();
    const versionId = randomUUID();
    typeIds.set(type.key, { typeId, versionId });
    const category=type.categoryKey?(await listRecordCards(client,'card_type_category',{where:{category_key:type.categoryKey,status:'active'}}))[0]:null;
    const fields=remapDictionaryTreeFields(type.fields,dictionaryIds,dictionaryItemIds);
    installedFieldsByType.set(type.key,fields);
    await client.query(`INSERT INTO new_design.card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,source_card_type_id,source_type_version_id,category_id) VALUES ($1,$2,$3,$4,$5,'published',1,NULL,$6::jsonb,false,$7,$8::jsonb,$9,$10,$11)`, [typeId, spaceId, type.key, type.name, type.description, JSON.stringify(fields), type.sortOrder, JSON.stringify(type.capabilities), type.sourceId, type.sourceVersionId, category?.id ?? null]);
    await client.query("INSERT INTO new_design.card_type_versions (id,card_type_id,version,fields) VALUES ($1,$2,1,$3::jsonb)", [versionId, typeId, JSON.stringify(fields)]);
    await client.query("UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1", [typeId, versionId]);
    await installNonSettlementFields(client,spaceId,type.key,fields);
  }
  await applyTreeAdditions(client,spaceId,{dictionaries:[],tagDimensions:[],tagBindings:payload.tagBindings??[]},'template_install');
  for (const relation of payload.relationTypes) {const relationId=randomUUID();relationTypeIds.set(relation.sourceId,relationId);if(!Array.isArray(relation.propertiesSchema))throw new NewDesignError(`模板关系“${relation.name}”缺少完整正式字段规格，请选择已完善的模板版本。`,422,{[`relationTypes.${relation.sourceId}`]:"请核对正式模板关系规格。"});const fields:FieldDefinition[]=[];for(const [index,value] of relation.propertiesSchema.entries()){const raw=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null,result=raw?fieldDefinitionSchema.strict().safeParse({...raw,order:raw.order??index}):null;if(!result?.success)throw new NewDesignError(`模板关系“${relation.name}”含未知字段，不会自动发布；请核对正式模板规格。`,422,{[`relationTypes.${relation.sourceId}`]:"请完善真实字段规格后重新选择模板版本。"});fields.push({...result.data,defaultValue:result.data.defaultValue??null} as FieldDefinition);}const propertiesSchema=remapDictionaryTreeFields(fields,dictionaryIds,dictionaryItemIds);await client.query(`INSERT INTO new_design.relation_types (id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status,source_relation_type_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'book',$10,$11::jsonb,'published',$12)`, [relationId, relation.key, relation.name, relation.description, relation.direction, relation.sourceTypeKeys, relation.targetTypeKeys, relation.sourceMax, relation.targetMax, spaceId, JSON.stringify(propertiesSchema), relation.sourceId]);}
  for(const relation of payload.relationTypes)if(relation.statePolicy?.settlementCapability==="disabled"&&relation.statePolicy.stateMode==="none"){
    if(!(await listRecordCards(client,'state_relation_capability',{where:{space_id:spaceId,relation_key:relation.key}})).length){
      const id=randomUUID();await createRecordCard(client,{id,spaceId,typeKey:'state_relation_capability',title:relation.name,values:{id,space_id:spaceId,relation_key:relation.key,settlement_capability:'disabled',state_mode:'none'}});
    }
  }
  for(const view of completeViewConfigs(payload.viewConfigs)){
    const id=randomUUID(),now=new Date().toISOString();
    await createRecordCard(client,{id,spaceId,typeKey:'book_view_config',title:view.name,values:{id,book_id:bookId,view_key:view.key,config:view.config,revision:1,created_at:now,updated_at:now}});
  }
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
        if(!dictionaryMappings.some(mapping=>mapping.sourceId===origin.sourceId)){const targetId=dictionaryIds.get(origin.sourceId)!;const nodes=await listRecordCards(client,'dictionary_item',{where:{dictionary_id:targetId,status:'active'}});
          dictionaryMappings.push({sourceId:origin.sourceId,sourceVersion:{kind:'template_snapshot',versionId:sourceTemplateVersionId,definitionHash:structureWriteHash(origin)},targetId,nodes:nodes.map(node=>({sourceId:String(node.source_item_id),targetId:String(node.id),targetVersionId:String(node.current_version_id)}))});}}
      slot.localFields=remapDictionaryTreeFields(slot.localFields.map((field,index)=>({...field,description:field.description??"",options:field.options??[],group:field.group??"",order:field.order??index,defaultValue:field.defaultValue??null})),dictionaryIds,dictionaryItemIds);
    }
    const relationMappings:NonNullable<CardGroupFormDefinition['installation']>['relationMappings']=[];
    for(const key of [...new Set(formSlots(definition).map(slot=>slot.relationTypeKey).filter((key):key is string=>!!key))]){const origin=payload.relationTypes.find(item=>item.key===key),targetId=origin?relationTypeIds.get(origin.sourceId):undefined;if(!origin||!targetId)throw new NewDesignError('表单关系来源不在冻结模板中。',422);const rule=relationDefinition((await client.query('SELECT * FROM new_design.relation_types WHERE id=$1',[targetId])).rows[0]);const sourceRule={key:origin.key,name:origin.name,description:origin.description,direction:origin.direction,sourceTypeKeys:origin.sourceTypeKeys,targetTypeKeys:origin.targetTypeKeys,sourceMax:origin.sourceMax,targetMax:origin.targetMax,propertiesSchema:origin.propertiesSchema};relationMappings.push({key,targetKey:key,sourceId:origin.sourceId,sourceVersion:{kind:'template_snapshot',versionId:sourceTemplateVersionId,definitionHash:structureWriteHash(sourceRule)},targetId,targetDefinitionHash:structureWriteHash(rule)});}
    definition.installation={sourceTemplateVersionId,sourceFormId:form.sourceId,sourceFormVersionId:form.sourceVersionId,sourceDefinitionHash:structureWriteHash(form.definition),previousFormVersionId:null,typeMappings:[...new Set(formSlots(definition).flatMap(slot=>slot.allowedTypeKeys))].map(key=>{const origin=payload.cardTypes.find(type=>type.key===key),target=typeIds.get(key);if(!origin||!target)throw new NewDesignError('表单类型来源不在冻结模板中。',422);return{key,sourceId:origin.sourceId,sourceVersionId:origin.sourceVersionId,targetId:target.typeId,targetVersionId:target.versionId};}),relationMappings,dictionaryMappings};
    const now=new Date().toISOString();
    await createRecordCard(client,{id:formId,spaceId,typeKey:'card_group_form',title:form.name,values:{id:formId,space_id:spaceId,form_key:form.key,name:form.name,description:form.description,status:'published',revision:1,current_version_id:versionId,draft_definition:definition,is_system:false,source_form_id:form.sourceId,source_form_version_id:form.sourceVersionId,created_at:now,updated_at:now}});
    await createRecordCard(client,{id:versionId,spaceId,typeKey:'card_group_form_version',title:form.name,values:{id:versionId,form_id:formId,version:1,definition,created_at:now}});
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
      if(fieldBatchId){
        const batch=await findRecordCard(client,fieldBatchId,'ai_generation_batch');
        const approvedValue=fieldKey==="$title"?card.title:card.values[fieldKey]??null;
        const adopted=batch?.status==='applied'&&batch.stage==='review_adopted'&&(batch.preparation_adoption_receipts??[]).some((adoption:Record<string,any>)=>
          adoption.receipt?.batchId===batch.id&&(adoption.receipt?.session?.reviewCards??[]).some((reviewed:Record<string,any>)=>
            reviewed.id===(card as BookCreationReviewCard).id&&reviewed.typeKey===card.typeKey&&reviewed.aiFieldBatchIds?.[fieldKey]===batch.id&&structureWriteHash(fieldKey==="$title"?reviewed.title:reviewed.values?.[fieldKey]??null)===structureWriteHash(approvedValue)));
        if(!batch||batch.session_id!==(options.origin?.sessionId??null)||(batch.status!=='review'&&!adopted))throw new NewDesignError("开书 AI 来源不属于当前创建会话，未创建书籍。",409);
      }
      await saveFieldOrigin(client,spaceId,cardId,fieldKey,{source_kind:fieldBatchId?"ai":sourceKind,source_id:fieldBatchId?null:prepared.sourceId,generation_batch_id:fieldBatchId??(sourceKind==="ai"?options.origin?.generationBatchId??null:null),confirmation_status:confirmation,original_value:originalValue??null,current_value:value});
    }
    if (sourceKind === "resource" && prepared.sourceId && prepared.sourceVersionId) {
      await recordWorkflowAction(client,{cardId,cardVersionId:versionId,actionKey:'resource.install_snapshot',payload:{resource_card_id:prepared.sourceId,resource_version_id:prepared.sourceVersionId,book_id:bookId,target_card_id:cardId,action:'install_snapshot',snapshot:{typeKey:card.typeKey,title:card.title,values}}});
    }
  }
  for(const card of options.researchCards??[]){
    const type=assertFound(typeIds.get(card.typeKey),`模板缺少卡片类型 ${card.typeKey}。`),fields=assertFound(installedFieldsByType.get(card.typeKey),`模板缺少类型定义 ${card.typeKey}。`),allowedKeys=new Set(fields.map((field)=>field.key)),suggested=remapTreeValues(fields,Object.fromEntries(Object.entries(card.values).filter(([key])=>allowedKeys.has(key)))),key=`${card.typeKey}\u0000${card.title}`,existing=installedCards.get(key);
    if(existing){const values={...existing.values};const adopted:string[]=[];for(const [fieldKey,value] of Object.entries(suggested))if(values[fieldKey]===null||values[fieldKey]===undefined||values[fieldKey]===""||(Array.isArray(values[fieldKey])&&values[fieldKey].length===0)){values[fieldKey]=value;adopted.push(fieldKey);}if(!adopted.length)continue;const treeIssues=await validateDictionaryTreeValues(client,fields,values);if(Object.keys(treeIssues).length)throw new NewDesignError(`研究建议“${card.title}”引用了不可用的字典项。`,422,treeIssues);const nextRevision=existing.revision+1,versionId=randomUUID();await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit')",[versionId,existing.id,nextRevision,existing.typeVersionId,existing.title,JSON.stringify(values)]);await snapshotDictionaryTreeValues(client,fields,values,versionId);await client.query("UPDATE new_design.cards SET values=$2::jsonb,revision=$3,current_version_id=$4,updated_at=now() WHERE id=$1",[existing.id,JSON.stringify(values),nextRevision,versionId]);for(const fieldKey of adopted)await saveFieldOrigin(client,spaceId,existing.id,fieldKey,{source_kind:'research',source_id:card.researchVersionId,confirmation_status:'confirmed',original_value:values[fieldKey],current_value:values[fieldKey]});installedCards.set(key,{...existing,values,revision:nextRevision});continue;}
    const validated=validateCardValues(fields,suggested);if(Object.keys(validated.issues).length)throw new NewDesignError(`研究建议“${card.title}”未满足模板字段要求。`,422,validated.issues);const treeIssues=await validateDictionaryTreeValues(client,fields,validated.values);if(Object.keys(treeIssues).length)throw new NewDesignError(`研究建议“${card.title}”引用了不可用的字典项。`,422,treeIssues);const cardId=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)",[cardId,spaceId,type.typeId,card.title,type.versionId,JSON.stringify(validated.values)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[versionId,cardId,type.versionId,card.title,JSON.stringify(validated.values)]);await snapshotDictionaryTreeValues(client,fields,validated.values,versionId);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,versionId]);for(const [fieldKey,value]of [["$title",card.title],...Object.entries(validated.values)])await saveFieldOrigin(client,spaceId,cardId,String(fieldKey),{source_kind:'research',source_id:card.researchVersionId,confirmation_status:'confirmed',original_value:value,current_value:value});installedCards.set(key,{id:cardId,typeVersionId:type.versionId,title:card.title,values:validated.values,revision:1});
  }
  return{cards:reviewCardIds,dictionaryIds,dictionaryItemIds,relationTypeIds};
}

async function saveFieldOrigin(client:PoolClient,spaceId:string,cardId:string,fieldKey:string,values:Record<string,unknown>):Promise<void>{
  const prior=(await listRecordCards(client,'card_field_origin',{where:{card_id:cardId,field_key:fieldKey},lock:true}))[0],now=new Date().toISOString();
  if(prior)await replaceRecordCard(client,{id:prior.id,spaceId:prior.recordSpaceId,typeKey:'card_field_origin',values:{...prior,...values,updated_at:now}});
  else{const id=randomUUID();await createRecordCard(client,{id,spaceId,typeKey:'card_field_origin',title:fieldKey,values:{id,card_id:cardId,field_key:fieldKey,generation_batch_id:null,...values,created_at:now,updated_at:now}});}
}

async function saveBookSources(client:PoolClient,bookId:string,spaceId:string,options:CreateBookOptions):Promise<void>{
  const now=new Date().toISOString();
  for(const reference of options.researchReferences??[]){
    const id=randomUUID();await createRecordCard(client,{id,spaceId,typeKey:'book_research_reference',title:reference.purpose,values:{id,book_id:bookId,research_version_id:reference.researchVersionId,pack_version_id:reference.packVersionId,purpose:reference.purpose,compiled_snapshot:reference.compiledSnapshot,created_at:now}});
  }
  if(options.origin){const id=randomUUID();await createRecordCard(client,{id,spaceId,typeKey:'book_content_source',title:options.origin.method,values:{id,book_id:bookId,session_id:options.origin.sessionId??null,method:options.origin.method,source_reference:options.origin.sourceReference,source_payload:options.origin.sourcePayload,confirmation_status:'confirmed',created_at:now}});}
}

export async function getBookInTransaction(client:PoolClient,id:string):Promise<BookSummary>{return assertFound((await bookSummaries(client,id))[0],"书籍不可用。");}

export async function createBookInTransaction(client:PoolClient,input:{key:string;name:string;description:string;templateVersionId:string},options:CreateBookOptions={}):Promise<{book:BookSummary;installed:InstalledBookPayload;payload:TemplatePayload}>{
 const id=randomUUID(),spaceId=randomUUID(),version=assertFound(await findRecordCard(client,input.templateVersionId,'template_group_version'),"模板版本不存在。"),template=assertFound(await findRecordCard(client,String(version.template_id),'template_group'),"模板组不存在。"),payload=version.payload as TemplatePayload;
 await client.query("INSERT INTO new_design.card_spaces(id,space_key,name) VALUES($1,$2,$3)",[spaceId,`book_${input.key}`,input.name]);
 await client.query("INSERT INTO new_design.books(id,space_id,book_key,name,description,template_id,template_version_id,installed_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[id,spaceId,input.key,input.name,input.description,template.id,version.id,JSON.stringify(payload)]);
 const installed=await installPayload(client,id,spaceId,payload,options);
 await initializeProjectRuleInTransaction(client,id,randomUUID());
 await saveBookSources(client,id,spaceId,options);
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
    const version=assertFound(await findRecordCard(client,input.templateVersionId,'template_group_version'),"模板版本不存在。");
    const template=assertFound(await findRecordCard(client,String(version.template_id),'template_group'),"模板组不存在。");
    const payload = version.payload as TemplatePayload;
    await client.query("INSERT INTO new_design.card_spaces (id,space_key,name) VALUES ($1,$2,$3)", [spaceId, `book_${input.key}`, input.name]);
    await client.query(`INSERT INTO new_design.books (id,space_id,book_key,name,description,template_id,template_version_id,installed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [id, spaceId, input.key, input.name, input.description, template.id, version.id, JSON.stringify(payload)]);
    await installPayload(client, id, spaceId, payload, options);
    await initializeProjectRuleInTransaction(client,id,randomUUID());
    await saveBookSources(client,id,spaceId,options);
    if(options.origin?.sessionId){
      const session=await findRecordCard(client,options.origin.sessionId,'book_creation_session',{lock:true});
      if(!session||session.status!=='creating'||session.book_id)throw new NewDesignError("当前开书会话已变化，书籍未重复创建。",409);
      await replaceRecordCard(client,{id:session.id,spaceId:session.recordSpaceId,typeKey:'book_creation_session',values:{...session,status:'completed',stage:'ready',progress:100,book_id:id,error_message:null,revision:session.revision+1,updated_at:new Date().toISOString()}});
      const usedBatches=[...new Set([options.origin.generationBatchId,...(options.reviewCards??[]).flatMap(card=>Object.values(card.aiFieldBatchIds??{}))].filter((id):id is string=>Boolean(id)))];
      for(const batchId of usedBatches){
        const batch=await findRecordCard(client,batchId,'ai_generation_batch',{lock:true});
        if(batch?.session_id===session.id&&batch.status==='review')await replaceRecordCard(client,{id:batch.id,spaceId:batch.recordSpaceId,typeKey:'ai_generation_batch',values:{...batch,status:'applied',updated_at:new Date().toISOString()}});
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
  const target=assertFound(await findRecordCard(pool,targetVersionId,'template_group_version'),"目标模板版本不存在。");
  if(target.template_id!==book.template_id)throw new NewDesignError("目标模板版本不属于当前模板。",404);
  const types=await pool.query("SELECT type.id,type.current_version_id,type.revision,type.type_key,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id=$1",[book.space_id]);
  const installed=book.installed_payload as TemplatePayload,next=target.payload as TemplatePayload;
  const comparison=compareFields(installed,next,types.rows.map((row)=>({key:String(row.type_key),fields:row.fields as FieldDefinition[]})));
  const treeAdditions=compareTrees(installed,next,comparison.conflicts),id=randomUUID();
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await createRecordCard(client,{id,spaceId:String(book.space_id),typeKey:'book_template_sync',title:'模板增量同步',values:{id,book_id:bookId,from_template_version_id:book.template_version_id,to_template_version_id:targetVersionId,additions:comparison.additions,tree_additions:{...treeAdditions,preconditions:syncPreconditions(book,types.rows,targetVersionId,comparison.additions,treeAdditions,comparison.conflicts)},conflicts:comparison.conflicts,status:'previewed',created_at:new Date().toISOString(),applied_at:null}});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return{id,bookId,fromTemplateVersionId:String(book.template_version_id),toTemplateVersionId:targetVersionId,...comparison,treeAdditions,status:"previewed"};
}

export async function readBookTemplateSync(syncId:string):Promise<TemplateSyncPreview|null>{
  const row=await findRecordCard(await getNewDesignPool(),syncId,'book_template_sync');
  return row?{id:String(row.id),bookId:String(row.book_id),fromTemplateVersionId:String(row.from_template_version_id),toTemplateVersionId:String(row.to_template_version_id),additions:row.additions as TemplateSyncPreview["additions"],treeAdditions:row.tree_additions as TemplateSyncPreview["treeAdditions"],conflicts:row.conflicts as TemplateSyncPreview["conflicts"],status:row.status as TemplateSyncPreview["status"]}:null;
}

function installedTreePath(nodes:Map<string,{id:string;parent_id:string|null;name:string}>,id:string):Array<{id:string;name:string}>{
  const path:Array<{id:string;name:string}>=[],seen=new Set<string>();
  let current:string|null=id;
  while(current){
    if(seen.has(current))throw new NewDesignError("模板树存在循环，未安装任何内容。",422);
    seen.add(current);
    const node:{id:string;parent_id:string|null;name:string}=assertFound(nodes.get(current),"模板树引用了缺失的父节点。");
    path.unshift({id:node.id,name:node.name});current=node.parent_id;
  }
  return path;
}

async function applyTreeAdditions(client:PoolClient,spaceId:string,treeAdditions:NonNullable<TemplateSyncPreview["treeAdditions"]>,actor='template_sync'):Promise<void>{
  const now=new Date().toISOString();
  for(const dictionary of treeAdditions.dictionaries){
    let definition=(await listRecordCards(client,'dictionary_definition',{where:{owner_space_id:spaceId,source_dictionary_id:dictionary.sourceId},lock:true}))[0];
    if(!definition){
      if((await listRecordCards(client,'dictionary_definition',{where:{owner_space_id:spaceId,dictionary_key:dictionary.key}})).length)throw new NewDesignError("书内已有同名但来源不同的字典，未自动覆盖。",409);
      const id=randomUUID();
      definition=await createRecordCard(client,{id,spaceId,typeKey:'dictionary_definition',title:dictionary.name,values:{id,dictionary_key:dictionary.key,name:dictionary.name,description:dictionary.description,scope:'book',owner_space_id:spaceId,status:'published',read_only:false,source_dictionary_id:dictionary.sourceId,revision:1,created_at:now,updated_at:now}});
    }
    const existing=await listRecordCards(client,'dictionary_item',{where:{dictionary_id:definition.id},includeArchived:true});
    const bySource=new Map(existing.filter(row=>row.source_item_id).map(row=>[String(row.source_item_id),row.id]));
    const keys=new Set(existing.map(row=>String(row.item_key)));
    const pending=dictionary.items.filter(item=>!bySource.has(item.sourceId));
    for(const item of pending){
      if(bySource.has(item.sourceId)||keys.has(item.key))throw new NewDesignError("字典新增项的标识与已有节点重复。",409);
      bySource.set(item.sourceId,randomUUID());keys.add(item.key);
    }
    const nodes=new Map(existing.map(row=>[row.id,{id:row.id,parent_id:row.parent_id as string|null,name:String(row.label)}]));
    for(const item of pending){
      const id=bySource.get(item.sourceId)!;
      const parentId=item.parentSourceId?assertFound(bySource.get(item.parentSourceId),"字典新增节点缺少父节点。"):null;
      nodes.set(id,{id,parent_id:parentId,name:item.label});
    }
    for(const item of pending){
      const id=bySource.get(item.sourceId)!,versionId=randomUUID(),node=nodes.get(id)!,path=installedTreePath(nodes,id);
      const values={id,dictionary_id:definition.id,item_key:item.key,label:item.label,description:item.description??"",value:item.value??{},sort_order:item.sortOrder,status:'active',source_item_id:item.sourceId,parent_id:node.parent_id,current_version_id:versionId,revision:1,created_at:now,updated_at:now};
      await createRecordCard(client,{id,spaceId,typeKey:'dictionary_item',title:item.label,values});
      await createRecordCard(client,{id:versionId,spaceId,typeKey:'dictionary_item_version',title:item.label,values:{id:versionId,item_id:id,version:1,label:item.label,description:values.description,parent_id:node.parent_id,sort_order:item.sortOrder,value:values.value,status:'active',path_node_ids:path.map(row=>row.id),path_labels:path.map(row=>row.name),created_by:actor,created_at:now}});
    }
  }
  for(const dimension of treeAdditions.tagDimensions){
    let target=(await listRecordCards(client,'material_tag_dimension',{where:{owner_space_id:spaceId,source_dimension_id:dimension.sourceId},lock:true}))[0];
    if(!target){
      if((await listRecordCards(client,'material_tag_dimension',{where:{owner_space_id:spaceId,dimension_key:dimension.key}})).length)throw new NewDesignError("书内已有同名但来源不同的标签维度，未自动覆盖。",409);
      const id=randomUUID(),versionId=randomUUID();
      target=await createRecordCard(client,{id,spaceId,typeKey:'material_tag_dimension',title:dimension.name,values:{id,dimension_key:dimension.key,name:dimension.name,description:dimension.description??"",scope:'book',owner_space_id:spaceId,status:'active',read_only:false,source_dimension_id:dimension.sourceId,current_version_id:versionId,revision:1,created_by:actor,updated_by:actor,created_at:now,updated_at:now}});
      await createRecordCard(client,{id:versionId,spaceId,typeKey:'material_tag_dimension_version',title:dimension.name,values:{id:versionId,dimension_id:id,version:1,name:dimension.name,description:dimension.description??"",status:'active',created_by:actor,created_at:now}});
    }
    const existing=await listRecordCards(client,'material_tag',{where:{dimension_id:target.id},includeArchived:true});
    const bySource=new Map(existing.filter(row=>row.source_tag_id).map(row=>[String(row.source_tag_id),row.id]));
    const keys=new Set(existing.map(row=>String(row.tag_key))),pending=dimension.nodes.filter(node=>!bySource.has(node.sourceId));
    for(const node of pending){
      if(bySource.has(node.sourceId)||keys.has(node.key))throw new NewDesignError("标签新增项的标识与已有节点重复。",409);
      bySource.set(node.sourceId,randomUUID());keys.add(node.key);
    }
    const nodes=new Map<string,{id:string;parent_id:string|null;name:string}>();
    for(const node of existing){
      const version=assertFound(await findRecordCard(client,String(node.current_version_id),'material_tag_version'),"现有标签的正式版本不存在。");
      nodes.set(node.id,{id:node.id,parent_id:node.parent_id,name:String(version.name)});
    }
    for(const node of pending){
      const id=bySource.get(node.sourceId)!,parentId=node.parentSourceId?assertFound(bySource.get(node.parentSourceId),"标签新增节点缺少父节点。"):null;
      nodes.set(id,{id,parent_id:parentId,name:node.name});
    }
    for(const node of pending){
      const id=bySource.get(node.sourceId)!,versionId=randomUUID(),parentId=nodes.get(id)!.parent_id,path=installedTreePath(nodes,id);
      await createRecordCard(client,{id,spaceId,typeKey:'material_tag',title:node.name,values:{id,space_id:spaceId,tag_key:node.key,dimension_id:target.id,parent_id:parentId,sort_order:node.sortOrder,visibility:'space',source_tag_id:node.sourceId,status:'active',revision:1,current_version_id:versionId,created_by:actor,updated_by:actor,created_at:now,updated_at:now}});
      await createRecordCard(client,{id:versionId,spaceId,typeKey:'material_tag_version',title:node.name,values:{id:versionId,tag_id:id,version:1,name:node.name,aliases:node.aliases??[],color:node.color??null,metadata:{...node.metadata,description:node.description??""},status:'active',parent_id:parentId,sort_order:node.sortOrder,path_node_ids:path.map(row=>row.id),path_names:path.map(row=>row.name),created_by:actor,created_at:now}});
    }
  }
  for(const binding of treeAdditions.tagBindings){
    const targetType=(await client.query("SELECT id FROM new_design.card_types WHERE space_id=$1 AND source_card_type_id=$2",[spaceId,binding.sourceTypeId])).rows[0];
    const targetDimension=(await listRecordCards(client,'material_tag_dimension',{where:{owner_space_id:spaceId,source_dimension_id:binding.sourceDimensionId}}))[0];
    if(!targetType||!targetDimension)continue;
    if((await listRecordCards(client,'card_type_tag_binding',{where:{card_type_id:targetType.id,dimension_id:targetDimension.id,status:'active'}})).length)continue;
    const tags=await listRecordCards(client,'material_tag',{where:{dimension_id:targetDimension.id}});
    const tagIds=new Map(tags.filter(row=>row.source_tag_id).map(row=>[String(row.source_tag_id),row.id]));
    const id=randomUUID(),versionId=randomUUID(),config=remapTagBindingConfig(binding.config,tagIds);
    await createRecordCard(client,{id,spaceId,typeKey:'card_type_tag_binding',title:'类型标签规则',values:{id,card_type_id:targetType.id,dimension_id:targetDimension.id,config,status:'active',current_version_id:versionId,revision:1,created_at:now,updated_at:now}});
    await createRecordCard(client,{id:versionId,spaceId,typeKey:'card_type_tag_binding_version',title:'类型标签规则',values:{id:versionId,binding_id:id,version:1,config,status:'active',created_by:actor,created_at:now}});
  }
}

async function remapTreeFieldsForBook(client:PoolClient,spaceId:string,fields:FieldDefinition[]):Promise<FieldDefinition[]>{
  const dictionaries=await listRecordCards(client,'dictionary_definition',{where:{owner_space_id:spaceId}});
  const dictionaryIds=new Map(dictionaries.filter(row=>row.source_dictionary_id).map(row=>[String(row.source_dictionary_id),row.id]));
  const itemIds=new Map<string,string>();
  for(const dictionary of dictionaries)for(const row of await listRecordCards(client,'dictionary_item',{where:{dictionary_id:dictionary.id}}))if(row.source_item_id)itemIds.set(String(row.source_item_id),row.id);
  return remapDictionaryTreeFields(fields,dictionaryIds,itemIds);
}

export async function applyBookSync(syncId:string):Promise<TemplateSyncPreview>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const sync=assertFound(await findRecordCard(client,syncId,'book_template_sync',{lock:true}),"同步建议不存在。");
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
    const target=assertFound(await findRecordCard(client,String(sync.to_template_version_id),'template_group_version'),"目标模板版本不存在。");
    if(target.template_id!==book.template_id)throw new NewDesignError("目标模板版本不属于当前模板。",409);
    await client.query("UPDATE new_design.books SET template_version_id=$2,installed_payload=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[book.id,target.id,JSON.stringify(installedSyncPayload(book.installed_payload as TemplatePayload,sync.additions as TemplateSyncPreview["additions"],treeAdditions))]);
    const result:TemplateSyncPreview={id:syncId,bookId:String(sync.book_id),fromTemplateVersionId:String(sync.from_template_version_id),toTemplateVersionId:String(sync.to_template_version_id),additions:sync.additions as TemplateSyncPreview["additions"],treeAdditions:{dictionaries:treeAdditions.dictionaries,tagDimensions:treeAdditions.tagDimensions,tagBindings:treeAdditions.tagBindings},conflicts:sync.conflicts as TemplateSyncPreview["conflicts"],status:"applied"};
    await replaceRecordCard(client,{id:syncId,spaceId:sync.recordSpaceId,typeKey:'book_template_sync',values:{...sync,status:'applied',applied_at:new Date().toISOString(),tree_additions:{...treeAdditions,receipt:result}}});
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

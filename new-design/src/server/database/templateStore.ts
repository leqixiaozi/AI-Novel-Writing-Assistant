import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { BookSummary, BookViewKey, CardGroupFormDefinition, FieldDefinition, InitialCardDraft, ResearchPrefillCard, TemplateGroupSummary, TemplateGroupVersion, TemplateSyncPreview } from "../../common/contracts";
import type { StrategyResourceDraft } from "./resourceStore";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { getNewDesignPool } from "./runtime";

interface PayloadType { sourceId:string;sourceVersionId:string;key:string;name:string;description:string;categoryKey?:string;capabilities:string[];fields:FieldDefinition[];sortOrder:number; }
interface PayloadDictionary { sourceId:string;key:string;name:string;description:string;items:Array<{sourceId:string;key:string;label:string;value:Record<string,unknown>;sortOrder:number}>; }
interface PayloadRelation { sourceId:string;key:string;name:string;description:string;direction:"directed"|"undirected";sourceTypeKeys:string[];targetTypeKeys:string[];sourceMax:number|null;targetMax:number|null;propertiesSchema:unknown[]; }
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
export interface TemplatePayload { cardTypes:PayloadType[];dictionaries:PayloadDictionary[];relationTypes:PayloadRelation[];forms:PayloadForm[];seedCards:PayloadCard[];viewConfigs?:PayloadViewConfig[];menu:{defaultPage:string;pages:string[]}; }

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function mapTemplate(row:Record<string,unknown>):TemplateGroupSummary{return{id:String(row.id),key:String(row.template_key),name:String(row.name),description:String(row.description??""),status:row.status as TemplateGroupSummary["status"],revision:Number(row.revision),currentVersion:row.current_version==null?null:Number(row.current_version),currentVersionId:row.current_version_id?String(row.current_version_id):null,draftConfig:row.draft_config as Record<string,unknown>,createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at)};}
function completeViewConfigs(viewConfigs:PayloadViewConfig[]|undefined):PayloadViewConfig[]{const configured=new Map((viewConfigs??[]).map((view)=>[view.key,view]));return DEFAULT_VIEW_CONFIGS.map((fallback)=>configured.get(fallback.key)??fallback);}

export async function listTemplates():Promise<TemplateGroupSummary[]>{const result=await(await getNewDesignPool()).query(`SELECT template.*,version.version AS current_version FROM new_design.template_groups template LEFT JOIN new_design.template_group_versions version ON version.id=template.current_version_id WHERE template.status<>'archived' ORDER BY template.updated_at DESC`);return result.rows.map(mapTemplate);}
export async function listTemplateVersions(templateId:string):Promise<TemplateGroupVersion[]>{const result=await(await getNewDesignPool()).query("SELECT * FROM new_design.template_group_versions WHERE template_id=$1 ORDER BY version DESC",[templateId]);return result.rows.map((row)=>({id:String(row.id),version:Number(row.version),payload:row.payload as Record<string,unknown>,createdAt:asDate(row.created_at)}));}

export async function saveTemplate(input:{id?:string;key:string;name:string;description:string;draftConfig:Record<string,unknown>;revision?:number}):Promise<TemplateGroupSummary>{const pool=await getNewDesignPool();const id=input.id??randomUUID();if(input.id){const result=await pool.query(`UPDATE new_design.template_groups SET name=$2,description=$3,draft_config=$4::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$5 RETURNING *,NULL::integer AS current_version`,[id,input.name,input.description,JSON.stringify(input.draftConfig),input.revision]);if(!result.rows[0])throw new NewDesignError("模板组已在其他页面更新，请刷新后重试。",409);return assertFound((await listTemplates()).find((item)=>item.id===id),"模板保存后读取失败。");}try{await pool.query(`INSERT INTO new_design.template_groups (id,template_key,name,description,draft_config,status) VALUES ($1,$2,$3,$4,$5::jsonb,'draft')`,[id,input.key,input.name,input.description,JSON.stringify(input.draftConfig)]);return assertFound((await listTemplates()).find((item)=>item.id===id),"模板创建后读取失败。");}catch(error){if((error as{code?:string}).code==="23505")throw new NewDesignError("模板标识已存在。",409);throw error;}}

async function buildPayload(client:PoolClient,config:Record<string,unknown>):Promise<TemplatePayload>{const requested=Array.isArray(config.cardTypeIds)?config.cardTypeIds.filter((id):id is string=>typeof id==="string"):[];const typeResult=await client.query(`SELECT type.*,version.id AS source_version_id,version.fields,category.category_key FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id LEFT JOIN new_design.card_type_categories category ON category.id=type.category_id WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.status='published' ${requested.length?"AND type.id=ANY($1::uuid[])":"AND type.is_system"} ORDER BY type.sort_order`,requested.length?[requested]:[]);const dictionaryResult=await client.query("SELECT * FROM new_design.dictionary_definitions WHERE scope='system' AND status='published' ORDER BY name");const relationResult=await client.query("SELECT * FROM new_design.relation_types WHERE scope='system' AND status='published' ORDER BY name");const formResult=await client.query(`SELECT form.*,version.id AS source_version_id,version.definition FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id IS NULL AND form.status='published' ORDER BY form.name`);const dictionaries:PayloadDictionary[]=[];for(const dictionary of dictionaryResult.rows){const items=await client.query("SELECT * FROM new_design.dictionary_items WHERE dictionary_id=$1 AND status='active' ORDER BY sort_order",[dictionary.id]);dictionaries.push({sourceId:String(dictionary.id),key:String(dictionary.dictionary_key),name:String(dictionary.name),description:String(dictionary.description??""),items:items.rows.map((item)=>({sourceId:String(item.id),key:String(item.item_key),label:String(item.label),value:item.value as Record<string,unknown>,sortOrder:Number(item.sort_order)}))});}let seedCards:PayloadCard[]=[];if(typeof config.seedSpaceId==="string"){const cards=await client.query(`SELECT card.*,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active'`,[config.seedSpaceId]);seedCards=cards.rows.map((card)=>({sourceId:String(card.id),typeKey:String(card.type_key),title:String(card.title),values:card.values as Record<string,unknown>}));}return{cardTypes:typeResult.rows.map((type)=>({sourceId:String(type.id),sourceVersionId:String(type.source_version_id),key:String(type.type_key),name:String(type.name),description:String(type.description??""),categoryKey:type.category_key?String(type.category_key):undefined,capabilities:type.semantic_capabilities as string[],fields:type.fields as FieldDefinition[],sortOrder:Number(type.sort_order)})),dictionaries,relationTypes:relationResult.rows.map((relation)=>({sourceId:String(relation.id),key:String(relation.relation_key),name:String(relation.name),description:String(relation.description??""),direction:relation.direction,sourceTypeKeys:relation.source_type_keys,targetTypeKeys:relation.target_type_keys,sourceMax:relation.source_max==null?null:Number(relation.source_max),targetMax:relation.target_max==null?null:Number(relation.target_max),propertiesSchema:relation.properties_schema})),forms:formResult.rows.map((form)=>({sourceId:String(form.id),sourceVersionId:String(form.source_version_id),key:String(form.form_key),name:String(form.name),description:String(form.description??""),definition:form.definition as CardGroupFormDefinition})),seedCards,viewConfigs:DEFAULT_VIEW_CONFIGS,menu:{defaultPage:"creative-forms",pages:["creative-forms","all-cards","book-views"]}};}

export async function publishTemplate(id:string,revision:number):Promise<TemplateGroupSummary>{const pool=await getNewDesignPool();const client=await pool.connect();try{await client.query("BEGIN");const template=assertFound((await client.query("SELECT * FROM new_design.template_groups WHERE id=$1 FOR UPDATE",[id])).rows[0],"模板组不存在。");if(Number(template.revision)!==revision)throw new NewDesignError("模板组已在其他页面更新，请刷新后重试。",409);const payload=await buildPayload(client,template.draft_config as Record<string,unknown>);const version=Number((await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM new_design.template_group_versions WHERE template_id=$1",[id])).rows[0].version);const versionId=randomUUID();await client.query("INSERT INTO new_design.template_group_versions (id,template_id,version,payload) VALUES ($1,$2,$3,$4::jsonb)",[versionId,id,version,JSON.stringify(payload)]);await client.query("UPDATE new_design.template_groups SET status='published',current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[id,versionId]);await client.query("COMMIT");return assertFound((await listTemplates()).find((item)=>item.id===id),"模板发布后读取失败。");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

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

interface CreateBookOptions {
  includeTemplateSeed?: boolean;
  initialCards?: InitialCardDraft[];
  resourceCards?: StrategyResourceDraft[];
  researchCards?: ResearchPrefillCard[];
  researchReferences?: Array<{researchVersionId:string|null;packVersionId:string|null;purpose:string;compiledSnapshot:Record<string,unknown>}>;
  origin?: CreateBookOrigin;
}

async function installPayload(
  client: PoolClient,
  bookId: string,
  spaceId: string,
  payload: TemplatePayload,
  options: CreateBookOptions,
): Promise<void> {
  const typeIds = new Map<string, { typeId: string; versionId: string }>();
  for (const type of payload.cardTypes) {
    const typeId = randomUUID();
    const versionId = randomUUID();
    typeIds.set(type.key, { typeId, versionId });
    const category = type.categoryKey ? (await client.query("SELECT id FROM new_design.card_type_categories WHERE category_key=$1 AND status='active'", [type.categoryKey])).rows[0] : null;
    await client.query(`INSERT INTO new_design.card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,source_card_type_id,source_type_version_id,category_id) VALUES ($1,$2,$3,$4,$5,'published',1,NULL,$6::jsonb,false,$7,$8::jsonb,$9,$10,$11)`, [typeId, spaceId, type.key, type.name, type.description, JSON.stringify(type.fields), type.sortOrder, JSON.stringify(type.capabilities), type.sourceId, type.sourceVersionId, category?.id ?? null]);
    await client.query("INSERT INTO new_design.card_type_versions (id,card_type_id,version,fields) VALUES ($1,$2,1,$3::jsonb)", [versionId, typeId, JSON.stringify(type.fields)]);
    await client.query("UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1", [typeId, versionId]);
  }
  for (const dictionary of payload.dictionaries) {
    const dictionaryId = randomUUID();
    await client.query(`INSERT INTO new_design.dictionary_definitions (id,dictionary_key,name,description,scope,owner_space_id,status,source_dictionary_id) VALUES ($1,$2,$3,$4,'book',$5,'published',$6)`, [dictionaryId, dictionary.key, dictionary.name, dictionary.description, spaceId, dictionary.sourceId]);
    for (const item of dictionary.items) await client.query(`INSERT INTO new_design.dictionary_items (id,dictionary_id,item_key,label,value,sort_order,status) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'active')`, [randomUUID(), dictionaryId, item.key, item.label, JSON.stringify(item.value), item.sortOrder]);
  }
  for (const relation of payload.relationTypes) await client.query(`INSERT INTO new_design.relation_types (id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status,source_relation_type_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'book',$10,$11::jsonb,'published',$12)`, [randomUUID(), relation.key, relation.name, relation.description, relation.direction, relation.sourceTypeKeys, relation.targetTypeKeys, relation.sourceMax, relation.targetMax, spaceId, JSON.stringify(relation.propertiesSchema), relation.sourceId]);
  for(const view of completeViewConfigs(payload.viewConfigs))await client.query("INSERT INTO new_design.book_view_configs(id,book_id,view_key,config) VALUES($1,$2,$3,$4::jsonb)",[randomUUID(),bookId,view.key,JSON.stringify(view.config)]);
  for (const form of payload.forms) {
    const formId = randomUUID();
    const versionId = randomUUID();
    await client.query(`INSERT INTO new_design.card_group_forms (id,space_id,form_key,name,description,status,revision,current_version_id,draft_definition,is_system,source_form_id,source_form_version_id) VALUES ($1,$2,$3,$4,$5,'published',1,NULL,$6::jsonb,false,$7,$8)`, [formId, spaceId, form.key, form.name, form.description, JSON.stringify(form.definition), form.sourceId, form.sourceVersionId]);
    await client.query("INSERT INTO new_design.card_group_form_versions (id,form_id,version,definition) VALUES ($1,$2,1,$3::jsonb)", [versionId, formId, JSON.stringify(form.definition)]);
    await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2 WHERE id=$1", [formId, versionId]);
  }
  const cards = [
    ...(options.includeTemplateSeed === false ? [] : payload.seedCards.map((card) => ({ card, sourceKind: "template" as const, sourceId: card.sourceId, sourceVersionId: null }))),
    ...(options.initialCards ?? []).map((card) => ({ card, sourceKind: "ai" as const, sourceId: null, sourceVersionId: null })),
    ...(options.resourceCards ?? []).map((card) => ({ card, sourceKind: "resource" as const, sourceId: card.sourceCardId, sourceVersionId: card.sourceVersionId })),
  ];
  const installedCards=new Map<string,{id:string;typeVersionId:string;title:string;values:Record<string,unknown>;revision:number}>();
  for (const prepared of cards) {
    const { card, sourceKind } = prepared;
    const confirmation = sourceKind === "ai" ? "ai_draft" : sourceKind === "template" ? "template_suggestion" : "confirmed";
    const type = assertFound(typeIds.get(card.typeKey), `模板缺少卡片类型 ${card.typeKey}。`);
    const definition = assertFound(payload.cardTypes.find((item) => item.key === card.typeKey), `模板缺少类型定义 ${card.typeKey}。`);
    const allowedKeys = new Set(definition.fields.map((field) => field.key));
    const filteredValues = Object.fromEntries(Object.entries(card.values).filter(([key]) => allowedKeys.has(key)));
    const validated = validateCardValues(definition.fields, filteredValues);
    if (sourceKind !== "template" && Object.keys(validated.issues).length) {
      throw new NewDesignError(`${sourceKind === "ai" ? "AI 生成的" : "选用的创作策略"}“${card.title}”未满足模板字段要求。`, 422, validated.issues);
    }
    const values = sourceKind === "template" ? filteredValues : validated.values;
    const cardId = randomUUID();
    const versionId = randomUUID();
    await client.query(`INSERT INTO new_design.cards (id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES ($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)`, [cardId, spaceId, type.typeId, card.title, type.versionId, JSON.stringify(values)]);
    await client.query(`INSERT INTO new_design.card_versions (id,card_id,revision,type_version_id,title,values,source) VALUES ($1,$2,1,$3,$4,$5::jsonb,'create')`, [versionId, cardId, type.versionId, card.title, JSON.stringify(values)]);
    await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1", [cardId, versionId]);
    installedCards.set(`${card.typeKey}\u0000${card.title}`,{id:cardId,typeVersionId:type.versionId,title:card.title,values,revision:1});
    for (const [fieldKey, value] of [["$title", card.title] as const, ...Object.entries(values)]) {
      await client.query(`INSERT INTO new_design.card_field_origins (id,card_id,field_key,source_kind,source_id,generation_batch_id,confirmation_status,original_value,current_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$8::jsonb)`, [randomUUID(), cardId, fieldKey, sourceKind, prepared.sourceId, sourceKind === "ai" ? options.origin?.generationBatchId ?? null : null, confirmation, JSON.stringify(value)]);
    }
    if (sourceKind === "resource" && prepared.sourceId && prepared.sourceVersionId) {
      await client.query(`INSERT INTO new_design.resource_adoptions (id,resource_card_id,resource_version_id,book_id,target_card_id,action,snapshot) VALUES ($1,$2,$3,$4,$5,'install_snapshot',$6::jsonb)`, [randomUUID(), prepared.sourceId, prepared.sourceVersionId, bookId, cardId, JSON.stringify({ typeKey: card.typeKey, title: card.title, values })]);
    }
  }
  for(const card of options.researchCards??[]){
    const type=assertFound(typeIds.get(card.typeKey),`模板缺少卡片类型 ${card.typeKey}。`),definition=assertFound(payload.cardTypes.find((item)=>item.key===card.typeKey),`模板缺少类型定义 ${card.typeKey}。`),allowedKeys=new Set(definition.fields.map((field)=>field.key)),suggested=Object.fromEntries(Object.entries(card.values).filter(([key])=>allowedKeys.has(key))),key=`${card.typeKey}\u0000${card.title}`,existing=installedCards.get(key);
    if(existing){const values={...existing.values};const adopted:string[]=[];for(const [fieldKey,value] of Object.entries(suggested))if(values[fieldKey]===null||values[fieldKey]===undefined||values[fieldKey]===""||(Array.isArray(values[fieldKey])&&values[fieldKey].length===0)){values[fieldKey]=value;adopted.push(fieldKey);}if(!adopted.length)continue;const nextRevision=existing.revision+1,versionId=randomUUID();await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit')",[versionId,existing.id,nextRevision,existing.typeVersionId,existing.title,JSON.stringify(values)]);await client.query("UPDATE new_design.cards SET values=$2::jsonb,revision=$3,current_version_id=$4,updated_at=now() WHERE id=$1",[existing.id,JSON.stringify(values),nextRevision,versionId]);for(const fieldKey of adopted)await client.query("INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES($1,$2,$3,'research',$4,'confirmed',$5::jsonb,$5::jsonb) ON CONFLICT(card_id,field_key) DO UPDATE SET source_kind='research',source_id=EXCLUDED.source_id,confirmation_status='confirmed',original_value=EXCLUDED.original_value,current_value=EXCLUDED.current_value,updated_at=now()",[randomUUID(),existing.id,fieldKey,card.researchVersionId,JSON.stringify(values[fieldKey])]);installedCards.set(key,{...existing,values,revision:nextRevision});continue;}
    const validated=validateCardValues(definition.fields,suggested);if(Object.keys(validated.issues).length)throw new NewDesignError(`研究建议“${card.title}”未满足模板字段要求。`,422,validated.issues);const cardId=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)",[cardId,spaceId,type.typeId,card.title,type.versionId,JSON.stringify(validated.values)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[versionId,cardId,type.versionId,card.title,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,versionId]);for(const [fieldKey,value]of [["$title",card.title],...Object.entries(validated.values)])await client.query("INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES($1,$2,$3,'research',$4,'confirmed',$5::jsonb,$5::jsonb)",[randomUUID(),cardId,fieldKey,card.researchVersionId,JSON.stringify(value)]);installedCards.set(key,{id:cardId,typeVersionId:type.versionId,title:card.title,values:validated.values,revision:1});
  }
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
    for(const reference of options.researchReferences??[])await client.query("INSERT INTO new_design.book_research_references(id,book_id,research_version_id,pack_version_id,purpose,compiled_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[randomUUID(),id,reference.researchVersionId,reference.packVersionId,reference.purpose,JSON.stringify(reference.compiledSnapshot)]);
    if (options.origin) {
      await client.query(`INSERT INTO new_design.book_content_sources (id,book_id,session_id,method,source_reference,source_payload,confirmation_status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'confirmed')`, [randomUUID(), id, options.origin.sessionId ?? null, options.origin.method, options.origin.sourceReference, JSON.stringify(options.origin.sourcePayload)]);
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

export async function previewBookSync(bookId:string,targetVersionId:string):Promise<TemplateSyncPreview>{const pool=await getNewDesignPool();const book=assertFound((await pool.query("SELECT * FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");const target=assertFound((await pool.query("SELECT * FROM new_design.template_group_versions WHERE id=$1 AND template_id=$2",[targetVersionId,book.template_id])).rows[0],"目标模板版本不存在。");const types=await pool.query("SELECT type.type_key,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id=$1",[book.space_id]);const comparison=compareFields(book.installed_payload as TemplatePayload,target.payload as TemplatePayload,types.rows.map((row)=>({key:String(row.type_key),fields:row.fields as FieldDefinition[]})));const id=randomUUID();await pool.query(`INSERT INTO new_design.book_template_syncs (id,book_id,from_template_version_id,to_template_version_id,additions,conflicts,status) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'previewed')`,[id,bookId,book.template_version_id,targetVersionId,JSON.stringify(comparison.additions),JSON.stringify(comparison.conflicts)]);return{id,bookId,fromTemplateVersionId:String(book.template_version_id),toTemplateVersionId:targetVersionId,...comparison,status:"previewed"};}

export async function applyBookSync(syncId:string):Promise<TemplateSyncPreview>{const pool=await getNewDesignPool();const client=await pool.connect();try{await client.query("BEGIN");const sync=assertFound((await client.query("SELECT * FROM new_design.book_template_syncs WHERE id=$1 FOR UPDATE",[syncId])).rows[0],"同步建议不存在。");if(sync.status!=="previewed")throw new NewDesignError("此同步建议已经处理。",409);const book=assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 FOR UPDATE",[sync.book_id])).rows[0],"书籍不存在。");for(const addition of sync.additions as TemplateSyncPreview["additions"]){const type=assertFound((await client.query("SELECT * FROM new_design.card_types WHERE space_id=$1 AND type_key=$2 FOR UPDATE",[book.space_id,addition.typeKey])).rows[0],`书内类型 ${addition.typeKey} 不存在。`);const fields=[...(type.draft_fields as FieldDefinition[]),...addition.fields];const version=Number((await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM new_design.card_type_versions WHERE card_type_id=$1",[type.id])).rows[0].version);const versionId=randomUUID();await client.query("INSERT INTO new_design.card_type_versions (id,card_type_id,version,fields) VALUES ($1,$2,$3,$4::jsonb)",[versionId,type.id,version,JSON.stringify(fields)]);await client.query("UPDATE new_design.card_types SET draft_fields=$2::jsonb,current_version_id=$3,revision=revision+1,updated_at=now() WHERE id=$1",[type.id,JSON.stringify(fields),versionId]);}const target=assertFound((await client.query("SELECT * FROM new_design.template_group_versions WHERE id=$1",[sync.to_template_version_id])).rows[0],"目标模板版本不存在。");await client.query("UPDATE new_design.books SET template_version_id=$2,installed_payload=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[book.id,target.id,JSON.stringify(target.payload)]);await client.query("UPDATE new_design.book_template_syncs SET status='applied',applied_at=now() WHERE id=$1",[syncId]);await client.query("COMMIT");return{id:syncId,bookId:String(sync.book_id),fromTemplateVersionId:String(sync.from_template_version_id),toTemplateVersionId:String(sync.to_template_version_id),additions:sync.additions as TemplateSyncPreview["additions"],conflicts:sync.conflicts as TemplateSyncPreview["conflicts"],status:"applied"};}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

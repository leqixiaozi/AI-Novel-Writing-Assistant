import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  CardGroupFormDefinition,
  CardGroupFormInstance,
  CardGroupFormSummary,
  CardGroupFormVersion,
  CardMount,
  DictionarySummary,
  FieldType,
  RelationTypeSummary,
} from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { getNewDesignPool } from "./runtime";
import {executeStructureWrite} from "./structureWrites";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from "./recordCards";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
const SYSTEM_SPACE_ID="00000000-0000-4000-8000-000000000001";

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapDictionary(row: Record<string, unknown>, items: DictionarySummary["items"]): DictionarySummary {
  return {
    id: String(row.id), key: String(row.dictionary_key), name: String(row.name), description: String(row.description ?? ""),
    scope: row.scope as DictionarySummary["scope"], ownerSpaceId: row.owner_space_id ? String(row.owner_space_id) : null,
    sourceDictionaryId: row.source_dictionary_id ? String(row.source_dictionary_id) : null, readOnly: Boolean(row.read_only),
    status: row.status as DictionarySummary["status"], revision: Number(row.revision), items,
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export async function listDictionaries(spaceId?: string): Promise<DictionarySummary[]> {
  const pool = await getNewDesignPool();
  const definitions=(await listRecordCards(pool,"dictionary_definition",{includeArchived:true})).filter(row=>row.status!=="archived"&&(spaceId?String(row.owner_space_id)===spaceId:!row.owner_space_id)).sort((a,b)=>`${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`));
  const items=(await listRecordCards(pool,"dictionary_item",{includeArchived:true})).sort((a,b)=>String(a.dictionary_id).localeCompare(String(b.dictionary_id))||Number(a.sort_order)-Number(b.sort_order)||String(a.label).localeCompare(String(b.label)));
  const versions=await listRecordCards(pool,"dictionary_item_version",{includeArchived:true});
  const versionsById=new Map(versions.map(version=>[version.id,version]));
  const snapshots=await listRecordCards(pool,"card_tree_value_snapshot",{includeArchived:true});
  return definitions.map((row) => mapDictionary(row, items
    .filter((item) => String(item.dictionary_id) === String(row.id))
    .map((item) => ({
      id: String(item.id), key: String(item.item_key), label: String(item.label), description: String(item.description ?? ""),
      parentId: item.parent_id ? String(item.parent_id) : null, value: item.value as Record<string, unknown>,
      sortOrder: Number(item.sort_order), status: item.status as "active" | "archived", revision: Number(item.revision),
      currentVersionId: item.current_version_id ? String(item.current_version_id) : null,
      path: ((versionsById.get(String(item.current_version_id))?.path_node_ids as string[]|undefined)??[item.id]).map((id,index)=>({id:String(id),label:String(versionsById.get(String(item.current_version_id))?.path_labels?.[index]??item.label)})),
      childCount: items.filter(child=>String(child.parent_id)===String(item.id)&&child.status==='active').length,
      referenceCount: snapshots.filter(snapshot=>Array.isArray(snapshot.node_ids)&&snapshot.node_ids.includes(item.id)).length,
    }))));
}

export async function getDictionary(id:string):Promise<DictionarySummary>{
  const row=assertFound(await findRecordCard(await getNewDesignPool(),id,"dictionary_definition",{includeArchived:true}),"字典不存在。");
  return assertFound((await listDictionaries(row.owner_space_id?String(row.owner_space_id):undefined)).find(item=>item.id===id),"字典不存在。");
}

export async function saveDictionary(input: {
  id?: string; key: string; name: string; description: string; scope: DictionarySummary["scope"];
  ownerSpaceId?: string | null; revision?: number; readOnly?: boolean; items: Array<Partial<DictionarySummary["items"][number]> & Pick<DictionarySummary["items"][number], "label" | "sortOrder" | "status">>;
}): Promise<DictionarySummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  const id = input.id ?? randomUUID();
  try {
    await client.query("BEGIN");
    // Serialize the logical unique key as well as the dictionary head. The former
    // UNIQUE(owner_space_id,dictionary_key) cannot be replaced by a read-only check.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`dictionary:${input.ownerSpaceId??'public'}:${input.key}`]);
    const duplicates=await listRecordCards(client,"dictionary_definition",{includeArchived:true,where:{dictionary_key:input.key,owner_space_id:input.ownerSpaceId??null}});
    if(duplicates.some(row=>row.id!==id))throw new NewDesignError("字典标识已存在。",409);
    if (input.id) {
      const current = assertFound(await findRecordCard(client,id,"dictionary_definition",{includeArchived:true,lock:true}), "字典不存在。");
      if (Number(current.revision) !== input.revision) throw new NewDesignError("字典已在其他页面更新，请刷新后重试。", 409);
      if (current.read_only) throw new NewDesignError("系统字典只用于显示稳定状态，不能修改结构。", 422);
      await replaceRecordCard(client,{id,spaceId:current.recordSpaceId,typeKey:"dictionary_definition",title:input.name,values:{...current,name:input.name,description:input.description,scope:input.scope,owner_space_id:input.ownerSpaceId??null,read_only:input.readOnly??false,revision:Number(current.revision)+1,updated_at:new Date().toISOString()}});
    } else {
      await createRecordCard(client,{id,spaceId:input.ownerSpaceId??SYSTEM_SPACE_ID,typeKey:"dictionary_definition",title:input.name,values:{id,dictionary_key:input.key,name:input.name,description:input.description,scope:input.scope,owner_space_id:input.ownerSpaceId??null,status:"published",read_only:input.readOnly??false,revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    }
    const existingItems=await listRecordCards(client,"dictionary_item",{includeArchived:true,where:{dictionary_id:id}});
    const preparedItems=input.items.map(item=>{
      const byKey=item.key?existingItems.find(row=>row.item_key===item.key):undefined;
      if(byKey&&item.id&&byKey.id!==item.id)throw new NewDesignError("字典项标识对应了另一个节点。",409);
      const itemId=item.id??byKey?.id??randomUUID();
      return {...item,id:itemId,key:item.key??`node_${itemId.replace(/-/g,"").slice(0,12)}`};
    });
    if(new Set(preparedItems.map(item=>item.id)).size!==preparedItems.length||new Set(preparedItems.map(item=>item.key)).size!==preparedItems.length)throw new NewDesignError("字典节点不能重复。",422);
    type Node={id:string;parent_id:string|null;label:string};
    const nodes=new Map<string,Node>(existingItems.map(item=>[item.id,{id:item.id,parent_id:item.parent_id??null,label:String(item.label)}]));
    for(const item of preparedItems)nodes.set(item.id,{id:item.id,parent_id:item.parentId??null,label:item.label});
    const paths=new Map<string,Node[]>();
    for(const node of nodes.values()){
      const path:Node[]=[],seen=new Set<string>();let cursor:Node|undefined=node;
      while(cursor){
        if(seen.has(cursor.id))throw new NewDesignError("字典节点不能引用自身或形成循环。",422);
        seen.add(cursor.id);path.unshift(cursor);
        if(!cursor.parent_id)break;
        cursor=nodes.get(cursor.parent_id);
        if(!cursor)throw new NewDesignError("上级节点必须属于同一个字典。",422);
      }
      paths.set(node.id,path);
    }
    for(const item of preparedItems){
      const previous=existingItems.find(row=>row.id===item.id),other=previous?null:await findRecordCard(client,item.id,"dictionary_item",{includeArchived:true});
      if(other)throw new NewDesignError("字典节点已属于其他字典。",409);
      const sameKey=existingItems.find(row=>row.item_key===item.key&&row.id!==item.id);
      if(sameKey)throw new NewDesignError("字典项标识已存在。",409);
      const versionId=randomUUID(),revision=Number(previous?.revision??0)+1,now=new Date().toISOString();
      const values={...(previous??{}),id:item.id,dictionary_id:id,item_key:item.key,label:item.label,description:item.description??"",parent_id:item.parentId??null,value:item.value??{},sort_order:item.sortOrder,status:item.status,revision,current_version_id:versionId,created_at:previous?.created_at??now,updated_at:now};
      const path=paths.get(item.id)!;
      await createRecordCard(client,{id:versionId,spaceId:input.ownerSpaceId??SYSTEM_SPACE_ID,typeKey:"dictionary_item_version",title:item.label,values:{id:versionId,item_id:item.id,version:revision,label:item.label,description:values.description,parent_id:values.parent_id,sort_order:item.sortOrder,value:values.value,status:item.status,path_node_ids:path.map(node=>node.id),path_labels:path.map(node=>node.label),created_by:"user",created_at:now}});
      if(previous)await replaceRecordCard(client,{id:item.id,spaceId:previous.recordSpaceId,typeKey:"dictionary_item",title:item.label,values});
      else await createRecordCard(client,{id:item.id,spaceId:input.ownerSpaceId??SYSTEM_SPACE_ID,typeKey:"dictionary_item",title:item.label,values});
    }
    await client.query("COMMIT");
    return assertFound((await listDictionaries(input.ownerSpaceId ?? undefined)).find((item) => item.id === id), "字典保存后读取失败。");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("字典标识或字典项标识已存在。", 409);
    throw error;
  } finally { client.release(); }
}

function mapRelationType(row: Record<string, unknown>): RelationTypeSummary {
  return {
    id: String(row.id), key: String(row.relation_key), name: String(row.name), description: String(row.description ?? ""),
    direction: row.direction as RelationTypeSummary["direction"], sourceTypeKeys: row.source_type_keys as string[],
    targetTypeKeys: row.target_type_keys as string[], sourceMax: row.source_max == null ? null : Number(row.source_max),
    targetMax: row.target_max == null ? null : Number(row.target_max), scope: row.scope as RelationTypeSummary["scope"],
    ownerSpaceId: row.owner_space_id ? String(row.owner_space_id) : null,
    propertiesSchema: row.properties_schema as RelationTypeSummary["propertiesSchema"],
    status: row.status as RelationTypeSummary["status"], revision: Number(row.revision),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export async function listRelationTypes(spaceId?: string): Promise<RelationTypeSummary[]> {
  const result = await (await getNewDesignPool()).query(`SELECT * FROM new_design.relation_types WHERE status <> 'archived'
    AND ${spaceId ? "owner_space_id=$1" : "owner_space_id IS NULL"} ORDER BY scope, name`, spaceId ? [spaceId] : []);
  return result.rows.map(mapRelationType);
}

export async function saveRelationType(input: Omit<RelationTypeSummary, "id" | "status" | "createdAt" | "updatedAt" | "revision" | "ownerSpaceId"> & { id?: string; revision?: number; ownerSpaceId?: string | null }): Promise<RelationTypeSummary> {
  const pool = await getNewDesignPool();
  const id = input.id ?? randomUUID();
  if (input.id) {
    const result = await pool.query(`UPDATE new_design.relation_types SET name=$2,description=$3,direction=$4,
      source_type_keys=$5,target_type_keys=$6,source_max=$7,target_max=$8,scope=$9,owner_space_id=$10,
      properties_schema=$11::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$12 RETURNING *`,
    [id,input.name,input.description,input.direction,input.sourceTypeKeys,input.targetTypeKeys,input.sourceMax,input.targetMax,
      input.scope,input.ownerSpaceId,JSON.stringify(input.propertiesSchema),input.revision]);
    if (!result.rows[0]) throw new NewDesignError("关系类型已在其他页面更新，请刷新后重试。", 409);
    return mapRelationType(result.rows[0]);
  }
  try {
    const result = await pool.query(`INSERT INTO new_design.relation_types
      (id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'published') RETURNING *`,
    [id,input.key,input.name,input.description,input.direction,input.sourceTypeKeys,input.targetTypeKeys,input.sourceMax,input.targetMax,
      input.scope,input.ownerSpaceId,JSON.stringify(input.propertiesSchema)]);
    return mapRelationType(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("关系类型标识已存在。", 409);
    throw error;
  }
}

function mapForm(row: Record<string, unknown>): CardGroupFormSummary {
  return {
    id: String(row.id), key: String(row.form_key), name: String(row.name), description: String(row.description ?? ""),
    status: row.status as CardGroupFormSummary["status"], revision: Number(row.revision),
    currentVersion: row.current_version == null ? null : Number(row.current_version),
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    draftDefinition: row.draft_definition as CardGroupFormDefinition, isSystem: Boolean(row.is_system),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export async function listCardGroupForms(spaceId?: string): Promise<CardGroupFormSummary[]> {
  const pool=await getNewDesignPool(),forms=(await listRecordCards(pool,"card_group_form",{includeArchived:true})).filter(form=>form.status!=="archived"&&(spaceId?String(form.space_id)===spaceId:!form.space_id||String(form.space_id)===SYSTEM_SPACE_ID)),versions=await listRecordCards(pool,"card_group_form_version",{includeArchived:true});
  return forms.sort((a,b)=>Number(b.is_system)-Number(a.is_system)||String(a.name).localeCompare(String(b.name))).map(form=>mapForm({...form,current_version:versions.find(version=>String(version.id)===String(form.current_version_id))?.version??null}));
}

export async function saveCardGroupForm(input: {
  id?: string; key: string; name: string; description: string; definition: CardGroupFormDefinition; revision?: number;requestKey?:string;
}): Promise<CardGroupFormSummary> {
  const {requestKey,...payload}=input;
  return executeStructureWrite("form","save",requestKey,payload,async(pool)=>{
  const id = input.id ?? randomUUID();
  if (input.id) {
    const current=await findRecordCard(pool,id,"card_group_form",{includeArchived:true,lock:true});
    if(!current||current.status==='archived'||Number(current.revision)!==input.revision)throw new NewDesignError("卡片组表单已在其他页面更新，请刷新后重试。",409);
    const updated=await replaceRecordCard(pool,{id,spaceId:String(current.space_id??SYSTEM_SPACE_ID),typeKey:"card_group_form",title:input.name,values:{...current,name:input.name,description:input.description,draft_definition:input.definition,revision:Number(current.revision)+1,updated_at:new Date().toISOString()}}),version=current.current_version_id?await findRecordCard(pool,String(current.current_version_id),"card_group_form_version",{includeArchived:true}):null;
    return mapForm({...updated,current_version:version?.version??null});
  }
  try {
    await pool.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`public-form:${input.key}`]);
    const duplicate=(await listRecordCards(pool,"card_group_form",{includeArchived:true})).find(form=>form.form_key===input.key&&(!form.space_id||String(form.space_id)===SYSTEM_SPACE_ID));if(duplicate)throw Object.assign(new Error("duplicate"),{code:"23505"});
    const result=await createRecordCard(pool,{id,spaceId:SYSTEM_SPACE_ID,typeKey:"card_group_form",title:input.name,values:{id,space_id:null,form_key:input.key,name:input.name,description:input.description,status:"draft",revision:1,current_version_id:null,draft_definition:input.definition,is_system:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    return mapForm({...result,current_version:null});
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("表单标识已存在。", 409);
    throw error;
  }
  });
}

export async function publishCardGroupForm(id: string, revision: number,requestKey?:string): Promise<CardGroupFormSummary> {
  return executeStructureWrite("form","publish",requestKey,{id,revision},async(client)=>{
    const form=assertFound(await findRecordCard(client,id,"card_group_form",{includeArchived:true,lock:true}),"创作表单不存在。");if(form.status==='archived')throw new NewDesignError("创作表单不存在。",404);
    if (Number(form.revision) !== revision) throw new NewDesignError("卡片组表单已在其他页面更新，请刷新后重试。", 409);
    const versions=(await listRecordCards(client,"card_group_form_version",{includeArchived:true})).filter(item=>String(item.form_id)===id),version=Math.max(0,...versions.map(item=>Number(item.version)))+1;
    const versionId = randomUUID();
    await createRecordCard(client,{id:versionId,spaceId:String(form.space_id??SYSTEM_SPACE_ID),typeKey:"card_group_form_version",title:`${form.name} v${version}`,values:{id:versionId,form_id:id,version,definition:form.draft_definition,created_at:new Date().toISOString()}});
    const updated=await replaceRecordCard(client,{id,spaceId:String(form.space_id??SYSTEM_SPACE_ID),typeKey:"card_group_form",title:String(form.name),values:{...form,status:"published",current_version_id:versionId,revision:Number(form.revision)+1,updated_at:new Date().toISOString()}});
    return mapForm({...updated,current_version:version});
  });
}

export async function listCardGroupFormVersions(formId: string): Promise<CardGroupFormVersion[]> {
  const result=(await listRecordCards(await getNewDesignPool(),"card_group_form_version",{includeArchived:true})).filter(row=>String(row.form_id)===formId).sort((a,b)=>Number(b.version)-Number(a.version));
  return result.map((row) => ({ id:String(row.id),version:Number(row.version),definition:row.definition as CardGroupFormDefinition,createdAt:asDate(row.created_at) }));
}

function mapMount(row: Record<string, unknown>): CardMount {
  return { id:String(row.id),slotKey:String(row.slot_key),cardId:String(row.card_id),cardTitle:String(row.card_title),
    cardTypeKey:String(row.type_key),relationId:row.relation_id ? String(row.relation_id) : null,sortOrder:Number(row.sort_order),
    localValues:row.local_values as Record<string,unknown>,revision:Number(row.revision) };
}

async function readFormInstance(queryable: Queryable, id: string): Promise<CardGroupFormInstance | null> {
  const instance=await findRecordCard(queryable,id,"card_group_form_instance",{includeArchived:true});
  if (!instance) return null;
  const version=await findRecordCard(queryable,String(instance.form_version_id),"card_group_form_version",{includeArchived:true}),mountRows=(await listRecordCards(queryable,"card_mount",{includeArchived:true})).filter(mount=>String(mount.form_instance_id)===id).sort((a,b)=>`${a.slot_key}:${Number(a.sort_order)}`.localeCompare(`${b.slot_key}:${Number(b.sort_order)}`)),mounts=[] as Record<string,unknown>[];
  for(const mount of mountRows){const card=(await queryable.query("SELECT card.title,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1",[mount.card_id])).rows[0];if(card)mounts.push({...mount,card_title:card.title,type_key:card.type_key});}
  return { id:String(instance.id),spaceId:String(instance.space_id),formVersionId:String(instance.form_version_id),
    formVersion:Number(version?.version??0),primaryCardId:String(instance.primary_card_id),title:String(instance.title),revision:Number(instance.revision),
    mounts:mounts.map(mapMount),createdAt:asDate(instance.created_at),updatedAt:asDate(instance.updated_at) };
}

export async function listFormInstances(spaceId: string, formId?: string): Promise<CardGroupFormInstance[]> {
  const pool = await getNewDesignPool();
  const versions=await listRecordCards(pool,"card_group_form_version",{includeArchived:true}),result=(await listRecordCards(pool,"card_group_form_instance",{spaceId})).filter(instance=>!formId||String(versions.find(version=>String(version.id)===String(instance.form_version_id))?.form_id)===formId).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
  return Promise.all(result.map(async (row) => assertFound(await readFormInstance(pool,String(row.id)),"表单实例不存在。")));
}

function validLocalValue(type: FieldType, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "multi_select") return Array.isArray(value) && value.every((item) => typeof item === "string");
  return typeof value === "string";
}

export async function saveFormInstance(input: {
  id?: string; spaceId: string; formVersionId: string; primaryCardId: string; title: string; revision?: number;
  mounts: Array<{ id?: string; slotKey: string; cardId: string; sortOrder: number; localValues: Record<string, unknown> }>;
}): Promise<CardGroupFormInstance> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  const id = input.id ?? randomUUID();
  try {
    await client.query("BEGIN");
    const version=assertFound(await findRecordCard(client,input.formVersionId,"card_group_form_version",{includeArchived:true}),"表单版本不存在。");
    const definition = version.definition as CardGroupFormDefinition;
    const primary = assertFound((await client.query(`SELECT card.*,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
      WHERE card.id=$1 AND card.space_id=$2`, [input.primaryCardId,input.spaceId])).rows[0], "事件主卡不在当前数据空间中。");
    if (String(primary.type_key) !== definition.primaryTypeKey) throw new NewDesignError("主卡类型不符合表单定义。", 422);
    const slots = definition.groups.flatMap((group) => group.sections.flatMap((section) => section.slots)).filter((slot) => slot.kind === "card_reference");
    const cardIds = [...new Set(input.mounts.map((mount) => mount.cardId))];
    const cardRows = cardIds.length ? (await client.query(`SELECT card.id,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
      WHERE card.space_id=$1 AND card.id=ANY($2::uuid[])`, [input.spaceId,cardIds])).rows : [];
    if (cardRows.length !== cardIds.length) throw new NewDesignError("引用卡片必须属于当前数据空间。", 422);
    const cardsById = new Map(cardRows.map((row) => [String(row.id),String(row.type_key)]));
    for (const slot of slots) {
      const selected = input.mounts.filter((mount) => mount.slotKey === slot.key);
      if (selected.length < slot.min || selected.length > slot.max) throw new NewDesignError(`${slot.name}需要选择 ${slot.min}–${slot.max} 张卡片。`, 422, { [slot.key]: "数量不符合表单定义。" });
      for (const mount of selected) {
        if (!slot.allowedTypeKeys.includes(cardsById.get(mount.cardId) ?? "")) throw new NewDesignError(`${slot.name}包含不允许的卡片类型。`, 422);
        const allowedKeys = new Set(slot.localFields.map((field) => field.key));
        for (const key of Object.keys(mount.localValues)) if (!allowedKeys.has(key)) throw new NewDesignError(`${slot.name}包含未知局部字段。`, 422);
        for (const field of slot.localFields) {
          const value = mount.localValues[field.key];
          if (field.required && (value === undefined || value === null || value === "")) throw new NewDesignError(`${field.name}为必填项。`, 422);
          if (!validLocalValue(field.type,value)) throw new NewDesignError(`${field.name}的值类型无效。`, 422);
        }
      }
    }
    if (input.mounts.some((mount) => !slots.some((slot) => slot.key === mount.slotKey))) throw new NewDesignError("提交内容包含未知引用槽。", 422);
    if (input.id) {
      const current=assertFound(await findRecordCard(client,id,"card_group_form_instance",{spaceId:input.spaceId,includeArchived:true,lock:true}),"表单实例不存在。");
      if (Number(current.revision) !== input.revision) throw new NewDesignError("事件规划已在其他页面更新，请刷新后重试。", 409);
      const activeMounts=(await listRecordCards(client,"card_mount",{spaceId:input.spaceId,includeArchived:true,lock:true})).filter(mount=>String(mount.form_instance_id)===id&&mount.status==='active');
      for(const mount of activeMounts){
        const nextRevision=Number(mount.revision)+1;const versionId=randomUUID();
        await createRecordCard(client,{id:versionId,spaceId:input.spaceId,typeKey:"card_mount_version",title:`挂载历史 ${mount.id}`,values:{id:versionId,card_mount_id:mount.id,revision:nextRevision,form_version_id:input.formVersionId,source_card_version_id:mount.source_card_version_id,slot_key:mount.slot_key,card_id:mount.card_id,sort_order:mount.sort_order,local_values:mount.local_values,status:"ended",created_by:"form_editor",created_at:new Date().toISOString()}});
        await replaceRecordCard(client,{id:String(mount.id),spaceId:input.spaceId,typeKey:"card_mount",title:`挂载 ${mount.slot_key}`,values:{...mount,status:"ended",revision:nextRevision,current_version_id:versionId,ended_at:new Date().toISOString(),ended_by:"form_editor",updated_at:new Date().toISOString()}});
      }
      await replaceRecordCard(client,{id,spaceId:input.spaceId,typeKey:"card_group_form_instance",title:input.title,values:{...current,title:input.title,form_version_id:input.formVersionId,primary_card_id:input.primaryCardId,revision:Number(current.revision)+1,updated_at:new Date().toISOString()}});
    } else {
      await createRecordCard(client,{id,spaceId:input.spaceId,typeKey:"card_group_form_instance",title:input.title,values:{id,space_id:input.spaceId,form_version_id:input.formVersionId,primary_card_id:input.primaryCardId,title:input.title,revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    }
    for (const mount of input.mounts) {
      const source=assertFound((await client.query("SELECT current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2",[mount.cardId,input.spaceId])).rows[0],"关联资料不属于当前数据空间。");
      const mountId=randomUUID(),versionId=randomUUID();
      await createRecordCard(client,{id:versionId,spaceId:input.spaceId,typeKey:"card_mount_version",title:`挂载历史 ${mount.slotKey}`,values:{id:versionId,card_mount_id:mountId,revision:1,form_version_id:input.formVersionId,source_card_version_id:source.current_version_id,slot_key:mount.slotKey,card_id:mount.cardId,sort_order:mount.sortOrder,local_values:mount.localValues,status:"active",created_by:"form_editor",created_at:new Date().toISOString()}});
      await createRecordCard(client,{id:mountId,spaceId:input.spaceId,typeKey:"card_mount",title:`挂载 ${mount.slotKey}`,values:{id:mountId,space_id:input.spaceId,form_instance_id:id,slot_key:mount.slotKey,card_id:mount.cardId,relation_id:null,sort_order:mount.sortOrder,local_values:mount.localValues,source_card_version_id:source.current_version_id,status:"active",created_by:"form_editor",current_version_id:versionId,revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    }
    await client.query("COMMIT");
    return assertFound(await readFormInstance(pool,id),"事件规划保存后读取失败。");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

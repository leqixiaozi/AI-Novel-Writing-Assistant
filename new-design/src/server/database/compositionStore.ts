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

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapDictionary(row: Record<string, unknown>, items: DictionarySummary["items"]): DictionarySummary {
  return {
    id: String(row.id), key: String(row.dictionary_key), name: String(row.name), description: String(row.description ?? ""),
    scope: row.scope as DictionarySummary["scope"], ownerSpaceId: row.owner_space_id ? String(row.owner_space_id) : null,
    status: row.status as DictionarySummary["status"], revision: Number(row.revision), items,
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export async function listDictionaries(spaceId?: string): Promise<DictionarySummary[]> {
  const pool = await getNewDesignPool();
  const definitions = await pool.query(`SELECT * FROM new_design.dictionary_definitions WHERE status <> 'archived'
    AND ${spaceId ? "owner_space_id=$1" : "owner_space_id IS NULL"} ORDER BY scope, name`, spaceId ? [spaceId] : []);
  const items = await pool.query("SELECT * FROM new_design.dictionary_items ORDER BY dictionary_id, sort_order, label");
  return definitions.rows.map((row) => mapDictionary(row, items.rows
    .filter((item) => String(item.dictionary_id) === String(row.id))
    .map((item) => ({
      id: String(item.id), key: String(item.item_key), label: String(item.label), value: item.value as Record<string, unknown>,
      sortOrder: Number(item.sort_order), status: item.status as "active" | "archived",
    }))));
}

export async function saveDictionary(input: {
  id?: string; key: string; name: string; description: string; scope: DictionarySummary["scope"];
  ownerSpaceId?: string | null; revision?: number; items: Array<Omit<DictionarySummary["items"][number], "id"> & { id?: string }>;
}): Promise<DictionarySummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  const id = input.id ?? randomUUID();
  try {
    await client.query("BEGIN");
    if (input.id) {
      const current = assertFound((await client.query("SELECT * FROM new_design.dictionary_definitions WHERE id = $1 FOR UPDATE", [id])).rows[0], "字典不存在。");
      if (Number(current.revision) !== input.revision) throw new NewDesignError("字典已在其他页面更新，请刷新后重试。", 409);
      await client.query(`UPDATE new_design.dictionary_definitions SET name=$2, description=$3, scope=$4, owner_space_id=$5,
        revision=revision+1, updated_at=now() WHERE id=$1`, [id, input.name, input.description, input.scope, input.ownerSpaceId ?? null]);
      await client.query("UPDATE new_design.dictionary_items SET status='archived', updated_at=now() WHERE dictionary_id=$1", [id]);
    } else {
      await client.query(`INSERT INTO new_design.dictionary_definitions
        (id,dictionary_key,name,description,scope,owner_space_id,status) VALUES ($1,$2,$3,$4,$5,$6,'published')`,
      [id, input.key, input.name, input.description, input.scope, input.ownerSpaceId ?? null]);
    }
    for (const item of input.items) {
      await client.query(`INSERT INTO new_design.dictionary_items (id,dictionary_id,item_key,label,value,sort_order,status)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
        ON CONFLICT (dictionary_id,item_key) DO UPDATE SET label=EXCLUDED.label,value=EXCLUDED.value,
        sort_order=EXCLUDED.sort_order,status=EXCLUDED.status,updated_at=now()`,
      [item.id ?? randomUUID(), id, item.key, item.label, JSON.stringify(item.value), item.sortOrder, item.status]);
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
  const result = await (await getNewDesignPool()).query(`SELECT form.*, version.version AS current_version
    FROM new_design.card_group_forms form LEFT JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id
    WHERE form.status <> 'archived' AND ${spaceId ? "form.space_id=$1" : "form.space_id IS NULL"} ORDER BY form.is_system DESC, form.name`, spaceId ? [spaceId] : []);
  return result.rows.map(mapForm);
}

export async function saveCardGroupForm(input: {
  id?: string; key: string; name: string; description: string; definition: CardGroupFormDefinition; revision?: number;
}): Promise<CardGroupFormSummary> {
  const pool = await getNewDesignPool();
  const id = input.id ?? randomUUID();
  if (input.id) {
    const result = await pool.query(`UPDATE new_design.card_group_forms SET name=$2,description=$3,draft_definition=$4::jsonb,
      revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$5 RETURNING *,NULL::integer AS current_version`,
    [id,input.name,input.description,JSON.stringify(input.definition),input.revision]);
    if (!result.rows[0]) throw new NewDesignError("卡片组表单已在其他页面更新，请刷新后重试。", 409);
    const saved = mapForm(result.rows[0]);
    const current = (await listCardGroupForms(result.rows[0].space_id ? String(result.rows[0].space_id) : undefined)).find((item) => item.id === id);
    return current ? { ...saved, currentVersion: current.currentVersion } : saved;
  }
  try {
    const result = await pool.query(`INSERT INTO new_design.card_group_forms
      (id,form_key,name,description,status,draft_definition,is_system) VALUES ($1,$2,$3,$4,'draft',$5::jsonb,false)
      RETURNING *,NULL::integer AS current_version`, [id,input.key,input.name,input.description,JSON.stringify(input.definition)]);
    return mapForm(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("表单标识已存在。", 409);
    throw error;
  }
}

export async function publishCardGroupForm(id: string, revision: number): Promise<CardGroupFormSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const form = assertFound((await client.query("SELECT * FROM new_design.card_group_forms WHERE id=$1 FOR UPDATE", [id])).rows[0], "卡片组表单不存在。");
    if (Number(form.revision) !== revision) throw new NewDesignError("卡片组表单已在其他页面更新，请刷新后重试。", 409);
    const version = Number((await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM new_design.card_group_form_versions WHERE form_id=$1", [id])).rows[0].version);
    const versionId = randomUUID();
    await client.query("INSERT INTO new_design.card_group_form_versions (id,form_id,version,definition) VALUES ($1,$2,$3,$4::jsonb)",
      [versionId,id,version,JSON.stringify(form.draft_definition)]);
    await client.query("UPDATE new_design.card_group_forms SET status='published',current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1", [id,versionId]);
    await client.query("COMMIT");
    return assertFound((await listCardGroupForms(form.space_id ? String(form.space_id) : undefined)).find((item) => item.id === id), "表单发布后读取失败。");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function listCardGroupFormVersions(formId: string): Promise<CardGroupFormVersion[]> {
  const result = await (await getNewDesignPool()).query("SELECT * FROM new_design.card_group_form_versions WHERE form_id=$1 ORDER BY version DESC", [formId]);
  return result.rows.map((row) => ({ id:String(row.id),version:Number(row.version),definition:row.definition as CardGroupFormDefinition,createdAt:asDate(row.created_at) }));
}

function mapMount(row: Record<string, unknown>): CardMount {
  return { id:String(row.id),slotKey:String(row.slot_key),cardId:String(row.card_id),cardTitle:String(row.card_title),
    cardTypeKey:String(row.type_key),relationId:row.relation_id ? String(row.relation_id) : null,sortOrder:Number(row.sort_order),
    localValues:row.local_values as Record<string,unknown>,revision:Number(row.revision) };
}

async function readFormInstance(queryable: Queryable, id: string): Promise<CardGroupFormInstance | null> {
  const instance = (await queryable.query(`SELECT instance.*,version.version AS form_version FROM new_design.card_group_form_instances instance
    JOIN new_design.card_group_form_versions version ON version.id=instance.form_version_id WHERE instance.id=$1`, [id])).rows[0];
  if (!instance) return null;
  const mounts = await queryable.query(`SELECT mount.*,card.title AS card_title,type.type_key FROM new_design.card_mounts mount
    JOIN new_design.cards card ON card.id=mount.card_id JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE mount.form_instance_id=$1 ORDER BY mount.slot_key,mount.sort_order`, [id]);
  return { id:String(instance.id),spaceId:String(instance.space_id),formVersionId:String(instance.form_version_id),
    formVersion:Number(instance.form_version),primaryCardId:String(instance.primary_card_id),title:String(instance.title),revision:Number(instance.revision),
    mounts:mounts.rows.map(mapMount),createdAt:asDate(instance.created_at),updatedAt:asDate(instance.updated_at) };
}

export async function listFormInstances(spaceId: string, formId?: string): Promise<CardGroupFormInstance[]> {
  const pool = await getNewDesignPool();
  const result = await pool.query(`SELECT instance.id FROM new_design.card_group_form_instances instance
    JOIN new_design.card_group_form_versions version ON version.id=instance.form_version_id
    WHERE instance.space_id=$1 ${formId ? "AND version.form_id=$2" : ""} ORDER BY instance.updated_at DESC`, formId ? [spaceId,formId] : [spaceId]);
  return Promise.all(result.rows.map(async (row) => assertFound(await readFormInstance(pool,String(row.id)),"表单实例不存在。")));
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
    const version = assertFound((await client.query("SELECT * FROM new_design.card_group_form_versions WHERE id=$1", [input.formVersionId])).rows[0], "表单版本不存在。");
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
      const current = assertFound((await client.query("SELECT * FROM new_design.card_group_form_instances WHERE id=$1 FOR UPDATE", [id])).rows[0], "表单实例不存在。");
      if (Number(current.revision) !== input.revision) throw new NewDesignError("事件规划已在其他页面更新，请刷新后重试。", 409);
      const activeMounts=(await client.query("SELECT * FROM new_design.card_mounts WHERE form_instance_id=$1 AND status='active' FOR UPDATE",[id])).rows;
      for(const mount of activeMounts){
        const nextRevision=Number(mount.revision)+1;const versionId=randomUUID();
        await client.query(`INSERT INTO new_design.card_mount_versions(id,card_mount_id,revision,form_version_id,source_card_version_id,slot_key,card_id,sort_order,local_values,status,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'ended','legacy_form_editor')`,[versionId,mount.id,nextRevision,input.formVersionId,mount.source_card_version_id,mount.slot_key,mount.card_id,mount.sort_order,JSON.stringify(mount.local_values)]);
        await client.query("UPDATE new_design.card_mounts SET status='ended',revision=$2,current_version_id=$3,ended_at=now(),ended_by='legacy_form_editor',updated_at=now() WHERE id=$1",[mount.id,nextRevision,versionId]);
      }
      await client.query("UPDATE new_design.card_group_form_instances SET title=$2,form_version_id=$3,primary_card_id=$4,revision=revision+1,updated_at=now() WHERE id=$1", [id,input.title,input.formVersionId,input.primaryCardId]);
    } else {
      await client.query(`INSERT INTO new_design.card_group_form_instances (id,space_id,form_version_id,primary_card_id,title)
        VALUES ($1,$2,$3,$4,$5)`, [id,input.spaceId,input.formVersionId,input.primaryCardId,input.title]);
    }
    for (const mount of input.mounts) {
      const source=assertFound((await client.query("SELECT current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2",[mount.cardId,input.spaceId])).rows[0],"关联资料不属于当前数据空间。");
      const mountId=randomUUID(),versionId=randomUUID();
      await client.query(`INSERT INTO new_design.card_mounts (id,form_instance_id,slot_key,card_id,relation_id,sort_order,local_values,source_card_version_id,status,created_by,current_version_id)
        VALUES ($1,$2,$3,$4,NULL,$5,$6::jsonb,$7,'active','legacy_form_editor',NULL)`,[mountId,id,mount.slotKey,mount.cardId,mount.sortOrder,JSON.stringify(mount.localValues),source.current_version_id]);
      await client.query(`INSERT INTO new_design.card_mount_versions(id,card_mount_id,revision,form_version_id,source_card_version_id,slot_key,card_id,sort_order,local_values,status,created_by)
        VALUES($1,$2,1,$3,$4,$5,$6,$7,$8::jsonb,'active','legacy_form_editor')`,[versionId,mountId,input.formVersionId,source.current_version_id,mount.slotKey,mount.cardId,mount.sortOrder,JSON.stringify(mount.localValues)]);
      await client.query("UPDATE new_design.card_mounts SET current_version_id=$2 WHERE id=$1",[mountId,versionId]);
    }
    await client.query("COMMIT");
    return assertFound(await readFormInstance(pool,id),"事件规划保存后读取失败。");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

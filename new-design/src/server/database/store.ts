import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CardSummary, CardTypeCapability, CardTypeSummary, CardTypeVersion, CardVersion, FieldDefinition, FormResolutionKind } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateBookTypeEvolution, validateCardValues, validatePublishedEvolution } from "../domain/validation";
import { getNewDesignPool } from "./runtime";

export const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapCardType(row: Record<string, unknown>): CardTypeSummary {
  return {
    id: String(row.id),
    spaceId: String(row.space_id),
    key: String(row.type_key),
    name: String(row.name),
    description: String(row.description ?? ""),
    isSystem: Boolean(row.is_system),
    sortOrder: Number(row.sort_order ?? 1_000),
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryKey: row.category_key ? String(row.category_key) : null,
    semanticCapabilities: (row.semantic_capabilities ?? []) as CardTypeCapability[],
    status: row.status as CardTypeSummary["status"],
    revision: Number(row.revision),
    currentVersion: row.current_version === null || row.current_version === undefined ? null : Number(row.current_version),
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    draftFields: (row.draft_fields ?? []) as FieldDefinition[],
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function mapCard(row: Record<string, unknown>): CardSummary {
  return {
    id: String(row.id),
    cardTypeId: String(row.card_type_id),
    cardTypeName: String(row.card_type_name),
    title: String(row.title),
    status: row.status as CardSummary["status"],
    revision: Number(row.revision),
    typeVersionId: String(row.type_version_id),
    typeVersion: Number(row.type_version),
    values: (row.values ?? {}) as Record<string, unknown>,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    archivedAt: row.archived_at ? asDate(row.archived_at) : null,
  };
}

async function findCardType(queryable: Queryable, id: string, lock = false): Promise<CardTypeSummary | null> {
  const result = await queryable.query(`
    SELECT ct.*, ctv.version AS current_version, category.category_key
    FROM new_design.card_types ct
    LEFT JOIN new_design.card_type_versions ctv ON ctv.id = ct.current_version_id
    LEFT JOIN new_design.card_type_categories category ON category.id = ct.category_id
    WHERE ct.id = $1
    ${lock ? "FOR UPDATE OF ct" : ""}
  `, [id]);
  return result.rows[0] ? mapCardType(result.rows[0]) : null;
}

async function findCurrentTypeFields(queryable: Queryable, cardTypeId: string): Promise<{ id: string; version: number; fields: FieldDefinition[] }> {
  const result = await queryable.query(`
    SELECT ctv.id, ctv.version, ctv.fields
    FROM new_design.card_types ct
    JOIN new_design.card_type_versions ctv ON ctv.id = ct.current_version_id
    WHERE ct.id = $1 AND ct.status = 'published'
  `, [cardTypeId]);
  const row = assertFound(result.rows[0], "内容类型尚未发布，不能创建或保存资料。");
  return { id: String(row.id), version: Number(row.version), fields: row.fields as FieldDefinition[] };
}

async function validateFormProvenance(queryable: Queryable, input: {
  formVersionId: string | null;
  formResolutionKind: FormResolutionKind;
  spaceId: string;
  typeKey: string;
  requireCurrent: boolean;
}): Promise<void> {
  if (input.formResolutionKind !== "installed_form") {
    if (input.formVersionId) throw new NewDesignError("只有本书已发布创作表单可以记录表单版本。", 422);
    return;
  }
  if (!input.formVersionId) throw new NewDesignError("缺少本次填写采用的创作表单版本。", 422);
  const result = await queryable.query(`
    SELECT 1
    FROM new_design.card_group_form_versions version
    JOIN new_design.card_group_forms form ON form.id=version.form_id
    WHERE version.id=$1
      AND form.space_id=$2
      AND ($4::boolean=false OR (form.status='published' AND form.current_version_id=version.id))
      AND version.definition->>'primaryTypeKey'=$3
  `, [input.formVersionId, input.spaceId, input.typeKey, input.requireCurrent]);
  if (!result.rows[0]) throw new NewDesignError("本次填写引用的创作表单版本不属于当前书籍、内容类型或已发布版本。", 422);
}

export async function listCardTypes(spaceId = DEFAULT_SPACE_ID): Promise<CardTypeSummary[]> {
  const pool = await getNewDesignPool();
  const result = await pool.query(`
    SELECT ct.*, ctv.version AS current_version, category.category_key
    FROM new_design.card_types ct
    LEFT JOIN new_design.card_type_versions ctv ON ctv.id = ct.current_version_id
    LEFT JOIN new_design.card_type_categories category ON category.id = ct.category_id
    WHERE ct.space_id = $1 AND ct.status <> 'archived'
    ORDER BY ct.is_system DESC, category.sort_order ASC NULLS LAST, ct.sort_order ASC, ct.updated_at DESC
  `, [spaceId]);
  return result.rows.map(mapCardType);
}

export async function getCardType(id: string): Promise<CardTypeSummary> {
  return assertFound(await findCardType(await getNewDesignPool(), id), "元卡片类型不存在。");
}

export async function createCardType(input: { key: string; name: string; description: string; categoryId?: string | null; semanticCapabilities: CardTypeCapability[]; fields: FieldDefinition[] }, spaceId = DEFAULT_SPACE_ID): Promise<CardTypeSummary> {
  const pool = await getNewDesignPool();
  const id = randomUUID();
  try {
    const result = await pool.query(`
      INSERT INTO new_design.card_types (id, space_id, type_key, name, description, status, semantic_capabilities, draft_fields, category_id)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb, $7::jsonb, $8)
      RETURNING *
    `, [id, spaceId, input.key, input.name, input.description, JSON.stringify(input.semanticCapabilities), JSON.stringify(input.fields), input.categoryId ?? null]);
    return mapCardType({ ...result.rows[0], current_version: null });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("类型标识已存在，请换一个标识。", 409, { key: "类型标识已存在。" });
    throw error;
  }
}

export async function updateCardType(
  id: string,
  input: { name: string; description: string; categoryId?: string | null; semanticCapabilities: CardTypeCapability[]; fields: FieldDefinition[]; revision: number },
): Promise<CardTypeSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = assertFound(await findCardType(client, id, true), "元卡片类型不存在。");
    if (existing.revision !== input.revision) throw new NewDesignError("此元卡片类型已在其他页面更新，请刷新后再保存。", 409);
    if (existing.currentVersionId) {
      const current = await findCurrentTypeFields(client, id);
      const issues = existing.spaceId === DEFAULT_SPACE_ID
        ? validatePublishedEvolution(current.fields, input.fields)
        : validateBookTypeEvolution(current.fields, input.fields);
      if (Object.keys(issues).length > 0) throw new NewDesignError(existing.spaceId === DEFAULT_SPACE_ID
        ? "已发布系统类型只能增加非必填字段。"
        : "书内类型可调整显示信息和选项，但不能删除稳定字段、改变数据类型或新增必填约束。", 422, issues);
    }
    const result = await client.query(`
      UPDATE new_design.card_types
      SET name = $2, description = $3, semantic_capabilities = $4::jsonb, draft_fields = $5::jsonb, category_id = $6, revision = revision + 1, updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [id, input.name, input.description, JSON.stringify(input.semanticCapabilities), JSON.stringify(input.fields), input.categoryId === undefined ? existing.categoryId : input.categoryId]);
    await client.query("COMMIT");
    return mapCardType({ ...result.rows[0], current_version: existing.currentVersion });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function publishCardType(id: string, revision: number): Promise<CardTypeSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = assertFound(await findCardType(client, id, true), "元卡片类型不存在。");
    if (existing.revision !== revision) throw new NewDesignError("此元卡片类型已在其他页面更新，请刷新后再发布。", 409);
    if (existing.currentVersionId) {
      const current = await findCurrentTypeFields(client, id);
      const issues = existing.spaceId === DEFAULT_SPACE_ID
        ? validatePublishedEvolution(current.fields, existing.draftFields)
        : validateBookTypeEvolution(current.fields, existing.draftFields);
      if (Object.keys(issues).length > 0) throw new NewDesignError(existing.spaceId === DEFAULT_SPACE_ID
        ? "发布失败：系统类型只能在已发布结构后增加非必填字段。"
        : "发布失败：书内类型不能删除稳定字段、改变数据类型或新增必填约束。", 422, issues);
      if (JSON.stringify(current.fields) === JSON.stringify(existing.draftFields)) {
        throw new NewDesignError("字段定义没有变化，无需发布新版本。", 422);
      }
    }
    const versionResult = await client.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM new_design.card_type_versions WHERE card_type_id = $1",
      [id],
    );
    const version = Number(versionResult.rows[0]?.version ?? 1);
    const versionId = randomUUID();
    await client.query(`
      INSERT INTO new_design.card_type_versions (id, card_type_id, version, fields)
      VALUES ($1, $2, $3, $4::jsonb)
    `, [versionId, id, version, JSON.stringify(existing.draftFields)]);
    const updated = await client.query(`
      UPDATE new_design.card_types
      SET status = 'published', current_version_id = $2, revision = revision + 1, updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [id, versionId]);
    await client.query("COMMIT");
    return mapCardType({ ...updated.rows[0], current_version: version });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listCardTypeVersions(cardTypeId: string): Promise<CardTypeVersion[]> {
  const pool = await getNewDesignPool();
  const result = await pool.query(`
    SELECT id, version, fields, created_at
    FROM new_design.card_type_versions
    WHERE card_type_id = $1
    ORDER BY version DESC
  `, [cardTypeId]);
  return result.rows.map((row) => ({
    id: String(row.id), version: Number(row.version), fields: row.fields as FieldDefinition[], createdAt: asDate(row.created_at),
  }));
}

export async function listCards(input: { cardTypeId?: string; archived?: boolean; spaceId?: string }): Promise<CardSummary[]> {
  const pool = await getNewDesignPool();
  const values: unknown[] = [input.spaceId ?? DEFAULT_SPACE_ID, input.archived ? "archived" : "active"];
  const typeFilter = input.cardTypeId ? "AND c.card_type_id = $3" : "";
  if (input.cardTypeId) values.push(input.cardTypeId);
  const result = await pool.query(`
    SELECT c.*, ct.name AS card_type_name, ctv.version AS type_version
    FROM new_design.cards c
    JOIN new_design.card_types ct ON ct.id = c.card_type_id
    JOIN new_design.card_type_versions ctv ON ctv.id = c.type_version_id
    WHERE c.space_id = $1 AND c.status = $2 ${typeFilter}
    ORDER BY c.updated_at DESC
  `, values);
  return result.rows.map(mapCard);
}

async function findCard(queryable: Queryable, id: string, lock = false): Promise<CardSummary | null> {
  const result = await queryable.query(`
    SELECT c.*, ct.name AS card_type_name, ctv.version AS type_version
    FROM new_design.cards c
    JOIN new_design.card_types ct ON ct.id = c.card_type_id
    JOIN new_design.card_type_versions ctv ON ctv.id = c.type_version_id
    WHERE c.id = $1
    ${lock ? "FOR UPDATE OF c" : ""}
  `, [id]);
  return result.rows[0] ? mapCard(result.rows[0]) : null;
}

export async function getCard(id: string): Promise<CardSummary> {
  return assertFound(await findCard(await getNewDesignPool(), id), "资料不存在。");
}

export async function createCard(input: { cardTypeId: string; title: string; values: Record<string, unknown>; spaceId?: string; formVersionId?:string|null; formResolutionKind?:FormResolutionKind }): Promise<CardSummary> {
  const pool = await getNewDesignPool();
  const typeVersion = await findCurrentTypeFields(pool, input.cardTypeId);
  const validated = validateCardValues(typeVersion.fields, input.values);
  if (Object.keys(validated.issues).length > 0) throw new NewDesignError("请修正资料字段后再保存。", 422, validated.issues);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardId = randomUUID();
    const versionId = randomUUID();
    const spaceId = input.spaceId ?? DEFAULT_SPACE_ID;
    const typeSpace = await client.query(`
      SELECT type.type_key
      FROM new_design.card_types type
      JOIN new_design.card_spaces target_space ON target_space.id=$2
      WHERE type.id=$1
        AND (type.space_id=$2 OR (type.space_id=$3 AND target_space.space_key LIKE 'resource_%'))
    `, [input.cardTypeId, spaceId, DEFAULT_SPACE_ID]);
    if (!typeSpace.rows[0]) throw new NewDesignError("内容类型不属于当前书籍空间。", 422);
    await validateFormProvenance(client, {
      formVersionId: input.formVersionId ?? null,
      formResolutionKind: input.formResolutionKind ?? "legacy",
      spaceId,
      typeKey: String(typeSpace.rows[0].type_key),
      requireCurrent: true,
    });
    await client.query(`
      INSERT INTO new_design.cards (id, space_id, card_type_id, title, status, revision, type_version_id, values)
      VALUES ($1, $2, $3, $4, 'active', 1, $5, $6::jsonb)
    `, [cardId, spaceId, input.cardTypeId, input.title, typeVersion.id, JSON.stringify(validated.values)]);
    await client.query(`
      INSERT INTO new_design.card_versions (id, card_id, revision, type_version_id, title, values, source, form_version_id, form_resolution_kind)
      VALUES ($1, $2, 1, $3, $4, $5::jsonb, 'create', $6, $7)
    `, [versionId, cardId, typeVersion.id, input.title, JSON.stringify(validated.values), input.formVersionId??null, input.formResolutionKind??"legacy"]);
    await client.query("UPDATE new_design.cards SET current_version_id = $2 WHERE id = $1", [cardId, versionId]);
    await client.query("COMMIT");
    return assertFound(await findCard(pool, cardId), "卡片创建后读取失败。");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateCardSnapshot(
  id: string,
  input: { title?: string; values?: Record<string, unknown>; revision: number; source: CardVersion["source"]; formVersionId?:string|null; formResolutionKind?:FormResolutionKind },
): Promise<CardSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = assertFound(await findCard(client, id, true), "资料不存在。");
    if (existing.revision !== input.revision) throw new NewDesignError("此卡片已在其他页面更新，请刷新后再保存。", 409);
    const typeVersion = await findCurrentTypeFields(client, existing.cardTypeId);
    const title = input.title ?? existing.title;
    const incomingValues = input.values ?? existing.values;
    const previousProvenance=(await client.query("SELECT form_version_id,form_resolution_kind FROM new_design.card_versions WHERE card_id=$1 AND revision=$2",[id,existing.revision])).rows[0];
    const formVersionId=input.formVersionId===undefined?(previousProvenance?.form_version_id??null):input.formVersionId;
    const formResolutionKind=input.formResolutionKind??previousProvenance?.form_resolution_kind??"legacy";
    const cardContext=(await client.query("SELECT card.space_id,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1",[id])).rows[0];
    await validateFormProvenance(client,{formVersionId,formResolutionKind,spaceId:String(cardContext.space_id),typeKey:String(cardContext.type_key),requireCurrent:input.formVersionId!==undefined||input.formResolutionKind!==undefined});
    const validated = validateCardValues(typeVersion.fields, incomingValues);
    if (Object.keys(validated.issues).length > 0) throw new NewDesignError("请修正资料字段后再保存。", 422, validated.issues);
    const nextRevision = existing.revision + 1;
    const nextStatus = input.source === "archive" ? "archived" : input.source === "restore" ? "active" : existing.status;
    const versionId = randomUUID();
    await client.query(`
      INSERT INTO new_design.card_versions (id, card_id, revision, type_version_id, title, values, source, form_version_id, form_resolution_kind)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
    `, [versionId, id, nextRevision, typeVersion.id, title, JSON.stringify(validated.values), input.source, formVersionId, formResolutionKind]);
    await client.query(`
      UPDATE new_design.cards
      SET title = $2, values = $3::jsonb, status = $4, revision = $5, type_version_id = $6,
          current_version_id = $7, updated_at = now(), archived_at = CASE WHEN $4 = 'archived' THEN now() ELSE NULL END
      WHERE id = $1
    `, [id, title, JSON.stringify(validated.values), nextStatus, nextRevision, typeVersion.id, versionId]);
    await client.query("COMMIT");
    return assertFound(await findCard(pool, id), "卡片保存后读取失败。");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCard(id: string, input: { title: string; values: Record<string, unknown>; revision: number; formVersionId?:string|null; formResolutionKind?:FormResolutionKind }): Promise<CardSummary> {
  return updateCardSnapshot(id, { ...input, source: "edit" });
}

export async function archiveCard(id: string, revision: number): Promise<CardSummary> {
  return updateCardSnapshot(id, { revision, source: "archive" });
}

export async function restoreCard(id: string, revision: number): Promise<CardSummary> {
  return updateCardSnapshot(id, { revision, source: "restore" });
}

export async function listCardVersions(cardId: string): Promise<CardVersion[]> {
  const pool = await getNewDesignPool();
  const result = await pool.query(`
    SELECT cv.*, ctv.version AS type_version, form_version.version AS form_version
    FROM new_design.card_versions cv
    JOIN new_design.card_type_versions ctv ON ctv.id = cv.type_version_id
    LEFT JOIN new_design.card_group_form_versions form_version ON form_version.id=cv.form_version_id
    WHERE cv.card_id = $1
    ORDER BY cv.revision DESC
  `, [cardId]);
  return result.rows.map((row) => ({
    id: String(row.id),
    revision: Number(row.revision),
    typeVersionId: String(row.type_version_id),
    typeVersion: Number(row.type_version),
    title: String(row.title),
    values: row.values as Record<string, unknown>,
    source: row.source as CardVersion["source"],
    formVersionId: row.form_version_id ? String(row.form_version_id) : null,
    formVersion: row.form_version === null || row.form_version === undefined ? null : Number(row.form_version),
    formResolutionKind: String(row.form_resolution_kind??"legacy") as FormResolutionKind,
    createdAt: asDate(row.created_at),
  }));
}

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CardSummary, CardTypeSummary, CardTypeVersion, CardVersion, FieldDefinition } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues, validatePublishedEvolution } from "../domain/validation";
import { getNewDesignPool } from "./runtime";

const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapCardType(row: Record<string, unknown>): CardTypeSummary {
  return {
    id: String(row.id),
    key: String(row.type_key),
    name: String(row.name),
    description: String(row.description ?? ""),
    isSystem: Boolean(row.is_system),
    sortOrder: Number(row.sort_order ?? 1_000),
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
    SELECT ct.*, ctv.version AS current_version
    FROM new_design.card_types ct
    LEFT JOIN new_design.card_type_versions ctv ON ctv.id = ct.current_version_id
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
  const row = assertFound(result.rows[0], "元卡片类型尚未发布，不能创建或保存卡片。");
  return { id: String(row.id), version: Number(row.version), fields: row.fields as FieldDefinition[] };
}

export async function listCardTypes(): Promise<CardTypeSummary[]> {
  const pool = await getNewDesignPool();
  const result = await pool.query(`
    SELECT ct.*, ctv.version AS current_version
    FROM new_design.card_types ct
    LEFT JOIN new_design.card_type_versions ctv ON ctv.id = ct.current_version_id
    WHERE ct.space_id = $1 AND ct.status <> 'archived'
    ORDER BY ct.is_system DESC, ct.sort_order ASC, ct.updated_at DESC
  `, [DEFAULT_SPACE_ID]);
  return result.rows.map(mapCardType);
}

export async function getCardType(id: string): Promise<CardTypeSummary> {
  return assertFound(await findCardType(await getNewDesignPool(), id), "元卡片类型不存在。");
}

export async function createCardType(input: { key: string; name: string; description: string; fields: FieldDefinition[] }): Promise<CardTypeSummary> {
  const pool = await getNewDesignPool();
  const id = randomUUID();
  try {
    const result = await pool.query(`
      INSERT INTO new_design.card_types (id, space_id, type_key, name, description, status, draft_fields)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb)
      RETURNING *
    `, [id, DEFAULT_SPACE_ID, input.key, input.name, input.description, JSON.stringify(input.fields)]);
    return mapCardType({ ...result.rows[0], current_version: null });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("类型标识已存在，请换一个标识。", 409, { key: "类型标识已存在。" });
    throw error;
  }
}

export async function updateCardType(
  id: string,
  input: { name: string; description: string; fields: FieldDefinition[]; revision: number },
): Promise<CardTypeSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = assertFound(await findCardType(client, id, true), "元卡片类型不存在。");
    if (existing.revision !== input.revision) throw new NewDesignError("此元卡片类型已在其他页面更新，请刷新后再保存。", 409);
    if (existing.currentVersionId) {
      const current = await findCurrentTypeFields(client, id);
      const issues = validatePublishedEvolution(current.fields, input.fields);
      if (Object.keys(issues).length > 0) throw new NewDesignError("已发布类型只能增加非必填字段。", 422, issues);
    }
    const result = await client.query(`
      UPDATE new_design.card_types
      SET name = $2, description = $3, draft_fields = $4::jsonb, revision = revision + 1, updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [id, input.name, input.description, JSON.stringify(input.fields)]);
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
      const issues = validatePublishedEvolution(current.fields, existing.draftFields);
      if (Object.keys(issues).length > 0) throw new NewDesignError("发布失败：只能在已发布结构后增加非必填字段。", 422, issues);
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

export async function listCards(input: { cardTypeId?: string; archived?: boolean }): Promise<CardSummary[]> {
  const pool = await getNewDesignPool();
  const values: unknown[] = [DEFAULT_SPACE_ID, input.archived ? "archived" : "active"];
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
  return assertFound(await findCard(await getNewDesignPool(), id), "卡片不存在。");
}

export async function createCard(input: { cardTypeId: string; title: string; values: Record<string, unknown> }): Promise<CardSummary> {
  const pool = await getNewDesignPool();
  const typeVersion = await findCurrentTypeFields(pool, input.cardTypeId);
  const validated = validateCardValues(typeVersion.fields, input.values);
  if (Object.keys(validated.issues).length > 0) throw new NewDesignError("请修正卡片字段后再保存。", 422, validated.issues);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardId = randomUUID();
    const versionId = randomUUID();
    await client.query(`
      INSERT INTO new_design.cards (id, space_id, card_type_id, title, status, revision, type_version_id, values)
      VALUES ($1, $2, $3, $4, 'active', 1, $5, $6::jsonb)
    `, [cardId, DEFAULT_SPACE_ID, input.cardTypeId, input.title, typeVersion.id, JSON.stringify(validated.values)]);
    await client.query(`
      INSERT INTO new_design.card_versions (id, card_id, revision, type_version_id, title, values, source)
      VALUES ($1, $2, 1, $3, $4, $5::jsonb, 'create')
    `, [versionId, cardId, typeVersion.id, input.title, JSON.stringify(validated.values)]);
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
  input: { title?: string; values?: Record<string, unknown>; revision: number; source: CardVersion["source"] },
): Promise<CardSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = assertFound(await findCard(client, id, true), "卡片不存在。");
    if (existing.revision !== input.revision) throw new NewDesignError("此卡片已在其他页面更新，请刷新后再保存。", 409);
    const typeVersion = await findCurrentTypeFields(client, existing.cardTypeId);
    const title = input.title ?? existing.title;
    const incomingValues = input.values ?? existing.values;
    const validated = validateCardValues(typeVersion.fields, incomingValues);
    if (Object.keys(validated.issues).length > 0) throw new NewDesignError("请修正卡片字段后再保存。", 422, validated.issues);
    const nextRevision = existing.revision + 1;
    const nextStatus = input.source === "archive" ? "archived" : input.source === "restore" ? "active" : existing.status;
    const versionId = randomUUID();
    await client.query(`
      INSERT INTO new_design.card_versions (id, card_id, revision, type_version_id, title, values, source)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `, [versionId, id, nextRevision, typeVersion.id, title, JSON.stringify(validated.values), input.source]);
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

export async function updateCard(id: string, input: { title: string; values: Record<string, unknown>; revision: number }): Promise<CardSummary> {
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
    SELECT cv.*, ctv.version AS type_version
    FROM new_design.card_versions cv
    JOIN new_design.card_type_versions ctv ON ctv.id = cv.type_version_id
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
    createdAt: asDate(row.created_at),
  }));
}

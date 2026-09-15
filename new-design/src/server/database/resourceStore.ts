import { randomUUID } from "node:crypto";
import type { FieldDefinition, InitialCardDraft, ResourceAdoption, StrategyResourceSummary, StrategyResourceTypeKey } from "../../common/contracts";
import { STRATEGY_RESOURCE_TYPE_KEYS } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { getNewDesignPool } from "./runtime";
import { getCard } from "./store";

export const STRATEGY_RESOURCE_SPACE_ID = "60000000-0000-4000-8000-000000000001";

export interface StrategyResourceDraft extends InitialCardDraft {
  sourceCardId: string;
  sourceVersionId: string;
}

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapResource(row: Record<string, unknown>): StrategyResourceSummary {
  return {
    id: String(row.id),
    cardTypeId: String(row.card_type_id),
    cardTypeName: String(row.card_type_name),
    typeKey: row.type_key as StrategyResourceTypeKey,
    title: String(row.title),
    status: row.status as StrategyResourceSummary["status"],
    revision: Number(row.revision),
    typeVersionId: String(row.type_version_id),
    typeVersion: Number(row.type_version),
    values: row.values as Record<string, unknown>,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    archivedAt: row.archived_at ? asDate(row.archived_at) : null,
  };
}

export async function listStrategyResources(input: { typeKey?: string; archived?: boolean; search?: string } = {}): Promise<StrategyResourceSummary[]> {
  const values: unknown[] = [STRATEGY_RESOURCE_SPACE_ID, input.archived ? "archived" : "active", STRATEGY_RESOURCE_TYPE_KEYS];
  const filters = ["card.space_id=$1", "card.status=$2", "type.type_key=ANY($3::text[])"];
  if (input.typeKey) {
    values.push(input.typeKey);
    filters.push(`type.type_key=$${values.length}`);
  }
  if (input.search?.trim()) {
    values.push(`%${input.search.trim()}%`);
    filters.push(`(card.title ILIKE $${values.length} OR card.values::text ILIKE $${values.length})`);
  }
  const result = await (await getNewDesignPool()).query(`
    SELECT card.*,type.type_key,type.name AS card_type_name,version.version AS type_version
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id
    JOIN new_design.card_type_versions version ON version.id=card.type_version_id
    WHERE ${filters.join(" AND ")}
    ORDER BY type.sort_order,card.updated_at DESC,card.title
  `, values);
  return result.rows.map(mapResource);
}

export async function getStrategyResourceDrafts(ids: string[]): Promise<StrategyResourceDraft[]> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const result = await (await getNewDesignPool()).query(`
    SELECT card.id,card.current_version_id,type.type_key,card.title,card.values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.space_id=$1 AND card.status='active' AND type.type_key=ANY($2::text[]) AND card.id=ANY($3::uuid[])
  `, [STRATEGY_RESOURCE_SPACE_ID, STRATEGY_RESOURCE_TYPE_KEYS, uniqueIds]);
  if (result.rows.length !== uniqueIds.length) throw new NewDesignError("选择的创作策略已失效，请重新选择。", 409);
  const byId = new Map(result.rows.map((row) => [String(row.id), row]));
  return uniqueIds.map((id) => {
    const row = assertFound(byId.get(id), "选择的创作策略不存在。");
    return {
      sourceCardId: id,
      sourceVersionId: String(row.current_version_id),
      typeKey: String(row.type_key),
      title: String(row.title),
      values: row.values as Record<string, unknown>,
    };
  });
}

export async function installStrategyResource(bookId: string, resourceId: string): Promise<{ resource: StrategyResourceSummary; target: Awaited<ReturnType<typeof getCard>>; adoption: ResourceAdoption }> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  const targetCardId = randomUUID();
  const targetVersionId = randomUUID();
  const adoptionId = randomUUID();
  try {
    await client.query("BEGIN");
    const resourceRow = assertFound((await client.query(`
      SELECT card.*,type.type_key,type.name AS card_type_name,version.version AS type_version
      FROM new_design.cards card
      JOIN new_design.card_types type ON type.id=card.card_type_id
      JOIN new_design.card_type_versions version ON version.id=card.type_version_id
      WHERE card.id=$1 AND card.space_id=$2 AND card.status='active' AND type.type_key=ANY($3::text[])
      FOR UPDATE OF card
    `, [resourceId, STRATEGY_RESOURCE_SPACE_ID, STRATEGY_RESOURCE_TYPE_KEYS])).rows[0], "创作策略资源不存在或已归档。");
    const book = assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active' FOR UPDATE", [bookId])).rows[0], "目标书籍不存在。");
    const targetType = assertFound((await client.query(`
      SELECT type.*,version.fields,version.id AS target_version_id
      FROM new_design.card_types type
      JOIN new_design.card_type_versions version ON version.id=type.current_version_id
      WHERE type.space_id=$1 AND type.type_key=$2 AND type.status='published'
    `, [book.space_id, resourceRow.type_key])).rows[0], "目标书籍尚未安装这项资料规格。");
    const fields = targetType.fields as FieldDefinition[];
    const allowed = new Set(fields.map((field) => field.key));
    const values = Object.fromEntries(Object.entries(resourceRow.values as Record<string, unknown>).filter(([key]) => allowed.has(key)));
    const validated = validateCardValues(fields, values);
    if (Object.keys(validated.issues).length) throw new NewDesignError("该资源与目标书籍的资料规格不兼容。", 422, validated.issues);
    await client.query(`INSERT INTO new_design.cards (id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES ($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)`, [targetCardId, book.space_id, targetType.id, resourceRow.title, targetType.target_version_id, JSON.stringify(validated.values)]);
    await client.query(`INSERT INTO new_design.card_versions (id,card_id,revision,type_version_id,title,values,source) VALUES ($1,$2,1,$3,$4,$5::jsonb,'create')`, [targetVersionId, targetCardId, targetType.target_version_id, resourceRow.title, JSON.stringify(validated.values)]);
    await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1", [targetCardId, targetVersionId]);
    for (const [fieldKey, value] of [["$title", resourceRow.title] as const, ...Object.entries(validated.values)]) {
      await client.query(`INSERT INTO new_design.card_field_origins (id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES ($1,$2,$3,'resource',$4,'confirmed',$5::jsonb,$5::jsonb)`, [randomUUID(), targetCardId, fieldKey, resourceId, JSON.stringify(value)]);
    }
    const snapshot = { typeKey: resourceRow.type_key as StrategyResourceTypeKey, title: String(resourceRow.title), values: validated.values };
    await client.query(`INSERT INTO new_design.resource_adoptions (id,resource_card_id,resource_version_id,book_id,target_card_id,action,snapshot) VALUES ($1,$2,$3,$4,$5,'install_snapshot',$6::jsonb)`, [adoptionId, resourceId, resourceRow.current_version_id, bookId, targetCardId, JSON.stringify(snapshot)]);
    await client.query("COMMIT");
    return {
      resource: mapResource(resourceRow),
      target: await getCard(targetCardId),
      adoption: { id: adoptionId, resourceCardId: resourceId, resourceVersionId: String(resourceRow.current_version_id), bookId, targetCardId, action: "install_snapshot", snapshot, createdAt: new Date().toISOString() },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

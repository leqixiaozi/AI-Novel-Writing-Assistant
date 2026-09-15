import { randomUUID } from "node:crypto";
import type { CardTypeCategory } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { getNewDesignPool } from "./runtime";

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapCategory(row: Record<string, unknown>): CardTypeCategory {
  return {
    id: String(row.id), key: String(row.category_key), name: String(row.name), parentId: row.parent_id ? String(row.parent_id) : null,
    sortOrder: Number(row.sort_order), status: row.status as CardTypeCategory["status"], isSystem: Boolean(row.is_system), revision: Number(row.revision),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export async function listCardTypeCategories(): Promise<CardTypeCategory[]> {
  const result = await (await getNewDesignPool()).query("SELECT * FROM new_design.card_type_categories WHERE status='active' ORDER BY sort_order,name");
  return result.rows.map(mapCategory);
}

export async function saveCardTypeCategory(input: { id?: string; key: string; name: string; parentId?: string | null; sortOrder: number; revision?: number }): Promise<CardTypeCategory> {
  const pool = await getNewDesignPool();
  if (input.parentId === input.id) throw new NewDesignError("分类不能成为自己的上级。", 422);
  if (input.id) {
    const existing = assertFound((await pool.query("SELECT * FROM new_design.card_type_categories WHERE id=$1", [input.id])).rows[0], "分类不存在。");
    if (existing.is_system && input.key !== existing.category_key) throw new NewDesignError("系统内置分类的稳定标识不能修改。", 422);
    const row = (await pool.query("UPDATE new_design.card_type_categories SET name=$2,parent_id=$3,sort_order=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$5 RETURNING *", [input.id, input.name, input.parentId ?? null, input.sortOrder, input.revision])).rows[0];
    if (!row) throw new NewDesignError("分类已在其他页面更新，请刷新后重试。", 409);
    return mapCategory(row);
  }
  try {
    const row = (await pool.query("INSERT INTO new_design.card_type_categories (id,category_key,name,parent_id,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *", [randomUUID(), input.key, input.name, input.parentId ?? null, input.sortOrder])).rows[0];
    return mapCategory(row);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new NewDesignError("分类标识已存在。", 409);
    throw error;
  }
}

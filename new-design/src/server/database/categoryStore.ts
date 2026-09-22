import { randomUUID } from "node:crypto";
import type { CardTypeCategory } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { getNewDesignPool } from "./runtime";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from './recordCards';

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
  const rows=await listRecordCards(await getNewDesignPool(),'card_type_category',{where:{status:'active'}});
  return rows.sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name))).map(mapCategory);
}

export async function saveCardTypeCategory(input: { id?: string; key: string; name: string; parentId?: string | null; sortOrder: number; revision?: number }): Promise<CardTypeCategory> {
  const client=await(await getNewDesignPool()).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['card-type-categories']);
    const id=input.id??randomUUID(),seen=new Set([id]);let parentId=input.parentId??null;
    while(parentId){
      if(seen.has(parentId))throw new NewDesignError('分类不能形成循环。',422);seen.add(parentId);
      const parent=assertFound(await findRecordCard(client,parentId,'card_type_category',{includeArchived:true}),'上级分类不存在。');parentId=parent.parent_id??null;
    }
    const now=new Date().toISOString();let row;
    if(input.id){
      const existing=assertFound(await findRecordCard(client,id,'card_type_category',{includeArchived:true,lock:true}),'分类不存在。');
      if(existing.is_system&&input.key!==existing.category_key)throw new NewDesignError('系统内置分类的稳定标识不能修改。',422);
      if(existing.revision!==input.revision)throw new NewDesignError('分类已在其他页面更新，请刷新后重试。',409);
      row=await replaceRecordCard(client,{id,spaceId:existing.recordSpaceId,typeKey:'card_type_category',title:input.name,values:{...existing,name:input.name,parent_id:input.parentId??null,sort_order:input.sortOrder,revision:existing.revision+1,updated_at:now}});
    }else{
      if((await listRecordCards(client,'card_type_category',{includeArchived:true,where:{category_key:input.key}})).length)throw new NewDesignError('分类标识已存在。',409);
      row=await createRecordCard(client,{id,spaceId:'00000000-0000-4000-8000-000000000001',typeKey:'card_type_category',title:input.name,values:{id,category_key:input.key,name:input.name,parent_id:input.parentId??null,sort_order:input.sortOrder,status:'active',is_system:false,revision:1,created_at:now,updated_at:now}});
    }
    await client.query('COMMIT');return mapCategory(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}

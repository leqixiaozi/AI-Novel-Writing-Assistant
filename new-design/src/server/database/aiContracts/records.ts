import type {PoolClient} from 'pg';
import {createRecordCard,listRecordCards,type RecordCardDb} from '../recordCards';
import {DEFAULT_SPACE_ID} from '../store';

export async function readRecipeSlots(db:RecordCardDb,versionId:string){
  return(await listRecordCards(db,'prompt_recipe_slot',{where:{recipe_version_id:versionId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}
export async function readRecipeComponents(db:RecordCardDb,versionId:string){
  const slots=await readRecipeSlots(db,versionId),rows=await listRecordCards(db,'prompt_recipe_slot_component',{where:{recipe_version_id:versionId}});
  return rows.filter(row=>slots.some(slot=>slot.id===row.slot_id)).sort((a,b)=>Number(slots.find(slot=>slot.id===a.slot_id)!.sort_order)-Number(slots.find(slot=>slot.id===b.slot_id)!.sort_order)||Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}
export async function readContractPublication(db:RecordCardDb,key:string){
  return(await listRecordCards(db,'ai_contract_publication',{where:{idempotency_key:key}}))[0]??null;
}
export async function hasContractPublication(db:RecordCardDb,kind:string,versionId:string){
  return(await listRecordCards(db,'ai_contract_publication',{where:{entity_kind:kind,to_version_id:versionId}})).length>0;
}
export async function insertContractRecord(db:PoolClient,kind:string,values:Record<string,unknown>){
  return createRecordCard(db,{id:values.id as string|undefined,spaceId:DEFAULT_SPACE_ID,typeKey:kind,title:String(values.slot_key??values.entity_kind??'AI 合同记录'),values});
}

export async function readRouteFallbacks(db:RecordCardDb,versionId:string){
  return(await listRecordCards(db,'model_route_fallback',{where:{route_version_id:versionId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}
export async function readSnapshotFallbacks(db:RecordCardDb,snapshotId:string){
  return(await listRecordCards(db,'model_route_snapshot_fallback',{where:{snapshot_id:snapshotId}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}

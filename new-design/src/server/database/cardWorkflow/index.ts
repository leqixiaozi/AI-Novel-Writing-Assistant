import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {DEFAULT_SPACE_ID} from '../store';

export type WorkflowDb=Pick<PoolClient,'query'>|Pick<Pool,'query'>;
export type WorkflowRow=Record<string,any>;

/** Read-only capability probe for the pure-table installation; never bootstraps it. */
export async function readCardWorkflowCapability(db:WorkflowDb,capabilityKey:string,typeKeys:string[]){
  const exists=(await db.query("SELECT to_regclass('new_design.system_capabilities') IS NOT NULL present")).rows[0]?.present===true;
  if(!exists)return{installed:false,operational:false};
  const row=(await db.query(`SELECT feature.installed,feature.operational,
    EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only') complete,
    EXISTS(SELECT 1 FROM new_design.system_capabilities kernel WHERE kernel.capability_key='card_kernel_v2' AND kernel.installed AND kernel.operational AND kernel.details->>'storage'='tables_only') kernel_ready,
    (SELECT count(DISTINCT type_key) FROM new_design.card_types WHERE type_key=ANY($2::text[]) AND is_internal AND status='published' AND current_version_id IS NOT NULL) type_count,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('new_design.card_version_actions') AND tgname='card_version_actions_immutable' AND tgenabled IN('O','A')) protected
    FROM new_design.system_capabilities feature WHERE feature.capability_key=$1`,[capabilityKey,[...new Set(typeKeys)]])).rows[0];
  const installed=row?.installed===true&&row.complete===true&&Number(row.type_count)===new Set(typeKeys).size;
  return{installed,operational:installed&&row.operational===true&&row.kernel_ready===true&&row.protected===true};
}

export async function requireCardWorkflowTypes(db:WorkflowDb,typeKeys:string[],write=false):Promise<void>{
  const cutover=(await db.query(`SELECT
    to_regclass('new_design.system_capabilities') IS NOT NULL capability_table,
    EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only') migration`)).rows[0]??{};
  if(!cutover.capability_table||!cutover.migration)throw new NewDesignError('卡片内核纯表结构尚未完整安装，请到运行维护核对；普通启动不会自动重建数据库。',503);
  const capability=(await db.query("SELECT installed,operational,details FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2'")).rows[0]??{};
  if(!capability.installed||!capability.operational||capability.details?.storage!=='tables_only')throw new NewDesignError('卡片内核纯表结构正处于维护状态，写入已停用。',503);
  const row=(await db.query(`SELECT
    to_regclass('new_design.card_version_actions') IS NOT NULL actions,
    EXISTS(
      SELECT 1 FROM pg_trigger
      WHERE tgrelid=to_regclass('new_design.card_version_actions')
        AND tgname='card_version_actions_immutable' AND tgenabled='O'
    ) immutable,
    (
      SELECT count(DISTINCT type_key)
      FROM new_design.card_types
      WHERE type_key=ANY($1::text[]) AND status='published'
    ) type_count`,[typeKeys])).rows[0]??{};
  const installed=Boolean(row.actions)&&Number(row.type_count)===typeKeys.length;
  if(!installed||write&&!row.immutable)throw new NewDesignError(
    !installed?'卡片工作流收敛迁移尚未完整启用。':'卡片动作历史保护未就绪，写入已停用。',503,
  );
}

export async function workflowType(db:WorkflowDb,typeKey:string):Promise<{id:string;currentVersionId:string}>{
  const row=assertFound((await db.query(`SELECT id,current_version_id
    FROM new_design.card_types
    WHERE type_key=$1 AND status='published'
    ORDER BY CASE WHEN space_id=$2 THEN 0 ELSE 1 END,id
    LIMIT 1`,[typeKey,DEFAULT_SPACE_ID])).rows[0],`内容类型尚未发布：${typeKey}`);
  return{id:String(row.id),currentVersionId:String(row.current_version_id)};
}

export async function workflowCard(db:WorkflowDb,id:string,typeKey:string,lock=false,includeArchived=false):Promise<WorkflowRow>{
  return assertFound((await db.query(`SELECT card.*,type.type_key,version.values current_values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$2
    JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
    WHERE card.id=$1 AND ($3::boolean OR card.status='active')${lock?' FOR UPDATE OF card':''}`,[id,typeKey,includeArchived])).rows[0],'内容对象不存在。');
}

export async function workflowVersions(db:WorkflowDb,cardId:string):Promise<WorkflowRow[]>{
  return(await db.query(`SELECT * FROM new_design.card_versions
    WHERE card_id=$1 ORDER BY revision DESC,id DESC`,[cardId])).rows;
}

export async function workflowActionByRequest(db:WorkflowDb,requestKey:string):Promise<WorkflowRow|null>{
  return(await db.query('SELECT * FROM new_design.card_version_actions WHERE request_key=$1',[requestKey])).rows[0]??null;
}

export async function latestWorkflowAction(db:WorkflowDb,cardId:string,actionKey:string):Promise<WorkflowRow|null>{
  return(await db.query(`SELECT * FROM new_design.card_version_actions
    WHERE card_id=$1 AND action_key=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[cardId,actionKey])).rows[0]??null;
}

export async function createWorkflowCard(db:WorkflowDb,input:{
  id?:string;spaceId:string;typeKey:string;title:string;revision?:number;values:Record<string,unknown>;
  versionId?:string;versionRevision?:number;source?:'create'|'edit'|'archive'|'restore';createdAt?:string|Date;
}):Promise<{cardId:string;versionId:string;typeVersionId:string}>{
  const type=await workflowType(db,input.typeKey),cardId=input.id??randomUUID(),versionId=input.versionId??randomUUID();
  await db.query(`INSERT INTO new_design.cards(
      id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at
    ) VALUES($1,$2,$3,$4,'active',$5,$6,NULL,$7::jsonb,coalesce($8::timestamptz,now()),coalesce($8::timestamptz,now()))`,
    [cardId,input.spaceId,type.id,input.title,input.revision??1,type.currentVersionId,JSON.stringify(input.values),input.createdAt??null]);
  await db.query(`INSERT INTO new_design.card_versions(
      id,card_id,revision,type_version_id,title,values,source,created_at
    ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,coalesce($8::timestamptz,now()))`,
    [versionId,cardId,input.versionRevision??1,type.currentVersionId,input.title,JSON.stringify(input.values),input.source??'create',input.createdAt??null]);
  await db.query('UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1',[cardId,versionId]);
  return{cardId,versionId,typeVersionId:type.currentVersionId};
}

export async function appendWorkflowVersion(db:WorkflowDb,input:{
  cardId:string;typeKey:string;title?:string;values:Record<string,unknown>;versionId?:string;source?:'create'|'edit'|'archive'|'restore';
}):Promise<WorkflowRow>{
  const card=await workflowCard(db,input.cardId,input.typeKey,true,input.source==='restore'),versionId=input.versionId??randomUUID();
  const revision=Number((await db.query('SELECT coalesce(max(revision),0)+1 value FROM new_design.card_versions WHERE card_id=$1',[input.cardId])).rows[0].value);
  const row=(await db.query(`INSERT INTO new_design.card_versions(
      id,card_id,revision,type_version_id,title,values,source
    ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
    [versionId,input.cardId,revision,card.type_version_id,input.title??card.title,JSON.stringify(input.values),input.source??'edit'])).rows[0];
  await db.query(`UPDATE new_design.cards
    SET revision=revision+1,current_version_id=$2,values=$3::jsonb,title=$4,updated_at=now() WHERE id=$1`,
    [input.cardId,versionId,JSON.stringify(input.values),input.title??card.title]);
  return row;
}

export async function recordWorkflowAction(db:WorkflowDb,input:{
  cardId:string;cardVersionId?:string|null;actionKey:string;requestKey?:string|null;inputHash?:string|null;
  payload?:Record<string,unknown>;receipt?:Record<string,unknown>|null;id?:string;createdAt?:string|Date;
}):Promise<WorkflowRow>{
  return(await db.query(`INSERT INTO new_design.card_version_actions(
      id,card_id,card_version_id,action_key,request_key,input_hash,payload,receipt,created_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,coalesce($9::timestamptz,now())) RETURNING *`,[
      input.id??randomUUID(),input.cardId,input.cardVersionId??null,input.actionKey,input.requestKey??null,input.inputHash??null,
      JSON.stringify(input.payload??{}),input.receipt?JSON.stringify(input.receipt):null,input.createdAt??null,
    ])).rows[0];
}

export async function adoptWorkflowVersion(db:WorkflowDb,input:{
  cardId:string;typeKey:string;versionId:string;expectedRevision:number;actionKey:string;requestKey:string;inputHash:string;
  payload?:Record<string,unknown>;
}):Promise<{revision:number;action:WorkflowRow}>{
  const card=await workflowCard(db,input.cardId,input.typeKey,true);
  const workflowRevision=Number(card.values?.workflow_revision??0);
  if(workflowRevision!==input.expectedRevision)throw new NewDesignError('采用状态已变化，请先读取最新版本。',409);
  if(!(await db.query('SELECT 1 FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[input.versionId,input.cardId])).rowCount){
    throw new NewDesignError('候选版本不存在或属于其他对象。',404);
  }
  const revision=input.expectedRevision+1,values={...(card.values as Record<string,unknown>),workflow_revision:revision,adopted_version_id:input.versionId};
  await db.query('UPDATE new_design.cards SET revision=revision+1,values=$2::jsonb,updated_at=now() WHERE id=$1',[
    input.cardId,JSON.stringify(values),
  ]);
  const action=await recordWorkflowAction(db,{...input,cardVersionId:input.versionId,payload:{...(input.payload??{}),revision}});
  return{revision,action};
}

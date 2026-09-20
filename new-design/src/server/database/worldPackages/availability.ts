import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {worldCatalogActionSchema,type WorldCatalogActionInput,type WorldCatalogActionReceipt,type WorldCatalogState} from '../../../common/worldPackages';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {formHash} from '../formAssist';
import {requireWorldPackageCapability} from './capability';
import {readWorldOriginal,writeWorldOriginal} from './receipts';

export async function worldCatalogStateInstalled(db:Pick<PoolClient,'query'>):Promise<boolean>{
 return Boolean((await db.query("SELECT to_regclass('new_design.world_package_catalog_actions') IS NOT NULL installed")).rows[0].installed);
}

export async function worldCatalogArchiveAvailable(db:Pick<PoolClient,'query'>):Promise<boolean>{
 if(!await worldCatalogStateInstalled(db))return false;
 const row=(await db.query("SELECT count(*)::integer guards FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='new_design' AND relation.relname='world_package_catalog_actions' AND trigger.tgname=ANY($1::text[]) AND trigger.tgenabled='O'",[['world_package_catalog_action_guard','world_package_catalog_actions_immutable']])).rows[0];
 return Number(row.guards)===2;
}

export async function worldCatalogState(db:Pick<PoolClient,'query'>,rootCardId:string):Promise<WorldCatalogState>{
 const row=(await db.query('SELECT action,revision FROM new_design.world_package_catalog_actions WHERE root_card_id=$1 ORDER BY revision DESC LIMIT 1',[rootCardId])).rows[0];
 return {status:row?.action==='archive'?'archived':'active',revision:Number(row?.revision??0)};
}

export async function requireWorldCatalogActive(db:Pick<PoolClient,'query'>,rootCardId:string):Promise<void>{
 if(!await worldCatalogStateInstalled(db))return;
 if(!await worldCatalogArchiveAvailable(db))throw new NewDesignError('世界样本归档门禁不可用，请到运行维护核对；新导入和发布已暂停。',503);
 if((await worldCatalogState(db,rootCardId)).status==='archived')throw new NewDesignError('此世界样本已归档，不能新导入或发布；原版本和已导入内容保留。',409);
}

export async function changeWorldPackageAvailability(rootCardId:string,input:WorldCatalogActionInput):Promise<WorldCatalogActionReceipt>{
 const id=z.string().uuid().parse(rootCardId),parsed=worldCatalogActionSchema.parse(input),request={rootCardId:id,...parsed};
 const pool=await getNewDesignPool();if(!await worldCatalogArchiveAvailable(pool))throw new NewDesignError('世界样本归档能力尚未安装，请到运行维护核对。',503);
 return writeWorldOriginal('catalog',request,async db=>{
  await requireWorldPackageCapability(db);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`world-package-root:${id}`]);
  if(!(await db.query('SELECT 1 FROM new_design.world_package_versions WHERE root_card_id=$1 LIMIT 1',[id])).rowCount)throw new NewDesignError('世界样本不存在，无法归档或恢复。',404);
  const current=await worldCatalogState(db,id);
  if(current.revision!==parsed.expectedRevision)throw new NewDesignError('世界样本状态已变化，请重新读取后确认。',409);
  if((parsed.action==='archive')!==(current.status==='active'))throw new NewDesignError('世界样本已处于所选状态，请重新读取。',409);
  const revision=current.revision+1,inputHash=formHash({scope:'catalog',input:request});
  const receipt:WorldCatalogActionReceipt={rootCardId:id,status:parsed.action==='archive'?'archived':'active',revision,requestKey:parsed.requestKey,inputHash,input:request,repeated:false};
  await db.query('INSERT INTO new_design.world_package_catalog_actions(id,root_card_id,action,revision,expected_revision,request_key,input_hash,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[randomUUID(),id,parsed.action,revision,parsed.expectedRevision,parsed.requestKey,inputHash,JSON.stringify(receipt)]);
  return receipt;
 });
}

export async function readWorldCatalogActionOriginal(rootCardId:string,input:WorldCatalogActionInput):Promise<WorldCatalogActionReceipt|null>{
 const id=z.string().uuid().parse(rootCardId),parsed=worldCatalogActionSchema.parse(input),pool=await getNewDesignPool();
 if(!await worldCatalogArchiveAvailable(pool))throw new NewDesignError('世界样本归档能力尚未安装，请到运行维护核对。',503);
 return readWorldOriginal<WorldCatalogActionReceipt>('catalog',{rootCardId:id,...parsed});
}

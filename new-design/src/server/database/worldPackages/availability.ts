import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {worldCatalogActionSchema,type WorldCatalogActionInput,type WorldCatalogActionReceipt,type WorldCatalogState} from '../../../common/worldPackages';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {formHash} from '../formAssist';
import {recordWorkflowAction} from '../cardWorkflow';
import {createRecordCard,listRecordCards} from '../recordCards';
import {requireWorldPackageCapability} from './capability';
import {readWorldOriginal,writeWorldOriginal} from './receipts';

export async function worldCatalogStateInstalled(db:Pick<PoolClient,'query'>):Promise<boolean>{
 return Boolean((await db.query("SELECT EXISTS(SELECT 1 FROM new_design.card_types WHERE type_key='world_package_catalog_action' AND status='published') installed")).rows[0].installed);
}

export async function worldCatalogArchiveAvailable(db:Pick<PoolClient,'query'>):Promise<boolean>{
 if(!await worldCatalogStateInstalled(db))return false;
 const row=(await db.query("SELECT EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational) kernel,EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('new_design.card_version_actions') AND tgname='card_version_actions_immutable' AND tgenabled='O') immutable")).rows[0]??{};
 return Boolean(row.kernel&&row.immutable);
}

export async function worldCatalogState(db:Pick<PoolClient,'query'>,rootCardId:string):Promise<WorldCatalogState>{
 const row=(await listRecordCards(db,'world_package_catalog_action')).filter(item=>item.root_card_id===rootCardId).sort((left,right)=>Number(right.revision)-Number(left.revision))[0];
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
  if(!(await listRecordCards(db,'world_package_snapshot')).some(row=>row.root_card_id===id))throw new NewDesignError('世界样本不存在，无法归档或恢复。',404);
  const current=await worldCatalogState(db,id);
  if(current.revision!==parsed.expectedRevision)throw new NewDesignError('世界样本状态已变化，请重新读取后确认。',409);
  if((parsed.action==='archive')!==(current.status==='active'))throw new NewDesignError('世界样本已处于所选状态，请重新读取。',409);
  const revision=current.revision+1,inputHash=formHash({scope:'catalog',input:request});
  const receipt:WorldCatalogActionReceipt={rootCardId:id,status:parsed.action==='archive'?'archived':'active',revision,requestKey:parsed.requestKey,inputHash,input:request,repeated:false};
  const root=await db.query('SELECT space_id FROM new_design.cards WHERE id=$1',[id]),saved=await createRecordCard(db,{spaceId:String(root.rows[0]?.space_id??'00000000-0000-4000-8000-000000000001'),typeKey:'world_package_catalog_action',title:`世界样本${parsed.action==='archive'?'归档':'恢复'}`,values:{id:randomUUID(),root_card_id:id,action:parsed.action,revision,expected_revision:parsed.expectedRevision,request_key:parsed.requestKey,input_hash:inputHash,receipt}});
  await recordWorkflowAction(db,{cardId:saved.recordCardId,actionKey:`world_package.${parsed.action}`,requestKey:parsed.requestKey,inputHash,payload:{rootCardId:id,revision}});
  return receipt;
 });
}

export async function readWorldCatalogActionOriginal(rootCardId:string,input:WorldCatalogActionInput):Promise<WorldCatalogActionReceipt|null>{
 const id=z.string().uuid().parse(rootCardId),parsed=worldCatalogActionSchema.parse(input),pool=await getNewDesignPool();
 if(!await worldCatalogArchiveAvailable(pool))throw new NewDesignError('世界样本归档能力尚未安装，请到运行维护核对。',503);
 return readWorldOriginal<WorldCatalogActionReceipt>('catalog',{rootCardId:id,...parsed});
}

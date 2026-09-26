import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {type WorldPackageCommit,type WorldPackageReceipt,type PublishedWorldPackage} from '../../../common/worldPackages';
import {NewDesignError} from '../../domain/errors';
import {formHash} from '../formAssist';
import {recordWorkflowAction} from '../cardWorkflow';
import {createRecordCard,listRecordCards} from '../recordCards';
import {freezeWorldPackage} from './freeze';
import {requireWorldCatalogActive} from './availability';

export async function publishWorldPackageInTransaction(db:PoolClient,parsed:WorldPackageCommit):Promise<WorldPackageReceipt>{
 const {previewHash,...raw}=parsed,current=await freezeWorldPackage(db,raw,true);if(current.previewHash!==previewHash)throw new NewDesignError('所选公共来源已变化，完整选择保留，请先重新预览。',409);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`world-package-root:${parsed.rootCardId}`]);
 await requireWorldCatalogActive(db,parsed.rootCardId);
 const prior=await listRecordCards(db,'world_package_snapshot'),version=Math.max(0,...prior.filter(row=>row.root_card_id===parsed.rootCardId).map(row=>Number(row.version)))+1,id=randomUUID(),createdAt=new Date().toISOString(),frameHash=formHash(current.frame),inputHash=formHash({scope:'public',input:parsed}),published:PublishedWorldPackage={id,rootCardId:parsed.rootCardId,rootVersionId:parsed.rootVersionId,version,frame:current.frame,frameHash,createdAt},receipt:WorldPackageReceipt={requestKey:parsed.requestKey,inputHash,input:parsed,package:published,repeated:false},root=await db.query('SELECT space_id FROM new_design.cards WHERE id=$1',[parsed.rootCardId]),spaceId=String(root.rows[0]?.space_id??'00000000-0000-4000-8000-000000000001');
 const saved=await createRecordCard(db,{spaceId,typeKey:'world_package_snapshot',title:`公共世界包 v${version}`,createdAt,values:{id,root_card_id:parsed.rootCardId,root_version_id:parsed.rootVersionId,version,frame:current.frame,frame_hash:frameHash,request_key:parsed.requestKey,input_hash:inputHash,input:parsed,receipt}});
 await recordWorkflowAction(db,{cardId:saved.recordCardId,actionKey:'world_package.publish',requestKey:parsed.requestKey,inputHash,payload:{packageId:id,rootCardId:parsed.rootCardId,version}});
 return receipt;
}

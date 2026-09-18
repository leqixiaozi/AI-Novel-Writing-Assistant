import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {type WorldPackageCommit,type WorldPackageReceipt,type PublishedWorldPackage} from '../../../common/worldPackages';
import {NewDesignError} from '../../domain/errors';
import {formHash} from '../formAssist';
import {freezeWorldPackage} from './freeze';

export async function publishWorldPackageInTransaction(db:PoolClient,parsed:WorldPackageCommit):Promise<WorldPackageReceipt>{
 const {previewHash,...raw}=parsed,current=await freezeWorldPackage(db,raw,true);if(current.previewHash!==previewHash)throw new NewDesignError('所选公共来源已变化，完整选择保留，请先重新预览。',409);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`world-package-root:${parsed.rootCardId}`]);
 const id=randomUUID(),version=Number((await db.query('SELECT coalesce(max(version),0)+1 next FROM new_design.world_package_versions WHERE root_card_id=$1',[parsed.rootCardId])).rows[0].next),createdAt=new Date().toISOString(),frameHash=formHash(current.frame),inputHash=formHash({scope:'public',input:parsed}),published:PublishedWorldPackage={id,rootCardId:parsed.rootCardId,rootVersionId:parsed.rootVersionId,version,frame:current.frame,frameHash,createdAt},receipt:WorldPackageReceipt={requestKey:parsed.requestKey,inputHash,input:parsed,package:published,repeated:false};
 await db.query('INSERT INTO new_design.world_package_versions(id,root_card_id,root_version_id,version,frame,frame_hash,request_key,input_hash,input,receipt,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11)',[id,parsed.rootCardId,parsed.rootVersionId,version,JSON.stringify(current.frame),frameHash,parsed.requestKey,inputHash,JSON.stringify(parsed),JSON.stringify(receipt),createdAt]);
 for(const card of current.frame.cards)await db.query('INSERT INTO new_design.world_package_card_refs(package_id,source_card_id,source_version_id,type_version_id,form_version_id,section) VALUES($1,$2,$3,$4,$5,$6)',[id,card.cardId,card.versionId,card.typeVersionId,card.formVersionId,card.section]);
 for(const relation of current.frame.relations)await db.query('INSERT INTO new_design.world_package_relation_refs(package_id,source_relation_id,source_version_id) VALUES($1,$2,$3)',[id,relation.relationId,relation.versionId]);
 return receipt;
}

import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {createRecordCard,listRecordCards,replaceRecordCard,requireRecordCard} from '../recordCards';

/** Called inside the asset command transaction after its explicit adoption decision. */
export async function recordAssetAdoption(client:PoolClient,values:Record<string,any>){
 const asset=await requireRecordCard(client,String(values.asset_id),'asset','原资产不存在。',{lock:true});
 if(asset.book_id!==values.book_id||asset.current_version_id!==values.to_version_id||Number(asset.revision)!==Number(values.asset_revision))throw new NewDesignError('资产采用记录与当前明确采用的版本不一致。',409);
 const row=await createRecordCard(client,{id:String(values.id),spaceId:asset.recordSpaceId,typeKey:'asset_adoption',title:'资产版本采用',values});
 if(!values.from_version_id||values.from_version_id===values.to_version_id)return row;
 const resources=(await client.query("SELECT new_design.register_dependency_resource('asset_version',$1,$2) old_id,new_design.register_dependency_resource('asset_version',$1,$3) new_id",[values.asset_id,values.from_version_id,values.to_version_id])).rows[0];
 const event=assertFound((await client.query("SELECT new_design.record_dependency_invalidation($1,$2,$3,$4,'附件采用版本发生变化。','asset_adoption','stale',$5,$6,$7,NULL) id",[randomUUID(),values.book_id,resources.old_id,resources.new_id,row.id,`asset-adoption:${row.id}`,values.dependency_preview_id])).rows[0],'采用版本的依赖失效记录不存在。');
 const impacts=await listRecordCards(client,'dependency_invalidation_impact',{where:{event_id:String(event.id)}});
 if(!impacts.length)return row;
 const impacted=(await client.query("SELECT exact_version_id FROM new_design.dependency_resources WHERE id=ANY($1::uuid[]) AND book_id=$2 AND resource_kind='asset_version'",[impacts.map(impact=>impact.resource_id),values.book_id])).rows;
 const results=await listRecordCards(client,'asset_derivation_result',{where:{book_id:values.book_id}});
 const ids=new Set(results.filter(result=>impacted.some(resource=>resource.exact_version_id===result.output_asset_version_id)).map(result=>String(result.derivation_id)));
 for(const derivation of await listRecordCards(client,'asset_derivation',{where:{book_id:values.book_id,status:'succeeded'},lock:true})){
  if(!ids.has(derivation.id))continue;
  const revision=Number(derivation.revision)+1;
  await createRecordCard(client,{spaceId:derivation.recordSpaceId,typeKey:'asset_derivation_event',title:'派生来源已变化',values:{id:randomUUID(),derivation_id:derivation.id,from_status:'succeeded',to_status:'stale',action:'mark_stale',actor:'system',detail:'来源附件版本发生变化，派生结果等待重建。',derivation_revision:revision,created_at:new Date().toISOString()}});
  await replaceRecordCard(client,{id:derivation.recordCardId,spaceId:derivation.recordSpaceId,typeKey:'asset_derivation',values:{...derivation,status:'stale',revision,updated_at:new Date().toISOString()}});
 }
 return row;
}

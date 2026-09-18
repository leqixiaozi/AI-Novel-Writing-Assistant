import type {PoolClient} from 'pg';
import type {WorldSyncInput,WorldSyncWorkspace,WorldSyncReceipt,PublishedWorldPackage} from '../../../../common/worldPackages';
import {assertFound} from '../../../domain/errors';
import {worldValue} from '../workspace';
import {publicRelationValue} from './relations';

/** Each side has its own acknowledged value, including explicit conversions. */
export async function saveSyncBaselines(db:PoolClient,commandId:string,installationId:string,input:WorldSyncInput,published:PublishedWorldPackage,workspace:WorldSyncWorkspace,added:WorldSyncReceipt['addedCards'],relations:WorldSyncReceipt['relationVersions']){
 const mappings=[...workspace.objects.map(object=>({sourceCardId:object.sourceCardId,targetCardId:object.targetCardId})),...added];
 const fields=[...input.choices,...added.flatMap(card=>card.mapping.map(map=>({sourceCardId:card.sourceCardId,sourceKey:map.sourceKey,targetKey:map.targetKey})))];
 for(const choice of fields){
  const mapping=assertFound(mappings.find(card=>card.sourceCardId===choice.sourceCardId),'基线的本书资料映射不存在。'),source=published.frame.cards.find(card=>card.cardId===choice.sourceCardId),fallback=workspace.installation.cards.find(card=>card.sourceCardId===choice.sourceCardId)??added.find(card=>card.sourceCardId===choice.sourceCardId);
  const local=(await db.query('SELECT current_version_id,values FROM new_design.cards WHERE id=$1',[mapping.targetCardId])).rows[0],extra=Object.fromEntries((await db.query('SELECT definition.field_key,local.value FROM new_design.card_version_local_values local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id WHERE local.card_version_id=$1',[local.current_version_id])).rows.map(row=>[row.field_key,row.value]));
  const publicVersion=source?.versionId??fallback?.sourceVersionId??(await db.query("SELECT snapshot->>'sourceVersionId' version_id FROM new_design.world_package_added_card_refs WHERE installation_id=$1 AND source_card_id=$2",[installationId,choice.sourceCardId])).rows[0]?.version_id;
  // An added object may be absent from a later package; its retained mapping
  // still identifies an actual source version for the absence acknowledgement.
  const versionId=assertFound(publicVersion,'原公共版本引用不存在，未将最新状态猜作历史基线。');
  await db.query('INSERT INTO new_design.world_package_field_baselines(command_id,installation_id,source_card_id,source_key,target_key,public_version_id,local_version_id,public_value,local_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',[commandId,installationId,choice.sourceCardId,choice.sourceKey,choice.targetKey,versionId,local.current_version_id,JSON.stringify(worldValue(source?{...source.values,...source.localValues}:{},choice.sourceKey)),JSON.stringify(worldValue({...local.values,...extra},choice.targetKey))]);
 }
 for(const choice of input.relationChoices??[]){
  const difference=workspace.relations.find(relation=>relation.sourceRelationId===choice.sourceRelationId)!,saved=relations.find(relation=>relation.sourceRelationId===choice.sourceRelationId),targetId=saved?.targetRelationId??difference.targetRelationId;
  if(!targetId)continue;
  const local=(await db.query('SELECT relation.relation_type_id,relation.source_card_id,relation.target_card_id,version.id,version.properties,version.status FROM new_design.card_relations relation JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id WHERE relation.id=$1',[targetId])).rows[0],source=published.frame.relations.find(relation=>relation.relationId===choice.sourceRelationId),value={present:true,value:{sourceCardId:mappings.find(card=>card.targetCardId===local.source_card_id)?.sourceCardId??null,targetCardId:mappings.find(card=>card.targetCardId===local.target_card_id)?.sourceCardId??null,properties:local.properties,status:local.status}};
  await db.query('INSERT INTO new_design.world_package_relation_baselines(command_id,installation_id,source_relation_id,target_relation_id,target_type_id,public_version_id,local_version_id,public_value,local_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',[commandId,installationId,choice.sourceRelationId,targetId,local.relation_type_id,source?.versionId??null,local.id,JSON.stringify(publicRelationValue(source)),JSON.stringify(value)]);
 }
}

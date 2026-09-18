import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {FieldDefinition} from '../../../common/contracts';
import type {FrozenWorldRelation,WorldInstallInput} from '../../../common/worldPackages';
import {assertFound,NewDesignError} from '../../domain/errors';
import {validateFieldValue} from '../../domain/validation';

export async function previewPackageRelation(db:PoolClient,spaceId:string,source:FrozenWorldRelation,input:WorldInstallInput['relations'][number],typeKeys:Map<string,string>,lock=false){
 const row=assertFound((await db.query("SELECT to_jsonb(type) snapshot FROM new_design.relation_types type WHERE id=$1 AND status='published' AND (owner_space_id=$2 OR owner_space_id IS NULL)"+(lock?' FOR UPDATE':''),[input.targetTypeId,spaceId])).rows[0],'关系规则不属于本书可用的已发布规则。'),type=row.snapshot;
 const sourceKey=typeKeys.get(source.sourceCardId),targetKey=typeKeys.get(source.targetCardId),direct=type.source_type_keys.includes(sourceKey)&&type.target_type_keys.includes(targetKey),reverse=type.direction==='undirected'&&type.source_type_keys.includes(targetKey)&&type.target_type_keys.includes(sourceKey);
 if(!direct&&!reverse)throw new NewDesignError('世界关系两端的本书内容类型或方向不符合所选关系规则。',422);
 const fields=(type.properties_schema??[]) as Array<Partial<FieldDefinition>&{key:string;name:string;type:FieldDefinition['type']}>;
 if(Object.keys(input.properties).some(key=>!fields.some(field=>field.key===key)))throw new NewDesignError('关系映射包含未定义的属性，请核对完整网络。',422);
 for(const field of fields){const issue=validateFieldValue({description:'',required:false,defaultValue:null,options:[],group:'关系',order:0,...field},input.properties[field.key]);if(issue)throw new NewDesignError(issue,422,{[field.key]:issue});}
 return type as Record<string,unknown>;
}
/** Independent archive relations use the canonical business-relation history.
 * No initial states, settlement dimensions, facts or knowledge are created. */
export async function createPackageRelation(db:PoolClient,spaceId:string,typeId:string,sourceId:string,targetId:string,properties:Record<string,unknown>){
 const type=assertFound((await db.query('SELECT * FROM new_design.relation_types WHERE id=$1 FOR UPDATE',[typeId])).rows[0],'关系规则来源不存在。');
 const endpoints=(await db.query('SELECT id,current_version_id FROM new_design.cards WHERE id=ANY($1::uuid[]) AND space_id=$2 AND status=\'active\' FOR SHARE',[[sourceId,targetId],spaceId])).rows;
 if(sourceId===targetId||endpoints.length!==2)throw new NewDesignError('关系两端必须是本书两个独立有效对象。',422);
 for(const [key,id,max] of [['source_card_id',sourceId,type.source_max],['target_card_id',targetId,type.target_max]] as const){if(max&&Number((await db.query(`SELECT count(*) n FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2 AND ${key}=$3 AND status='active'`,[spaceId,typeId,id])).rows[0].n)>=max)throw new NewDesignError('关系数量超过本书实际规则，完整安装未提交。',422);}
 const id=randomUUID(),versionId=randomUUID(),sourceVersion=endpoints.find(row=>row.id===sourceId)!.current_version_id,targetVersion=endpoints.find(row=>row.id===targetId)!.current_version_id;
 await db.query("INSERT INTO new_design.card_relations(id,space_id,relation_type_id,source_card_id,target_card_id,status,properties,created_by) VALUES($1,$2,$3,$4,$5,'active',$6::jsonb,'world_package_install')",[id,spaceId,typeId,sourceId,targetId,JSON.stringify(properties)]);
 await db.query("INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by) VALUES($1,$2,1,$3,$4,'active',$5::jsonb,'world_package_install')",[versionId,id,sourceVersion,targetVersion,JSON.stringify(properties)]);
 await db.query('UPDATE new_design.card_relations SET current_version_id=$2 WHERE id=$1',[id,versionId]);return{id,versionId};
}

/** Keep canonical identities stable so historical package provenance survives. */
export async function revisePackageRelation(db:PoolClient,spaceId:string,relationId:string,expectedVersionId:string,properties:Record<string,unknown>,status:'active'|'archived'){
 const current=assertFound((await db.query('SELECT * FROM new_design.card_relations WHERE id=$1 AND space_id=$2 FOR UPDATE',[relationId,spaceId])).rows[0],'选中关系不属于当前世界来源。');
 if(current.current_version_id!==expectedVersionId)throw new NewDesignError('关系已在其他页面修改，请保留选择重新预览。',409);
 const endpoints=(await db.query("SELECT id,current_version_id FROM new_design.cards WHERE id=ANY($1::uuid[]) AND space_id=$2 AND status='active' FOR SHARE",[[current.source_card_id,current.target_card_id],spaceId])).rows;
 if(endpoints.length!==2)throw new NewDesignError('关系两端存在不可用资料，请保留原关系核对。',409);
 const previous=assertFound((await db.query('SELECT * FROM new_design.card_relation_versions WHERE id=$1',[expectedVersionId])).rows[0],'关系的原版本不可用。');
 const sourceVersion=endpoints.find(row=>row.id===current.source_card_id)!.current_version_id,targetVersion=endpoints.find(row=>row.id===current.target_card_id)!.current_version_id;
 if(previous.status===status&&JSON.stringify(previous.properties)===JSON.stringify(properties)&&previous.source_card_version_id===sourceVersion&&previous.target_card_version_id===targetVersion)return{id:relationId,versionId:expectedVersionId};
 if(status==='active'&&current.status!=='active'){
  const type=assertFound((await db.query("SELECT * FROM new_design.relation_types WHERE id=$1 AND status='published' FOR UPDATE",[current.relation_type_id])).rows[0],'关系规则不可用。');
  for(const [key,id,max] of [['source_card_id',current.source_card_id,type.source_max],['target_card_id',current.target_card_id,type.target_max]] as const)if(max&&Number((await db.query(`SELECT count(*) n FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2 AND ${key}=$3 AND status='active' AND id<>$4`,[spaceId,type.id,id,relationId])).rows[0].n)>=max)throw new NewDesignError('恢复关系超过实际规则允许的数量。',422);
 }
 const versionId=randomUUID(),revision=Number(current.revision)+1;
 await db.query("INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'world_package_sync')",[versionId,relationId,revision,sourceVersion,targetVersion,status,JSON.stringify(properties)]);
 await db.query('UPDATE new_design.card_relations SET current_version_id=$2,revision=$3,status=$4,properties=$5::jsonb,updated_at=now() WHERE id=$1',[relationId,versionId,revision,status,JSON.stringify(properties)]);
 return{id:relationId,versionId};
}

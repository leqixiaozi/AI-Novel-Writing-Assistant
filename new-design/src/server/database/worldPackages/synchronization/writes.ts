import type {PoolClient} from 'pg';
import {PUBLIC_WORLD_SPACE_ID,type WorldSyncInput,type WorldSyncWorkspace,type WorldSyncReceipt} from '../../../../common/worldPackages';
import {assertFound,NewDesignError} from '../../../domain/errors';
import {updateCardInTransaction} from '../../store';
import {freezeWorldPackage} from '../freeze';
import {publishWorldPackageInTransaction} from '../publication';
import {createPackageRelation,revisePackageRelation} from '../relations';
import {candidateSource,patchWorldValue} from './preview';

export async function pullRelations(db:PoolClient,bookId:string,input:WorldSyncInput,workspace:WorldSyncWorkspace,added:WorldSyncReceipt['addedCards']){
 const spaceId=String((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0].space_id),mappings=[...workspace.objects.map(object=>({sourceCardId:object.sourceCardId,targetCardId:object.targetCardId})),...added],versions:WorldSyncReceipt['relationVersions']=[];
 for(const choice of input.relationChoices??[]){
  const difference=workspace.relations.find(relation=>relation.sourceRelationId===choice.sourceRelationId)!;
  if(choice.decision==='keep')continue;
  let saved:{id:string;versionId:string};
  if(choice.decision==='detach'){
   const local=difference.local.present?difference.local.value as {properties:Record<string,unknown>}:null;
   saved=await revisePackageRelation(db,spaceId,difference.targetRelationId!,difference.targetVersionId!,local?.properties??{},'archived');
  }else{
   const sourceId=assertFound(mappings.find(card=>card.sourceCardId===choice.sourceCardId),'关系来源资料未导入。').targetCardId,targetId=assertFound(mappings.find(card=>card.sourceCardId===choice.targetCardId),'关系目标资料未导入。').targetCardId;
   const current=difference.targetRelationId?(await db.query('SELECT * FROM new_design.card_relations WHERE id=$1 FOR UPDATE',[difference.targetRelationId])).rows[0]:null;
   if(current&&current.current_version_id!==difference.targetVersionId)throw new NewDesignError('本书关系在预览后变化，完整选择保留。',409);
   if(current&&current.relation_type_id===choice.targetTypeId&&current.source_card_id===sourceId&&current.target_card_id===targetId)saved=await revisePackageRelation(db,spaceId,current.id,difference.targetVersionId!,choice.properties,'active');
   else{
    if(current)await revisePackageRelation(db,spaceId,current.id,difference.targetVersionId!,current.properties,'archived');
    saved=await createPackageRelation(db,spaceId,choice.targetTypeId,sourceId,targetId,choice.properties);
   }
  }
  versions.push({sourceRelationId:choice.sourceRelationId,targetRelationId:saved.id,versionId:saved.versionId,targetTypeId:choice.decision==='detach'?difference.targetTypeId:choice.targetTypeId});
 }
 return versions;
}

export async function publishCandidate(db:PoolClient,bookId:string,input:WorldSyncInput,workspace:WorldSyncWorkspace){
 const candidate=await candidateSource(db,bookId,input,workspace);
 if((await db.query('SELECT 1 FROM new_design.world_package_versions WHERE request_key=$1',[input.publicRequestKey])).rowCount)throw new NewDesignError('公共发布原键已有其他结果，请保留原键核对。',409);
 const versions=new Map(workspace.upstream.frame.cards.map(card=>[card.cardId,card.versionId])),affected=new Map<string,WorldSyncInput['choices']>();
 for(const choice of candidate.input.choices.filter(choice=>choice.decision==='take'))affected.set(choice.sourceCardId,[...(affected.get(choice.sourceCardId)??[]),choice]);
 for(const [cardId,choices] of affected){
  const source=assertFound(workspace.upstream.frame.cards.find(card=>card.cardId===cardId),'候选公共目标不可用。'),values={...source.values},localValues={...source.localValues};
  for(const choice of choices)patchWorldValue(source.localFields.some(field=>field.field.key===choice.sourceKey)?localValues:values,choice.sourceKey,choice.value);
  const current=assertFound((await db.query('SELECT revision,current_version_id FROM new_design.cards WHERE id=$1 FOR UPDATE',[cardId])).rows[0],'公共目标不存在。');
  if(current.current_version_id!==source.versionId)throw new NewDesignError('公共档案在候选后变化，原候选保留。',409);
  await updateCardInTransaction(db,cardId,{title:source.title,values,localValues,revision:current.revision});
  versions.set(cardId,String((await db.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[cardId])).rows[0].current_version_id));
 }
 const relationVersionIds:string[]=[];
 for(const source of workspace.upstream.frame.relations){
  const current=assertFound((await db.query('SELECT current_version_id FROM new_design.card_relations WHERE id=$1 FOR UPDATE',[source.relationId])).rows[0],'公共关系来源不可用。');
  if(current.current_version_id!==source.versionId)throw new NewDesignError('公共关系在候选后变化，原候选保留。',409);
  const choice=candidate.input.relationChoices?.find(choice=>choice.sourceRelationId===source.relationId),status=choice?.decision==='detach'?'archived':'active',properties=choice?.decision==='take'?choice.properties:source.properties;
  const saved=await revisePackageRelation(db,PUBLIC_WORLD_SPACE_ID,source.relationId,source.versionId,properties,status);
  if(status==='active')relationVersionIds.push(saved.versionId);
 }
 const raw={requestKey:input.publicRequestKey!,rootCardId:workspace.upstream.rootCardId,rootVersionId:versions.get(workspace.upstream.rootCardId)!,cards:workspace.upstream.frame.cards.map(card=>({cardId:card.cardId,versionId:versions.get(card.cardId)!,section:card.section})),relationVersionIds},frozen=await freezeWorldPackage(db,raw,true);
 return{candidate,package:(await publishWorldPackageInTransaction(db,{...raw,previewHash:frozen.previewHash})).package};
}

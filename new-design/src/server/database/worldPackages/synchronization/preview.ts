import type {PoolClient} from 'pg';
import {PUBLIC_WORLD_SPACE_ID,type WorldSyncInput,type WorldSyncWorkspace,type WorldSyncPreview,type WorldPushCandidate,type WorldValue} from '../../../../common/worldPackages';
import {assertFound,NewDesignError} from '../../../domain/errors';
import {validateFieldValue} from '../../../domain/validation';
import {formHash} from '../../formAssist';
import {readSyncWorkspace} from '../workspace';
import {prepareWorldCard} from '../mapping';
import {previewPackageRelation} from '../relations';
import {findRecordCardByValue,listRecordCards} from '../../recordCards';

export function patchWorldValue(values:Record<string,unknown>,key:string,value:WorldValue){if(value.present)values[key]=value.value;else delete values[key];}

export async function candidateSource(db:PoolClient,bookId:string,input:WorldSyncInput,workspace:WorldSyncWorkspace){
 const stored=await findRecordCardByValue(db,'world_package_push_candidate','id',String(input.candidateId)),candidate=assertFound(stored&&stored.book_id===bookId&&stored.installation_id===input.installationId&&stored.package_id===input.packageId?stored.snapshot:null,'原公共候选不属于本书世界或固定版本。') as WorldPushCandidate;
 if(candidate.workspaceHash!==workspace.workspaceHash)throw new NewDesignError('本书或公共来源在候选准备后变化，原候选保留，请核对新差异再准备。',409);
 if((await listRecordCards(db,'world_package_sync_command')).some(row=>row.installation_id===input.installationId&&row.operation==='publish'&&row.input?.candidateId===candidate.id))throw new NewDesignError('原候选已发布，请只读核对原发布结果。',409);
 for(const live of workspace.publicLive)if(!workspace.upstream.frame.cards.some(card=>card.cardId===live.cardId&&card.versionId===live.versionId))throw new NewDesignError('公共档案已产生包外更新，请先选择对应固定公共版本。',409);
 return candidate;
}

export async function syncPreview(db:PoolClient,bookId:string,input:WorldSyncInput,lock=false):Promise<WorldSyncPreview>{
 const workspace=await readSyncWorkspace(db,bookId,input.installationId,input.packageId,lock),additions=input.newCards??[],relations=input.relationChoices??[];
 if(input.operation==='publish'){
  const candidate=await candidateSource(db,bookId,input,workspace),{previewHash:_candidatePreview,...original}=candidate.input,prepared=await syncPreview(db,bookId,original,lock),warnings=[...prepared.warnings.slice(0,-1),'发布会新增公共固定版本；其他书籍须主动拉取。'];
  return{...prepared,input,warnings,previewHash:formHash({bookId,input,candidateId:candidate.id,preparedHash:prepared.previewHash,warnings})};
 }
 if((input.operation==='pull'||input.operation==='push')&&!input.choices.length&&!additions.length&&!relations.length)throw new NewDesignError('请选择需要处理的资料或关系差异。',422);
 if(input.operation==='push'&&!input.choices.some(choice=>choice.decision==='take')&&!relations.some(choice=>choice.decision!=='keep'))throw new NewDesignError('请选择需要推送的资料或关系改动。',422);
 const book=assertFound((await db.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'"+(lock?' FOR SHARE':''),[bookId])).rows[0],'本书不可用。'),changed=new Map<string,{cardId:string;title:string;values:Record<string,unknown>}>(),used=new Set<string>();
 for(const choice of input.choices){
  const object=assertFound(workspace.objects.find(object=>object.sourceCardId===choice.sourceCardId),'字段不属于本书世界对象。'),difference=assertFound(object.differences.find(field=>field.key===choice.sourceKey),'来源字段不属于本次完整差异。'),field=assertFound(object.fields.find(field=>field.key===choice.targetKey&&!field.hidden),'目标不是本书可填写的实际字段。');
  if(difference.targetKey&&difference.targetKey!==choice.targetKey)throw new NewDesignError('来源字段的书内映射不同，请保留原映射核对。',422);
  const target=`${object.targetCardId}:${choice.targetKey}`;
  if(used.has(target)||object.differences.some(other=>other.key!==choice.sourceKey&&other.targetKey===choice.targetKey))throw new NewDesignError('多个公共字段不能覆盖同一本书字段。',422);used.add(target);
  if(choice.decision==='keep'&&formHash(choice.value)!==formHash(difference.local))throw new NewDesignError('保留本书须使用实际本书值。',422);
  if(choice.decision!=='take')continue;
  const source=workspace.upstream.frame.cards.find(card=>card.cardId===choice.sourceCardId);
  if(input.operation==='push'){
   if(!source)throw new NewDesignError('已从公共版本移除的对象保留为本书资料，不能向不存在的公共对象推送。',422);
   const definition=assertFound([...source.fields,...source.localFields.map(local=>local.field)].find(field=>field.key===choice.sourceKey),'公共字段没有对应定义，请先核对公共规格。');
   const issue=validateFieldValue(definition,choice.value.present?choice.value.value:undefined);if(issue)throw new NewDesignError(issue,422,{[definition.key]:issue});
  }else if(input.operation==='pull'){const issue=validateFieldValue(field,choice.value.present?choice.value.value:undefined);if(issue)throw new NewDesignError(issue,422,{[field.key]:issue});}
  const cardId=input.operation==='pull'?object.targetCardId:choice.sourceCardId,initial=input.operation==='pull'?{...object.values,...object.localValues}:{...source!.values,...source!.localValues},change=changed.get(cardId)??{cardId,title:input.operation==='pull'?object.title:source!.title,values:initial};
  patchWorldValue(change.values,input.operation==='pull'?choice.targetKey:choice.sourceKey,choice.value);changed.set(cardId,change);
 }
 const requested=Object.keys(input.cardRequestKeys).sort(),expected=input.operation==='pull'?[...changed.keys()].sort():[];
 if(formHash(requested)!==formHash(expected))throw new NewDesignError('资料保存原键须完整对应实际改动资料。',422);
 const typeKeys=new Map(workspace.objects.map(object=>[object.sourceCardId,object.targetTypeKey])),newTargets:WorldSyncPreview['newTargets']=[];
 for(const item of additions){const source=assertFound(workspace.newObjects.find(card=>card.cardId===item.sourceCardId),'选中对象不是尚未导入的公共新增对象。'),target=await prepareWorldCard(db,bookId,String(book.space_id),source,item,lock);typeKeys.set(item.sourceCardId,target.typeKey);newTargets.push(target);}
 if(workspace.objects.length+newTargets.length>300)throw new NewDesignError('本书世界对象超过完整同步范围，未进行部分保存。',422);
 const relationTargets:Record<string,unknown>[]=[];
 for(const choice of relations){
  const difference=assertFound(workspace.relations.find(relation=>relation.sourceRelationId===choice.sourceRelationId),'关系不属于当前完整差异。');
  if(choice.decision==='keep'){
   if(!difference.targetRelationId||!difference.local.present)throw new NewDesignError('此公共新增关系尚无本书副本，可不选择它，或明确采用。',422);
   const local=difference.local.value as {sourceCardId:string;targetCardId:string;properties:Record<string,unknown>};
   if(choice.targetTypeId!==difference.targetTypeId||choice.sourceCardId!==local.sourceCardId||choice.targetCardId!==local.targetCardId||formHash(choice.properties)!==formHash(local.properties))throw new NewDesignError('保留关系须对应实际本书两端、规则与属性。',422);
   continue;
  }
  if(choice.decision==='detach'){
   if(!difference.targetRelationId||!difference.local.present)throw new NewDesignError('只有已导入本书的关系才能移除；公共新增关系可不选择或明确采用。',422);
   if(input.operation==='push'&&!difference.next)throw new NewDesignError('公共关系已移除，不能向不存在的公共关系推送移除。',422);
   const local=difference.local.value as {sourceCardId:string;targetCardId:string;properties:Record<string,unknown>};
   if(choice.targetTypeId!==difference.targetTypeId||choice.sourceCardId!==local.sourceCardId||choice.targetCardId!==local.targetCardId)throw new NewDesignError('移除关系须对应本书实际关系和两端资料。',422);
   continue;
  }
  const source=assertFound(difference.next,'公共关系已移除，请明确保留或移除本书关系。');
  if(input.operation==='push'&&!difference.targetRelationId)throw new NewDesignError('此关系尚无本书副本，请先拉取关系再推送本书改动。',422);
  if(choice.sourceCardId!==source.sourceCardId||choice.targetCardId!==source.targetCardId)throw new NewDesignError('关系两端须对应选中公共关系，不能更换另一对资料。',422);
  if(input.operation==='push'&&choice.targetTypeId!==String(source.type.id))throw new NewDesignError('推送须使用此公共关系的实际规则。',422);
  const keys=input.operation==='push'?new Map(workspace.upstream.frame.cards.map(card=>[card.cardId,card.typeKey])):typeKeys;
  if(!keys.has(choice.sourceCardId)||!keys.has(choice.targetCardId))throw new NewDesignError('关系两端未导入，请同时选择新增资料或先独立导入。',422);
  relationTargets.push(await previewPackageRelation(db,input.operation==='push'?PUBLIC_WORLD_SPACE_ID:String(book.space_id),source,{sourceRelationId:choice.sourceRelationId,targetTypeId:choice.targetTypeId,properties:choice.properties},keys,lock));
 }
 const changes=[...changed.values()],warnings=['只保存明确选择的档案与关系；未选择资料、本书扩展、事实、状态、认知和正文保留。'];
 if(additions.length)warnings.push(`将独立创建 ${additions.length} 份公共新增资料，不按同名合并。`);
 if(workspace.removedObjects.length)warnings.push('已从公共版本移除的对象保留为本书副本，只有明确选择的字段或关系会改变。');
 if(relations.some(choice=>choice.decision==='detach'))warnings.push('明确移除的关系会保留旧版本记录。');
 if(input.operation==='push')warnings.push('本次只保存公共候选，公共档案与其他书籍保持原样。');
 return{bookId,input,workspace,changes,newTargets,relationTargets,selectedRelations:relations,warnings,previewHash:formHash({bookId,input,workspaceHash:workspace.workspaceHash,changes,newTargets,relationTargets,warnings})};
}

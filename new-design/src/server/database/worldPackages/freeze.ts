import type {PoolClient} from 'pg';
import {PUBLIC_WORLD_SPACE_ID,WORLD_PACKAGE_CONTRACT,type WorldPackageInput,type WorldPackageFrame,type FrozenWorldCard,type FrozenWorldRelation,type FrozenWorldDictionary} from '../../../common/worldPackages';
import {WORLD_PROFESSIONAL_TYPE_KEYS} from '../../../common/worldCharacterMaintenance';
import type {FieldDefinition} from '../../../common/contracts';
import {assertFound,NewDesignError} from '../../domain/errors';
import {formHash} from '../formAssist';
import {requireWorldPackageCapability} from './capability';
import {findRecordCardByValue,listRecordCards} from '../recordCards';

export async function freezeWorldPackage(db:PoolClient,input:WorldPackageInput,lock=false,sourceSpaceId:string=PUBLIC_WORLD_SPACE_ID){
 await requireWorldPackageCapability(db);
 if(!input.cards.some(card=>card.cardId===input.rootCardId&&card.versionId===input.rootVersionId))throw new NewDesignError('公共世界根版本必须在本次完整分区选择中。',422);
 const cards:FrozenWorldCard[]=[],types:WorldPackageFrame['types']=[],forms:WorldPackageFrame['forms']=[],dictionaries:FrozenWorldDictionary[]=[],dictionaryIds=new Set<string>(),localRows=await listRecordCards(db,'card_version_local_value'),formVersions=await listRecordCards(db,'card_group_form_version'),formRows=await listRecordCards(db,'card_group_form'),dictionaryRows=await listRecordCards(db,'dictionary_definition'),dictionaryItems=await listRecordCards(db,'dictionary_item'),dictionaryVersions=await listRecordCards(db,'dictionary_item_version');
 for(const ref of [...input.cards].sort((a,b)=>a.cardId.localeCompare(b.cardId))){
  const row=assertFound((await db.query(`SELECT card.card_type_id,version.*,type.type_key,type_version.fields,to_jsonb(type) type_metadata,to_jsonb(type_version) type_snapshot FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.status='published' JOIN new_design.card_versions version ON version.card_id=card.id JOIN new_design.card_type_versions type_version ON type_version.id=version.type_version_id AND type_version.card_type_id=type.id WHERE card.id=$1 AND version.id=$2 AND card.space_id=$3 AND card.status='active' ${lock?'FOR SHARE OF card,type,version,type_version':''}`,[ref.cardId,ref.versionId,sourceSpaceId])).rows[0],'所选世界对象或版本不属于当前有效来源。');
  if(!(WORLD_PROFESSIONAL_TYPE_KEYS as readonly string[]).includes(row.type_key))throw new NewDesignError('公共世界包只接受明确的世界资料内容类型。',422);
  const locals=[];for(const local of localRows.filter(item=>item.card_version_id===ref.versionId)){const definition=(await db.query('SELECT id,field_key FROM new_design.field_definitions WHERE id=$1 AND card_id=$2',[local.field_definition_id,ref.cardId])).rows[0],fieldVersion=(await db.query('SELECT id,field_schema FROM new_design.field_definition_versions WHERE id=$1 AND field_definition_id=$2',[local.field_definition_version_id,local.field_definition_id])).rows[0];if(definition&&fieldVersion)locals.push({definition_id:definition.id,field_key:definition.field_key,version_id:fieldVersion.id,field_schema:fieldVersion.field_schema,value:local.value});}locals.sort((left,right)=>String(left.field_key).localeCompare(String(right.field_key)));
  if(locals.some(local=>Object.hasOwn(row.values,local.field_key)))throw new NewDesignError('公共对象的档案与独立补充字段重复，请先核对来源。',422);
  const fields=row.fields as FieldDefinition[],localFields=locals.map(local=>({definitionId:String(local.definition_id),versionId:String(local.version_id),field:local.field_schema as FieldDefinition}));
  if(!types.some(type=>type.versionId===row.type_version_id))types.push({id:String(row.card_type_id),versionId:String(row.type_version_id),metadata:row.type_metadata,version:row.type_snapshot});
  if(Object.keys(row.values).some(key=>!fields.some(field=>field.key===key)))throw new NewDesignError('公共对象包含无对应版本定义的字段，完整来源保留。',422);
  for(const field of [...fields,...localFields.map(local=>local.field)])if(field.optionSource?.kind==='dictionary_tree')dictionaryIds.add(field.optionSource.dictionaryId);
  if(row.form_version_id&&!forms.some(form=>form.id===row.form_version_id)){
   const version=formVersions.find(item=>item.id===row.form_version_id),parent=version?formRows.find(item=>item.id===version.form_id):null,form=assertFound(version&&parent?{id:version.id,form_id:version.form_id,definition:version.definition,space_id:parent.space_id}:null,'公共来源的原表单版本不存在。');
   if(form.space_id&&form.space_id!==sourceSpaceId)throw new NewDesignError('世界对象引用了其他空间的表单，请核对实际来源。',422);
   forms.push({id:String(form.id),formId:String(form.form_id),definition:form.definition});
  }
  cards.push({cardId:ref.cardId,versionId:ref.versionId,section:ref.section,typeId:String(row.card_type_id),typeKey:String(row.type_key),typeVersionId:String(row.type_version_id),title:String(row.title),revision:Number(row.revision),values:row.values,localValues:Object.fromEntries(locals.map(local=>[String(local.field_key),local.value])),fields,localFields,formVersionId:row.form_version_id?String(row.form_version_id):null,formResolutionKind:String(row.form_resolution_kind)});
 }
 for(const id of [...dictionaryIds].sort()){
  const dictionaryRow=dictionaryRows.find(item=>item.id===id&&item.status==='published'&&(!item.owner_space_id||item.owner_space_id===sourceSpaceId)),dictionary=assertFound(dictionaryRow?{definition:dictionaryRow}:null,'世界字典不可用或属于其他空间。');
  const nodes=dictionaryItems.filter(item=>item.dictionary_id===id).sort((left,right)=>String(left.id).localeCompare(String(right.id))).slice(0,1001).map(item=>{const version=dictionaryVersions.find(candidate=>candidate.id===item.current_version_id&&candidate.item_id===item.id);return version?{id:item.id,version_id:version.id,snapshot:version}:null;}).filter(Boolean) as Array<{id:string;version_id:string;snapshot:Record<string,unknown>}>;
  if(nodes.length>1000)throw new NewDesignError('字典超过1000个节点，请先明确拆分范围；没有截断公共来源。',422);
  dictionaries.push({id,definition:dictionary.definition,nodes:nodes.map(node=>({id:String(node.id),versionId:String(node.version_id),snapshot:node.snapshot}))});
 }
 const relations:FrozenWorldRelation[]=[];
 for(const versionId of [...input.relationVersionIds].sort()){
  const row=assertFound((await db.query(`SELECT relation.id relation_id,relation.source_card_id,relation.target_card_id,version.*,to_jsonb(type) type FROM new_design.card_relation_versions version JOIN new_design.card_relations relation ON relation.id=version.card_relation_id JOIN new_design.relation_types type ON type.id=relation.relation_type_id AND type.status='published' WHERE version.id=$1 AND version.status='active' AND relation.space_id=$2 ${lock?'FOR SHARE OF relation,version,type':''}`,[versionId,sourceSpaceId])).rows[0],'所选关系版本不属于当前世界来源。');
  if(!cards.some(card=>card.cardId===row.source_card_id&&card.versionId===row.source_card_version_id)||!cards.some(card=>card.cardId===row.target_card_id&&card.versionId===row.target_card_version_id))throw new NewDesignError('关系两端须采用本次完整选择中的精确对象版本，请核对关系网络。',422);
  relations.push({relationId:String(row.relation_id),versionId,sourceCardId:String(row.source_card_id),targetCardId:String(row.target_card_id),sourceVersionId:String(row.source_card_version_id),targetVersionId:String(row.target_card_version_id),revision:Number(row.revision),properties:row.properties,type:row.type});
 }
 if(new Set(relations.map(relation=>relation.relationId)).size!==relations.length)throw new NewDesignError('同一关系只能选择一个明确版本。',422);
 const frame:WorldPackageFrame={contract:WORLD_PACKAGE_CONTRACT,rootCardId:input.rootCardId,rootVersionId:input.rootVersionId,cards,types:types.sort((a,b)=>a.versionId.localeCompare(b.versionId)),relations,forms:forms.sort((a,b)=>a.id.localeCompare(b.id)),dictionaries};
 return{input,frame,previewHash:formHash({input,frame})};
}

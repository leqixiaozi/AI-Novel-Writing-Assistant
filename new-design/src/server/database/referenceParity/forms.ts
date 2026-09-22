import {executeBookFormWrite} from "./receipts";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {CardGroupFormDefinition} from "../../../common/contracts";
import type {ReferenceFormInstallInput,ReferenceFormPreviewInput,ReferenceFormPreview,ReferenceFormReceipt,ReferenceFormsWorkspace,ReferenceFormSelectionInput} from "../../../common/referenceParity";
import {NewDesignError,assertFound} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
import {executeStructureWrite,readStructureWriteReceipt,structureWriteHash} from "../structureWrites";
import type {TemplatePayload} from "../templateStore";
import {formSlots,formEvolutionConflicts,relationDefinition} from "./formPolicy";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from "../recordCards";

function summary(row:Record<string,unknown>,version:number):Omit<ReferenceFormReceipt,'installationResult'>{return{id:String(row.id),key:String(row.form_key),name:String(row.name),description:String(row.description??''),status:'published',revision:Number(row.revision),currentVersion:version,currentVersionId:String(row.current_version_id),draftDefinition:row.draft_definition as CardGroupFormDefinition,isSystem:Boolean(row.is_system),createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()};}
export async function getReferenceForms(bookId:string):Promise<ReferenceFormsWorkspace>{
  const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const book=assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],'书籍不存在。');
    const rows=(await listRecordCards(client,"card_group_form",{spaceId:String(book.space_id)})).filter(form=>form.status==='published').sort((a,b)=>String(a.name).localeCompare(String(b.name))),allVersions=await listRecordCards(client,"card_group_form_version",{includeArchived:true}),forms:ReferenceFormsWorkspace['forms']=[];
    for(const row of rows){const versions=allVersions.filter(version=>String(version.form_id)===String(row.id)).sort((a,b)=>Number(b.version)-Number(a.version)),current=versions.find(version=>String(version.id)===String(row.current_version_id));forms.push({id:String(row.id),name:String(row.name),revision:Number(row.revision),currentVersionId:String(row.current_version_id),primaryTypeKey:String(current?.definition?.primaryTypeKey??''),versions:versions.map(version=>({id:String(version.id),version:Number(version.version),definition:version.definition}))});}
    const sourceRows=(await listRecordCards(client,'template_group_version',{where:{template_id:book.template_id}})).sort((a,b)=>Number(b.version)-Number(a.version)),sources:ReferenceFormsWorkspace['sources']=[];
    for(const row of sourceRows)for(const form of (row.payload as TemplatePayload).forms.filter(form=>['character','world_setting','world_rule'].includes(form.definition.primaryTypeKey)))sources.push({templateVersionId:String(row.id),templateVersion:Number(row.version),formId:form.sourceId,formVersionId:form.sourceVersionId,key:form.key,name:form.name,primaryTypeKey:form.definition.primaryTypeKey});
    const instances=(await listRecordCards(client,"card_group_form_instance",{spaceId:String(book.space_id),includeArchived:true})).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(row=>({id:String(row.id),primaryCardId:String(row.primary_card_id),formId:String(allVersions.find(version=>String(version.id)===String(row.form_version_id))?.form_id??''),formVersionId:String(row.form_version_id),revision:Number(row.revision)}));
    const result={bookId,bookRevision:Number(book.revision),spaceId:String(book.space_id),templateId:String(book.template_id),activeForms:(book.installed_payload as TemplatePayload).activeForms??{},forms,sources,instances};await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function inspect(client:PoolClient,bookId:string,input:ReferenceFormPreviewInput,lock=false){
  const book=assertFound((await client.query(`SELECT * FROM new_design.books WHERE id=$1 AND status='active' ${lock?'FOR UPDATE':''}`,[bookId])).rows[0],'书籍不存在。');
  const source=assertFound(await findRecordCard(client,input.sourceTemplateVersionId,'template_group_version'),'所选来源不是本书模板的已发布版本。'),payload=source.payload as TemplatePayload;
  if(source.template_id!==book.template_id)throw new NewDesignError('所选来源不是本书模板的已发布版本。',404);
  const frozen=assertFound(payload.forms.find(form=>form.sourceVersionId===input.sourceFormVersionId),'所选表单不在冻结模板版本中。');
  const actualVersion=await findRecordCard(client,frozen.sourceVersionId,"card_group_form_version",{includeArchived:true}),actualForm=actualVersion?await findRecordCard(client,String(actualVersion.form_id),"card_group_form",{includeArchived:true}):null,actual=assertFound(actualVersion&&actualForm&&actualForm.status==='published'&&(!actualForm.space_id||String(actualForm.space_id)==='00000000-0000-4000-8000-000000000001')?{definition:actualVersion.definition,form_id:actualVersion.form_id}:null,'来源表单版本不可用。');
  if(String(actual.form_id)!==frozen.sourceId||structureWriteHash(actual.definition)!==structureWriteHash(frozen.definition))throw new NewDesignError('来源表单与冻结模板不一致，请核对实际来源。',409);
  const definition=structuredClone(frozen.definition),conflicts:string[]=[],primary=definition.primaryTypeKey;
  if(!['character','world_setting','world_rule'].includes(primary))conflicts.push('请选择实际人物或世界关联表单。');
  const types=(await client.query(`SELECT type.id,type.type_key,type.current_version_id,type.revision,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id=$1 AND type.status='published' ${lock?'FOR UPDATE OF type':''}`,[book.space_id])).rows;
  const usedKeys=[...new Set([primary,...formSlots(definition).flatMap(slot=>slot.allowedTypeKeys)])],typeMappings:ReferenceFormPreview['installation']['typeMappings']=[];
  for(const key of usedKeys){const origin=payload.cardTypes.find(type=>type.key===key),target=types.find(type=>type.type_key===key);if(!origin||!target){conflicts.push(`本书缺少已发布的“${key}”规格，需先明确安装内容类型。`);continue;}const version=(await client.query("SELECT fields,card_type_id FROM new_design.card_type_versions WHERE id=$1",[origin.sourceVersionId])).rows[0];if(!version||String(version.card_type_id)!==origin.sourceId||structureWriteHash(version.fields)!==structureWriteHash(origin.fields)){conflicts.push(`“${key}”的冻结类型来源不匹配。`);continue;}typeMappings.push({key,sourceId:origin.sourceId,sourceVersionId:origin.sourceVersionId,targetId:String(target.id),targetVersionId:String(target.current_version_id)});}
  const allTargetForms=await listRecordCards(client,"card_group_form",{spaceId:String(book.space_id),includeArchived:true,lock}),allTargetVersions=await listRecordCards(client,"card_group_form_version",{includeArchived:true});
  const targetRows=allTargetForms.filter(form=>input.targetFormId?form.id===input.targetFormId:form.source_form_id===frozen.sourceId).flatMap(form=>{const version=allTargetVersions.find(item=>item.id===form.current_version_id);return version?[{...form,definition:version.definition,version:version.version}]:[];});
  if(input.targetFormId&&!targetRows.length)conflicts.push('目标表单不属于本书。');if(targetRows.length>1)conflicts.push('本书有多份来源安装，请明确选择目标表单。');
  const target=targetRows.length===1?targetRows[0]:null;
  if(target&&(target.status!=='published'||structureWriteHash(target.draft_definition)!==structureWriteHash(target.definition)))conflicts.push('目标表单有未发布草稿或不可用，保留草稿后明确处理。');
  const relationMappings:ReferenceFormPreview['installation']['relationMappings']=[],relations:Array<{id:string;key:string;definition:ReturnType<typeof relationDefinition>;sourceId:string;exists:boolean}>=[];
  for(const slot of formSlots(definition).filter(slot=>slot.kind==='card_reference')){
    const relation=payload.relationTypes.find(relation=>relation.key===slot.relationTypeKey);if(!relation){conflicts.push(`“${slot.name}”没有冻结关系规格。`);continue;}
    const rule={key:relation.key,name:relation.name,description:relation.description,direction:relation.direction,sourceTypeKeys:relation.sourceTypeKeys,targetTypeKeys:relation.targetTypeKeys,sourceMax:relation.sourceMax,targetMax:relation.targetMax,propertiesSchema:relation.propertiesSchema},key=`${relation.key.slice(0,45)}_${structureWriteHash(rule).slice(0,12)}`,privateRule={...rule,key};
    if(!rule.sourceTypeKeys.includes(primary)||slot.allowedTypeKeys.some(key=>!rule.targetTypeKeys.includes(key)))conflicts.push(`“${slot.name}”的允许类型或关系方向不匹配。`);
    const existing=(await client.query(`SELECT * FROM new_design.relation_types WHERE owner_space_id=$1 AND relation_key=$2 ${lock?'FOR UPDATE':''}`,[book.space_id,key])).rows[0];
    if(existing&&(existing.status!=='published'||structureWriteHash(relationDefinition(existing))!==structureWriteHash(privateRule)))conflicts.push(`“${slot.name}”书内关系规格已被修改，请保留原版本，明确处理。`);
    const id=existing?String(existing.id):`new:${key}`;relations.push({id,key,definition:privateRule,sourceId:relation.sourceId,exists:!!existing});
    relationMappings.push({key:relation.key,targetKey:key,sourceId:relation.sourceId,sourceVersion:{kind:'template_snapshot',versionId:input.sourceTemplateVersionId,definitionHash:structureWriteHash(rule)},targetId:id,targetDefinitionHash:structureWriteHash(privateRule)});slot.relationTypeKey=key;
  }
  const dictionaryMappings:ReferenceFormPreview['installation']['dictionaryMappings']=[];
  for(const field of formSlots(definition).flatMap(slot=>slot.localFields))if(field.optionSource?.kind==='dictionary_tree'){
    const binding=field.optionSource,origin=payload.dictionaries.find(dictionary=>dictionary.sourceId===binding.dictionaryId),dictionary=(await listRecordCards(client,"dictionary_definition",{spaceId:String(book.space_id),includeArchived:true})).find(item=>String(item.owner_space_id)===String(book.space_id)&&String(item.source_dictionary_id)===binding.dictionaryId&&item.status==='published');
    if(!origin||!dictionary){conflicts.push(`“${field.name}”的字典来源尚未安装，需先预览安装字典。`);continue;}
    const nodes=(await listRecordCards(client,"dictionary_item",{includeArchived:true})).filter(item=>String(item.dictionary_id)===String(dictionary.id)&&item.status==='active'&&item.source_item_id),mapping=nodes.map(row=>({sourceId:String(row.source_item_id),targetId:String(row.id),targetVersionId:String(row.current_version_id)}));
    const root=binding.rule.rootNodeId?mapping.find(node=>node.sourceId===binding.rule.rootNodeId):null;if(binding.rule.rootNodeId&&!root){conflicts.push(`“${field.name}”的字典范围起点尚未安装。`);continue;}
    field.optionSource={...binding,dictionaryId:String(dictionary.id),rule:{...binding.rule,rootNodeId:root?.targetId??null}};
    if(!dictionaryMappings.some(item=>item.sourceId===origin.sourceId))dictionaryMappings.push({sourceId:origin.sourceId,sourceVersion:{kind:'template_snapshot',versionId:input.sourceTemplateVersionId,definitionHash:structureWriteHash(origin)},targetId:String(dictionary.id),nodes:mapping});
  }
  const installation:ReferenceFormPreview['installation']={sourceTemplateVersionId:input.sourceTemplateVersionId,sourceFormId:frozen.sourceId,sourceFormVersionId:frozen.sourceVersionId,sourceDefinitionHash:structureWriteHash(frozen.definition),previousFormVersionId:target?String(target.current_version_id):null,typeMappings,relationMappings,dictionaryMappings};definition.installation=installation;
  if(target)conflicts.push(...formEvolutionConflicts(target.definition,definition));
  const preservedInstanceCount=target?(await listRecordCards(client,"card_group_form_instance",{includeArchived:true})).filter(instance=>allTargetVersions.some(version=>String(version.id)===String(instance.form_version_id)&&String(version.form_id)===String(target.id))).length:0;
  const preview:ReferenceFormPreview={bookId,bookRevision:Number(book.revision),source:input,primaryTypeKey:primary,targetFormId:target?String(target.id):null,targetFormRevision:target?Number(target.revision):null,installation,definition,inputHash:structureWriteHash({bookId,bookRevision:book.revision,input,definition,targetRevision:target?.revision??null}),conflicts,canInstall:!conflicts.length,messages:['关联是写作使用规划；资源持有、当前位置与正式事实分别确认。',`保留 ${preservedInstanceCount} 个已有实例及全部挂载、局部填写与历史。`,input.setActive?'明确将此版本用于本书新建关联实例；已有实例仍保留原版本。':'保留本书原默认选择。'],preservedInstanceCount};
  return{book,payload,frozen,target,relations,preview};
}
export async function previewReferenceForm(bookId:string,input:ReferenceFormPreviewInput){const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const {preview}=await inspect(client,bookId,input);await client.query('COMMIT');return preview;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
export async function installReferenceForm(bookId:string,input:ReferenceFormInstallInput):Promise<ReferenceFormReceipt>{
  return executeBookFormWrite(bookId,input.requestKey,{command:'reference_form_install',bookId,...input},async client=>{
    const {previewHash,requestKey,...source}=input,{book,payload,frozen,target,relations,preview}=await inspect(client,bookId,source,true);
    if(preview.inputHash!==previewHash)throw new NewDesignError('书籍、表单或来源在预览后已改变，请重新预览。',409);if(!preview.canInstall)throw new NewDesignError(preview.conflicts.join(' '),422);
    for(const relation of relations)if(!relation.exists){const id=randomUUID(),rule=relation.definition;await client.query("INSERT INTO new_design.relation_types(id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status,source_relation_type_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'book',$10,$11::jsonb,'published',$12)",[id,relation.key,rule.name,rule.description,rule.direction,rule.sourceTypeKeys,rule.targetTypeKeys,rule.sourceMax,rule.targetMax,book.space_id,JSON.stringify(rule.propertiesSchema),relation.sourceId]);preview.installation.relationMappings.find(mapping=>mapping.targetId===relation.id)!.targetId=id;}
    for(const mapping of preview.installation.relationMappings){
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`state-relation:${book.space_id}:${mapping.targetKey}`]);
      if(!(await listRecordCards(client,'state_relation_capability',{where:{space_id:book.space_id,relation_key:mapping.targetKey}})).length){
        const id=randomUUID();await createRecordCard(client,{id,spaceId:String(book.space_id),typeKey:'state_relation_capability',title:mapping.targetKey,values:{id,space_id:book.space_id,relation_key:mapping.targetKey,settlement_capability:'disabled',state_mode:'none'}});
      }
    }
    const formId=target?String(target.id):randomUUID(),versionId=randomUUID(),version=target?Number(target.version)+1:1;
    if(!target)await createRecordCard(client,{id:formId,spaceId:String(book.space_id),typeKey:"card_group_form",title:frozen.name,values:{id:formId,space_id:book.space_id,form_key:`${frozen.key.slice(0,45)}_${formId.replaceAll('-','').slice(0,10)}`,name:frozen.name,description:frozen.description,status:"published",revision:1,draft_definition:preview.definition,is_system:false,source_form_id:frozen.sourceId,source_form_version_id:frozen.sourceVersionId,current_version_id:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    await createRecordCard(client,{id:versionId,spaceId:String(book.space_id),typeKey:"card_group_form_version",title:`${frozen.name} v${version}`,values:{id:versionId,form_id:formId,version,definition:preview.definition,created_at:new Date().toISOString()}});
    const base=target??assertFound(await findRecordCard(client,formId,"card_group_form",{spaceId:String(book.space_id),includeArchived:true}),"表单安装后未能读回。"),row=await replaceRecordCard(client,{id:formId,spaceId:String(book.space_id),typeKey:"card_group_form",title:frozen.name,values:{...base,current_version_id:versionId,draft_definition:preview.definition,source_form_version_id:frozen.sourceVersionId,revision:Number(base.revision)+(target?1:0),updated_at:new Date().toISOString()}});
    const installed=structuredClone(book.installed_payload as TemplatePayload);installed.activeForms??={};if(input.setActive)installed.activeForms[preview.primaryTypeKey]=versionId;
    const index=installed.forms.findIndex(form=>form.sourceId===frozen.sourceId);if(index<0)installed.forms.push(structuredClone(frozen));else installed.forms[index]=structuredClone(frozen);
    for(const mapping of preview.installation.relationMappings){const frozenRelation=payload.relationTypes.find(item=>item.sourceId===mapping.sourceId&&item.key===mapping.key)!;const relationIndex=installed.relationTypes.findIndex(item=>item.sourceId===mapping.sourceId);if(relationIndex<0)installed.relationTypes.push(structuredClone(frozenRelation));else installed.relationTypes[relationIndex]=structuredClone(frozenRelation);}
    await client.query("UPDATE new_design.books SET installed_payload=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[bookId,JSON.stringify(installed)]);
    return{...summary(row,version),installationResult:{bookId,bookRevision:Number(book.revision)+1,command:'install',formVersionId:versionId,active:installed.activeForms[preview.primaryTypeKey]===versionId,sourceTemplateVersionId:input.sourceTemplateVersionId}};
  });
}
export async function selectReferenceForm(bookId:string,input:ReferenceFormSelectionInput):Promise<ReferenceFormReceipt>{
  return executeBookFormWrite(bookId,input.requestKey,{command:'reference_form_select',bookId,...input},async client=>{
    const book=assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active' FOR UPDATE",[bookId])).rows[0],'书籍不存在。');if(Number(book.revision)!==input.expectedBookRevision)throw new NewDesignError('书籍已改变，请重新读取表单选择。',409);
    const selected=await findRecordCard(client,input.formVersionId,"card_group_form_version",{includeArchived:true}),form=selected?await findRecordCard(client,String(selected.form_id),"card_group_form",{spaceId:String(book.space_id),includeArchived:true,lock:true}):null,current=selected&&form?.current_version_id?await findRecordCard(client,String(form.current_version_id),"card_group_form_version",{includeArchived:true}):null,row=assertFound(selected&&form&&form.status==='published'?{...form,definition:selected.definition,version:selected.version,current_version:current?.version}:null,'所选表单版本不属于本书。');
    const installed=structuredClone(book.installed_payload as TemplatePayload);installed.activeForms??={};installed.activeForms[row.definition.primaryTypeKey]=input.formVersionId;
    await client.query("UPDATE new_design.books SET installed_payload=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[bookId,JSON.stringify(installed)]);
    return{...summary(row,Number(row.current_version)),installationResult:{bookId,bookRevision:Number(book.revision)+1,command:'select',formVersionId:input.formVersionId,active:true}};
  });
}
export async function readReferenceFormReceipt(bookId:string,input:ReferenceFormInstallInput|ReferenceFormSelectionInput,command:'reference_form_install'|'reference_form_select'){
  const saved=await readStructureWriteReceipt('form',input.requestKey);if(!saved)return null;if(saved.operation!=='save'||saved.inputHash!==structureWriteHash({kind:'form',operation:'save',input:{command,bookId,...input}}))throw new NewDesignError('原回执与本书完整冻结输入不一致。',409);return saved.result as ReferenceFormReceipt;
}

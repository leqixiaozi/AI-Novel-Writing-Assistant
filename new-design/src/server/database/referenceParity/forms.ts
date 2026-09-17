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

function summary(row:Record<string,unknown>,version:number):Omit<ReferenceFormReceipt,'installationResult'>{return{id:String(row.id),key:String(row.form_key),name:String(row.name),description:String(row.description??''),status:'published',revision:Number(row.revision),currentVersion:version,currentVersionId:String(row.current_version_id),draftDefinition:row.draft_definition as CardGroupFormDefinition,isSystem:Boolean(row.is_system),createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()};}
export async function getReferenceForms(bookId:string):Promise<ReferenceFormsWorkspace>{
  const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const book=assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],'书籍不存在。');
    const rows=(await client.query("SELECT form.*,version.definition FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id=$1 AND form.status='published' ORDER BY form.name",[book.space_id])).rows,forms:ReferenceFormsWorkspace['forms']=[];
    for(const row of rows){const versions=(await client.query("SELECT id,version,definition FROM new_design.card_group_form_versions WHERE form_id=$1 ORDER BY version DESC",[row.id])).rows;forms.push({id:String(row.id),name:String(row.name),revision:Number(row.revision),currentVersionId:String(row.current_version_id),primaryTypeKey:String(row.definition.primaryTypeKey),versions:versions.map(version=>({id:String(version.id),version:Number(version.version),definition:version.definition}))});}
    const sourceRows=(await client.query("SELECT id,version,payload FROM new_design.template_group_versions WHERE template_id=$1 ORDER BY version DESC",[book.template_id])).rows,sources:ReferenceFormsWorkspace['sources']=[];
    for(const row of sourceRows)for(const form of (row.payload as TemplatePayload).forms.filter(form=>['character','world_setting','world_rule'].includes(form.definition.primaryTypeKey)))sources.push({templateVersionId:String(row.id),templateVersion:Number(row.version),formId:form.sourceId,formVersionId:form.sourceVersionId,key:form.key,name:form.name,primaryTypeKey:form.definition.primaryTypeKey});
    const instances=(await client.query("SELECT instance.*,version.form_id FROM new_design.card_group_form_instances instance JOIN new_design.card_group_form_versions version ON version.id=instance.form_version_id WHERE instance.space_id=$1 ORDER BY instance.created_at",[book.space_id])).rows.map(row=>({id:String(row.id),primaryCardId:String(row.primary_card_id),formId:String(row.form_id),formVersionId:String(row.form_version_id),revision:Number(row.revision)}));
    const result={bookId,bookRevision:Number(book.revision),spaceId:String(book.space_id),templateId:String(book.template_id),activeForms:(book.installed_payload as TemplatePayload).activeForms??{},forms,sources,instances};await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function inspect(client:PoolClient,bookId:string,input:ReferenceFormPreviewInput,lock=false){
  const book=assertFound((await client.query(`SELECT * FROM new_design.books WHERE id=$1 AND status='active' ${lock?'FOR UPDATE':''}`,[bookId])).rows[0],'书籍不存在。');
  const source=assertFound((await client.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1 AND template_id=$2",[input.sourceTemplateVersionId,book.template_id])).rows[0],'所选来源不是本书模板的已发布版本。'),payload=source.payload as TemplatePayload;
  const frozen=assertFound(payload.forms.find(form=>form.sourceVersionId===input.sourceFormVersionId),'所选表单不在冻结模板版本中。');
  const actual=assertFound((await client.query("SELECT version.definition,version.form_id FROM new_design.card_group_form_versions version JOIN new_design.card_group_forms form ON form.id=version.form_id WHERE version.id=$1 AND form.space_id IS NULL AND form.status='published'",[frozen.sourceVersionId])).rows[0],'来源表单版本不可用。');
  if(String(actual.form_id)!==frozen.sourceId||structureWriteHash(actual.definition)!==structureWriteHash(frozen.definition))throw new NewDesignError('来源表单与冻结模板不一致，请核对实际来源。',409);
  const definition=structuredClone(frozen.definition),conflicts:string[]=[],primary=definition.primaryTypeKey;
  if(!['character','world_setting','world_rule'].includes(primary))conflicts.push('请选择实际人物或世界关联表单。');
  const types=(await client.query(`SELECT type.id,type.type_key,type.current_version_id,type.revision,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id=$1 AND type.status='published' ${lock?'FOR UPDATE OF type':''}`,[book.space_id])).rows;
  const usedKeys=[...new Set([primary,...formSlots(definition).flatMap(slot=>slot.allowedTypeKeys)])],typeMappings:ReferenceFormPreview['installation']['typeMappings']=[];
  for(const key of usedKeys){const origin=payload.cardTypes.find(type=>type.key===key),target=types.find(type=>type.type_key===key);if(!origin||!target){conflicts.push(`本书缺少已发布的“${key}”规格，需先明确安装内容类型。`);continue;}const version=(await client.query("SELECT fields,card_type_id FROM new_design.card_type_versions WHERE id=$1",[origin.sourceVersionId])).rows[0];if(!version||String(version.card_type_id)!==origin.sourceId||structureWriteHash(version.fields)!==structureWriteHash(origin.fields)){conflicts.push(`“${key}”的冻结类型来源不匹配。`);continue;}typeMappings.push({key,sourceId:origin.sourceId,sourceVersionId:origin.sourceVersionId,targetId:String(target.id),targetVersionId:String(target.current_version_id)});}
  const targetRows=(await client.query(`SELECT form.*,version.definition,version.version FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id=$1 AND ${input.targetFormId?'form.id=$2':'form.source_form_id=$2'} ${lock?'FOR UPDATE OF form':''}`,[book.space_id,input.targetFormId??frozen.sourceId])).rows;
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
    const binding=field.optionSource,origin=payload.dictionaries.find(dictionary=>dictionary.sourceId===binding.dictionaryId),dictionary=(await client.query("SELECT id FROM new_design.dictionary_definitions WHERE owner_space_id=$1 AND source_dictionary_id=$2 AND status='published'",[book.space_id,binding.dictionaryId])).rows[0];
    if(!origin||!dictionary){conflicts.push(`“${field.name}”的字典来源尚未安装，需先预览安装字典。`);continue;}
    const nodes=(await client.query("SELECT id,source_item_id,current_version_id FROM new_design.dictionary_items WHERE dictionary_id=$1 AND status='active' AND source_item_id IS NOT NULL",[dictionary.id])).rows,mapping=nodes.map(row=>({sourceId:String(row.source_item_id),targetId:String(row.id),targetVersionId:String(row.current_version_id)}));
    const root=binding.rule.rootNodeId?mapping.find(node=>node.sourceId===binding.rule.rootNodeId):null;if(binding.rule.rootNodeId&&!root){conflicts.push(`“${field.name}”的字典范围起点尚未安装。`);continue;}
    field.optionSource={...binding,dictionaryId:String(dictionary.id),rule:{...binding.rule,rootNodeId:root?.targetId??null}};
    if(!dictionaryMappings.some(item=>item.sourceId===origin.sourceId))dictionaryMappings.push({sourceId:origin.sourceId,sourceVersion:{kind:'template_snapshot',versionId:input.sourceTemplateVersionId,definitionHash:structureWriteHash(origin)},targetId:String(dictionary.id),nodes:mapping});
  }
  const installation:ReferenceFormPreview['installation']={sourceTemplateVersionId:input.sourceTemplateVersionId,sourceFormId:frozen.sourceId,sourceFormVersionId:frozen.sourceVersionId,sourceDefinitionHash:structureWriteHash(frozen.definition),previousFormVersionId:target?String(target.current_version_id):null,typeMappings,relationMappings,dictionaryMappings};definition.installation=installation;
  if(target)conflicts.push(...formEvolutionConflicts(target.definition,definition));
  const preservedInstanceCount=target?Number((await client.query("SELECT count(*) value FROM new_design.card_group_form_instances instance JOIN new_design.card_group_form_versions version ON version.id=instance.form_version_id WHERE version.form_id=$1",[target.id])).rows[0].value):0;
  const preview:ReferenceFormPreview={bookId,bookRevision:Number(book.revision),source:input,primaryTypeKey:primary,targetFormId:target?String(target.id):null,targetFormRevision:target?Number(target.revision):null,installation,definition,inputHash:structureWriteHash({bookId,bookRevision:book.revision,input,definition,targetRevision:target?.revision??null}),conflicts,canInstall:!conflicts.length,messages:['关联是写作使用规划；资源持有、当前位置与正式事实分别确认。',`保留 ${preservedInstanceCount} 个已有实例及全部挂载、局部填写与历史。`,input.setActive?'明确将此版本用于本书新建关联实例；已有实例仍保留原版本。':'保留本书原默认选择。'],preservedInstanceCount};
  return{book,payload,frozen,target,relations,preview};
}
export async function previewReferenceForm(bookId:string,input:ReferenceFormPreviewInput){const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const {preview}=await inspect(client,bookId,input);await client.query('COMMIT');return preview;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
export async function installReferenceForm(bookId:string,input:ReferenceFormInstallInput):Promise<ReferenceFormReceipt>{
  return executeBookFormWrite(bookId,input.requestKey,{command:'reference_form_install',bookId,...input},async client=>{
    const {previewHash,requestKey,...source}=input,{book,payload,frozen,target,relations,preview}=await inspect(client,bookId,source,true);
    if(preview.inputHash!==previewHash)throw new NewDesignError('书籍、表单或来源在预览后已改变，请重新预览。',409);if(!preview.canInstall)throw new NewDesignError(preview.conflicts.join(' '),422);
    for(const relation of relations)if(!relation.exists){const id=randomUUID(),rule=relation.definition;await client.query("INSERT INTO new_design.relation_types(id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status,source_relation_type_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'book',$10,$11::jsonb,'published',$12)",[id,relation.key,rule.name,rule.description,rule.direction,rule.sourceTypeKeys,rule.targetTypeKeys,rule.sourceMax,rule.targetMax,book.space_id,JSON.stringify(rule.propertiesSchema),relation.sourceId]);preview.installation.relationMappings.find(mapping=>mapping.targetId===relation.id)!.targetId=id;}
    for(const mapping of preview.installation.relationMappings)await client.query("INSERT INTO new_design.state_relation_capabilities(space_id,relation_key,settlement_capability,state_mode) VALUES($1,$2,'disabled','none') ON CONFLICT DO NOTHING",[book.space_id,mapping.targetKey]);
    const formId=target?String(target.id):randomUUID(),versionId=randomUUID(),version=target?Number(target.version)+1:1;
    if(!target)await client.query("INSERT INTO new_design.card_group_forms(id,space_id,form_key,name,description,status,revision,draft_definition,is_system,source_form_id,source_form_version_id) VALUES($1,$2,$3,$4,$5,'published',1,$6::jsonb,false,$7,$8)",[formId,book.space_id,`${frozen.key.slice(0,45)}_${formId.replaceAll('-','').slice(0,10)}`,frozen.name,frozen.description,JSON.stringify(preview.definition),frozen.sourceId,frozen.sourceVersionId]);
    await client.query("INSERT INTO new_design.card_group_form_versions(id,form_id,version,definition) VALUES($1,$2,$3,$4::jsonb)",[versionId,formId,version,JSON.stringify(preview.definition)]);
    const row=(await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2,draft_definition=$3::jsonb,source_form_version_id=$4,revision=revision+$5,updated_at=now() WHERE id=$1 RETURNING *",[formId,versionId,JSON.stringify(preview.definition),frozen.sourceVersionId,target?1:0])).rows[0];
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
    const row=assertFound((await client.query("SELECT form.*,version.definition,version.version,(SELECT version FROM new_design.card_group_form_versions WHERE id=form.current_version_id) current_version FROM new_design.card_group_form_versions version JOIN new_design.card_group_forms form ON form.id=version.form_id WHERE version.id=$1 AND form.space_id=$2 AND form.status='published' FOR UPDATE OF form",[input.formVersionId,book.space_id])).rows[0],'所选表单版本不属于本书。');
    const installed=structuredClone(book.installed_payload as TemplatePayload);installed.activeForms??={};installed.activeForms[row.definition.primaryTypeKey]=input.formVersionId;
    await client.query("UPDATE new_design.books SET installed_payload=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[bookId,JSON.stringify(installed)]);
    return{...summary(row,Number(row.current_version)),installationResult:{bookId,bookRevision:Number(book.revision)+1,command:'select',formVersionId:input.formVersionId,active:true}};
  });
}
export async function readReferenceFormReceipt(bookId:string,input:ReferenceFormInstallInput|ReferenceFormSelectionInput,command:'reference_form_install'|'reference_form_select'){
  const saved=await readStructureWriteReceipt('form',input.requestKey);if(!saved)return null;if(saved.operation!=='save'||saved.inputHash!==structureWriteHash({kind:'form',operation:'save',input:{command,bookId,...input}}))throw new NewDesignError('原回执与本书完整冻结输入不一致。',409);return saved.result as ReferenceFormReceipt;
}

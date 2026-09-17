import { randomUUID } from "node:crypto";
import {installNonSettlementFields} from "../referenceParity";
import {structureWriteHash} from "../structureWrites";
import {FieldWriteSession} from "./receipts";
import type { PoolClient } from "pg";
import type { AddInformationFieldInput, FieldDefinition, FieldExtensionPreview, ScopedFieldBundle, ScopedFieldDefinition, ScopedFieldVersion } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { validateFieldValue } from "../../domain/validation";
import { getNewDesignPool } from "../runtime";

const CORE_SPACE_ID="00000000-0000-4000-8000-000000000001";
type ScopeInput={cardTypeId:string;scope:"book_type"|"card"|"card_mount";cardId?:string|null;cardMountId?:string|null;field:AddInformationFieldInput};
type BookExtensionInput={cardTypeId:string;expectedTypeRevision:number;field:AddInformationFieldInput;backfillStrategy:"none"|"default";idempotencyKey:string;createdBy:string};
type LocalInput={expectedCardRevision:number;field:AddInformationFieldInput;initialValue?:unknown;idempotencyKey:string;createdBy:string};

function asDate(value:unknown){return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function slug(prefix:string){return `${prefix}_${randomUUID().replaceAll("-","")}`;}
function isBlank(value:unknown){return value===undefined||value===null||value===""||(Array.isArray(value)&&value.length===0);}

function mapVersion(row:Record<string,unknown>):ScopedFieldVersion{return{id:String(row.version_id),version:Number(row.version),field:row.field_schema as FieldDefinition,createdBy:String(row.version_created_by),createdAt:asDate(row.version_created_at)};}
function mapDefinition(row:Record<string,unknown>):ScopedFieldDefinition{return{
  id:String(row.id),spaceId:String(row.space_id),cardTypeId:row.card_type_id?String(row.card_type_id):null,cardId:row.card_id?String(row.card_id):null,cardMountId:row.card_mount_id?String(row.card_mount_id):null,
  fieldKey:String(row.field_key),origin:row.origin as ScopedFieldDefinition["origin"],scope:row.scope as ScopedFieldDefinition["scope"],status:row.status as ScopedFieldDefinition["status"],revision:Number(row.revision),
  sourceTemplateVersionId:row.source_template_version_id?String(row.source_template_version_id):null,sourceTypeVersionId:row.source_type_version_id?String(row.source_type_version_id):null,sourceFormVersionId:row.source_form_version_id?String(row.source_form_version_id):null,
  currentVersion:mapVersion(row),createdBy:String(row.created_by),createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at),
};}

async function getBookScope(client:PoolClient,bookId:string,cardTypeId:string,lock=false){
  const result=await client.query(`SELECT book.id book_id,book.space_id,type.id card_type_id,type.type_key,type.revision,type.current_version_id,type.draft_fields,version.version,version.fields
    FROM new_design.books book JOIN new_design.card_types type ON type.space_id=book.space_id JOIN new_design.card_type_versions version ON version.id=type.current_version_id
    WHERE book.id=$1 AND type.id=$2 AND type.status='published' ${lock?"FOR UPDATE OF book,type":""}`,[bookId,cardTypeId]);
  return assertFound(result.rows[0],"当前书籍没有这个内容类型。");
}

async function assertLocalTarget(client:PoolClient,bookId:string,input:ScopeInput){
  const scope=await getBookScope(client,bookId,input.cardTypeId);
  if(input.scope==="card"){
    const card=(await client.query("SELECT id FROM new_design.cards WHERE id=$1 AND space_id=$2 AND card_type_id=$3",[input.cardId,scope.space_id,input.cardTypeId])).rows[0];
    if(!card)throw new NewDesignError("当前资料不属于这本书或内容类型。",422);
  }
  if(input.scope==="card_mount"){
    const mount=(await client.query(`SELECT mount.id FROM new_design.card_mounts mount JOIN new_design.card_group_form_instances instance ON instance.id=mount.form_instance_id WHERE mount.id=$1 AND instance.space_id=$2`,[input.cardMountId,scope.space_id])).rows[0];
    if(!mount)throw new NewDesignError("当前关联不属于这本书。",422);
  }
  return scope;
}

export async function previewFieldExtension(bookId:string,input:ScopeInput):Promise<FieldExtensionPreview>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{
    const scope=await assertLocalTarget(client,bookId,input);
    const affected=input.scope==="book_type"?Number((await client.query("SELECT count(*) value FROM new_design.cards WHERE space_id=$1 AND card_type_id=$2 AND status='active'",[scope.space_id,input.cardTypeId])).rows[0]?.value??0):1;
    const requiredNeedsDefault=input.field.required&&affected>0&&isBlank(input.field.defaultValue);
    const messages=input.scope==="book_type"?[`将加入本书全部“${scope.type_key}”资料，现有 ${affected} 条。`]:input.scope==="card"?["只补充当前资料，不会改变其他同类资料。"]:["只补充当前关联，不会写入来源资料或其他引用位置。"];
    if(requiredNeedsDefault)messages.push("设为必填会影响已有资料，请先提供安全默认值；逐条补齐将在后续批次开放。");
    return{scope:input.scope,affectedCardCount:affected,requiredNeedsDefault,canApply:!requiredNeedsDefault,expectedTypeRevision:Number(scope.revision),messages};
  }finally{client.release();}
}

function buildField(input:AddInformationFieldInput,key:string):FieldDefinition{
  const options=input.options.map((option)=>{const id=option.id??randomUUID();return{id,value:`opt_${id.replaceAll("-","")}`,label:option.label};});
  let defaultValue=input.defaultValue;
  if((input.type==="select"||input.type==="multi_select")&&!isBlank(defaultValue)){
    const labels=Array.isArray(defaultValue)?defaultValue:[defaultValue];
    const mapped=labels.map((label)=>options.find((option)=>option.label===label||option.value===label)?.value).filter(Boolean) as string[];
    defaultValue=input.type==="select"?mapped[0]:mapped;
  }
  return{key,name:input.name,description:input.description,type:input.type,required:input.required,group:input.group,order:9000,options,defaultValue,visibleWhen:input.visibleWhen,aiSuggestible:input.aiSuggestible,stateSettlement:input.stateSettlement};
}

function normalizeOptionValue(field:FieldDefinition,value:unknown){
  if(field.type!=="select"&&field.type!=="multi_select")return value;
  const items=Array.isArray(value)?value:[value];const mapped=items.map((item)=>field.options.find((option)=>option.value===item||option.label===item)?.value).filter(Boolean) as string[];
  return field.type==="select"?mapped[0]:mapped;
}

async function findDefinition(client:PoolClient,id:string){
  const row=(await client.query(`SELECT definition.*,version.id version_id,version.version,version.field_schema,version.created_by version_created_by,version.created_at version_created_at
    FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id WHERE definition.id=$1`,[id])).rows[0];
  return row?mapDefinition(row):null;
}

export async function createBookFieldExtension(bookId:string,input:BookExtensionInput):Promise<ScopedFieldDefinition>{
  const pool=await getNewDesignPool();const client=await pool.connect();const write=new FieldWriteSession(client,bookId,"book_field_create",input.idempotencyKey,input);
  try{

    const repeated=await write.begin();if(repeated)return await write.commit(repeated);
    const scope=await getBookScope(client,bookId,input.cardTypeId,true);
    if(String(scope.space_id)===CORE_SPACE_ID)throw new NewDesignError("公共内容规格不能从书内表单改动。",422);
    if(Number(scope.revision)!==input.expectedTypeRevision)throw new NewDesignError("内容规格已更新，请刷新影响范围后重试。",409);
    if(structureWriteHash(scope.draft_fields)!==structureWriteHash(scope.fields))throw new NewDesignError("填写规格有未发布草稿，请先处理草稿后补充信息。",409);
    const affected=Number((await client.query("SELECT count(*) value FROM new_design.cards WHERE space_id=$1 AND card_type_id=$2 AND status='active'",[scope.space_id,input.cardTypeId])).rows[0]?.value??0);
    if(input.field.required&&affected>0&&(input.backfillStrategy!=="default"||isBlank(input.field.defaultValue)))throw new NewDesignError("已有同类资料时，必填字段必须提供安全默认值。",422,{defaultValue:"请提供安全默认值；逐条补齐将在后续开放。"});
    const key=slug("ext");const field=buildField({...input.field,options:input.field.options.map((option)=>({label:option.label}))},key);const defaultIssue=validateFieldValue(field,field.defaultValue);if(defaultIssue&&(!isBlank(field.defaultValue)||field.required))throw new NewDesignError("安全默认值与信息规格不兼容。",422,{defaultValue:defaultIssue});const nextFields=[...(scope.fields as FieldDefinition[]),field];
    const typeVersionId=randomUUID();const nextVersion=Number(scope.version)+1;
    await client.query("INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,$3,$4::jsonb)",[typeVersionId,input.cardTypeId,nextVersion,JSON.stringify(nextFields)]);
    await client.query("UPDATE new_design.card_types SET current_version_id=$2,draft_fields=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[input.cardTypeId,typeVersionId,JSON.stringify(nextFields)]);
    await installNonSettlementFields(client,String(scope.space_id),String(scope.type_key),[field]);
    const forms=await client.query(`SELECT form.*,version.definition,version.version form_version FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id=$1 AND form.status='published' AND version.definition->>'primaryTypeKey'=$2 FOR UPDATE OF form`,[scope.space_id,scope.type_key]);
    let sourceFormVersionId:string|null=null;
    for(const form of forms.rows){
      const nextId=randomUUID();const definition={...form.definition,fieldExtensions:[...(form.definition.fieldExtensions??[]),{fieldKey:key,group:field.group,order:field.order}]};
      await client.query("INSERT INTO new_design.card_group_form_versions(id,form_id,version,definition) VALUES($1,$2,$3,$4::jsonb)",[nextId,form.id,Number(form.form_version)+1,JSON.stringify(definition)]);
      await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2,draft_definition=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[form.id,nextId,JSON.stringify(definition)]);
      sourceFormVersionId??=nextId;
    }
    const definitionRow=assertFound((await client.query("SELECT id,current_version_id FROM new_design.field_definitions WHERE card_type_id=$1 AND field_key=$2",[input.cardTypeId,key])).rows[0],"新字段版本登记失败。");
    await client.query("UPDATE new_design.field_definitions SET source_form_version_id=COALESCE($2,source_form_version_id) WHERE id=$1",[definitionRow.id,sourceFormVersionId]);
    const result=assertFound(await findDefinition(client,String(definitionRow.id)),"新字段读取失败。");
    await write.record(result,{action:"create",expectedTypeRevision:input.expectedTypeRevision,createdBy:input.createdBy,impact:{affectedCardCount:affected,backfillStrategy:input.backfillStrategy}});
    return await write.commit(result);
  }catch(error){return await write.fail(error);}finally{client.release();}
}

async function insertOptions(client:PoolClient,definitionId:string,version:number,field:FieldDefinition,createdBy:string){
  for(const option of field.options){
    const id=option.id??randomUUID();const optionVersionId=randomUUID();
    await client.query("INSERT INTO new_design.field_option_definitions(id,field_definition_id,option_key,current_version_id) VALUES($1,$2,$3,NULL)",[id,definitionId,option.value]);
    await client.query("INSERT INTO new_design.field_option_versions(id,option_definition_id,version,label,created_by) VALUES($1,$2,$3,$4,$5)",[optionVersionId,id,version,option.label,createdBy]);
    await client.query("UPDATE new_design.field_option_definitions SET current_version_id=$2 WHERE id=$1",[id,optionVersionId]);
  }
}

async function reviseOptions(client:PoolClient,definitionId:string,version:number,field:FieldDefinition,createdBy:string){
  const existing=await client.query("SELECT id FROM new_design.field_option_definitions WHERE field_definition_id=$1 FOR UPDATE",[definitionId]);
  const existingIds=new Set(existing.rows.map((row)=>String(row.id)));const retained=new Set<string>();
  for(const option of field.options){
    const id=option.id??randomUUID();retained.add(id);const optionVersionId=randomUUID();
    if(!existingIds.has(id))await client.query("INSERT INTO new_design.field_option_definitions(id,field_definition_id,option_key,current_version_id) VALUES($1,$2,$3,NULL)",[id,definitionId,option.value]);
    await client.query("INSERT INTO new_design.field_option_versions(id,option_definition_id,version,label,created_by) VALUES($1,$2,$3,$4,$5)",[optionVersionId,id,version,option.label,createdBy]);
    await client.query("UPDATE new_design.field_option_definitions SET status='active',current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[id,optionVersionId]);
  }
  for(const id of existingIds)if(!retained.has(id))await client.query("UPDATE new_design.field_option_definitions SET status='archived',revision=revision+1,updated_at=now() WHERE id=$1",[id]);
}

async function copyCardVersion(client:PoolClient,card:Record<string,unknown>,createdBy:string,localDefinition?:{id:string;versionId:string;value:unknown}){
  const versionId=randomUUID();const nextRevision=Number(card.revision)+1;
  const provenance=(await client.query("SELECT form_version_id,form_resolution_kind FROM new_design.card_versions WHERE id=$1",[card.current_version_id])).rows[0];
  await client.query(`INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source,form_version_id,form_resolution_kind) VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit',$7,$8)`,[versionId,card.id,nextRevision,card.type_version_id,card.title,JSON.stringify(card.values),provenance?.form_version_id??null,provenance?.form_resolution_kind??"legacy"]);
  await client.query(`INSERT INTO new_design.card_version_local_values(card_version_id,field_definition_id,field_definition_version_id,value) SELECT $1,field_definition_id,field_definition_version_id,value FROM new_design.card_version_local_values WHERE card_version_id=$2`,[versionId,card.current_version_id]);
  if(localDefinition&&!isBlank(localDefinition.value))await client.query(`INSERT INTO new_design.card_version_local_values(card_version_id,field_definition_id,field_definition_version_id,value) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(card_version_id,field_definition_id) DO UPDATE SET field_definition_version_id=EXCLUDED.field_definition_version_id,value=EXCLUDED.value`,[versionId,localDefinition.id,localDefinition.versionId,JSON.stringify(localDefinition.value)]);
  await client.query("UPDATE new_design.cards SET revision=$2,current_version_id=$3,updated_at=now() WHERE id=$1",[card.id,nextRevision,versionId]);
  void createdBy;
}

export async function createCardLocalField(bookId:string,cardId:string,input:LocalInput):Promise<ScopedFieldDefinition>{
  const pool=await getNewDesignPool();const client=await pool.connect();const write=new FieldWriteSession(client,bookId,"card_field_create",input.idempotencyKey,{cardId,...input});
  try{
    const repeated=await write.begin();if(repeated)return await write.commit(repeated);
    const card=assertFound((await client.query(`SELECT card.* FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id WHERE card.id=$1 AND book.id=$2 FOR UPDATE OF card`,[cardId,bookId])).rows[0],"当前资料不属于这本书。");
    if(Number(card.revision)!==input.expectedCardRevision)throw new NewDesignError("当前资料已更新，请刷新后再添加。",409);
    const key=slug("local");const field=buildField({...input.field,defaultValue:undefined,options:input.field.options.map((option)=>({label:option.label}))},key);const value=normalizeOptionValue(field,input.initialValue);
    const valueIssue=validateFieldValue(field,value);if(valueIssue)throw new NewDesignError("请修正补充信息后再保存。",422,{initialValue:valueIssue});
    const definitionId=randomUUID(),versionId=randomUUID();
    await client.query(`INSERT INTO new_design.field_definitions(id,space_id,card_type_id,card_id,field_key,origin,scope,created_by) VALUES($1,$2,$3,$4,$5,'local_supplement','card',$6)`,[definitionId,card.space_id,card.card_type_id,card.id,key,input.createdBy]);
    await client.query("INSERT INTO new_design.field_definition_versions(id,field_definition_id,version,field_schema,created_by) VALUES($1,$2,1,$3::jsonb,$4)",[versionId,definitionId,JSON.stringify(field),input.createdBy]);
    await client.query("UPDATE new_design.field_definitions SET current_version_id=$2 WHERE id=$1",[definitionId,versionId]);await insertOptions(client,definitionId,1,field,input.createdBy);
    await copyCardVersion(client,card,input.createdBy,{id:definitionId,versionId,value});
    const result=assertFound(await findDefinition(client,definitionId),"补充信息读取失败。");
    await write.record(result,{action:"create",expectedSubjectRevision:input.expectedCardRevision,createdBy:input.createdBy,impact:{affectedCardCount:1}});
    return await write.commit(result);
  }catch(error){return await write.fail(error);}finally{client.release();}
}

export async function listScopedFields(bookId:string,cardTypeId:string,cardId?:string):Promise<ScopedFieldBundle>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{
    const scope=await getBookScope(client,bookId,cardTypeId);
    const result=await client.query(`SELECT definition.*,version.id version_id,version.version,version.field_schema,version.created_by version_created_by,version.created_at version_created_at
      FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id
      WHERE definition.space_id=$1 AND definition.card_type_id=$2 AND (definition.scope='book_type' OR (definition.scope='card' AND definition.card_id=$3)) ORDER BY CASE definition.origin WHEN 'core' THEN 1 WHEN 'template' THEN 2 WHEN 'book_extension' THEN 3 ELSE 4 END,version.field_schema->>'group',COALESCE((version.field_schema->>'order')::int,9999)`,[scope.space_id,cardTypeId,cardId??null]);
    const values:Record<string,unknown>={};
    if(cardId){const rows=await client.query(`SELECT definition.field_key,local.value FROM new_design.cards card JOIN new_design.card_version_local_values local ON local.card_version_id=card.current_version_id JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id WHERE card.id=$1 AND card.space_id=$2`,[cardId,scope.space_id]);for(const row of rows.rows)values[String(row.field_key)]=row.value;}
    return{definitions:result.rows.map(mapDefinition),values};
  }finally{client.release();}
}

export async function listScopedFieldHistory(bookId:string,fieldId:string):Promise<ScopedFieldVersion[]>{
  const pool=await getNewDesignPool();const result=await pool.query(`SELECT version.id version_id,version.version,version.field_schema,version.created_by version_created_by,version.created_at version_created_at FROM new_design.field_definition_versions version JOIN new_design.field_definitions definition ON definition.id=version.field_definition_id JOIN new_design.books book ON book.space_id=definition.space_id WHERE definition.id=$1 AND book.id=$2 ORDER BY version.version DESC`,[fieldId,bookId]);return result.rows.map(mapVersion);
}

export async function reviseCardLocalField(bookId:string,fieldId:string,input:{expectedRevision:number;field:AddInformationFieldInput;idempotencyKey:string;createdBy:string}):Promise<ScopedFieldDefinition>{
  const pool=await getNewDesignPool();const client=await pool.connect();const write=new FieldWriteSession(client,bookId,"card_field_revise",input.idempotencyKey,{fieldId,...input});
  try{const repeated=await write.begin();if(repeated)return await write.commit(repeated);
    const existing=assertFound((await client.query(`SELECT definition.*,version.field_schema FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id JOIN new_design.books book ON book.space_id=definition.space_id WHERE definition.id=$1 AND book.id=$2 FOR UPDATE OF definition`,[fieldId,bookId])).rows[0],"补充信息不存在。");
    if(existing.scope!=="card"||existing.origin!=="local_supplement")throw new NewDesignError("这里只能修改当前资料的补充信息。",422);if(Number(existing.revision)!==input.expectedRevision)throw new NewDesignError("补充信息已更新，请刷新后重试。",409);
    const previousField=existing.field_schema as FieldDefinition;if(previousField.type!==input.field.type)throw new NewDesignError("已保存的补充信息不能改变内容形式，请另建一项信息。",422,{type:"内容形式已固定。"});
    const ownedOptionIds=new Set((await client.query("SELECT id FROM new_design.field_option_definitions WHERE field_definition_id=$1",[fieldId])).rows.map((row)=>String(row.id)));
    if(input.field.options.some((option)=>option.id&&!ownedOptionIds.has(option.id)))throw new NewDesignError("可选内容身份不属于当前信息。",422,{options:"请刷新后再修改可选内容。"});
    const field=buildField({...input.field,defaultValue:undefined},String(existing.field_key));
    const currentValue=(await client.query(`SELECT local.value FROM new_design.cards card LEFT JOIN new_design.card_version_local_values local ON local.card_version_id=card.current_version_id AND local.field_definition_id=$1 WHERE card.id=$2`,[fieldId,existing.card_id])).rows[0]?.value;
    const valueIssue=validateFieldValue(field,currentValue);if(valueIssue)throw new NewDesignError("当前填写内容与修改后的规格不兼容。",422,{defaultValue:valueIssue});
    const nextVersion=Number(existing.revision)+1;const versionId=randomUUID();
    await client.query("INSERT INTO new_design.field_definition_versions(id,field_definition_id,version,field_schema,created_by) VALUES($1,$2,$3,$4::jsonb,$5)",[versionId,fieldId,nextVersion,JSON.stringify(field),input.createdBy]);
    await client.query("UPDATE new_design.field_definitions SET current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[fieldId,versionId]);
    await reviseOptions(client,fieldId,nextVersion,field,input.createdBy);
    const result=assertFound(await findDefinition(client,fieldId),"补充信息读取失败。");
    await write.record(result,{action:"revise",fromVersionId:String(existing.current_version_id),expectedSubjectRevision:input.expectedRevision,createdBy:input.createdBy});
    return await write.commit(result);
  }catch(error){return await write.fail(error);}finally{client.release();}
}

export async function archiveScopedField(bookId:string,fieldId:string,input:{expectedRevision:number;expectedTypeRevision?:number;idempotencyKey:string;createdBy:string}):Promise<ScopedFieldDefinition>{
  const pool=await getNewDesignPool();const client=await pool.connect();const write=new FieldWriteSession(client,bookId,"field_archive",input.idempotencyKey,{fieldId,...input});
  try{const repeated=await write.begin();if(repeated)return await write.commit(repeated);
    const existing=assertFound((await client.query(`SELECT definition.*,version.field_schema FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id JOIN new_design.books book ON book.space_id=definition.space_id WHERE definition.id=$1 AND book.id=$2 FOR UPDATE OF definition`,[fieldId,bookId])).rows[0],"字段不存在。");
    if(Number(existing.revision)!==input.expectedRevision)throw new NewDesignError("字段已更新，请刷新后重试。",409);if(existing.origin==="core")throw new NewDesignError("核心信息不能隐藏或归档。",422);if(existing.origin==="template"&&(existing.field_schema as FieldDefinition).required)throw new NewDesignError("必填的模板信息不能隐藏。",422);
    let toVersionId=String(existing.current_version_id);
    if(existing.scope==="book_type"){
      const type=assertFound((await client.query(`SELECT type.*,version.version type_version,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.id=$1 FOR UPDATE OF type`,[existing.card_type_id])).rows[0],"内容规格不存在。");
      if(input.expectedTypeRevision===undefined||Number(type.revision)!==input.expectedTypeRevision)throw new NewDesignError("内容规格已更新，请刷新后重试。",409);
      const fields=(type.fields as FieldDefinition[]).map((field)=>field.key===existing.field_key?{...field,hidden:true,required:false}:field);const typeVersionId=randomUUID();
      await client.query("INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,$3,$4::jsonb)",[typeVersionId,type.id,Number(type.type_version)+1,JSON.stringify(fields)]);
      await client.query("UPDATE new_design.card_types SET current_version_id=$2,draft_fields=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[type.id,typeVersionId,JSON.stringify(fields)]);
      const forms=await client.query(`SELECT form.id,form.revision,version.version,version.definition FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id=existing.space_id AND form.status='published' AND version.definition->>'primaryTypeKey'=$1 FOR UPDATE OF form`,[type.type_key]);
      for(const form of forms.rows){const formVersionId=randomUUID();const definition={...form.definition,archivedFieldKeys:[...new Set([...(form.definition.archivedFieldKeys??[]),existing.field_key])]};await client.query("INSERT INTO new_design.card_group_form_versions(id,form_id,version,definition) VALUES($1,$2,$3,$4::jsonb)",[formVersionId,form.id,Number(form.version)+1,JSON.stringify(definition)]);await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2,draft_definition=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[form.id,formVersionId,JSON.stringify(definition)]);}
      toVersionId=String((await client.query("SELECT current_version_id FROM new_design.field_definitions WHERE id=$1",[fieldId])).rows[0].current_version_id);
    }else{
      const nextVersion=Number(existing.revision)+1;toVersionId=randomUUID();const field={...(existing.field_schema as FieldDefinition),hidden:true,required:false};
      await client.query("INSERT INTO new_design.field_definition_versions(id,field_definition_id,version,field_schema,created_by) VALUES($1,$2,$3,$4::jsonb,$5)",[toVersionId,fieldId,nextVersion,JSON.stringify(field),input.createdBy]);
      await client.query("UPDATE new_design.field_definitions SET status='archived',current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[fieldId,toVersionId]);
    }
    const result=assertFound(await findDefinition(client,fieldId),"补充信息读取失败。");
    await write.record(result,{action:"archive",fromVersionId:String(existing.current_version_id),expectedSubjectRevision:input.expectedRevision,expectedTypeRevision:input.expectedTypeRevision,createdBy:input.createdBy});
    return await write.commit(result);
  }catch(error){return await write.fail(error);}finally{client.release();}
}

import {installNonSettlementFields} from "./fieldPolicies";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {CardGroupFormDefinition,FieldDefinition,TemplateGroupSummary} from "../../../common/contracts";
import {characterVisibleAdditions,characterFieldAdditions,type ReferenceSpecificationPreview,type ReferenceSpecificationPublishInput} from "../../../common/referenceParity";
import {NewDesignError,assertFound} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
import {executeStructureWrite,readStructureWriteReceipt,structureWriteHash} from "../structureWrites";
import type {TemplatePayload} from "../templateStore";

async function inspect(client:PoolClient,sourceTemplateVersionId:string,lock=false,kind:"profile"|"visible"="profile"){
  const template=assertFound((await client.query(`SELECT template.*,version.payload FROM new_design.template_group_versions version JOIN new_design.template_groups template ON template.id=version.template_id WHERE version.id=$1 ${lock?"FOR UPDATE OF template":""}`,[sourceTemplateVersionId])).rows[0],"请选择实际已发布的模板版本。");
  if(template.current_version_id!==sourceTemplateVersionId)throw new NewDesignError("模板已有新版本，请重新预览当前发布版本。",409);
  const payload=structuredClone(template.payload as TemplatePayload),type=assertFound(payload.cardTypes.find(item=>item.key==="character"),"这个模板没有人物规格。");
  const source=assertFound((await client.query(`SELECT type.*,version.fields,version.version FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.id=$1 AND type.space_id='00000000-0000-4000-8000-000000000001' AND type.status='published' ${lock?"FOR UPDATE OF type":""}`,[type.sourceId])).rows[0],"模板的人物来源不是可发布的公共规格。");
  const conflicts:string[]=[];
  if(source.current_version_id!==type.sourceVersionId||structureWriteHash(source.fields)!==structureWriteHash(type.fields))conflicts.push("模板快照与当前人物来源版本不同，请先明确选择对应的来源版本。");
  if(structureWriteHash(source.draft_fields)!==structureWriteHash(source.fields))conflicts.push("人物来源有未发布草稿，请先处理草稿后准备发布。");
  const diff=kind==="visible"?characterVisibleAdditions(type.fields):characterFieldAdditions(type.fields);conflicts.push(...diff.conflicts);
  const preview:ReferenceSpecificationPreview={...(kind==="visible"?{kind}:{}),sourceTemplateVersionId,templateId:String(template.id),templateRevision:Number(template.revision),inputHash:structureWriteHash({...(kind==="visible"?{kind}:{}),sourceTemplateVersionId,templateRevision:template.revision,payload,sourceRevision:source.revision,additions:diff.additions}),additions:diff.additions,conflicts,canPublish:!conflicts.length&&diff.additions.length>0};
  return{template,payload,type,source,preview};
}
export async function previewReferenceSpecification(sourceTemplateVersionId:string,kind:"profile"|"visible"="profile"){const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const {preview}=await inspect(client,sourceTemplateVersionId,false,kind);await client.query("COMMIT");return preview;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export async function publishReferenceSpecification(input:ReferenceSpecificationPublishInput):Promise<TemplateGroupSummary>{
  return executeStructureWrite("template","publish",input.requestKey,{command:"character_reference_specification",...input},async client=>{
    const {template,payload,type,source,preview}=await inspect(client,input.sourceTemplateVersionId,true,input.kind);
    if(preview.templateRevision!==input.templateRevision||preview.inputHash!==input.previewHash)throw new NewDesignError("来源规格或模板已改变，请重新预览。",409);
    if(!preview.canPublish)throw new NewDesignError(preview.conflicts.join(" ")||"人物字段已齐全，无需重复发布。",422);
    const fields=[...(source.fields as FieldDefinition[]),...preview.additions],typeVersionId=randomUUID();
    await client.query("INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,$3,$4::jsonb)",[typeVersionId,source.id,Number(source.version)+1,JSON.stringify(fields)]);
    await client.query("UPDATE new_design.card_types SET current_version_id=$2,draft_fields=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[source.id,typeVersionId,JSON.stringify(fields)]);
    await installNonSettlementFields(client,String(source.space_id),"character",preview.additions);
    type.fields=fields;type.sourceVersionId=typeVersionId;
    if(!payload.forms.some(item=>item.definition.primaryTypeKey==="character")){
      const formId=randomUUID(),formVersionId=randomUUID(),key=`character_reference_${formId.replaceAll("-","").slice(0,12)}`;
      const definition:CardGroupFormDefinition={primaryTypeKey:"character",fieldExtensions:preview.additions.map(field=>({fieldKey:field.key,group:field.group,order:field.order})),groups:[{key:"profile",name:"人物档案",order:0,sections:[{key:"profile",name:"档案与规划",order:0,slots:[{key:"character",name:"人物",kind:"primary_card",allowedTypeKeys:["character"],min:1,max:1,localFields:[]}]}]}]};
      await client.query("INSERT INTO new_design.card_group_forms(id,form_key,name,description,status,draft_definition,is_system) VALUES($1,$2,'人物档案','档案与规划分别填写。','published',$3::jsonb,false)",[formId,key,JSON.stringify(definition)]);
      await client.query("INSERT INTO new_design.card_group_form_versions(id,form_id,version,definition) VALUES($1,$2,1,$3::jsonb)",[formVersionId,formId,JSON.stringify(definition)]);
      await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2 WHERE id=$1",[formId,formVersionId]);
      payload.forms.push({sourceId:formId,sourceVersionId:formVersionId,key,name:"人物档案",description:"档案与规划分别填写。",definition});
    }
    for(const frozen of payload.forms.filter(item=>item.definition.primaryTypeKey==="character")){
      // A newly created form already includes these exact field extensions.
      if(preview.additions.every(field=>frozen.definition.fieldExtensions?.some(item=>item.fieldKey===field.key)))continue;
      const form=assertFound((await client.query(`SELECT form.*,version.version FROM new_design.card_group_forms form JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.id=$1 AND form.space_id IS NULL AND form.status='published' FOR UPDATE OF form`,[frozen.sourceId])).rows[0],"模板的公共人物表单已不可用。");
      if(form.current_version_id!==frozen.sourceVersionId||structureWriteHash(form.draft_definition)!==structureWriteHash(frozen.definition))throw new NewDesignError("人物表单来源或草稿已改变，请重新核对模板。",409);
      const definition={...frozen.definition,fieldExtensions:[...(frozen.definition.fieldExtensions??[]),...preview.additions.map(field=>({fieldKey:field.key,group:field.group,order:field.order}))]},versionId=randomUUID();
      await client.query("INSERT INTO new_design.card_group_form_versions(id,form_id,version,definition) VALUES($1,$2,$3,$4::jsonb)",[versionId,form.id,Number(form.version)+1,JSON.stringify(definition)]);
      await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2,draft_definition=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[form.id,versionId,JSON.stringify(definition)]);
      frozen.definition=definition;frozen.sourceVersionId=versionId;
    }
    const versionId=randomUUID(),version=Number((await client.query("SELECT COALESCE(max(version),0)+1 value FROM new_design.template_group_versions WHERE template_id=$1",[template.id])).rows[0].value);
    await client.query("INSERT INTO new_design.template_group_versions(id,template_id,version,payload) VALUES($1,$2,$3,$4::jsonb)",[versionId,template.id,version,JSON.stringify(payload)]);
    const row=(await client.query("UPDATE new_design.template_groups SET current_version_id=$2,revision=revision+1,status='published',updated_at=now() WHERE id=$1 RETURNING *",[template.id,versionId])).rows[0];
    return{id:String(row.id),key:String(row.template_key),name:String(row.name),description:String(row.description??""),status:"published",revision:Number(row.revision),currentVersion:version,currentVersionId:versionId,draftConfig:row.draft_config,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()};
  });
}

export async function readReferenceSpecificationReceipt(input:ReferenceSpecificationPublishInput){
  const saved=await readStructureWriteReceipt("template",input.requestKey);
  if(!saved)return null;
  if(saved.operation!=="publish"||saved.inputHash!==structureWriteHash({kind:"template",operation:"publish",input:{command:"character_reference_specification",...input}}))throw new NewDesignError("原凭证对应另一份发布输入，不能按当前模板确认。",409);
  return saved.result as TemplateGroupSummary;
}

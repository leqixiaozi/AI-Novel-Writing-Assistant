import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {TemplateGroupSummary} from "../../../common/contracts";
import {referenceAssociationDefinition,type ReferencePrimaryType,type ReferenceAssociationPublicationPreview,type ReferenceAssociationPublicationInput} from "../../../common/referenceParity";
import {NewDesignError,assertFound} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
import {executeStructureWrite,structureWriteHash} from "../structureWrites";
import type {TemplatePayload} from "../templateStore";

async function inspect(client:PoolClient,sourceTemplateVersionId:string,primaryTypeKeys:ReferencePrimaryType[],lock=false){
  const template=assertFound((await client.query(`SELECT template.*,version.payload FROM new_design.template_group_versions version JOIN new_design.template_groups template ON template.id=version.template_id WHERE version.id=$1 ${lock?"FOR UPDATE OF template":""}`,[sourceTemplateVersionId])).rows[0],"模板版本不存在。");
  if(template.current_version_id!==sourceTemplateVersionId)throw new NewDesignError("模板已有新版本，请重新选择当前发布版本。",409);
  const payload=structuredClone(template.payload as TemplatePayload),keys=payload.cardTypes.map(type=>type.key),available=(['character','world_setting','world_rule'] as const).filter(key=>keys.includes(key)),conflicts:string[]=[],forms:ReferenceAssociationPublicationPreview['forms']=[];
  if(new Set(primaryTypeKeys).size!==primaryTypeKeys.length||primaryTypeKeys.some(key=>!available.includes(key)))conflicts.push("请选择模板中实际已发布的主资料类型，不会自动改变旧书类型。");
  const existingRows:Record<string,unknown>[]=[];
  for(const primary of [...primaryTypeKeys].sort()){
    const key=`reference_${primary}_associations`,definition=referenceAssociationDefinition(primary,keys),name=primary==='character'?'人物关联资料':`世界使用范围 · ${payload.cardTypes.find(type=>type.key===primary)?.name??primary}`;
    const existing=(await client.query(`SELECT form.*,version.version,version.definition FROM new_design.card_group_forms form LEFT JOIN new_design.card_group_form_versions version ON version.id=form.current_version_id WHERE form.space_id IS NULL AND form.form_key=$1 ${lock?"FOR UPDATE OF form":""}`,[key])).rows[0];
    if(existing){existingRows.push(existing);if(existing.status!=='published'||structureWriteHash(existing.definition)!==structureWriteHash(definition)||structureWriteHash(existing.draft_definition)!==structureWriteHash(existing.definition))conflicts.push(`“${name}”已有不同规格或草稿，请明确处理，不能自动覆盖。`);}
    const frozen=payload.forms.find(form=>form.key===key);
    if(!frozen||structureWriteHash(frozen.definition)!==structureWriteHash(definition)||existing&&frozen.sourceVersionId!==existing.current_version_id)forms.push({key,name,definition});
  }
  const preview:ReferenceAssociationPublicationPreview={sourceTemplateVersionId,templateId:String(template.id),templateRevision:Number(template.revision),primaryTypeKeys:[...primaryTypeKeys],availablePrimaryTypeKeys:[...available],forms,conflicts,canPublish:!conflicts.length&&forms.length>0,inputHash:structureWriteHash({sourceTemplateVersionId,payload,templateRevision:template.revision,primaryTypeKeys,existingRows,forms})};
  return{template,payload,preview};
}
export async function previewReferenceAssociations(sourceTemplateVersionId:string,primaryTypeKeys:ReferencePrimaryType[]){const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const {preview}=await inspect(client,sourceTemplateVersionId,primaryTypeKeys);await client.query("COMMIT");return preview;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export async function publishReferenceAssociations(input:ReferenceAssociationPublicationInput):Promise<TemplateGroupSummary>{
  return executeStructureWrite("template","publish",input.requestKey,{command:"reference_association_template",...input},async client=>{
    const {template,payload,preview}=await inspect(client,input.sourceTemplateVersionId,input.primaryTypeKeys,true);
    if(input.previewHash!==preview.inputHash||input.templateRevision!==preview.templateRevision)throw new NewDesignError("模板或来源表单已改变，请重新预览。",409);
    if(!preview.canPublish)throw new NewDesignError(preview.conflicts.join(" ")||"所选关联表单已包含在模板中。",422);
    const templateVersionId=randomUUID();payload.defaultFormKeys??={};
    for(const prepared of preview.forms){
      let form=(await client.query("SELECT * FROM new_design.card_group_forms WHERE space_id IS NULL AND form_key=$1",[prepared.key])).rows[0];
      if(!form){const id=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.card_group_forms(id,form_key,name,description,status,draft_definition,is_system) VALUES($1,$2,$3,'关联资料与本书使用规划；正式事实分别确认。','published',$4::jsonb,false)",[id,prepared.key,prepared.name,JSON.stringify(prepared.definition)]);await client.query("INSERT INTO new_design.card_group_form_versions(id,form_id,version,definition) VALUES($1,$2,1,$3::jsonb)",[versionId,id,JSON.stringify(prepared.definition)]);form=(await client.query("UPDATE new_design.card_group_forms SET current_version_id=$2 WHERE id=$1 RETURNING *",[id,versionId])).rows[0];}
      const frozen={sourceId:String(form.id),sourceVersionId:String(form.current_version_id),key:prepared.key,name:prepared.name,description:String(form.description),definition:prepared.definition},index=payload.forms.findIndex(item=>item.key===prepared.key);if(index<0)payload.forms.push(frozen);else payload.forms[index]=frozen;
      payload.defaultFormKeys[prepared.definition.primaryTypeKey]=prepared.key;
      for(const slot of prepared.definition.groups.flatMap(group=>group.sections.flatMap(section=>section.slots)).filter(slot=>slot.kind==='card_reference')){
        const key=slot.relationTypeKey!,rule={key,name:slot.name,description:"仅为关联表单的写作引用，不建立持有、成员或当前位置事实。",direction:'directed' as const,sourceTypeKeys:[prepared.definition.primaryTypeKey],targetTypeKeys:slot.allowedTypeKeys,sourceMax:50,targetMax:null,propertiesSchema:[]};
        let relation=(await client.query("SELECT * FROM new_design.relation_types WHERE owner_space_id IS NULL AND relation_key=$1 FOR UPDATE",[key])).rows[0];
        if(relation&&(relation.status!=='published'||relation.direction!==rule.direction||structureWriteHash(relation.source_type_keys)!==structureWriteHash(rule.sourceTypeKeys)||structureWriteHash(relation.target_type_keys)!==structureWriteHash(rule.targetTypeKeys)||relation.source_max!==50||relation.target_max!==null||structureWriteHash(relation.properties_schema)!==structureWriteHash([])))throw new NewDesignError(`“${slot.name}”的公共关系规格不同，请先明确核对。`,409);
        if(!relation)relation=(await client.query("INSERT INTO new_design.relation_types(id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,properties_schema,status) VALUES($1,$2,$3,$4,'directed',$5,$6,50,NULL,'system','[]','published') RETURNING *",[randomUUID(),key,rule.name,rule.description,rule.sourceTypeKeys,rule.targetTypeKeys])).rows[0];
        const frozenRelation={sourceId:String(relation.id),...rule,statePolicy:{settlementCapability:"disabled" as const,stateMode:"none" as const},sourceRevision:Number(relation.revision),sourceVersion:{kind:'template_snapshot' as const,versionId:templateVersionId,definitionHash:structureWriteHash(rule)}};
        const index=payload.relationTypes.findIndex(item=>item.key===key);if(index<0)payload.relationTypes.push(frozenRelation);else payload.relationTypes[index]=frozenRelation;
        await client.query("INSERT INTO new_design.state_relation_capabilities(space_id,relation_key,settlement_capability,state_mode) VALUES('00000000-0000-4000-8000-000000000001',$1,'disabled','none') ON CONFLICT DO NOTHING",[key]);
      }
    }
    const version=Number((await client.query("SELECT COALESCE(max(version),0)+1 value FROM new_design.template_group_versions WHERE template_id=$1",[template.id])).rows[0].value);
    await client.query("INSERT INTO new_design.template_group_versions(id,template_id,version,payload) VALUES($1,$2,$3,$4::jsonb)",[templateVersionId,template.id,version,JSON.stringify(payload)]);
    const row=(await client.query("UPDATE new_design.template_groups SET current_version_id=$2,revision=revision+1,status='published',updated_at=now() WHERE id=$1 RETURNING *",[template.id,templateVersionId])).rows[0];
    return{id:String(row.id),key:String(row.template_key),name:String(row.name),description:String(row.description??''),status:'published',revision:Number(row.revision),currentVersion:version,currentVersionId:templateVersionId,draftConfig:row.draft_config,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()};
  });
}

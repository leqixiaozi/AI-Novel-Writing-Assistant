import {executeBookFormWrite} from "./receipts";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {CardGroupFormDefinition,ScopedFieldDefinition} from "../../../common/contracts";
import type {ReferenceInstanceUpgradeInput,ReferenceFormReceipt} from "../../../common/referenceParity";
import {NewDesignError,assertFound} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
import {executeStructureWrite,structureWriteHash,readStructureWriteReceipt} from "../structureWrites";
import {cloneLocalFieldOptions,installLocalFieldOptions} from "./localOptions";
import {formEvolutionConflicts,formSlots,relationDefinition} from "./formPolicy";
async function inspect(client:PoolClient,bookId:string,instanceId:string,targetFormVersionId:string,lock=false){
  const book=assertFound((await client.query(`SELECT * FROM new_design.books WHERE id=$1 AND status='active' ${lock?'FOR UPDATE':''}`,[bookId])).rows[0],'书籍不存在。');
  const instance=assertFound((await client.query(`SELECT instance.*,version.definition,version.form_id FROM new_design.card_group_form_instances instance JOIN new_design.card_group_form_versions version ON version.id=instance.form_version_id WHERE instance.id=$1 AND instance.space_id=$2 ${lock?'FOR UPDATE OF instance':''}`,[instanceId,book.space_id])).rows[0],'关联实例不属于本书。');
  const target=assertFound((await client.query(`SELECT form.*,version.definition,version.version FROM new_design.card_group_form_versions version JOIN new_design.card_group_forms form ON form.id=version.form_id WHERE version.id=$1 AND form.space_id=$2 AND form.status='published' ${lock?'FOR UPDATE OF form':''}`,[targetFormVersionId,book.space_id])).rows[0],'目标表单版本不属于本书。');
  const conflicts=formEvolutionConflicts(instance.definition as CardGroupFormDefinition,target.definition as CardGroupFormDefinition);
  if(String(instance.form_id)!==String(target.id))conflicts.push('升级须保留原表单身份；不同表单的实例分别保留。');if(String(instance.form_version_id)===targetFormVersionId)conflicts.push('此实例已使用所选版本。');
  for(const definition of [instance.definition,target.definition] as CardGroupFormDefinition[])for(const mapping of definition.installation?.relationMappings??[]){const actual=(await client.query(`SELECT * FROM new_design.relation_types WHERE id=$1 AND owner_space_id=$2 AND status='published' ${lock?'FOR UPDATE':''}`,[mapping.targetId,book.space_id])).rows[0];if(!actual||structureWriteHash(relationDefinition(actual))!==mapping.targetDefinitionHash)conflicts.push('已安装关系规格已改变，不能按原快照升级实例。');}
  const mounts=(await client.query(`SELECT * FROM new_design.card_mounts WHERE form_instance_id=$1 ORDER BY id ${lock?'FOR UPDATE':''}`,[instanceId])).rows;
  const preview={bookId,instanceId,targetFormVersionId,expectedInstanceRevision:Number(instance.revision),fromFormVersionId:String(instance.form_version_id),mountCount:mounts.filter(mount=>mount.status==='active').length,conflicts,canUpgrade:!conflicts.length,inputHash:structureWriteHash({bookId,bookRevision:book.revision,instanceId,targetFormVersionId,instanceRevision:instance.revision,sourceDefinition:instance.definition,targetDefinition:target.definition,mounts:mounts.map(mount=>({id:mount.id,revision:mount.revision,currentVersionId:mount.current_version_id,status:mount.status}))})};
  return{book,instance,target,mounts,preview};
}
export async function previewReferenceInstanceUpgrade(bookId:string,instanceId:string,targetFormVersionId:string){const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const {preview}=await inspect(client,bookId,instanceId,targetFormVersionId);await client.query('COMMIT');return preview;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
export async function upgradeReferenceInstance(bookId:string,input:ReferenceInstanceUpgradeInput):Promise<ReferenceFormReceipt>{
  return executeBookFormWrite(bookId,input.requestKey,{command:'reference_instance_upgrade',bookId,...input},async client=>{
    const {book,instance,target,mounts,preview}=await inspect(client,bookId,input.instanceId,input.targetFormVersionId,true);
    if(input.previewHash!==preview.inputHash||input.expectedInstanceRevision!==preview.expectedInstanceRevision)throw new NewDesignError('实例或挂载在预览后已改变，请重新预览。',409);if(!preview.canUpgrade)throw new NewDesignError(preview.conflicts.join(' '),422);
    for(const mount of mounts.filter(mount=>mount.status==='active')){
      const versionId=randomUUID(),revision=Number(mount.revision)+1;
      await client.query("INSERT INTO new_design.card_mount_versions(id,card_mount_id,revision,form_version_id,source_card_version_id,slot_key,card_id,sort_order,local_values,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'active','explicit_form_upgrade')",[versionId,mount.id,revision,input.targetFormVersionId,mount.source_card_version_id,mount.slot_key,mount.card_id,mount.sort_order,JSON.stringify(mount.local_values)]);
      await client.query('UPDATE new_design.card_mounts SET revision=$2,current_version_id=$3,updated_at=now() WHERE id=$1',[mount.id,revision,versionId]);
      const slot=formSlots(target.definition).find(slot=>slot.key===String(mount.slot_key));if(!slot)throw new NewDesignError('目标版本缺少原关联位置。',409);
      const primary=assertFound((await client.query('SELECT card_type_id FROM new_design.cards WHERE id=$1 AND space_id=$2',[instance.primary_card_id,book.space_id])).rows[0],'实例主资料不属于本书。');
      const existing=(await client.query('SELECT field_key FROM new_design.field_definitions WHERE card_mount_id=$1',[mount.id])).rows.map(row=>String(row.field_key));
      for(const [index,field] of slot.localFields.entries())if(!existing.includes(`slot_${field.key}`)){
        if(field.required)throw new NewDesignError('已有挂载不能新增必填局部字段。',409);
        const id=randomUUID(),fieldVersionId=randomUUID(),schema={...field,key:`slot_${field.key}`,description:field.description??'',group:field.group??'关联补充',order:field.order??index,options:cloneLocalFieldOptions(field.options??[]),defaultValue:field.defaultValue??null};
        await client.query("INSERT INTO new_design.field_definitions(id,space_id,card_type_id,card_mount_id,field_key,origin,scope,source_form_version_id,created_by) VALUES($1,$2,$3,$4,$5,'template','card_mount',$6,'explicit_form_upgrade')",[id,book.space_id,primary.card_type_id,mount.id,schema.key,input.targetFormVersionId]);
        await client.query("INSERT INTO new_design.field_definition_versions(id,field_definition_id,version,field_schema,created_by) VALUES($1,$2,1,$3::jsonb,'explicit_form_upgrade')",[fieldVersionId,id,JSON.stringify(schema)]);await client.query('UPDATE new_design.field_definitions SET current_version_id=$2 WHERE id=$1',[id,fieldVersionId]);await installLocalFieldOptions(client,id,schema,'explicit_form_upgrade');
      }
    }
    await client.query('UPDATE new_design.card_group_form_instances SET form_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',[input.instanceId,input.targetFormVersionId]);
    return{id:String(target.id),key:String(target.form_key),name:String(target.name),description:String(target.description),status:'published',revision:Number(target.revision),currentVersion:Number((await client.query('SELECT version FROM new_design.card_group_form_versions WHERE id=$1',[target.current_version_id])).rows[0].version),currentVersionId:String(target.current_version_id),draftDefinition:target.draft_definition,isSystem:Boolean(target.is_system),createdAt:new Date(target.created_at).toISOString(),updatedAt:new Date(target.updated_at).toISOString(),installationResult:{bookId,bookRevision:Number(book.revision),command:'instance_upgrade',formVersionId:input.targetFormVersionId,active:(book.installed_payload.activeForms??{})[target.definition.primaryTypeKey]===input.targetFormVersionId,instanceId:input.instanceId,instanceRevision:Number(instance.revision)+1}};
  });
}
export async function readReferenceInstanceUpgradeReceipt(bookId:string,input:ReferenceInstanceUpgradeInput){const saved=await readStructureWriteReceipt('form',input.requestKey);if(!saved)return null;if(saved.operation!=='save'||saved.inputHash!==structureWriteHash({kind:'form',operation:'save',input:{command:'reference_instance_upgrade',bookId,...input}}))throw new NewDesignError('原实例升级回执与完整输入不同。',409);return saved.result as ReferenceFormReceipt;}

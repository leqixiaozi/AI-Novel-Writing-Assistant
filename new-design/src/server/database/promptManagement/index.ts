import {createRecordCard,replaceRecordCard,requireRecordCard,listRecordCards} from "../recordCards";
import {recordWorkflowAction} from "../cardWorkflow";
import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {PROMPT_COMPONENT_RESOURCE_SPACE_ID as SPACE} from "../../../common/contracts";
import type {PromptCatalog,PromptClassificationInput,PromptSaveInput,PromptReorderInput} from "../../../common/promptManagement";
import {getMaterialManagementWorkspace,createMaterialGroup,reviseMaterialGroup,archiveMaterialGroup} from "../materialManagement";
import {createCard,getCard,getCardType,listCards,listCardTypes,listCardTypeVersions,updateCard} from "../store";
import {getNewDesignPool} from "../runtime";
import {NewDesignError,assertFound} from "../../domain/errors";
import {stableHash} from "../aiContracts";

async function categoryWrite<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){
    if(["23514","23503"].includes((error as {code?:string}).code??""))throw new NewDesignError("上级分类不可用：不能选择自身、自己的下级、其他资源空间或已归档分类。请修改右侧“上级分类”再保存。",422);
    throw error;
  }
}
export const createPromptCategory=(input:Parameters<typeof createMaterialGroup>[1])=>categoryWrite(()=>createMaterialGroup({spaceId:SPACE},input));
export const revisePromptCategory=(id:string,input:Parameters<typeof reviseMaterialGroup>[2])=>categoryWrite(()=>reviseMaterialGroup({spaceId:SPACE},id,input));
export const archivePromptCategory=(id:string,input:Parameters<typeof archiveMaterialGroup>[2])=>categoryWrite(()=>archiveMaterialGroup({spaceId:SPACE},id,input));

export async function savePrompt(input:PromptSaveInput){
  const pool=await getNewDesignPool(),client=await pool.connect();
  const hash=stableHash(input),lock=`prompt-save:${input.cardId??input.idempotencyKey}`;
  try{
    await client.query("SELECT pg_advisory_lock(hashtext($1))",[`prompt-save-key:${input.idempotencyKey}`]);
    await client.query("SELECT pg_advisory_lock(hashtext($1))",[lock]);
    const receipt=(await client.query("SELECT payload.* FROM new_design.card_version_actions action CROSS JOIN LATERAL jsonb_to_record(action.payload) AS payload(input_hash text,card_id uuid,card_version_id uuid) WHERE action.action_key='prompt.save' AND action.request_key=$1",[`prompt-command:${input.idempotencyKey}`])).rows[0];
    if(receipt){if(receipt.input_hash!==hash)throw new NewDesignError("保存请求标识已用于其他内容，请核对已保存组件。",409);const result=await getCard(String(receipt.card_id));if(result.title!==input.title||Object.entries(input.values).some(([field,value])=>stableHash(result.values[field])!==stableHash(value)))throw new NewDesignError("原保存已完成，但组件随后有其他编辑，请核对服务器内容。",409);return result;}
    const type=assertFound((await listCardTypes()).find(item=>item.key==="prompt_component"),"提示词内容类型未配置。");
    const current=input.cardId?await getCard(input.cardId):null;
    const currentScope=current?(await client.query("SELECT space_id FROM new_design.cards WHERE id=$1",[current.id])).rows[0]:null;
    if(current&&(currentScope?.space_id!==SPACE||current.cardTypeId!==type.id||current.status!=="active"))throw new NewDesignError("组件不属于提示词资源，或已归档。",422);
    const componentKey=current?.values.component_key??`pc_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0,24)}`;
    const defaults=Object.fromEntries((await listCardTypeVersions(type.id)).find(version=>version.id===type.currentVersionId)?.fields.map(field=>[field.key,field.defaultValue])??[]);
    const values:Record<string,unknown>={...defaults,...current?.values,component_key:componentKey,trust_level:current?.values.trust_level??"editor_trusted"};
    for(const key of Object.keys(input.values)){if(!["component_type","content","task_families","notes","enabled"].includes(key))throw new NewDesignError("只能编辑名称、内容、说明、适用任务、组件职责与启停。",422);values[key]=input.values[key];}
    const recovered=assertUnique((await listCards({spaceId:SPACE,cardTypeId:type.id,archived:false})).filter(card=>card.values.component_key===componentKey));
    let saved=current;
    const matches=recovered&&recovered.title===input.title&&stableHash(recovered.values)===stableHash(values);
    if(!current&&recovered&&!matches)throw new NewDesignError("原保存请求已有不同结果，请重读组件并核对。",409);
    if(current&&current.revision!==input.expectedRevision){if(current.revision!==Number(input.expectedRevision)+1||!matches)throw new NewDesignError("组件已被其他页面修改。当前编辑仍保留，请核对服务器内容后继续。",409);saved=current;}
    else saved=current?await updateCard(current.id,{title:input.title,values,revision:current.revision}):recovered??await createCard({cardTypeId:type.id,spaceId:SPACE,title:input.title,values});
    const result=assertFound(saved,"组件保存未获得结果。");
    const version=assertFound((await client.query("SELECT id FROM new_design.card_versions WHERE card_id=$1 AND revision=$2",[result.id,result.revision])).rows[0],"保存版本未获得回执。");
    await recordWorkflowAction(client,{cardId:result.id,cardVersionId:String(version.id),actionKey:"prompt.save",requestKey:`prompt-command:${input.idempotencyKey}`,inputHash:hash,payload:{idempotency_key:input.idempotencyKey,input_hash:hash,card_id:result.id,card_version_id:version.id}});
    return result;
  }finally{try{await client.query("SELECT pg_advisory_unlock(hashtext($1))",[lock]);}finally{try{await client.query("SELECT pg_advisory_unlock(hashtext($1))",[`prompt-save-key:${input.idempotencyKey}`]);}finally{client.release();}}}
}
function assertUnique<T>(items:T[]):T|undefined{if(items.length>1)throw new NewDesignError("组件稳定标识存在重复，请先核对原资料。",409);return items[0];}

export async function reorderPromptGroups(input:PromptReorderInput):Promise<PromptCatalog>{
  const pool=await getNewDesignPool(),client=await pool.connect(),hash=stableHash(input);
  try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`prompt-organization:${SPACE}`]);
    const event=(await client.query("SELECT payload->'detail' detail FROM new_design.card_version_actions WHERE action_key LIKE 'material.%' AND payload->>'space_id'=$1 AND payload->>'idempotency_key'=$2",[SPACE,input.idempotencyKey])).rows[0];
    if(event){if(event.detail.inputHash!==hash)throw new NewDesignError("排序请求标识已用于其他操作。",409);await client.query("COMMIT");return getPromptCatalog();}
    const heads=(await listRecordCards(client,"material_group",{spaceId:SPACE,where:{parent_id:input.parentId,status:"active"},lock:true})).sort((a,b)=>a.id.localeCompare(b.id)),siblings=[];
    for(const row of heads){const version=await requireRecordCard(client,String(row.current_version_id),"material_group_version","分类版本不存在。");siblings.push({...row,name:String(version.name),sort_order:Number(row.sort_order),parent_id:row.parent_id===null?null:String(row.parent_id)});}
    if(new Set(input.orderedIds).size!==siblings.length||input.orderedIds.length!==siblings.length||siblings.some(row=>!input.orderedIds.includes(String(row.id))||input.expectedRevisions[String(row.id)]!==Number(row.revision)))throw new NewDesignError("同级分类已更新，请重读分类并核对后再排序。",409);
    for(let i=0;i<input.orderedIds.length;i++){
      const row=siblings.find(row=>String(row.id)===input.orderedIds[i])!,order=(i+1)*1000;
      if(Number(row.sort_order)===order)continue;
      const revision=Number(row.revision)+1,versionId=randomUUID();
      await createRecordCard(client,{id:versionId,spaceId:SPACE,typeKey:"material_group_version",title:String(row.name),values:{id:versionId,group_id:row.id,version:revision,name:row.name,parent_id:row.parent_id,sort_order:order,status:"active",created_by:"user"}});
      await replaceRecordCard(client,{id:row.recordCardId,spaceId:SPACE,typeKey:"material_group",values:{...row,sort_order:order,revision,current_version_id:versionId,updated_at:new Date().toISOString()}});
      await client.query("SELECT new_design.register_dependency_resource('material_group_version',$1,$2)",[row.id,versionId]);
    }
    await recordWorkflowAction(client,{cardId:assertFound(siblings.find(row=>row.id===input.orderedIds[0]),"没有可排序的分类。").recordCardId,actionKey:"material.group.reorder",payload:{space_id:SPACE,book_id:null,subject_kind:"group",subject_id:input.orderedIds[0],action:"reorder",detail:{inputHash:hash,organizationOnly:true,orderedIds:input.orderedIds},idempotency_key:input.idempotencyKey,created_by:"user"}});
    await client.query("COMMIT");return getPromptCatalog();
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function getPromptCatalog():Promise<PromptCatalog>{
  const type=assertFound((await listCardTypes()).find(item=>item.key==="prompt_component"),"提示词内容规格不存在。");
  const [organization,components,versions,primary]=await Promise.all([
    getMaterialManagementWorkspace({spaceId:SPACE}),listCards({spaceId:SPACE,cardTypeId:type.id,archived:false}),listCardTypeVersions(type.id),
    (async()=>{const pool=await getNewDesignPool(),groups=new Set((await listRecordCards(pool,"material_group",{spaceId:SPACE,where:{status:"active"}})).map(row=>row.id));return{rows:(await listRecordCards(pool,"material_group_membership",{spaceId:SPACE,where:{status:"active",is_primary:true}})).filter(row=>groups.has(String(row.group_id)))};})(),
  ]);
  const fields=assertFound(versions.find(version=>version.id===type.currentVersionId),"提示词发布规格未读取，请重试读取提示词。").fields;
  return {organization,type:await getCardType(type.id),fields,components,primaryGroups:Object.fromEntries(primary.rows.map(row=>[String(row.card_id),String(row.group_id)]))};
}

async function versionMembership(client:PoolClient,row:Record<string,unknown>,primary:boolean,status:"active"|"ended"){
  const member=await requireRecordCard(client,String(row.id),"material_group_membership","分类关联不存在。",{lock:true}),group=await requireRecordCard(client,String(member.group_id),"material_group","分类不存在。"),card=assertFound((await client.query("SELECT current_version_id FROM new_design.cards WHERE id=$1",[member.card_id])).rows[0],"组件不存在。");
  const versionId=randomUUID(),revision=Number(row.revision)+1;
  await createRecordCard(client,{id:versionId,spaceId:SPACE,typeKey:"material_group_membership_version",title:"提示词分类版本",values:{id:versionId,membership_id:member.id,revision,group_version_id:group.current_version_id,card_version_id:card.current_version_id,sort_order:member.sort_order,status,created_by:"user",is_primary:primary}});
  await replaceRecordCard(client,{id:member.recordCardId,spaceId:SPACE,typeKey:"material_group_membership",values:{...member,is_primary:primary,status,revision,current_version_id:versionId,updated_at:new Date().toISOString()}});
}

export async function classifyPrompt(cardId:string,input:PromptClassificationInput):Promise<PromptCatalog>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  const hash=createHash("sha256").update(JSON.stringify({cardId,...input})).digest("hex");
  try{
    await client.query("BEGIN");
    // Serialize organization commands; generic card edits additionally serialize on the card lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`prompt-organization:${SPACE}`]);
    const event=(await client.query("SELECT payload->'detail' detail FROM new_design.card_version_actions WHERE action_key LIKE 'material.%' AND payload->>'space_id'=$1 AND payload->>'idempotency_key'=$2",[SPACE,input.idempotencyKey])).rows[0];
    if(event){if(event.detail.inputHash!==hash)throw new NewDesignError("请求标识已用于其他分类操作，请核对原结果。",409);await client.query("COMMIT");return getPromptCatalog();}
    const card=assertFound((await client.query(`SELECT card.* FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1 AND card.space_id=$2 AND type.type_key='prompt_component' AND card.status='active' FOR UPDATE OF card`,[cardId,SPACE])).rows[0],"组件不属于提示词资源，或已归档。");
    const group=assertFound((await listRecordCards(client,"material_group",{spaceId:SPACE,where:{id:input.groupId,status:"active"},lock:true}))[0],"分类不存在或已归档。");
    if(Number(card.revision)!==input.expectedCardRevision||Number(group.revision)!==input.expectedGroupRevision)throw new NewDesignError("组件或分类已更新，请重读提示词并核对后再移动；编辑正文仍保留。",409);
    const members=(await listRecordCards(client,"material_group_membership",{where:{card_id:cardId,status:"active"},lock:true})).sort((a,b)=>a.id.localeCompare(b.id));
    for(const member of members.filter(member=>member.is_primary&&String(member.group_id)!==input.groupId))await versionMembership(client,member,false,"ended");
    const selected=members.find(member=>String(member.group_id)===input.groupId);
    if(selected&&!selected.is_primary)await versionMembership(client,selected,true,"active");
    if(!selected){const id=randomUUID();await createRecordCard(client,{id,spaceId:SPACE,typeKey:"material_group_membership",title:"提示词分类",values:{id,space_id:SPACE,group_id:input.groupId,card_id:cardId,revision:1,is_primary:false,status:"active",sort_order:1000,current_version_id:null,created_by:"user"}});await versionMembership(client,{id,revision:0},true,"active");}
    await recordWorkflowAction(client,{cardId,actionKey:"material.group_membership.move",payload:{space_id:SPACE,book_id:null,subject_kind:"group_membership",subject_id:cardId,action:"move",detail:{promptClassification:true,inputHash:hash,groupId:input.groupId,organizationOnly:true},idempotency_key:input.idempotencyKey,created_by:"user"}});
    await client.query("COMMIT");
    return getPromptCatalog();
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

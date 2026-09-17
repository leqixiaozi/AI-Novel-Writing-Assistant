import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { COMPOSITION_ROUTE,type CompositionDebugPreview,type DebugPreviewInput } from "../../../common/promptComposition";
import type { AiRuntimeRecovery } from "../../../common/aiRuntime";
import { NewDesignError,assertFound } from "../../domain/errors";
import { stableHash } from "../aiContracts";
import { captureManagedModelSnapshot,resolveManagedTaskRoute,getManagedCredentialEnvironment } from "../modelManagement";
import { database,iso,lock,type CompositionDatabaseContext } from "./database";
import { loadCompositionRecipeVersion } from "./recipes";
import type { DebugFrozenPlan,DebugPreviewBundle } from "./contracts";
import {compositionFrozenReferences} from "./knowledge";

type Row=Record<string,any>;
export const DEBUG_KIND="prompt_composition_debug";
const identitySchema=z.object({recipeId:z.string().uuid(),recipeVersionId:z.string().uuid(),idempotencyKey:z.string().trim().min(8).max(160)});
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
export const frozenHash=(plan:DebugFrozenPlan,inputHash:string)=>stableHash({format:1,plan,inputHash});
export function previewFromRow(row:Row,taskId:string|null=null):CompositionDebugPreview {
  const plan=row.prompt_plan as DebugFrozenPlan;
  return {id:row.id,recipeId:plan.recipe.id,recipeVersionId:row.prompt_recipe_version_id,recipeVersion:plan.recipeVersion,taskType:plan.recipe.taskType,bookId:row.book_id,revision:Number(row.revision),status:row.status,messages:plan.messages,outputSchema:plan.outputSchema,assetId:plan.assetId,assetVersion:plan.assetVersion,previewHash:row.preview_hash,components:plan.components.map(({cardId,versionId,title,enabled})=>({cardId,versionId,title,enabled})),sources:plan.sources.map(({cardId,versionId,title,role})=>({cardId,versionId,title,role})),...(plan.knowledgeSources?.length?{knowledgeSources:plan.knowledgeSources.map(({assetId,sourceVersionId,parsedVersionId,checksum,title,segment})=>({assetId,sourceVersionId,parsedVersionId,checksum,title,...(segment?{segment}:{})}))}:{}),variables:plan.variables,route:plan.route,recovery:plan.recovery,blockers:plan.blockers,estimatedInputUnits:plan.estimatedInputUnits,taskId,createdAt:iso(row.created_at)};
}
export async function readPreviewRow(client:PoolClient,id:string):Promise<Row>{
  return assertFound((await client.query("SELECT preview.*,submission.ai_task_id FROM new_design.ai_run_previews preview LEFT JOIN new_design.ai_run_submissions submission ON submission.preview_id=preview.id WHERE preview.id=$1 AND preview.source_kind=$2",[id,DEBUG_KIND])).rows[0],"组合预览不存在，请重新读取组合后生成预览。");
}
export async function readDebugPreview(id:string,context?:CompositionDatabaseContext):Promise<CompositionDebugPreview>{
  z.string().uuid().parse(id);return database(context,async client=>{const row=await readPreviewRow(client,id);return previewFromRow(row,row.ai_task_id??null);});
}
export async function readDebugPreviewByRequest(key:string,context?:CompositionDatabaseContext):Promise<CompositionDebugPreview|null>{
  z.string().trim().min(8).max(160).parse(key);
  return database(context,async client=>{await lock(client,`preview-key:${key}`);const rows=(await client.query("SELECT preview.*,submission.ai_task_id FROM new_design.ai_run_previews preview LEFT JOIN new_design.ai_run_submissions submission ON submission.preview_id=preview.id WHERE preview.idempotency_key=$1 AND preview.source_kind=$2",[key,DEBUG_KIND])).rows;if(rows.length>1)throw new NewDesignError("组合预览请求标识出现多条结果，请到运行维护核对，不要再次试运行。",409);return rows[0]?previewFromRow(rows[0],rows[0].ai_task_id??null):null;},true);
}
function validateBundle(bundle:DebugPreviewBundle,input:DebugPreviewInput):void {
  identitySchema.parse(input);
  if(bundle.recipe.id!==input.recipeId||bundle.recipe.versionId!==input.recipeVersionId||!bundle.recipe.context.bookId)throw new NewDesignError("生成预览必须使用已保存的精确组合版本，并明确选择现有书籍。",422);
  if(!object(bundle.taskInput)||!object(bundle.inputSchema)||bundle.inputSchema.type!=="object"||!Object.hasOwn(bundle.inputSchema,"const")||stableHash(bundle.inputSchema.const)!==stableHash(bundle.taskInput))throw new NewDesignError("本次任务缺少已校验输入的真值冻结合同。",422);
  if(!object(bundle.outputSchema)||Object.keys(bundle.outputSchema).length===0||!bundle.assetId||!bundle.assetVersion||!bundle.contextPolicy||!bundle.messages.length||bundle.messages.some(message=>!["system","user"].includes(message.role)||typeof message.content!=="string"))throw new NewDesignError("预览缺少受控资产、消息或真实输出规格。",422);
  if(!Number.isInteger(bundle.estimatedInputUnits)||bundle.estimatedInputUnits<0||!Number.isInteger(bundle.maxTokens)||bundle.maxTokens<1||!Number.isFinite(bundle.temperature))throw new NewDesignError("预览估算或受控生成参数无效。",422);
  const variables=bundle.recipe.variables;
  if(Object.keys(input.variableValues).some(key=>!variables.some(item=>item.key===key)))throw new NewDesignError("变量值包含此版本未声明的变量，请重新读取组合。",422);
  const expected=variables.map(item=>({label:item.label,value:input.variableValues[item.key]??item.defaultValue}));
  for(const [index,entry]of expected.entries()){const definition=variables[index]!;if(definition.type==="number"?(typeof entry.value!=="number"||!Number.isFinite(entry.value)):definition.type==="boolean"?typeof entry.value!=="boolean":typeof entry.value!=="string"||definition.type==="select"&&!definition.options.includes(String(entry.value)))throw new NewDesignError(`变量“${definition.label}”的值不符合保存版本的规格。`,422);}
  if(input.parameters.instruction.trim()&&["directions","initial_content"].includes(bundle.recipe.taskType))expected.push({label:"本次要求",value:input.parameters.instruction});
  if(stableHash(expected)!==stableHash(bundle.variables))throw new NewDesignError("冻结变量与本次请求不一致，请重新生成预览。",422);
}
async function freezeTaskContract(client:PoolClient,bundle:DebugPreviewBundle):Promise<string>{
  const key=`prompt_composition_${bundle.recipe.id}_${bundle.recipe.taskType}`;
  await lock(client,`contract:${key}`);
  let config=(await client.query("SELECT * FROM new_design.task_contracts WHERE task_key=$1 FOR UPDATE",[key])).rows[0];
  if(!config)config=(await client.query("INSERT INTO new_design.task_contracts(id,task_key,name,description) VALUES($1,$2,$3,'组合调试受控输入与输出合同；不采用正本') RETURNING *",[randomUUID(),key,`${bundle.recipe.name} · 调试合同`])).rows[0];
  if(config.status!=="active")throw new NewDesignError("此组合调试合同已归档，请到运行维护核对。",409);
  const contract={taskKey:key,taskGroup:"prompt_composition_debug",inputSchema:bundle.inputSchema,outputSchema:bundle.outputSchema,inputSchemaVersion:stableHash(bundle.inputSchema),outputSchemaVersion:stableHash(bundle.outputSchema),contextPolicy:bundle.contextPolicy,recipeVersionId:bundle.recipe.versionId,assetId:bundle.assetId,assetVersion:bundle.assetVersion,maxTokens:bundle.maxTokens,temperature:bundle.temperature};
  const hash=stableHash(contract);
  if(config.published_version_id){const current=(await client.query("SELECT * FROM new_design.task_contract_versions WHERE id=$1 AND contract_id=$2",[config.published_version_id,config.id])).rows[0];if(current?.status==="published"&&current.content_hash===hash)return current.id;}
  const number=Number((await client.query("SELECT COALESCE(max(version),0)+1 AS version FROM new_design.task_contract_versions WHERE contract_id=$1",[config.id])).rows[0].version),id=randomUUID();
  await client.query("INSERT INTO new_design.task_contract_versions(id,contract_id,version,base_version_id,source,status,task_group,input_schema,input_schema_version,output_schema,output_schema_version,context_policy_version,prompt_recipe_version_id,required_capabilities,budget_policy,timeout_ms,retry_policy,confirmation_policy,content_hash,created_by) VALUES($1,$2,$3,$4,'system','draft','prompt_composition_debug',$5::jsonb,$6,$7::jsonb,$8,$9,$10,ARRAY['structured_output'],$11::jsonb,120000,'{\"maxAttempts\":1,\"automaticRetry\":false}'::jsonb,'before_execute',$12,'prompt_composition')",[id,config.id,number,config.current_version_id,JSON.stringify(bundle.inputSchema),contract.inputSchemaVersion,JSON.stringify(bundle.outputSchema),contract.outputSchemaVersion,bundle.contextPolicy,bundle.recipe.versionId,JSON.stringify({maxOutputTokens:bundle.maxTokens,assetId:bundle.assetId,assetVersion:bundle.assetVersion,temperature:bundle.temperature}),hash]);
  if(config.published_version_id)await client.query("UPDATE new_design.task_contract_versions SET status='superseded' WHERE id=$1",[config.published_version_id]);
  await client.query("UPDATE new_design.task_contract_versions SET status='published' WHERE id=$1",[id]);
  const revision=Number(config.revision)+1;
  await client.query("UPDATE new_design.task_contracts SET current_version_id=$2,published_version_id=$2,revision=$3,updated_at=now() WHERE id=$1",[config.id,id,revision]);
  await client.query("INSERT INTO new_design.ai_contract_publications(id,entity_kind,entity_id,from_version_id,to_version_id,entity_revision,action,actor,idempotency_key) VALUES($1,'task_contract',$2,$3,$4,$5,'publish','prompt_composition',$6)",[randomUUID(),config.id,config.published_version_id,id,revision,`composition_contract_${id}`]);
  return id;
}
async function freezeContext(client:PoolClient,bundle:DebugPreviewBundle,contractId:string,snapshotId:string|null):Promise<string>{
  const id=randomUUID(),references=compositionFrozenReferences(bundle);
  const entries=[];
  for(const reference of references){if(reference.kind==="asset_version"&&"checksum" in reference){const version=assertFound((await client.query("SELECT version.version,asset.space_id FROM new_design.asset_versions version JOIN new_design.assets asset ON asset.id=version.asset_id WHERE version.id=$1 AND asset.id=$2 AND version.book_id=$3 AND asset.book_id=$3",[reference.versionId,reference.cardId,bundle.recipe.context.bookId])).rows[0],"冻结知识上下文时精确解析版本未读取。");entries.push({reference,spaceId:version.space_id,revision:Number(version.version),hash:reference.checksum});}else{const version=assertFound((await client.query("SELECT version.*,card.space_id FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id WHERE version.id=$1 AND card.id=$2",[reference.versionId,reference.cardId])).rows[0],"冻结上下文时精确版本未读取。");entries.push({reference,spaceId:version.space_id,revision:Number(version.revision),hash:stableHash({revision:version.revision,typeVersionId:version.type_version_id,title:version.title,values:version.values})});}}
  const manifestHash=stableHash({bookId:bundle.recipe.context.bookId,recipeVersionId:bundle.recipe.versionId,entries}),sourceSetHash=stableHash(entries);
  await client.query("INSERT INTO new_design.context_manifests(id,book_id,task_contract_version_id,prompt_recipe_version_id,node_key,status,manifest_hash,created_by,task_group,model_route_snapshot_id,source_set_hash,decision_summary) VALUES($1,$2,$3,$4,'prompt_composition_debug','complete',$5,'prompt_composition','prompt_composition_debug',$6,$7,$8::jsonb)",[id,bundle.recipe.context.bookId,contractId,bundle.recipe.versionId,manifestHash,snapshotId,sourceSetHash,JSON.stringify({selection:"explicit_exact_versions",trust:"user_data_only"})]);
  for(const [index,key]of ["author_additions","explicit_context"].entries()){
    const slotId=randomUUID();await client.query("INSERT INTO new_design.context_manifest_slots(id,manifest_id,slot_key,sort_order,required,token_budget) VALUES($1,$2,$3,$4,false,NULL)",[slotId,id,key,index]);
    const selected=entries.filter(item=>key==="author_additions"?item.reference.kind==="prompt_component":item.reference.kind!=="prompt_component");
    for(const [order,item]of selected.entries()){
      const segment="segment" in item.reference?item.reference.segment:undefined;
      await client.query("INSERT INTO new_design.context_manifest_entries(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,source_space_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order,source_revision,content_role,layer_label,knowledge_segment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'作者明确选定的精确版本，不提升指令信任',0,$9,'full',$10,$11,$12,$13,$14::jsonb)",[randomUUID(),id,slotId,item.reference.kind,item.reference.cardId,item.reference.versionId,item.spaceId,item.hash,Math.ceil(JSON.stringify(item.reference).length/4),order,item.revision,item.reference.role==="formal"?"required":"reference",key==="author_additions"?"普通组件补充":"明确参考资料",segment?JSON.stringify(segment):null]);
    }
  }
  for(const source of bundle.knowledgeSources??[]){
    if(!source.segment)continue;
    const resource=assertFound((await client.query("SELECT resource.id,resource.space_id FROM new_design.dependency_resources resource JOIN new_design.dependency_resource_states state ON state.resource_id=resource.id AND state.book_id=resource.book_id AND state.state IN ('fresh','recomputed') WHERE resource.resource_kind='embedding_chunk' AND resource.book_id=$1 AND resource.stable_object_id=$2 AND resource.exact_version_id=$2 FOR SHARE OF state",[bundle.recipe.context.bookId,source.segment.chunkId])).rows[0],"选中的原知识分块已失效或缺少有效状态，不能冻结为可执行预览。");
    const manifestResource=String((await client.query("SELECT new_design.register_dependency_resource('context_manifest',$1,$1) id",[id])).rows[0].id);
    await client.query("INSERT INTO new_design.dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id) VALUES($1,$2,$3,$4,$5,'derived_from','hard','system',$6) ON CONFLICT(source_resource_id,derived_resource_id,dependency_kind) WHERE status='active' DO NOTHING",[randomUUID(),resource.space_id,bundle.recipe.context.bookId,resource.id,manifestResource,id]);
  }
  return id;
}
export async function saveDebugPreview(bundle:DebugPreviewBundle,input:DebugPreviewInput,context?:CompositionDatabaseContext):Promise<CompositionDebugPreview>{
  identitySchema.parse(input);
  // Receipt equality is based on the original request plus server-controlled compiler output, never the current published route.
  const requestHash=stableHash(input);
  return database(context,async client=>{
    await lock(client,`preview-key:${input.idempotencyKey}`);
    const receipts=(await client.query("SELECT preview.*,submission.ai_task_id FROM new_design.ai_run_previews preview LEFT JOIN new_design.ai_run_submissions submission ON submission.preview_id=preview.id WHERE preview.idempotency_key=$1 AND preview.source_kind=$2",[input.idempotencyKey,DEBUG_KIND])).rows;
    if(receipts.length){if(receipts.length!==1||receipts[0].request_hash!==requestHash)throw new NewDesignError("同一预览请求包含不同输入，请核对服务器结果，不要重复提交。",409);return previewFromRow(receipts[0],receipts[0].ai_task_id??null);}
    validateBundle(bundle,input);
    const exact=await loadCompositionRecipeVersion(input.recipeId,input.recipeVersionId,{client});
    // Mutable catalogue labels/revisions are not authority; exact immutable version settings and contents are.
    const frozenRecipe=({id,versionId,version,taskType,components,variables,context:scope,name,description}:DebugPreviewBundle["recipe"])=>({id,versionId,version,taskType,components,variables,context:scope,name,description});
    if(stableHash(frozenRecipe(exact.recipe))!==stableHash(frozenRecipe(bundle.recipe))||stableHash(exact.components)!==stableHash(bundle.components)||stableHash(exact.sources)!==stableHash(bundle.sources)||stableHash(exact.knowledgeSources??[])!==stableHash(bundle.knowledgeSources??[]))throw new NewDesignError("预览使用的组合或精确资料与已保存版本不一致，请重新读取组合。",409);
    const book=assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active'",[bundle.recipe.context.bookId])).rows[0],"请选择现有书籍后生成预览。");
    const taskContractVersionId=await freezeTaskContract(client,bundle);
    let route:DebugFrozenPlan["route"]=null,snapshotId:string|null=null,recovery:AiRuntimeRecovery|null=null;
    const blockers:string[]=[];
    try{route=await resolveManagedTaskRoute(bundle.recipe.taskType,{client});await getManagedCredentialEnvironment(route.primary.credentialId,route.primary.provider,{client});for(const fallback of route.fallbacks)await getManagedCredentialEnvironment(fallback.credentialId,fallback.provider,{client});}
    catch(error){if(!(error instanceof NewDesignError)||![404,422].includes(error.status))throw error;blockers.push(error.message);recovery={failedStep:"读取任务模型路由",summary:error.message,savedResult:"组合版本、受控输入、完整消息与上下文可保存查看；尚未执行模型，也未修改书内正本。",actionLabel:"打开模型设置",sourceRoute:"/new-design/structure/models"};route=null;}
    if(route)snapshotId=(await captureManagedModelSnapshot(bundle.recipe.taskType,route,{client},{bookId:book.id,taskContractVersionId})).id;
    const contextManifestId=await freezeContext(client,bundle,taskContractVersionId,snapshotId),plan:DebugFrozenPlan={...bundle,route,recovery,blockers,taskContractVersionId,modelRouteSnapshotId:snapshotId,contextManifestId,recipeVersion:bundle.recipe.version};
    const id=randomUUID(),inputHash=stableHash(bundle.taskInput),hash=frozenHash(plan,inputHash);
    const row=(await client.query("INSERT INTO new_design.ai_run_previews(id,space_id,book_id,task_key,task_group,task_node_key,source_route,source_kind,source_id,task_contract_version_id,prompt_recipe_version_id,context_preview_id,context_manifest_id,model_route_snapshot_id,input_snapshot,input_hash,safe_checkpoint,budget_snapshot,prompt_plan,route_plan,blocker_snapshot,preview_hash,status,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,$4,'prompt_composition_debug','prompt_composition_debug',$5,$6,$7,$8,$9,NULL,$10,$11,$12::jsonb,$13,'{\"trialOnly\":true}'::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,'prompt_composition') RETURNING *",[id,book.space_id,book.id,`prompt_composition_${bundle.recipe.id}_${bundle.recipe.taskType}`,COMPOSITION_ROUTE,DEBUG_KIND,bundle.recipe.id,taskContractVersionId,bundle.recipe.versionId,contextManifestId,snapshotId,JSON.stringify(bundle.taskInput),inputHash,JSON.stringify(route?.policy??{maxOutputTokens:bundle.maxTokens}),JSON.stringify(plan),JSON.stringify(route??{}),JSON.stringify(blockers),hash,route?"ready":"blocked",input.idempotencyKey,requestHash])).rows[0];
    for(const [index,message]of bundle.messages.entries())await client.query("INSERT INTO new_design.ai_run_prompt_sections(id,preview_id,slot_key,section_kind,label,source_refs,token_estimate,sort_order,content_hash) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)",[randomUUID(),id,message.role==="system"?"controlled_asset":"author_additions",message.role==="system"?"instruction":"reference",message.role==="system"?"受控系统合同":"用户输入与普通组件补充",JSON.stringify(message.role==="system"?[{assetId:bundle.assetId,version:bundle.assetVersion}]:bundle.components.map(({cardId,versionId,enabled})=>({cardId,versionId,enabled}))),Math.ceil(message.content.length/4),index,stableHash(message.content)]);
    return previewFromRow(row);
  },true);
}

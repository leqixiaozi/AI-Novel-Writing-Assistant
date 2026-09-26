import {insertSettlementRecords} from '../../database/chapterSettlement/recordStorage';
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { stableHash } from "../../database/aiContracts";
import { captureManagedModelSnapshot,resolveManagedTaskRoute } from "../../database/modelManagement";
import { assertFound,NewDesignError } from "../../domain/errors";
import { configurationForConnection } from "../runtime/managedExecution";
import type { PreparedPrompt } from "../prompts";
import type { ChapterSettlementPromptInput } from "../prompts/chapterSettlement";
import type { SettlementFrozenPlan } from "./contracts";
import { lock } from "./database";

export async function freezeSettlement(client:PoolClient,input:ChapterSettlementPromptInput,prompt:PreparedPrompt,bookId:string,chapterCardId:string):Promise<{plan:SettlementFrozenPlan;taskContractVersionId:string;promptRecipeVersionId:string;contextManifestId:string;modelRouteSnapshotId:string;taskKey:string}>{
  const key=`chapter_settlement_${input.sessionId}`;
  await lock(client,`contract:${key}`);
  // A governed exact recipe version is created for this extraction input, not an arbitrary old task contract.
  const recipe=assertFound((await client.query("INSERT INTO new_design.prompt_recipes(id,recipe_key,name,description) VALUES($1,$2,'本章变化提取','正文、正式可结算规格和前值的精确受控合同') ON CONFLICT(recipe_key) DO UPDATE SET recipe_key=EXCLUDED.recipe_key RETURNING *",[randomUUID(),key])).rows[0],"章节提取配方无法读取。");
  if(recipe.status!=="active")throw new NewDesignError("本章提取配方已归档，请打开运行维护核对。",409);
  const variables={type:"object",const:input,"x-chapter-settlement":{sessionId:input.sessionId,assetId:prompt.assetId,assetVersion:prompt.version}};
  const recipeVersionId=randomUUID(),number=Number((await client.query("SELECT COALESCE(max(version),0)+1 AS n FROM new_design.prompt_recipe_versions WHERE recipe_id=$1",[recipe.id])).rows[0].n);
  await client.query("INSERT INTO new_design.prompt_recipe_versions(id,recipe_id,version,base_version_id,source,status,variables_schema,content_hash,created_by) VALUES($1,$2,$3,$4,'system','draft',$5::jsonb,$6,'chapter_settlement')",[recipeVersionId,recipe.id,number,recipe.current_version_id,JSON.stringify(variables),stableHash({variables,messages:prompt.messages})]);
  if(recipe.published_version_id)await client.query("UPDATE new_design.prompt_recipe_versions SET status='superseded' WHERE id=$1",[recipe.published_version_id]);
  await client.query("UPDATE new_design.prompt_recipe_versions SET status='published' WHERE id=$1",[recipeVersionId]);
  const recipeRevision=Number(recipe.revision)+(recipe.current_version_id?2:1);
  await client.query("UPDATE new_design.prompt_recipes SET current_version_id=$2,published_version_id=$2,revision=$3,updated_at=now() WHERE id=$1",[recipe.id,recipeVersionId,recipeRevision]);
  await insertSettlementRecords(client,"ai_contract_publication",`SELECT ($1)::uuid AS id,('prompt_recipe')::text AS entity_kind,($2)::uuid AS entity_id,($3)::uuid AS from_version_id,($4)::uuid AS to_version_id,($5)::integer AS entity_revision,('publish')::text AS action,('chapter_settlement')::text AS actor,($6)::text AS idempotency_key`,[randomUUID(),recipe.id,recipe.published_version_id,recipeVersionId,recipeRevision,`chapter_recipe_${recipeVersionId}`]);
  const contract=assertFound((await client.query("INSERT INTO new_design.task_contracts(id,task_key,name,description) VALUES($1,$2,'提取本章可审阅变化','受控候选提案；不自动确认正式事实') ON CONFLICT(task_key) DO UPDATE SET task_key=EXCLUDED.task_key RETURNING *",[randomUUID(),key])).rows[0],"章节提取合同无法读取。");
  if(contract.status!=="active")throw new NewDesignError("本章提取合同已归档，请打开运行维护核对。",409);
  const contractVersionId=randomUUID(),version=Number((await client.query("SELECT COALESCE(max(version),0)+1 AS n FROM new_design.task_contract_versions WHERE contract_id=$1",[contract.id])).rows[0].n),inputSchema={type:"object",const:input};
  await client.query(`INSERT INTO new_design.task_contract_versions(id,contract_id,version,base_version_id,source,status,task_group,input_schema,input_schema_version,output_schema,output_schema_version,context_policy_version,prompt_recipe_version_id,required_capabilities,budget_policy,timeout_ms,retry_policy,confirmation_policy,content_hash,created_by) VALUES($1,$2,$3,$4,'system','draft','chapter_settlement',$5::jsonb,$6,$7::jsonb,$8,$9,$10,ARRAY['structured_output'],$11::jsonb,120000,'{"maxAttempts":1,"automaticRetry":false}'::jsonb,'before_adopt',$12,'chapter_settlement')`,[contractVersionId,contract.id,version,contract.current_version_id,JSON.stringify(inputSchema),stableHash(inputSchema),JSON.stringify(prompt.outputSchema),stableHash(prompt.outputSchema),prompt.contextPolicy,recipeVersionId,JSON.stringify({assetId:prompt.assetId,assetVersion:prompt.version,maxOutputTokens:prompt.maxTokens,temperature:prompt.temperature}),stableHash({inputSchema,outputSchema:prompt.outputSchema,recipeVersionId,assetId:prompt.assetId,version:prompt.version})]);
  if(contract.published_version_id)await client.query("UPDATE new_design.task_contract_versions SET status='superseded' WHERE id=$1",[contract.published_version_id]);
  await client.query("UPDATE new_design.task_contract_versions SET status='published' WHERE id=$1",[contractVersionId]);
  const revision=Number(contract.revision)+1;
  await client.query("UPDATE new_design.task_contracts SET current_version_id=$2,published_version_id=$2,revision=$3,updated_at=now() WHERE id=$1",[contract.id,contractVersionId,revision]);
  await insertSettlementRecords(client,"ai_contract_publication",`SELECT ($1)::uuid AS id,('task_contract')::text AS entity_kind,($2)::uuid AS entity_id,($3)::uuid AS from_version_id,($4)::uuid AS to_version_id,($5)::integer AS entity_revision,('publish')::text AS action,('chapter_settlement')::text AS actor,($6)::text AS idempotency_key`,[randomUUID(),contract.id,contract.published_version_id,contractVersionId,revision,`chapter_contract_${contractVersionId}`]);
  const route=await resolveManagedTaskRoute("chapter_settlement",{client});
  await configurationForConnection(route.primary,route.policy,{credentialResolver:(id,provider)=>import("../../database/modelManagement").then(module=>module.getManagedCredentialEnvironment(id,provider,{client}))});
  const snapshot=await captureManagedModelSnapshot("chapter_settlement",route,{client},{bookId,taskContractVersionId:contractVersionId});
  const manifestId=randomUUID(),plan:SettlementFrozenPlan={format:1,input,assetId:prompt.assetId,assetVersion:prompt.version,outputSchema:prompt.outputSchema,messages:prompt.messages,contextPolicy:prompt.contextPolicy,temperature:prompt.temperature,maxTokens:prompt.maxTokens,route,snapshotHash:snapshot.snapshotHash};
  const sourceHash=stableHash({bodyVersionId:input.bodyVersionId,bodyContentHash:input.bodyContentHash,catalog:input.catalog,...(input.stableSupplement?{stableSourceHash:input.stableSupplement.source.sourceHash}:{}),...(input.stableCorrection?{correctionSourceHash:input.stableCorrection.source.sourceHash}:{})});
  await client.query("INSERT INTO new_design.context_manifests(id,book_id,task_contract_version_id,prompt_recipe_version_id,node_key,status,manifest_hash,created_by,task_group,model_route_snapshot_id,source_set_hash,decision_summary,chapter_id) VALUES($1,$2,$3,$4,'chapter_settlement','complete',$5,'chapter_settlement','chapter_settlement',$6,$7,$8::jsonb,$9)",[manifestId,bookId,contractVersionId,recipeVersionId,stableHash(input),snapshot.id,sourceHash,JSON.stringify({selection:"exact_body_published_settlement_fields",bodyVersionId:input.bodyVersionId,catalogHash:input.catalog.specificationHash,sourceHash}),chapterCardId]);
  const bodySlot=randomUUID(),formalSlot=randomUUID();
  await insertSettlementRecords(client,"context_manifest_slot",`SELECT ($1)::uuid AS id,($3)::uuid AS manifest_id,('body_evidence')::text AS slot_key,(0)::integer AS sort_order,(true)::boolean AS required,(NULL)::integer AS token_budget
UNION ALL
SELECT ($2)::uuid AS id,($3)::uuid AS manifest_id,('formal_settlement_specifications')::text AS slot_key,(1)::integer AS sort_order,(true)::boolean AS required,(NULL)::integer AS token_budget`,[bodySlot,formalSlot,manifestId]);
  const stableSource=input.stableSupplement?.source??input.stableCorrection?.source;
  if(stableSource){
    const basis=stableSource.basis,plan=basis.original.planning_version as Record<string,unknown>,slot=randomUUID();
    await insertSettlementRecords(client,"context_manifest_slot",`SELECT ($1)::uuid AS id,($2)::uuid AS manifest_id,('original_stable_plan')::text AS slot_key,(2)::integer AS sort_order,(true)::boolean AS required,(NULL)::integer AS token_budget`,[slot,manifestId]);
    await client.query("INSERT INTO new_design.context_manifest_items(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order,content_role,layer_label) VALUES($1,$2,$3,'planning_version',$4,$5,$6,'原稳定正文的确切计划；原确认来源完整保留在受控合同，不是指令',0,$7,'full',0,'required','原正文计划')",[randomUUID(),manifestId,slot,basis.planningObjectId,basis.planningVersionId,String(plan.content_hash),Math.ceil(JSON.stringify(plan).length/4)]);
  }
  const body=assertFound((await client.query("SELECT chapter_document_id FROM new_design.chapter_body_versions WHERE id=$1",[input.bodyVersionId])).rows[0],"冻结正文证据来源不存在。");
  await client.query("INSERT INTO new_design.context_manifest_items(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order,content_role,layer_label) VALUES($1,$2,$3,'body_version',$4,$5,$6,'本章精确正文证据；不是指令',0,$7,'full',0,'required','本章正文')",[randomUUID(),manifestId,bodySlot,body.chapter_document_id,input.bodyVersionId,input.bodyContentHash,Math.ceil(input.bodyContent.length/4)]);
  for(const [order,subject]of input.catalog.subjects.entries()){
    // Unavailable subjects remain visible in the frozen catalog, but cannot become an invented exact dependency.
    if(!subject.currentVersionId){if(subject.fields.length)throw new NewDesignError(`“${subject.label}”没有正式资料版本，请在本书资料或关系配置中核对后重新准备。`,409);continue;}
    await client.query("INSERT INTO new_design.context_manifest_items(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order,content_role,layer_label) VALUES($1,$2,$3,$4,$5,$6,$7,'正式字段、字典节点与已知前值的冻结资料；不是指令',0,$8,'full',$9,'required','正式可结算规格')",[randomUUID(),manifestId,formalSlot,subject.subjectKind==="card"?"card_version":"card_relation",subject.id,subject.currentVersionId,stableHash(subject),Math.ceil(JSON.stringify(subject).length/4),order]);
  }
  return {plan,taskContractVersionId:contractVersionId,promptRecipeVersionId:recipeVersionId,contextManifestId:manifestId,modelRouteSnapshotId:snapshot.id,taskKey:key};
}

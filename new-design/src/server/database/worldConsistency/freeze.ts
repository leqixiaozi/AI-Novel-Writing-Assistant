import {insertContractRecord} from "../aiContracts/records";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {ManagedTaskRoute} from "../../../common/modelRouting";
import type {WorldConsistencyCatalog,WorldConsistencyEvidence} from "../../../common/worldConsistency";
import {stableHash} from "../aiContracts";
import {resolveManagedTaskRoute,captureManagedModelSnapshot,getManagedCredentialEnvironment} from "../modelManagement";
import {configurationForConnection} from "../../ai/runtime/managedExecution";
import {preparePrompt,type PreparedPrompt} from "../../ai/prompts";
import {assertFound,NewDesignError} from "../../domain/errors";
export interface WorldFrozenPlan {catalog:WorldConsistencyCatalog;recheck:{issueId:string;issueVersionId:string;title:string;description:string;originalCatalog:WorldConsistencyCatalog;originalEvidence:WorldConsistencyEvidence[]}|null;prompt:PreparedPrompt;route:ManagedTaskRoute;snapshotHash:string;contractVersionId:string;recipeVersionId:string;manifestId:string;snapshotId:string;inputHash:string;}
export async function freezeWorldConsistency(client:PoolClient,bookId:string,requestId:string,catalog:WorldConsistencyCatalog,recheck:WorldFrozenPlan["recheck"]):Promise<WorldFrozenPlan>{
 const input={contract:"world_consistency_v1",catalog,recheck},prompt=preparePrompt("world_consistency",input),inputHash=stableHash(input),key=`world_consistency_${requestId}`;
 const recipeId=randomUUID(),recipeVersionId=randomUUID(),contractId=randomUUID(),contractVersionId=randomUUID(),manifestId=randomUUID();
 await client.query("INSERT INTO new_design.prompt_recipes(id,recipe_key,name,description) VALUES($1,$2,'世界一致性检查','精确资料与关系版本；只输出有证据的候选问题')",[recipeId,key]);
 const variables={type:"object",const:input,'x-world-consistency':{requestId,bookId,catalogHash:catalog.hash}};await client.query("INSERT INTO new_design.prompt_recipe_versions(id,recipe_id,version,source,status,variables_schema,content_hash,created_by) VALUES($1,$2,1,'system','draft',$3::jsonb,$4,'world_consistency')",[recipeVersionId,recipeId,JSON.stringify(variables),stableHash({variables,messages:prompt.messages})]);
 await client.query("UPDATE new_design.prompt_recipe_versions SET status='published' WHERE id=$1",[recipeVersionId]);await client.query("UPDATE new_design.prompt_recipes SET current_version_id=$2,published_version_id=$2,revision=2 WHERE id=$1",[recipeId,recipeVersionId]);
 await insertContractRecord(client,"ai_contract_publication",{id:randomUUID(),entity_kind:"prompt_recipe",entity_id:recipeId,to_version_id:recipeVersionId,entity_revision:2,action:"publish",actor:"world_consistency",idempotency_key:`${key}_recipe`,from_version_id:null});
 await client.query("INSERT INTO new_design.task_contracts(id,task_key,name,description) VALUES($1,$2,'世界一致性检查','局部质量债；修复需明确采用到原表单再正常保存')",[contractId,key]);
 const inputSchema={type:"object",const:input};await client.query(`INSERT INTO new_design.task_contract_versions(id,contract_id,version,source,status,task_group,input_schema,input_schema_version,output_schema,output_schema_version,context_policy_version,prompt_recipe_version_id,required_capabilities,budget_policy,timeout_ms,retry_policy,confirmation_policy,content_hash,created_by)
 VALUES($1,$2,1,'system','draft','world_consistency',$3::jsonb,$4,$5::jsonb,$6,$7,$8,ARRAY['structured_output'],$9::jsonb,600000,'{"maxAttempts":1,"automaticRetry":false}'::jsonb,'before_adopt',$10,'world_consistency')`,[contractVersionId,contractId,JSON.stringify(inputSchema),stableHash(inputSchema),JSON.stringify(prompt.outputSchema),stableHash(prompt.outputSchema),prompt.contextPolicy,recipeVersionId,JSON.stringify({assetId:prompt.assetId,assetVersion:prompt.version,maxOutputTokens:prompt.maxTokens,temperature:prompt.temperature}),stableHash({inputSchema,outputSchema:prompt.outputSchema,recipeVersionId})]);
 await client.query("UPDATE new_design.task_contract_versions SET status='published' WHERE id=$1",[contractVersionId]);await client.query("UPDATE new_design.task_contracts SET current_version_id=$2,published_version_id=$2,revision=2 WHERE id=$1",[contractId,contractVersionId]);
 await insertContractRecord(client,"ai_contract_publication",{id:randomUUID(),entity_kind:"task_contract",entity_id:contractId,to_version_id:contractVersionId,entity_revision:2,action:"publish",actor:"world_consistency",idempotency_key:`${key}_contract`,from_version_id:null});
 const route=await resolveManagedTaskRoute("world_consistency",{client});if(route.policy.maxRetries!==0||route.fallbacks.length)throw new NewDesignError("世界检查只支持单次原请求，请明确配置不自动重试且无备用路线；资料表单仍可人工维护。",422);
 await configurationForConnection(route.primary,route.policy,{credentialResolver:(id,provider)=>getManagedCredentialEnvironment(id,provider,{client})});
 const snapshot=await captureManagedModelSnapshot("world_consistency",route,{client},{bookId,taskContractVersionId:contractVersionId});
 await client.query(`INSERT INTO new_design.context_manifests(id,book_id,task_contract_version_id,prompt_recipe_version_id,node_key,status,manifest_hash,created_by,task_group,model_route_snapshot_id,source_set_hash,decision_summary)
 VALUES($1,$2,$3,$4,'world_consistency','complete',$5,'world_consistency','world_consistency',$6,$7,$8::jsonb)`,[manifestId,bookId,contractVersionId,recipeVersionId,inputHash,snapshot.id,catalog.hash,JSON.stringify({selection:"exact_material_versions",catalogHash:catalog.hash})]);
 const slotId=randomUUID();await insertContractRecord(client,"context_manifest_slot",{id:slotId,manifest_id:manifestId,slot_key:"world_material_evidence",sort_order:0,required:true,token_budget:null});
 for(const [order,subject]of catalog.subjects.entries()){
 const kind=subject.kind==='card'?'card_version':'card_relation',graphVersionId=subject.kind==='card'?subject.versionId:subject.id;
 const original=assertFound((await client.query('SELECT resolved_hash FROM new_design.resolve_dependency_resource($1,$2,$3) WHERE resolved_book_id=$4',[kind,subject.id,graphVersionId,bookId])).rows[0],'原正式来源依赖凭证不存在，不使用表单哈希冒充版本依赖。');
 await client.query(`INSERT INTO new_design.context_manifest_items(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order,content_role,layer_label)
 VALUES($1,$2,$3,$4,$5,$6,$7,'原来源依赖；关系精确版本另冻结在专属合同与报告材料凭证',0,$8,'full',$9,'required','世界一致性证据')`,[randomUUID(),manifestId,slotId,kind,subject.id,graphVersionId,String(original.resolved_hash),Math.ceil(JSON.stringify(subject).length/4),order]);}
 return{catalog,recheck,prompt:{...prompt,parseOutput:prompt.parseOutput},route,snapshotHash:snapshot.snapshotHash,contractVersionId,recipeVersionId,manifestId,snapshotId:snapshot.id,inputHash};
}

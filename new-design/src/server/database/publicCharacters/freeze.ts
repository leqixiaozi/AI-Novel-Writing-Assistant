import {insertContractRecord} from "../aiContracts/records";
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {publicDialogueOutputSchema,type PublicCharacterSource,type PublicCharacterTrialInput,type PublicDialoguePromptInput} from '../../../common/publicCharacters';
import type {ImageConnectionVersion,PublicImageProtocolInput} from '../../../common/imageGeneration';
import type {ManagedTaskRoute} from '../../../common/modelRouting';
import {preparePrompt} from '../../ai/prompts';
import {configurationForConnection} from '../../ai';
import {resolveManagedTaskRoute,captureManagedModelSnapshot,getManagedCredentialEnvironment} from '../modelManagement';
import {readManagedImageConnectionVersion} from '../modelManagement/imageGeneration';
import {freezeImageRequest} from '../imageGeneration/snapshot';
import {stableHash} from '../aiContracts';
import {assertFound,NewDesignError} from '../../domain/errors';
import {readTrial} from './repository';
export interface PublicTrialPlan {input:PublicCharacterTrialInput;source:PublicCharacterSource;promptInput:PublicDialoguePromptInput|PublicImageProtocolInput;route?:ManagedTaskRoute;connection?:ImageConnectionVersion;contractVersionId:string;recipeVersionId:string;manifestId:string;snapshotId:string;snapshotHash:string;inputHash:string;outputSchemaVersion:string;timeoutMs:number;}
export async function freezeTrial(client:PoolClient,id:string,input:PublicCharacterTrialInput,source:PublicCharacterSource):Promise<PublicTrialPlan>{
 let plan:PublicTrialPlan;
 if(input.kind==='portrait'){
  const connection=await readManagedImageConnectionVersion(input.connectionVersionId,{client});if(!connection.sizes.includes(input.size))throw new NewDesignError('所选专属图片连接没有声明此尺寸。',422);
  await getManagedCredentialEnvironment(connection.credentialId,connection.provider,{client});
  const promptInput:PublicImageProtocolInput={requestKey:input.requestKey,connectionVersionId:input.connectionVersionId,kind:'illustration',title:input.title,description:input.description,prompt:input.prompt,size:input.size,portraitSource:source,...(input.preparation?{preparation:input.preparation}:{})};
  const frozen=await freezeImageRequest(client,id,promptInput,connection);
  plan={input,source,promptInput,connection,contractVersionId:frozen.contractVersionId,recipeVersionId:frozen.recipeVersionId,manifestId:frozen.manifestId,snapshotId:frozen.snapshotId,snapshotHash:frozen.snapshotHash,inputHash:stableHash(promptInput),outputSchemaVersion:stableHash(frozen.contract.outputSchema),timeoutMs:connection.timeoutMs};
 }else{
  const history:PublicDialoguePromptInput['history']=[];
  for(const key of input.historyKeys){const prior=await readTrial(client,key,true);if(!prior||prior.status!=='succeeded'||prior.input_payload.kind!=='dialogue'||prior.resource_id!==source.id||prior.resource_version_id!==source.versionId||prior.source_snapshot.hash!==source.hash)throw new NewDesignError('试聊历史不属于此公共角色固定版本的真实成功回复。',422);const output=publicDialogueOutputSchema.parse(prior.output);if(stableHash(prior.input_payload.historyKeys)!==stableHash(history.map(item=>item.requestKey)))throw new NewDesignError('试聊历史顺序或完整链已变化，不截断或替换旧回复。',422);history.push({requestKey:key,message:prior.input_payload.message,utterance:output.utterance});}
  const promptInput:PublicDialoguePromptInput={contract:'public_character_dialogue_v1',source,message:input.message,history},prompt=preparePrompt('public_character_dialogue',promptInput),recipeId=randomUUID(),recipeVersionId=randomUUID(),contractId=randomUUID(),contractVersionId=randomUUID(),manifestId=randomUUID(),key=`public_character_${id}`,schema={type:'object',const:promptInput},variables={...schema,'x-public-character':{contract:'public_character_trial_v1',requestId:id,resourceId:source.id,resourceVersionId:source.versionId,sourceHash:source.hash}};
  const route=await resolveManagedTaskRoute('character_dialogue',{client});if(route.policy.maxRetries!==0||route.fallbacks.length)throw new NewDesignError('公共角色试聊需要关闭自动重试及备用路线，请核对人物对话模型设置。',422);
  await configurationForConnection(route.primary,route.policy,{credentialResolver:(credentialId,provider)=>getManagedCredentialEnvironment(credentialId,provider,{client})});
  await client.query("INSERT INTO new_design.prompt_recipes(id,recipe_key,name,description) VALUES($1,$2,'公共角色试聊','确切公共档案及此前真实成功回复')",[recipeId,key]);
  await client.query("INSERT INTO new_design.prompt_recipe_versions(id,recipe_id,version,source,status,variables_schema,content_hash,created_by) VALUES($1,$2,1,'system','draft',$3::jsonb,$4,'public_characters')",[recipeVersionId,recipeId,JSON.stringify(variables),stableHash({variables,messages:prompt.messages})]);
  await client.query("UPDATE new_design.prompt_recipe_versions SET status='published' WHERE id=$1",[recipeVersionId]);await client.query('UPDATE new_design.prompt_recipes SET current_version_id=$2,published_version_id=$2,revision=2 WHERE id=$1',[recipeId,recipeVersionId]);
  await client.query("INSERT INTO new_design.task_contracts(id,task_key,name,description) VALUES($1,$2,'公共角色试聊','试用结果不改角色、书籍或正式事实')",[contractId,key]);
  await client.query(`INSERT INTO new_design.task_contract_versions(id,contract_id,version,source,status,task_group,input_schema,input_schema_version,output_schema,output_schema_version,context_policy_version,prompt_recipe_version_id,required_capabilities,budget_policy,timeout_ms,retry_policy,confirmation_policy,content_hash,created_by)
   VALUES($1,$2,1,'system','draft','character_dialogue',$3::jsonb,$4,$5::jsonb,$6,$7,$8,ARRAY['structured_output'],$9::jsonb,$11,'{"maxAttempts":1,"automaticRetry":false}','before_adopt',$10,'public_characters')`,[contractVersionId,contractId,JSON.stringify(schema),stableHash(schema),JSON.stringify(prompt.outputSchema),stableHash(prompt.outputSchema),prompt.contextPolicy,recipeVersionId,JSON.stringify({assetId:prompt.assetId,assetVersion:prompt.version,maxOutputTokens:prompt.maxTokens,temperature:prompt.temperature}),stableHash({schema,messages:prompt.messages}),route.policy.timeoutMs]);
  await client.query("UPDATE new_design.task_contract_versions SET status='published' WHERE id=$1",[contractVersionId]);await client.query('UPDATE new_design.task_contracts SET current_version_id=$2,published_version_id=$2,revision=2 WHERE id=$1',[contractId,contractVersionId]);
  for(const [kind,entity,version]of [['prompt_recipe',recipeId,recipeVersionId],['task_contract',contractId,contractVersionId]])await insertContractRecord(client,"ai_contract_publication",{id:randomUUID(),entity_kind:kind,entity_id:entity,to_version_id:version,entity_revision:2,action:"publish",actor:"public_characters",idempotency_key:`${key}_${kind}`,from_version_id:null});
  const snapshot=await captureManagedModelSnapshot('character_dialogue',route,{client});
  await client.query(`INSERT INTO new_design.context_manifests(id,book_id,public_character_scope,task_contract_version_id,prompt_recipe_version_id,node_key,status,manifest_hash,created_by,task_group,model_route_snapshot_id,source_set_hash,decision_summary)
   VALUES($1,NULL,$2,$3,$4,'public_character_dialogue','complete',$5,'public_characters','character_dialogue',$6,$7,$8::jsonb)`,[manifestId,source.id,contractVersionId,recipeVersionId,stableHash(promptInput),snapshot.id,source.hash,JSON.stringify({contract:'public_character_trial_v1',resourceId:source.id,resourceVersionId:source.versionId,historyKeys:input.historyKeys})]);
  plan={input,source,promptInput,route,contractVersionId,recipeVersionId,manifestId,snapshotId:snapshot.id,snapshotHash:snapshot.snapshotHash,inputHash:stableHash(promptInput),outputSchemaVersion:stableHash(prompt.outputSchema),timeoutMs:route.policy.timeoutMs};
 }
 const original=assertFound((await client.query("SELECT resolved_hash FROM new_design.resolve_dependency_resource('card_version',$1,$2)",[source.id,source.versionId])).rows[0],'公共角色原版本依赖无法精确解析。'),slotId=randomUUID();
 await insertContractRecord(client,"context_manifest_slot",{id:slotId,manifest_id:plan.manifestId,slot_key:"public_character_profile",sort_order:0,required:true,token_budget:null});
 await client.query(`INSERT INTO new_design.context_manifest_items(id,manifest_id,slot_id,source_type,stable_object_id,exact_version_id,content_hash,inclusion_reason,priority,token_estimate,transform_status,sort_order,content_role,layer_label)
 VALUES($1,$2,$3,'card_version',$4,$5,$6,'作者明确选择的公共角色固定版本',0,$7,'full',0,'required','公共角色档案')`,[randomUUID(),plan.manifestId,slotId,source.id,source.versionId,original.resolved_hash,Math.ceil(JSON.stringify(source).length/4)]);
 return plan;
}

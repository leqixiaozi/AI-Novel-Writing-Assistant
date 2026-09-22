import {runRows,readRunPreview,insertRunRecord,transitionRunPreview} from "../aiRunOrchestration/records";
import {readManifestSlots} from "../aiContracts/contextStore";
import {readSnapshotFallbacks} from "../aiContracts/records";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { COMPOSITION_ROUTE,type CompositionDebugResult } from "../../../common/promptComposition";
import type { ManagedModelSnapshot } from "../../../common/modelRouting";
import { NewDesignError,assertFound } from "../../domain/errors";
import { stableHash } from "../aiContracts";
import { database,lock,type CompositionDatabaseContext } from "./database";
import { loadCompositionRecipeVersion } from "./recipes";
import { DEBUG_KIND,readPreviewRow,previewFromRow,frozenHash } from "./previews";
import type { ClaimedDebugRun,DebugFrozenPlan,DebugRunClaim,DebugRunCompletion } from "./contracts";
import {compositionFrozenReferences} from "./knowledge";

type Row=Record<string,any>;
const STEP="execute_prompt_composition_debug";
const requestSchema=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive(),key:z.string().trim().min(8).max(160)}).strict();
async function resultFromSubmission(client:PoolClient,previewId:string,repeated:boolean):Promise<CompositionDebugResult>{
  const submission=(await runRows(client,"ai_run_submission",{preview_id:previewId}))[0];if(!submission)throw new NewDesignError("试运行记录尚不存在，请先生成预览并点击试运行。",404);
  const row=assertFound((await client.query("SELECT task.id AS task_id,attempt.status,attempt.debug_result,attempt.debug_execution,attempt.debug_failure,EXISTS(SELECT 1 FROM new_design.ai_attempt_usage usage WHERE usage.attempt_id=attempt.id) AS usage_recorded FROM new_design.ai_tasks task JOIN new_design.ai_task_steps step ON step.task_id=task.id AND step.step_key=$2 JOIN new_design.ai_task_attempts attempt ON attempt.id=step.current_attempt_id WHERE task.id=$1 AND task.source_kind=$3",[submission.ai_task_id,STEP,DEBUG_KIND])).rows[0],"试运行记录尚不存在，请先生成预览并点击试运行。");
  return {previewId,taskId:row.task_id,status:row.status==="succeeded"?"succeeded":row.status==="running"||row.status==="queued"?"running":"failed",output:row.debug_result??null,modelSnapshot:row.debug_execution??null,failure:row.debug_failure??(row.status==="running"?{failedStep:"等待试运行回执",summary:"试运行已领取，请刷新核对原结果；不会自动再次调用模型。若进程中断，请确认旧运行后新建预览进行新的试验。",savedResult:"原预览、精确合同、上下文和运行领取记录已保留；书内正本未修改。",actionLabel:"返回提示词组合",sourceRoute:`${COMPOSITION_ROUTE}?previewId=${previewId}`} : null),usageRecorded:row.usage_recorded===true,repeated};
}
export async function readDebugResult(previewId:string,context?:CompositionDatabaseContext):Promise<CompositionDebugResult|null>{
  z.string().uuid().parse(previewId);return database(context,async client=>{await readPreviewRow(client,previewId);if(!(await runRows(client,"ai_run_submission",{preview_id:previewId})).length)return null;return resultFromSubmission(client,previewId,false);});
}
async function appendEvent(client:PoolClient,refs:{taskId:string;stepId:string;attemptId:string},kind:"task"|"step"|"attempt",from:string|null,to:string,reason:string,revision:number|null=null):Promise<void>{
  await client.query("INSERT INTO new_design.ai_task_events(id,task_id,step_id,attempt_id,entity_kind,from_status,to_status,checkpoint_key,reason_code,reason_detail,actor_kind,actor,entity_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'组合调试单次领取与终止；不采用正本','user','prompt_composition',$10)",[randomUUID(),refs.taskId,kind==="task"?null:refs.stepId,kind==="attempt"?refs.attemptId:null,kind,from,to,STEP,reason,revision]);
}
async function validateFrozen(client:PoolClient,row:Row):Promise<{plan:DebugFrozenPlan;snapshot:ManagedModelSnapshot}>{
  const plan=row.prompt_plan as DebugFrozenPlan;
  if(!plan?.route||!plan.modelRouteSnapshotId||plan.modelRouteSnapshotId!==row.model_route_snapshot_id||plan.taskContractVersionId!==row.task_contract_version_id||plan.contextManifestId!==row.context_manifest_id||plan.recipe.versionId!==row.prompt_recipe_version_id||plan.recipe.context.bookId!==row.book_id||stableHash(row.input_snapshot)!==row.input_hash||stableHash(plan.taskInput)!==row.input_hash||stableHash(plan.inputSchema.const)!==row.input_hash||frozenHash(plan,row.input_hash)!==row.preview_hash)throw new NewDesignError("冻结预览、真实输入或版本引用校验失败，请生成新的预览，不要重复执行旧预览。",409);
  const contract=assertFound((await client.query("SELECT version.*,config.task_key FROM new_design.task_contract_versions version JOIN new_design.task_contracts config ON config.id=version.contract_id WHERE version.id=$1",[row.task_contract_version_id])).rows[0],"冻结任务合同不存在。");
  if(contract.task_key!==row.task_key||contract.task_key!==`prompt_composition_${plan.recipe.id}_${plan.recipe.taskType}`||contract.prompt_recipe_version_id!==row.prompt_recipe_version_id||stableHash(contract.input_schema)!==stableHash(plan.inputSchema)||stableHash(contract.output_schema)!==stableHash(plan.outputSchema)||contract.output_schema_version!==stableHash(plan.outputSchema)||contract.input_schema_version!==stableHash(plan.inputSchema)||contract.context_policy_version!==plan.contextPolicy||contract.budget_policy?.assetId!==plan.assetId||contract.budget_policy?.assetVersion!==plan.assetVersion||contract.budget_policy?.maxOutputTokens!==plan.maxTokens||contract.budget_policy?.temperature!==plan.temperature||!["published","superseded"].includes(contract.status))throw new NewDesignError("冻结合同规格与本次精确配方不一致，请重新生成预览。",409);
  const exact=await loadCompositionRecipeVersion(plan.recipe.id,plan.recipe.versionId,{client});
  if(stableHash(exact.components)!==stableHash(plan.components)||stableHash(exact.sources)!==stableHash(plan.sources)||stableHash(exact.knowledgeSources??[])!==stableHash(plan.knowledgeSources??[])||stableHash(exact.recipe.variables)!==stableHash(plan.recipe.variables)||stableHash(exact.recipe.context)!==stableHash(plan.recipe.context)||exact.recipe.taskType!==plan.recipe.taskType)throw new NewDesignError("精确组件或资料已不可用，请重新选择并生成预览。",409);
  const manifest=assertFound((await client.query("SELECT * FROM new_design.context_manifests WHERE id=$1",[row.context_manifest_id])).rows[0],"冻结上下文清单不存在。");
  if(manifest.book_id!==row.book_id||manifest.task_contract_version_id!==row.task_contract_version_id||manifest.prompt_recipe_version_id!==row.prompt_recipe_version_id||manifest.model_route_snapshot_id!==row.model_route_snapshot_id||manifest.status!=="complete")throw new NewDesignError("冻结上下文清单范围不一致，请重新生成预览。",409);
  const expectedReferences=compositionFrozenReferences(plan);
  const slots=await readManifestSlots(client,String(manifest.id)),slotById=new Map(slots.map(slot=>[slot.id,slot]));
  const storedEntries=(await client.query("SELECT entry.*,version.revision AS exact_revision,version.type_version_id AS exact_type_version_id,version.title AS exact_title,version.values AS exact_values,card.space_id AS exact_space_id FROM new_design.context_manifest_items entry LEFT JOIN new_design.card_versions version ON entry.source_type IN ('card_version','prompt_component') AND version.id=entry.exact_version_id AND version.card_id=entry.stable_object_id LEFT JOIN new_design.cards card ON card.id=version.card_id WHERE entry.manifest_id=$1 ORDER BY entry.sort_order,entry.id",[manifest.id])).rows.filter(entry=>slotById.has(entry.slot_id)).map(entry=>({...entry,slot_key:slotById.get(entry.slot_id)!.slot_key,slot_order:Number(slotById.get(entry.slot_id)!.sort_order)})).sort((a,b)=>a.slot_order-b.slot_order||Number(a.sort_order)-Number(b.sort_order)||String(a.id).localeCompare(String(b.id)));
  if(storedEntries.length!==expectedReferences.length)throw new NewDesignError("冻结上下文条目数量不一致，请重新生成预览。",409);
  const reconstructed=[];
  for(const [index,entry]of storedEntries.entries()){
    const reference=expectedReferences[index]!,knowledge=reference.kind==="asset_version"?exact.knowledgeSources?.find(source=>source.parsedAssetId===reference.cardId&&source.parsedVersionId===reference.versionId):null;
    if(reference.kind==="asset_version"&&!knowledge)throw new NewDesignError("冻结知识正文精确版本不可用，请返回知识参考核对后重新预览。",409);
    if(stableHash(entry.knowledge_segment??null)!==stableHash(knowledge?.segment??null))throw new NewDesignError("冻结知识段落锚点与明确选择不一致，请重新生成预览。",409);
    const hash=knowledge?knowledge.checksum:stableHash({revision:entry.exact_revision,typeVersionId:entry.exact_type_version_id,title:entry.exact_title,values:entry.exact_values}),spaceId=knowledge?knowledge.spaceId:entry.exact_space_id,revision=knowledge?knowledge.revision:entry.exact_revision;
    if(entry.source_type!==reference.kind||entry.stable_object_id!==reference.cardId||entry.exact_version_id!==reference.versionId||entry.content_hash!==hash||entry.source_space_id!==spaceId||entry.source_revision!==revision||entry.content_role!==(reference.role==="formal"?"required":"reference")||entry.slot_key!==(reference.kind==="prompt_component"?"author_additions":"explicit_context"))throw new NewDesignError("冻结上下文内容、角色或精确引用不一致，请重新生成预览。",409);
    reconstructed.push({reference,spaceId,revision:Number(revision),hash});
  }
  if(stableHash({bookId:plan.recipe.context.bookId,recipeVersionId:plan.recipe.versionId,entries:reconstructed})!==manifest.manifest_hash||stableHash(reconstructed)!==manifest.source_set_hash)throw new NewDesignError("上下文冻结哈希不一致，请重新生成预览。",409);
  const stored=assertFound((await client.query("SELECT * FROM new_design.model_route_snapshots WHERE id=$1",[row.model_route_snapshot_id])).rows[0],"冻结模型快照不存在。");
  const fallbacks=(await readSnapshotFallbacks(client,String(stored.id))).map(item=>({provider:item.provider,model:item.model,endpoint:item.parameters?.baseUrl,credentialId:item.credential_ref_id??null,failureCategories:item.technical_failure_categories}));
  const route={primary:{provider:stored.provider,model:stored.model,endpoint:stored.parameters?.baseUrl,credentialId:stored.credential_ref_id??null},policy:{maxOutputTokens:Number(stored.budget_policy.maxOutputTokens),maxTotalTokens:Number(stored.budget_policy.maxTokens),timeoutMs:Number(stored.timeout_ms),maxRetries:Number(stored.retry_policy.maxRetries),retryDelayMs:Number(stored.retry_policy.retryDelayMs)},fallbacks,sourceLayers:stored.source_layers};
  const hash=stableHash({taskType:plan.recipe.taskType,...route,scope:{bookId:row.book_id,taskContractVersionId:row.task_contract_version_id}});
  if(stored.book_id!==row.book_id||stored.task_contract_version_id!==row.task_contract_version_id||stored.managed_task_key!==null||stableHash(route)!==stableHash(plan.route)||hash!==stored.snapshot_hash)throw new NewDesignError("冻结模型快照与真实版本来源不一致，请重新生成预览。",409);
  return {plan,snapshot:{id:stored.id,snapshotHash:stored.snapshot_hash,taskType:plan.recipe.taskType,route:plan.route}};
}
export async function claimDebugRun(id:string,expectedRevision:number,key:string,context?:CompositionDatabaseContext):Promise<ClaimedDebugRun>{
  const input=requestSchema.parse({id,expectedRevision,key});
  return database(context,async client=>{
    await lock(client,`run-key:${input.key}`);await lock(client,`run-preview:${id}`);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`ai-run-submission:${input.key}`]);const row=await readRunPreview(client,id,true);if(row.source_kind!==DEBUG_KIND)throw new NewDesignError("组合预览不存在。",404);
    const receipt=[...await runRows(client,"ai_run_submission",{idempotency_key:input.key}),...await runRows(client,"ai_run_submission",{preview_id:id})][0];
    const requestHash=stableHash({previewId:id,expectedRevision:input.expectedRevision,previewHash:row.preview_hash});
    if(receipt){if(receipt.preview_id!==id||receipt.idempotency_key!==input.key||Number(receipt.submitted_revision)!==input.expectedRevision)throw new NewDesignError("此预览已由不同试运行请求领取，请核对原结果；旧预览不会再次执行。",409);const task=(await client.query("SELECT request_hash FROM new_design.ai_tasks WHERE id=$1",[receipt.ai_task_id])).rows[0];if(task?.request_hash!==requestHash)throw new NewDesignError("原试运行请求内容不一致，请核对服务器结果。",409);return {priorResult:await resultFromSubmission(client,id,true)};}
    if(row.status!=="ready"||Number(row.revision)!==input.expectedRevision)throw new NewDesignError(row.status==="blocked"?"预览被阻止，模型尚未执行。请处理标出的阻止原因后生成新预览。":"预览已更新或领取，请核对服务器结果后生成新预览。",409);
    if((await client.query("SELECT id FROM new_design.ai_tasks WHERE space_id=$1 AND request_idempotency_key=$2",[row.space_id,input.key])).rows.length)throw new NewDesignError("试运行请求标识已用于其他任务，请核对原结果。",409);
    const {plan,snapshot}=await validateFrozen(client,row);
    const refs={taskId:randomUUID(),stepId:randomUUID(),attemptId:randomUUID()},leaseToken=randomUUID();
    await client.query("INSERT INTO new_design.ai_tasks(id,space_id,book_id,task_key,task_contract_version_id,source_route,source_kind,source_id,request_idempotency_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prompt_composition')",[refs.taskId,row.space_id,row.book_id,row.task_key,row.task_contract_version_id,`${COMPOSITION_ROUTE}?previewId=${id}`,DEBUG_KIND,id,input.key,requestHash]);
    await client.query("INSERT INTO new_design.ai_task_steps(id,task_id,step_key,sort_order,max_attempts) VALUES($1,$2,$3,0,1)",[refs.stepId,refs.taskId,STEP]);
    await client.query("INSERT INTO new_design.ai_task_attempts(id,task_id,step_id,attempt_number,trigger_kind,status,task_contract_version_id,prompt_recipe_version_id,context_manifest_id,model_route_snapshot_id,input_hash,output_schema_version,checkpoint_key,lease_token_digest,started_at) VALUES($1,$2,$3,1,'initial','running',$4,$5,$6,$7,$8,$9,$10,$11,now())",[refs.attemptId,refs.taskId,refs.stepId,row.task_contract_version_id,row.prompt_recipe_version_id,row.context_manifest_id,row.model_route_snapshot_id,row.input_hash,stableHash(plan.outputSchema),STEP,stableHash(leaseToken)]);
    await client.query("UPDATE new_design.ai_task_steps SET status='running',current_attempt_id=$2,checkpoint_key=$3,lease_owner='prompt_composition_http',lease_token=$4,lease_expires_at=now()+interval '15 minutes',heartbeat_at=now(),revision=revision+1,updated_at=now() WHERE id=$1",[refs.stepId,refs.attemptId,STEP,leaseToken]);
    await client.query("UPDATE new_design.ai_tasks SET status='running',current_step_key=$2,current_checkpoint=$2,revision=revision+1,updated_at=now() WHERE id=$1",[refs.taskId,STEP]);
    for(const kind of ["task","step","attempt"]as const)await appendEvent(client,refs,kind,kind==="attempt"?null:"queued","running","debug_run_claimed",kind==="attempt"?null:2);
    const submitted=await transitionRunPreview(client,id,"submitted",input.expectedRevision);if(!submitted)throw new NewDesignError("试运行预览领取冲突，请核对服务器结果。",409);
    await insertRunRecord(client,"ai_run_submission",{id:randomUUID(),preview_id:id,ai_task_id:refs.taskId,submitted_revision:input.expectedRevision,idempotency_key:input.key,submitted_by:"prompt_composition"});
    return {preview:previewFromRow(submitted,refs.taskId),taskInput:plan.taskInput,snapshot,frozenBundle:plan,...refs,leaseToken};
  },true);
}
const count=(value:unknown):number|null=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
export async function finishDebugRun(claim:DebugRunClaim,outcome:DebugRunCompletion,context?:CompositionDatabaseContext):Promise<CompositionDebugResult>{
  if("output"in outcome&&outcome.output===undefined)throw new NewDesignError("调试输出必须是可序列化真实结果。",422);
  const original="failure"in outcome?outcome.failure:null;
  const configurationRecovery=original?.sourceRoute==="/new-design/structure/models"&&original.actionLabel==="打开模型设置"||original?.sourceRoute==="/new-design/structure/maintenance"&&original.actionLabel==="打开运行维护";
  const failure=original?{...original,sourceRoute:configurationRecovery?original.sourceRoute:`${COMPOSITION_ROUTE}?previewId=${claim.preview.id}`,savedResult:`原预览、精确合同、上下文与本次失败记录已保留；书内正本未修改。${original.savedResult}`,actionLabel:configurationRecovery?original.actionLabel:"返回提示词组合"}:null;
  const execution=outcome.modelSnapshot??null,status=failure?"failed":"succeeded";
  return database(context,async client=>{
    await lock(client,`finish:${claim.attemptId}`);
    const attempt=assertFound((await client.query("SELECT attempt.*,task.source_kind,task.source_id FROM new_design.ai_task_attempts attempt JOIN new_design.ai_tasks task ON task.id=attempt.task_id WHERE attempt.id=$1 FOR UPDATE OF attempt",[claim.attemptId])).rows[0],"调试尝试不存在。");
    if(attempt.task_id!==claim.taskId||attempt.step_id!==claim.stepId||attempt.source_kind!==DEBUG_KIND||attempt.source_id!==claim.preview.id||attempt.lease_token_digest!==stableHash(claim.leaseToken))throw new NewDesignError("试运行领取凭据或尝试范围不一致，请核对原结果。",409);
    if(attempt.status!=="running"){
      const outputHash=failure?null:stableHash("output"in outcome?outcome.output:null);
      if(attempt.status!==status||stableHash(attempt.debug_failure??null)!==stableHash(failure)||stableHash(attempt.debug_execution??null)!==stableHash(execution)||(!failure&&attempt.result_hash!==outputHash))throw new NewDesignError("终止回执与已保存试运行结果不同；已保存结果不会覆盖。",409);
      return resultFromSubmission(client,claim.preview.id,true);
    }
    await client.query("UPDATE new_design.ai_task_attempts SET status=$2,result_kind=$3,result_stable_id=$4,result_version_id=$5,result_hash=$6,error_category=$7,retry_eligibility=$8,error_summary=$9,ended_at=now(),debug_result=$10::jsonb,debug_execution=$11::jsonb,debug_failure=$12::jsonb WHERE id=$1",[claim.attemptId,status,failure?null:DEBUG_KIND,failure?null:claim.preview.id,failure?null:claim.preview.recipeVersionId,failure?null:stableHash("output"in outcome?outcome.output:null),failure?("errorCategory"in outcome?outcome.errorCategory??"unknown":"unknown"):null,failure?"none":null,failure?.summary??"",failure?null:JSON.stringify("output"in outcome?outcome.output:null),execution?JSON.stringify(execution):null,failure?JSON.stringify(failure):null]);
    const step=(await client.query("UPDATE new_design.ai_task_steps SET status=$2,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' AND current_attempt_id=$3 RETURNING revision",[claim.stepId,status,claim.attemptId])).rows[0];
    const task=(await client.query("UPDATE new_design.ai_tasks SET status=$2,revision=revision+1,updated_at=now(),completed_at=now() WHERE id=$1 AND status='running' RETURNING revision",[claim.taskId,status])).rows[0];
    if(!step||!task)throw new NewDesignError("试运行状态已被改变，终止事务已撤回，请核对原结果。",409);
    for(const kind of ["attempt","step","task"]as const)await appendEvent(client,claim,kind,"running",status,failure?"debug_run_failed":"debug_run_succeeded",kind==="step"?Number(step.revision):kind==="task"?Number(task.revision):null);
    const provider=typeof execution?.provider==="string"?execution.provider:"not_invoked",model=typeof execution?.model==="string"?execution.model:"not_invoked";
    await client.query("INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,cached_input_tokens,duration_ms,estimated_cost,currency,fallback_count,budget_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,NULL,$10,$11)",[randomUUID(),claim.taskId,claim.stepId,claim.attemptId,provider,model,count(execution?.inputTokens),count(execution?.outputTokens),count(execution?.durationMs),count(execution?.fallbackCount)??0,execution?.budgetExceeded===true?"exceeded":count(execution?.inputTokens)!==null&&count(execution?.outputTokens)!==null?"within_budget":"unknown"]);
    // Build the response inside the commit transaction. A later unrelated GET cannot recast committed success as failure.
    return resultFromSubmission(client,claim.preview.id,false);
  },true);
}

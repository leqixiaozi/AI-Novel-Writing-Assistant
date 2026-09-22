import type {PoolClient} from 'pg';
import {imagePreparationInputSchema,imagePreparationOutputSchema} from '../../../common/imagePreparation';
import {NewDesignError} from '../../domain/errors';
import {stableHash} from '../aiContracts';
import {readCardWorkflowCapability} from '../cardWorkflow';
import {readImageMaterials} from './sources';

type Values=Record<string,any>;
const same=(a:unknown,b:unknown)=>stableHash(a??null)===stableHash(b??null);
function reject():never{throw new NewDesignError('图片优化的冻结资料、原运行合同或已收回复不一致，不能替换来源或推断完成。',409);}

/** Native records retain every source/ledger requirement of the original preparation guard. */
export async function guardImagePreparation(client:PoolClient,value:Values,previous?:Values){
  const input=imagePreparationInputSchema.parse(value.input_payload),source=value.source_snapshot,plan=value.frozen_plan;
  if(!['running','succeeded','failed','ended_unknown'].includes(value.status)||value.request_key!==input.requestKey||value.request_hash!==stableHash(input)||!source||!same(source.scope,input.scope)||source.hash!==input.sourceHash||source.hash!==stableHash({scope:source.scope,data:source.data}))reject();
  if(previous){
    for(const key of Object.keys(previous))if(!['status','reply','output','summary'].includes(key)&&!same(value[key],previous[key]))reject();
    if(previous.status!=='running'&&!same(previous,value)||previous.reply!==null&&!same(previous.reply,value.reply)||value.status==='running'&&(value.output!==null||value.summary!==previous.summary))reject();
  }else if(!(await readCardWorkflowCapability(client,'image_prompt_preparation_v1',['image_prompt_preparation'])).operational||value.status!=='running'||value.reply!==null||value.output!==null)reject();
  const ledger=(await client.query(`SELECT to_jsonb(task) task,to_jsonb(step) step,to_jsonb(attempt) attempt,to_jsonb(contract) contract,to_jsonb(recipe) recipe,to_jsonb(manifest) manifest,to_jsonb(snapshot) snapshot
    FROM new_design.ai_tasks task JOIN new_design.ai_task_steps step ON step.task_id=task.id AND step.id=$2 AND step.current_attempt_id=$3
    JOIN new_design.ai_task_attempts attempt ON attempt.id=$3 AND attempt.task_id=task.id AND attempt.step_id=step.id
    JOIN new_design.task_contract_versions contract ON contract.id=attempt.task_contract_version_id
    JOIN new_design.prompt_recipe_versions recipe ON recipe.id=attempt.prompt_recipe_version_id
    JOIN new_design.context_manifests manifest ON manifest.id=attempt.context_manifest_id
    JOIN new_design.model_route_snapshots snapshot ON snapshot.id=attempt.model_route_snapshot_id WHERE task.id=$1`,[value.id,value.step_id,value.attempt_id])).rows[0];
  if(!ledger)reject();
  const {task,step,attempt,contract,recipe,manifest,snapshot}=ledger;
  if(task.source_kind!=='image_prompt_preparation'||task.source_id!==value.id||task.request_idempotency_key!==value.request_key||task.request_hash!==value.request_hash||task.task_contract_version_id!==contract.id||step.step_key!=='image_prompt_preparation'||step.max_attempts!==1||attempt.attempt_number!==1||attempt.input_hash!==plan.inputHash||attempt.output_schema_version!==plan.outputSchemaVersion||contract.task_group!=='form_assist'||contract.status!=='published'||contract.budget_policy.assetId!=='new_design.image.prompt_preparation'||contract.budget_policy.assetVersion!=='v1'||!same(contract.retry_policy,{maxAttempts:1,automaticRetry:false})||recipe.id!==contract.prompt_recipe_version_id||recipe.status!=='published'||!same(recipe.variables_schema.const,contract.input_schema.const)||!same(contract.input_schema.const,plan.promptInput)||!same(plan.promptInput,{contract:'image_prompt_preparation_v1',source,original:input.original})||plan.inputHash!==stableHash(plan.promptInput)||plan.contractVersionId!==contract.id||plan.recipeVersionId!==recipe.id||plan.manifestId!==manifest.id||plan.snapshotId!==snapshot.id||manifest.task_contract_version_id!==contract.id||manifest.prompt_recipe_version_id!==recipe.id||manifest.model_route_snapshot_id!==snapshot.id||manifest.source_set_hash!==source.hash||snapshot.snapshot_hash!==plan.snapshotHash||snapshot.provider!==plan.route.primary.provider||snapshot.model!==plan.route.primary.model||snapshot.retry_policy.maxRetries!==0||!same(plan.route.fallbacks,[]))reject();
  if(!previous){
    if(task.status!=='running'||step.status!=='running'||attempt.status!=='running')reject();
    const current=await readImageMaterials(client,input.scope);
    if(!same(current,source))reject();
    if(input.scope.kind==='book'){if(value.scope_id!==input.scope.bookId||task.book_id!==input.scope.bookId||manifest.book_id!==input.scope.bookId||Object.keys(source.data).some(key=>!['book','cards','plans'].includes(key)))reject();}
    else if(value.scope_id!==input.scope.resourceId||task.book_id!==null||manifest.book_id!==null||manifest.public_character_scope!==input.scope.resourceId||source.data.profile.id!==input.scope.resourceId||source.data.profile.versionId!==input.scope.resourceVersionId||Object.keys(source.data).some(key=>key!=='profile'))reject();
    const refs=input.scope.kind==='public_character'?[{kind:'card_version',id:input.scope.resourceId,version:input.scope.resourceVersionId}]:[...source.data.cards.map((card:Values)=>({kind:'card_version',id:card.id,version:card.versionId})),...source.data.plans.map((plan:Values)=>({kind:'planning_version',id:plan.id,version:plan.versionId}))];
    const entries=(await client.query('SELECT source_type,stable_object_id,exact_version_id,content_hash,transform_status,content_role,token_estimate FROM new_design.context_manifest_items WHERE manifest_id=$1',[manifest.id])).rows;
    if(entries.length!==refs.length||new Set(entries.map(entry=>`${entry.source_type}:${entry.stable_object_id}:${entry.exact_version_id}`)).size!==entries.length)reject();
    for(const entry of entries){if(entry.transform_status!=='full'||entry.content_role!=='required'||Number(entry.token_estimate)<0||!refs.some((ref:Values)=>ref.kind===entry.source_type&&ref.id===entry.stable_object_id&&ref.version===entry.exact_version_id))reject();const actual=(await client.query('SELECT resolved_hash FROM new_design.resolve_dependency_resource($1,$2,$3)',[entry.source_type,entry.stable_object_id,entry.exact_version_id])).rows[0];if(!actual||actual.resolved_hash!==entry.content_hash)reject();}
  }
  if(value.reply!==null){
    if(!value.reply||Object.keys(value.reply).some(key=>!['output','execution'].includes(key)))reject();
    const output=imagePreparationOutputSchema.parse(value.reply.output),execution=value.reply.execution;
    if(output.sourceHash!==source.hash||!execution||execution.routeSnapshotId!==snapshot.id||execution.routeSnapshotHash!==snapshot.snapshot_hash||execution.provider!==snapshot.provider||execution.model!==snapshot.model||!Array.isArray(execution.attempts)||!execution.attempts.some((trace:Values)=>trace.status==='succeeded'&&trace.requestSent===true&&trace.responseReceived===true))reject();
  }
  if(value.status==='failed'&&(task.status!=='failed'||step.status!=='failed'||attempt.status!=='failed'))reject();
  if(value.status==='ended_unknown'&&(value.reply!==null||task.status!=='cancelled'||step.status!=='cancelled'||attempt.status!=='discarded'))reject();
  if(value.status==='succeeded'&&(value.reply===null||!same(value.output,value.reply.output)||task.status!=='succeeded'||step.status!=='succeeded'||attempt.status!=='succeeded'))reject();
  if(['failed','ended_unknown'].includes(value.status)&&value.output!==null)reject();
}

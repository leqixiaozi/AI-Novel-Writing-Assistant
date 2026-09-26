import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {requireRecordCard} from '../../recordCards';
import {stableHash} from '../../aiContracts/integrity';

type Values=Record<string,any>;
const same=(a:unknown,b:unknown)=>stableHash(a??null)===stableHash(b??null);
const reject=(message:string):never=>{throw new NewDesignError(message,409);};
function frozen(current:Values,next:Values,mutable:string[]){
  const allowed=new Set(mutable);
  for(const key of Object.keys(next))if(!key.startsWith('record')&&!allowed.has(key)&&!same(next[key],current[key]))reject('原请求的冻结来源与范围不可替换。');
}

/** Original frozen-scope guards live with the record writer after the table cutover. */
export async function guardProductionRecord(client:PoolClient,typeKey:string,next:Values,current?:Values):Promise<void>{
  if(typeKey==='production_director_run'&&current)frozen(current,next,['status','revision','pause_requested','lease_token','lease_expires_at','failure','updated_at']);
  if(typeKey==='production_director_chapter'){
    if(current)frozen(current,next,['current_request_id','current_request_key','boundary_completed']);
    const plan=await requireRecordCard(client,next.planning_object_id,'planning_object','导演原章节规划不存在。');
    if(plan.book_id!==next.book_id||plan.card_id!==next.chapter_card_id||plan.level!=='chapter')reject('导演章节与原书籍、规划资料不匹配。');
    const version=await requireRecordCard(client,next.planning_version_id,'planning_version','导演原章节规划版本不存在。');
    if(version.object_id!==plan.id||version.book_id!==next.book_id)reject('导演确切规划版本不属于原章节。');
    if(next.current_request_id){
      const request=await requireRecordCard(client,next.current_request_id,'chapter_writing_request','导演原章节请求不存在。');
      const document=assertFound((await client.query('SELECT book_id,chapter_card_id FROM new_design.chapter_documents WHERE id=$1',[request.chapter_document_id])).rows[0],'导演原章节正文档案不存在。');
      if(request.book_id!==next.book_id||document.book_id!==next.book_id||document.chapter_card_id!==next.chapter_card_id||request.planning_object_id!==next.planning_object_id||request.planning_version_id!==next.planning_version_id||request.idempotency_key!==next.current_request_key||!request.controlled_snapshot)reject('导演原请求不属于冻结的章节、计划版本或请求键。');
    }
  }
  if(typeKey==='chapter_quality_request'){
    if(current){
      frozen(current,next,['status','model_request_state','generated_output','generated_execution','report_id','failure']);
      if(current.status!=='running'||current.generated_output&&(!same(current.generated_output,next.generated_output)||!same(current.generated_execution,next.generated_execution))||current.model_request_state!=='not_sent'&&next.model_request_state==='not_sent')reject('原诊断已结束、已发送或已保存结果，不能覆盖原来源。');
    }
    const snapshot=next.frozen_snapshot,input=snapshot?.input,payload=next.input_payload;
    if(!input||input.bookId!==next.book_id||input.chapterDocumentId!==payload.chapterDocumentId||input.body?.versionId!==payload.bodyVersionId)reject('原诊断正文与冻结来源不匹配。');
    if(!(await client.query('SELECT body.id FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions body ON body.chapter_document_id=document.id WHERE document.id=$1 AND document.book_id=$2 AND body.id=$3',[payload.chapterDocumentId,next.book_id,payload.bodyVersionId])).rowCount)reject('原诊断正文不属于本书确切章节。');
    if(!(await client.query('SELECT attempt.id FROM new_design.ai_task_attempts attempt JOIN new_design.ai_task_steps step ON step.id=attempt.step_id JOIN new_design.ai_tasks task ON task.id=attempt.task_id WHERE attempt.id=$1 AND step.id=$2 AND task.id=$3 AND task.book_id=$4 AND attempt.task_contract_version_id=$5 AND attempt.context_manifest_id=$6 AND attempt.model_route_snapshot_id=$7',[next.attempt_id,next.step_id,next.ai_task_id,next.book_id,snapshot.taskContractVersionId,snapshot.contextManifestId,snapshot.snapshotId])).rowCount)reject('原诊断执行与冻结来源不匹配。');
    if(next.generated_output){const execution=next.generated_execution;if(!execution||execution.routeSnapshotId!==snapshot.snapshotId||execution.routeSnapshotHash!==snapshot.snapshotHash||!Array.isArray(execution.attempts)||!execution.attempts.some((attempt:Values)=>attempt?.status==='succeeded'&&attempt.requestSent===true&&attempt.responseReceived===true))reject('原诊断回复缺少已发送且已收到的确切凭证。');}
  }
  if(typeKey==='chapter_writing_request'){
    if(current){
      if(['succeeded','failed','cancelled','stale'].includes(current.status))reject('原章节请求已结束，不能覆盖。');
      frozen(current,next,['ai_task_id','result_body_version_id','status','error_summary','updated_at','controlled_output','controlled_execution']);
      if(current.controlled_output&&(!same(current.controlled_output,next.controlled_output)||!same(current.controlled_execution,next.controlled_execution)))reject('原模型回复与执行凭证不可替换。');
      const transitions:Record<string,string[]>={preparing:['queued','unavailable','cancelled'],queued:['running','succeeded','failed','cancelled','unavailable','stale'],running:['succeeded','failed','cancelled','stale'],unavailable:['preparing','queued','cancelled']};
      if(next.status!==current.status&&!transitions[current.status]?.includes(next.status))reject('原章节请求状态不允许此变更。');
    }
    const document=assertFound((await client.query('SELECT * FROM new_design.chapter_documents WHERE id=$1',[next.chapter_document_id])).rows[0],'本章正文档案不存在。');
    const plan=await requireRecordCard(client,next.planning_object_id,'planning_object','章节冻结规划不存在。');
    const version=await requireRecordCard(client,next.planning_version_id,'planning_version','章节冻结规划版本不存在。');
    if(document.book_id!==next.book_id||plan.book_id!==next.book_id||plan.card_id!==document.chapter_card_id||plan.level!=='chapter'||version.object_id!==plan.id||version.book_id!==next.book_id||version.content_hash!==next.planning_content_hash||!current&&plan.adopted_version_id!==version.id)reject('章节请求与本书确切采用规划不匹配。');
    const manifest=assertFound((await client.query('SELECT * FROM new_design.context_manifests WHERE id=$1',[next.context_manifest_id])).rows[0],'章节冻结上下文不存在。');
    const contract=assertFound((await client.query('SELECT version.prompt_recipe_version_id,version.input_schema,version.task_group,version.budget_policy,recipe.variables_schema FROM new_design.task_contract_versions version JOIN new_design.prompt_recipe_versions recipe ON recipe.id=version.prompt_recipe_version_id WHERE version.id=$1',[next.task_contract_version_id])).rows[0],'章节冻结合同不存在。');
    if(manifest.book_id!==next.book_id||manifest.chapter_id!==document.chapter_card_id||manifest.task_contract_version_id!==next.task_contract_version_id||manifest.prompt_recipe_version_id!==next.prompt_recipe_version_id||manifest.model_route_snapshot_id!==next.model_route_snapshot_id||contract.prompt_recipe_version_id!==next.prompt_recipe_version_id||manifest.status!==(next.controlled_snapshot?'complete':'finalized'))reject('章节请求的冻结合同、上下文或模型来源不匹配。');
    let body:Values|null=null;
    if(next.input_body_version_id){const sourceBody=assertFound((await client.query<{content_hash:string;content:string}>('SELECT content_hash,content FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2',[next.input_body_version_id,next.chapter_document_id])).rows[0],'章节冻结输入正文不存在。');if(sourceBody.content_hash!==next.input_body_hash)reject('章节冻结输入正文哈希不匹配。');body=sourceBody;}
    if(next.ai_task_id&&!(await client.query("SELECT id FROM new_design.ai_tasks WHERE id=$1 AND book_id=$2 AND task_contract_version_id=$3 AND source_kind='chapter_writing_request' AND source_id=$4",[next.ai_task_id,next.book_id,next.task_contract_version_id,next.id])).rowCount)reject('章节请求的原任务来源不匹配。');
    if(next.controlled_snapshot){
      const snapshot=next.controlled_snapshot,input=snapshot.input;
      if(snapshot.assetId!=='new_design.chapter.generate_candidate'||snapshot.assetVersion!==contract.budget_policy?.assetVersion||contract.task_group!=='controlled_chapter_generation'||!same(contract.input_schema?.const,input)||!same(contract.variables_schema?.const,input))reject('章节控制快照与原合同冻结输入不匹配。');
      if(snapshot.contextManifestId!==next.context_manifest_id||snapshot.taskContractVersionId!==next.task_contract_version_id||snapshot.promptRecipeVersionId!==next.prompt_recipe_version_id||snapshot.snapshotId!==next.model_route_snapshot_id||input.bookId!==next.book_id||input.chapterCardId!==document.chapter_card_id||input.operation!==next.operation_kind||!same(input.body?.versionId,next.input_body_version_id)||!same(input.body?.contentHash,next.input_body_hash)||!same(input.selection?.start,next.selection_start)||!same(input.selection?.end,next.selection_end)||body&&body.content!==input.body?.content)reject('章节控制快照与原正文、选区或运行版本不匹配。');
      if(next.selection_start!==null&&snapshot.candidateBoundary?.prefix+input.selection?.text+snapshot.candidateBoundary?.suffix!==input.body?.content)reject('章节原选区边界不能改变。');
      if(next.controlled_output&&!next.controlled_execution)reject('章节原回复缺少冻结执行凭证。');
      if(next.controlled_output){
        const output=next.controlled_output;
        if(typeof output.content!=='string'||!output.content.trim()||output.content.length>2000000||!['continue','continue_with_warning','pause_for_manual','stop_for_replan'].includes(output.decision)||typeof output.reason!=='string'||output.reason.length>4000||!Array.isArray(output.warnings)||output.warnings.length>100||output.warnings.some((warning:unknown)=>typeof warning!=='string'||warning.length<1||warning.length>2000))reject('原章节回复不符合冻结的结构与长度边界。');
        if(current&&!current.controlled_output&&(current.status!=='running'||next.status!=='running'||!(await client.query("SELECT attempt.id FROM new_design.ai_task_steps step JOIN new_design.ai_task_attempts attempt ON attempt.id=step.current_attempt_id WHERE step.task_id=$1 AND step.lease_expires_at>now() AND attempt.status='running' AND attempt.task_contract_version_id=$2 AND attempt.context_manifest_id=$3 AND attempt.prompt_recipe_version_id=$4 AND attempt.model_route_snapshot_id=$5",[next.ai_task_id,next.task_contract_version_id,next.context_manifest_id,next.prompt_recipe_version_id,next.model_route_snapshot_id])).rowCount))reject('原模型回复需要原有效执行领取。');
      }
    }
    if(next.result_body_version_id){
      const result=assertFound((await client.query('SELECT * FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2',[next.result_body_version_id,next.chapter_document_id])).rows[0],'原章节结果正文不存在。');
      for(const key of ['operation_kind','planning_object_id','planning_version_id','context_manifest_id','task_contract_version_id','prompt_recipe_version_id','model_route_snapshot_id','ai_task_id','input_body_version_id'])if(!same(result[key],next[key]))reject('原章节候选的冻结来源不匹配。');
      if(result.source!=='ai_candidate')reject('原章节结果不是对应模型候选。');
      if(next.controlled_snapshot){const content=next.selection_start===null?next.controlled_output?.content:next.controlled_snapshot.candidateBoundary?.prefix+next.controlled_output?.content+next.controlled_snapshot.candidateBoundary?.suffix;if(!next.controlled_output||result.content!==content)reject('章节候选不等于原已保存模型回复。');}
    }
  }
}

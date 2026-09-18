import { randomUUID } from "node:crypto";
import type {PoolClient} from 'pg';
import type { AiRunPreview, AiRunPromptSection, AiRunStableReadContract } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { createModelRouteSnapshot, getModelRouteSnapshot } from "../aiContracts";
import { stableHash } from "../aiContracts/integrity";
import { createAiTaskInTransaction } from "../aiTasks";
import { createContextAssemblyPreview, finalizeContextManifest, getContextAssemblyPreview } from "../contextManagement";
import { getNewDesignPool } from "../runtime";
import {runInputRecord,validateRunInput} from '../../../common/contextRunInput';

type Row=Record<string,unknown>;
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const nullable=(value:unknown)=>value===null||value===undefined?null:String(value);

export interface CreateAiRunPreviewInput {
  bookId:string;
  taskContractVersionId:string;
  taskNodeKey:string;
  sourceRoute:string;
  sourceKind:string;
  sourceId?:string|null;
  volumeId?:string|null;
  chapterId?:string|null;
  sceneId?:string|null;
  inputSnapshot:Record<string,unknown>;
  safeCheckpoint:Record<string,unknown>;
  totalBudget:number;
  timeoutMs?:number;
  oneTimeOverrideKey?:string|null;
  excludeSourceKeys?:string[];
  manualSwitches?:Record<string,boolean>;
  idempotencyKey:string;
  createdBy?:string;
}

function mapSection(row:Row):AiRunPromptSection{return{id:String(row.id),slotKey:String(row.slot_key),sectionKind:row.section_kind as AiRunPromptSection["sectionKind"],label:String(row.label),sourceRefs:(row.source_refs??[]) as Array<Record<string,unknown>>,tokenEstimate:Number(row.token_estimate),sortOrder:Number(row.sort_order),contentHash:String(row.content_hash)};}
async function mapPreview(row:Row,reader?:Pick<PoolClient,'query'>):Promise<AiRunPreview>{
 const pool=reader??await getNewDesignPool();
 const sections=(await pool.query("SELECT * FROM new_design.ai_run_prompt_sections WHERE preview_id=$1 ORDER BY sort_order,id",[row.id])).rows.map(mapSection);
 const submission=(await pool.query("SELECT ai_task_id FROM new_design.ai_run_submissions WHERE preview_id=$1",[row.id])).rows[0];
 const version=(await pool.query('SELECT input_schema FROM new_design.task_contract_versions WHERE id=$1 AND prompt_recipe_version_id=$2',[row.task_contract_version_id,row.prompt_recipe_version_id])).rows[0];
 return{id:String(row.id),spaceId:String(row.space_id),bookId:String(row.book_id),taskKey:String(row.task_key),taskGroup:String(row.task_group),taskNodeKey:String(row.task_node_key),sourceRoute:String(row.source_route),sourceKind:String(row.source_kind),sourceId:nullable(row.source_id),taskContractVersionId:String(row.task_contract_version_id),promptRecipeVersionId:String(row.prompt_recipe_version_id),contextPreviewId:String(row.context_preview_id),contextManifestId:String(row.context_manifest_id),modelRouteSnapshotId:String(row.model_route_snapshot_id),inputSnapshot:(row.input_snapshot??{}) as Record<string,unknown>,inputSchema:runInputRecord(version?.input_schema)?version.input_schema:undefined,inputHash:String(row.input_hash),safeCheckpoint:(row.safe_checkpoint??{}) as Record<string,unknown>,budgetSnapshot:(row.budget_snapshot??{}) as Record<string,unknown>,promptPlan:(row.prompt_plan??{}) as Record<string,unknown>,routePlan:(row.route_plan??{}) as Record<string,unknown>,blockers:Array.isArray(row.blocker_snapshot)?row.blocker_snapshot.map(String):[],previewHash:String(row.preview_hash),status:row.status as AiRunPreview['status'],revision:Number(row.revision),sections,aiTaskId:submission?String(submission.ai_task_id):null,createdBy:String(row.created_by),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}

async function f5Blockers(bookId:string,safeCheckpoint:Record<string,unknown>):Promise<string[]>{const documentId=typeof safeCheckpoint.chapterDocumentId==="string"?safeCheckpoint.chapterDocumentId:null;if(!documentId)return[];const pool=await getNewDesignPool(),rows=await pool.query(`SELECT reason FROM new_design.chapter_revision_review_flags WHERE book_id=$1 AND target_chapter_document_id=$2 AND status IN ('pending_review','in_review') ORDER BY updated_at DESC LIMIT 20`,[bookId,documentId]),running=await pool.query("SELECT status FROM new_design.chapter_revision_executions WHERE book_id=$1 AND chapter_document_id=$2 AND status NOT IN ('stable','cancelled') ORDER BY updated_at DESC LIMIT 1",[bookId,documentId]);const blockers=rows.rows.map(row=>`旧章换稿待复核：${String(row.reason)}`);if(running.rows[0])blockers.unshift(`旧章换稿处理处于 ${String(running.rows[0].status)} 状态。`);return blockers;}

async function verifySafeCheckpoint(bookId:string,checkpoint:Record<string,unknown>):Promise<void>{const documentId=typeof checkpoint.chapterDocumentId==="string"?checkpoint.chapterDocumentId:null;if(!documentId)return;const pool=await getNewDesignPool(),row=assertFound((await pool.query("SELECT revision,adopted_version_id FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2",[documentId,bookId])).rows[0],"安全检查点对应的章节不存在。");if(checkpoint.documentRevision!==undefined&&Number(row.revision)!==Number(checkpoint.documentRevision))throw new NewDesignError("章节修订号已变化，请重新生成运行预览。",409);if(checkpoint.bodyVersionId&&String(row.adopted_version_id??"")!==String(checkpoint.bodyVersionId))throw new NewDesignError("章节采用正文已变化，请重新生成运行预览。",409);}

async function buildPromptSections(taskContractVersionId:string,contextPreviewId:string):Promise<Array<Omit<AiRunPromptSection,"id">>>{const pool=await getNewDesignPool(),recipeRows=await pool.query(`SELECT slot.slot_key,slot.sort_order,component.component_card_id,component.component_version_id,version.values->>'component_type' component_type,version.values->>'component_key' component_key FROM new_design.task_contract_versions task JOIN new_design.prompt_recipe_slots slot ON slot.recipe_version_id=task.prompt_recipe_version_id LEFT JOIN new_design.prompt_recipe_slot_components component ON component.slot_id=slot.id LEFT JOIN new_design.card_versions version ON version.id=component.component_version_id WHERE task.id=$1 ORDER BY slot.sort_order,component.sort_order,component.id`,[taskContractVersionId]),contextRows=await pool.query("SELECT slot_key,source_type,stable_object_id,exact_version_id,source_label,token_estimate,content_role,sort_order FROM new_design.context_preview_decisions WHERE preview_id=$1 AND decision='included' ORDER BY sort_order",[contextPreviewId]),task=assertFound((await pool.query("SELECT output_schema_version,output_schema FROM new_design.task_contract_versions WHERE id=$1",[taskContractVersionId])).rows[0],"任务合同版本不存在。");const sections:Array<Omit<AiRunPromptSection,"id">>=[],grouped=new Map<string,Row[]>();for(const row of recipeRows.rows)grouped.set(String(row.slot_key),[...(grouped.get(String(row.slot_key))??[]),row]);let sortOrder=0;for(const [slotKey,rows] of grouped){const refs=rows.filter(row=>row.component_version_id).map(row=>({kind:"prompt_component",cardId:String(row.component_card_id),versionId:String(row.component_version_id),componentType:String(row.component_type??""),componentKey:String(row.component_key??"")})),contentHash=stableHash(refs);sections.push({slotKey,sectionKind:"instruction",label:`${slotKey} · 提示词组件`,sourceRefs:refs,tokenEstimate:0,sortOrder:sortOrder++,contentHash});}const contextGroups=new Map<string,Row[]>();for(const row of contextRows.rows)contextGroups.set(String(row.slot_key),[...(contextGroups.get(String(row.slot_key))??[]),row]);for(const [slotKey,rows] of contextGroups){const refs=rows.map(row=>({kind:String(row.source_type),stableObjectId:String(row.stable_object_id),exactVersionId:String(row.exact_version_id),label:String(row.source_label),role:String(row.content_role)})),tokenEstimate=rows.reduce((sum,row)=>sum+Number(row.token_estimate),0),kind=rows.some(row=>row.content_role==="required")?"formal_data":"reference";sections.push({slotKey,sectionKind:kind,label:`${slotKey} · ${kind==="formal_data"?"正式资料":"参考资料"}`,sourceRefs:refs,tokenEstimate,sortOrder:sortOrder++,contentHash:stableHash(refs)});}const outputRefs=[{kind:"output_contract",version:String(task.output_schema_version),schema:task.output_schema}];sections.push({slotKey:"output",sectionKind:"output_contract",label:"输出结构",sourceRefs:outputRefs,tokenEstimate:0,sortOrder:sortOrder++,contentHash:stableHash(outputRefs)});return sections;}

export async function createAiRunPreview(input:CreateAiRunPreviewInput):Promise<AiRunPreview>{
  const pool=await getNewDesignPool(),requestHash=stableHash({bookId:input.bookId,taskContractVersionId:input.taskContractVersionId,taskNodeKey:input.taskNodeKey,sourceRoute:input.sourceRoute,sourceKind:input.sourceKind,sourceId:input.sourceId??null,volumeId:input.volumeId??null,chapterId:input.chapterId??null,sceneId:input.sceneId??null,inputSnapshot:input.inputSnapshot,safeCheckpoint:input.safeCheckpoint,totalBudget:input.totalBudget,timeoutMs:input.timeoutMs??5000,oneTimeOverrideKey:input.oneTimeOverrideKey??null,excludeSourceKeys:[...(input.excludeSourceKeys??[])].sort(),manualSwitches:input.manualSwitches??{}}),existing=(await pool.query("SELECT * FROM new_design.ai_run_previews WHERE space_id=(SELECT space_id FROM new_design.books WHERE id=$1) AND idempotency_key=$2",[input.bookId,input.idempotencyKey])).rows[0];
  if(existing){if(String(existing.request_hash)!==requestHash)throw new NewDesignError("幂等键对应另一份运行预览请求。",409);return mapPreview(existing);}
  const contract=assertFound((await pool.query(`SELECT contract.task_key,version.* FROM new_design.task_contract_versions version JOIN new_design.task_contracts contract ON contract.id=version.contract_id WHERE version.id=$1 AND contract.published_version_id=version.id`,[input.taskContractVersionId])).rows[0],"任务合同未发布，不能生成运行预览。"),book=assertFound((await pool.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'",[input.bookId])).rows[0],"书籍不存在或已归档。");
  await verifySafeCheckpoint(input.bookId,input.safeCheckpoint);
  if(!runInputRecord(contract.input_schema))throw new NewDesignError('已发布输入规格不是有效对象，请返回原业务入口或合同维护核对；未开始本次冻结。',422);
  const inputIssues=validateRunInput(contract.input_schema,input.inputSnapshot);
  if(inputIssues.length)throw new NewDesignError('本次运行输入不符合已发布规格，或含尚未支持的规则；原输入保留，请核对对应字段或返回原业务入口。',422,Object.fromEntries(inputIssues.map(issue=>[issue.path||'inputSnapshot',`${issue.label}：${issue.message}`])));
  const contextPreview=await createContextAssemblyPreview({bookId:input.bookId,taskKey:String(contract.task_key),taskGroup:String(contract.task_group),taskNodeKey:input.taskNodeKey,volumeId:input.volumeId,chapterId:input.chapterId,sceneId:input.sceneId,totalBudget:input.totalBudget,timeoutMs:input.timeoutMs??5000,taskContractVersionId:input.taskContractVersionId,manualSwitches:input.manualSwitches??{},oneTimeOverrides:{excludeSourceKeys:input.excludeSourceKeys??[],manualSwitches:input.manualSwitches??{}},createdBy:input.createdBy??"user"});
  const route=await createModelRouteSnapshot({bookId:input.bookId,taskContractVersionId:input.taskContractVersionId,nodeKey:input.taskNodeKey,oneTimeOverrideKey:input.oneTimeOverrideKey});
  const manifest=await finalizeContextManifest({previewId:contextPreview.id,modelRouteSnapshotId:route.id,idempotencyKey:`run-manifest:${input.idempotencyKey}`,createdBy:input.createdBy??"user"}),sections=await buildPromptSections(input.taskContractVersionId,contextPreview.id),blockers=await f5Blockers(input.bookId,input.safeCheckpoint),budgetSnapshot={total:contextPreview.totalBudget,included:contextPreview.includedTokens,required:contextPreview.requiredTokens,reference:contextPreview.referenceTokens,remaining:contextPreview.remainingTokens},promptPlan={recipeVersionId:String(contract.prompt_recipe_version_id),sectionCount:sections.length,sections:sections.map(section=>({slotKey:section.slotKey,kind:section.sectionKind,label:section.label,tokenEstimate:section.tokenEstimate,contentHash:section.contentHash}))},routePlan={snapshotHash:route.snapshotHash,provider:route.provider,model:route.model,sourceLayers:route.sourceLayers,fallbacks:route.fallbacks.map(item=>({provider:item.provider,model:item.model,technicalFailureCategories:item.technicalFailureCategories})),timeoutMs:route.timeoutMs,budgetPolicy:route.budgetPolicy},inputHash=stableHash(input.inputSnapshot),status=blockers.length?"blocked":"ready",previewHash=stableHash({taskContractVersionId:input.taskContractVersionId,promptRecipeVersionId:contract.prompt_recipe_version_id,contextManifestId:manifest.id,modelRouteSnapshotId:route.id,inputHash,safeCheckpoint:input.safeCheckpoint,budgetSnapshot,promptPlan,routePlan,blockers}),id=randomUUID(),client=await pool.connect();
  try{await client.query("BEGIN");const row=(await client.query(`INSERT INTO new_design.ai_run_previews(id,space_id,book_id,task_key,task_group,task_node_key,source_route,source_kind,source_id,task_contract_version_id,prompt_recipe_version_id,context_preview_id,context_manifest_id,model_route_snapshot_id,input_snapshot,input_hash,safe_checkpoint,budget_snapshot,prompt_plan,route_plan,blocker_snapshot,preview_hash,status,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22,$23,$24,$25,$26) RETURNING *`,[id,book.space_id,input.bookId,contract.task_key,contract.task_group,input.taskNodeKey,input.sourceRoute,input.sourceKind,input.sourceId??null,input.taskContractVersionId,contract.prompt_recipe_version_id,contextPreview.id,manifest.id,route.id,JSON.stringify(input.inputSnapshot),inputHash,JSON.stringify(input.safeCheckpoint),JSON.stringify(budgetSnapshot),JSON.stringify(promptPlan),JSON.stringify(routePlan),JSON.stringify(blockers),previewHash,status,input.idempotencyKey,requestHash,input.createdBy??"user"])).rows[0];for(const section of sections)await client.query("INSERT INTO new_design.ai_run_prompt_sections(id,preview_id,slot_key,section_kind,label,source_refs,token_estimate,sort_order,content_hash) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)",[randomUUID(),id,section.slotKey,section.sectionKind,section.label,JSON.stringify(section.sourceRefs),section.tokenEstimate,section.sortOrder,section.contentHash]);const receipt=await mapPreview(row,client);await client.query("COMMIT");return receipt;}catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505"){const repeated=(await pool.query("SELECT * FROM new_design.ai_run_previews WHERE space_id=$1 AND idempotency_key=$2",[book.space_id,input.idempotencyKey])).rows[0];if(repeated&&String(repeated.request_hash)===requestHash)return mapPreview(repeated);}throw error;}finally{client.release();}
}

export async function getAiRunPreview(id:string,bookId?:string):Promise<AiRunPreview>{const row=assertFound((await(await getNewDesignPool()).query("SELECT * FROM new_design.ai_run_previews WHERE id=$1 AND ($2::uuid IS NULL OR book_id=$2)",[id,bookId??null])).rows[0],"运行预览不存在。");return mapPreview(row);}
export async function listAiRunPreviews(bookId:string,limit=30):Promise<AiRunPreview[]>{const rows=(await(await getNewDesignPool()).query("SELECT * FROM new_design.ai_run_previews WHERE book_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2",[bookId,Math.min(100,limit)])).rows,result:AiRunPreview[]=[];for(const row of rows)result.push(await mapPreview(row));return result;}

/** Read the original durable receipt, not a content-similarity guess. Null is only
 * "no committed receipt visible"; upstream preparation/task transactions may exist. */
async function readByRequest(bookId:string,key:string,operation:'preview'|'submission'):Promise<AiRunPreview|null> {
 if(!/^[0-9a-f-]{36}$/i.test(bookId)||key.length<8||key.length>160)throw new NewDesignError('原请求的本书范围或凭证无效，请保留输入核对原凭证。',422);
 const client=await(await getNewDesignPool()).connect();try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`context-run-receipt:${bookId}:${operation}:${key}`]);
  const rows=(await client.query(operation==='preview'
   ?'SELECT preview.* FROM new_design.ai_run_previews preview WHERE preview.book_id=$1 AND preview.idempotency_key=$2 LIMIT 2'
   :'SELECT preview.* FROM new_design.ai_run_submissions submission JOIN new_design.ai_run_previews preview ON preview.id=submission.preview_id WHERE preview.book_id=$1 AND submission.idempotency_key=$2 LIMIT 2',[bookId,key])).rows;
  if(rows.length>1)throw new NewDesignError('原请求对应多份冻结凭证，请打开运行维护核对，不选择其中任意一份。',409);
  const result=rows[0]?await mapPreview(rows[0],client):null;await client.query('COMMIT');return result;
 }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}
export const readAiRunPreviewByRequest=(bookId:string,key:string):Promise<AiRunPreview|null>=>readByRequest(bookId,key,'preview');
export const readAiRunSubmissionByRequest=(bookId:string,key:string):Promise<AiRunPreview|null>=>readByRequest(bookId,key,'submission');

export async function submitAiRunPreview(id:string,input:{expectedRevision:number;idempotencyKey:string;submittedBy?:string}):Promise<AiRunPreview>{
 const pool=await getNewDesignPool(),repeated=(await pool.query("SELECT preview_id FROM new_design.ai_run_submissions WHERE idempotency_key=$1",[input.idempotencyKey])).rows[0];
 if(repeated){if(String(repeated.preview_id)!==id)throw new NewDesignError("幂等键对应另一份运行提交。",409);return getAiRunPreview(id);}
 const preview=await getAiRunPreview(id);
 if(!preview.inputSchema)throw new NewDesignError('原冻结合同输入规格未完整读取，请打开运行维护核对；原预览与输入保留，禁止提交。',422);
 const issues=validateRunInput(preview.inputSchema,preview.inputSnapshot);
 if(issues.length)throw new NewDesignError('原预览输入不符合其确切冻结合同，或规格尚未支持；不能用目前发布版本代替，请返回原业务入口核对。',422,Object.fromEntries(issues.map(issue=>[issue.path||'inputSnapshot',`${issue.label}：${issue.message}`])));
 if(preview.revision!==input.expectedRevision)throw new NewDesignError("运行预览已变化，请刷新后重试。",409);
 if(preview.status!=="ready")throw new NewDesignError(preview.status==="blocked"?"运行预览存在阻断项，不能提交。":"运行预览不可重复提交。",409);
 await verifySafeCheckpoint(preview.bookId,preview.safeCheckpoint);
 const currentContext=await getContextAssemblyPreview(preview.contextPreviewId,preview.bookId);if(currentContext.status!=="complete")throw new NewDesignError("上下文来源已变化，请重新生成运行预览。",409);
 const currentRoute=await getModelRouteSnapshot(preview.modelRouteSnapshotId);if(currentRoute.snapshotHash!==String((preview.routePlan as Row).snapshotHash))throw new NewDesignError("模型路由快照校验失败，请重新生成运行预览。",409);
 const blockers=await f5Blockers(preview.bookId,preview.safeCheckpoint);if(blockers.length)throw new NewDesignError("旧章换稿状态发生变化，请重新生成运行预览。",409,{blockers:blockers.join("\n")});
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`ai-run-submission:${input.idempotencyKey}`]);
  const prior=(await client.query('SELECT preview_id FROM new_design.ai_run_submissions WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0];
  if(prior){if(String(prior.preview_id)!==id)throw new NewDesignError('原提交键对应另一份预览。',409);await client.query('COMMIT');return getAiRunPreview(id);}
  const head=assertFound((await client.query('SELECT status,revision FROM new_design.ai_run_previews WHERE id=$1 FOR UPDATE',[id])).rows[0],'原预览不存在。');
  if(head.status!=='ready'||Number(head.revision)!==input.expectedRevision)throw new NewDesignError('原预览已变化或提交，未创建第二个运行任务。',409);
  if(typeof preview.safeCheckpoint.chapterDocumentId==='string')await client.query('SELECT id FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2 FOR UPDATE',[preview.safeCheckpoint.chapterDocumentId,preview.bookId]);
  await verifySafeCheckpoint(preview.bookId,preview.safeCheckpoint);
  const task=await createAiTaskInTransaction(client,{spaceId:preview.spaceId,bookId:preview.bookId,taskKey:preview.taskKey,taskContractVersionId:preview.taskContractVersionId,sourceRoute:preview.sourceRoute,sourceKind:preview.sourceKind,sourceId:preview.sourceId??preview.id,requestIdempotencyKey:`run:${input.idempotencyKey}`,createdBy:input.submittedBy??'user',steps:[{stepKey:preview.taskNodeKey,sortOrder:0,maxAttempts:5}]});
  await client.query("UPDATE new_design.ai_run_previews SET status='submitted',revision=revision+1,updated_at=now() WHERE id=$1",[id]);
  await client.query('INSERT INTO new_design.ai_run_submissions(id,preview_id,ai_task_id,submitted_revision,idempotency_key,submitted_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,task.id,input.expectedRevision,input.idempotencyKey,input.submittedBy??'user']);
  await client.query('COMMIT');return getAiRunPreview(id);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function getAiRunStableReadContract(bookId:string):Promise<AiRunStableReadContract>{return{bookId,connectedEntryPoints:[{key:"unified_preview",label:"高级设置中的统一运行预览",sourceRoute:"/new-design/structure/context"},{key:"chapter_writing",label:"章节创作快捷操作",sourceRoute:`/new-design/books/${bookId}/writing`},{key:"chapter_extract_changes",label:"章节采用后的变化提取",sourceRoute:`/new-design/books/${bookId}/writing`}],unconnectedEntryPoints:[{key:"book_creation_assist",label:"开书会话与表单辅助",reason:"使用开书会话自己的候选协议，尚未迁入统一运行冻结单。"},{key:"market_analysis",label:"市场分析与拆书运行",reason:"研究运行保持独立；只有采用到书内时进入可编辑候选预览。"}],recentRuns:await listAiRunPreviews(bookId,50),generatedAt:new Date().toISOString()};}

import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {ChapterSettlementEditingWorkspace,SettlementEditingCatalog,SettlementEditingMutation,SettlementEditingCreateInput,SettlementEditingUpdateInput,SettlementEditingDecisionsInput,SettlementEditingCommitInput,SettlementEditingInitialInput,SettlementEditingReceipt,SettlementEditingAiImportInput} from "../../../common/chapterSettlementEditing";
import {NewDesignError} from "../../domain/errors";
import {stableHash} from "../aiContracts/integrity";
import {validateFieldValue} from "../../domain/validation";
import {validateDictionaryTreeBindings,validateDictionaryTreeValues} from "../treeResources";
import {detectCanonicalFactConflictsInTransaction,validateCanonicalFactValueInTransaction} from "../factStore";
import {getNewDesignPool,inSettlementTransaction} from "./transaction";
import {addChapterSettlementItem,updateChapterSettlementItem,decideChapterSettlementItems,settleChapterAdoptionSession,startChapterAdoptionSession as startLegacySession,materializeAiEditingItem} from "./store";
import {readEditingCatalog} from "./editingCatalog";
import {validateEditingDraft,SettlementEditingError,fail,isStateCategory,type EditingRow} from "./editingPolicy";
import {lockEditingSession,assertEditingSession,readEditingWorkspace,receiptByKey,appendEditingReceipt,freezeEditingItem,readDomain,frozenItemContract} from "./editingRepository";

async function requestLock(client:PoolClient,sessionId:string,key:string):Promise<void>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter_settlement_editing:${sessionId}:${key}`]);
}
async function bookLock(client:PoolClient,bookId:unknown):Promise<void>{await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter_settlement_editing_book:${bookId}`]);}
function requestInput(input:SettlementEditingMutation):void{
  if(!Number.isInteger(input.expectedSessionRevision)||input.expectedSessionRevision<1||typeof input.requestKey!=="string"||input.requestKey.length<8||input.requestKey.length>160)
    fail(null,"清单版本或保存请求标识无效，请重新读取本章清单。",422,"requestKey");
}
type Command=(client:PoolClient,session:EditingRow)=>Promise<string|null>;
async function mutate(sessionId:string,operation:SettlementEditingReceipt["operation"],input:SettlementEditingMutation,fullInput:unknown,command:Command):Promise<SettlementEditingReceipt>{
  requestInput(input);
  const pool=await getNewDesignPool(),client=await pool.connect();let session:EditingRow|null=null,committing=false;
  try{
    await client.query("BEGIN");await requestLock(client,sessionId,input.requestKey);
    const prior=await receiptByKey(client,sessionId,input.requestKey),hash=stableHash(JSON.parse(JSON.stringify({sessionId,operation,input:fullInput})));
    if(prior){
      const saved=prior.receipt.workspace.session;session={id:saved.id,book_id:saved.bookId,chapter_document_id:saved.chapterDocumentId};
      if(prior.inputHash!==hash)fail(session,"该保存请求标识已用于不同内容，不能覆盖；请核对原请求结果。",409,"requestKey");
      committing=true;await client.query("COMMIT");return{...prior.receipt,repeated:true};
    }
    const initial=(await client.query("SELECT book_id FROM new_design.chapter_adoption_sessions WHERE id=$1",[sessionId])).rows[0];
    if(!initial)fail(null,"章节确认会话不存在。",404);
    await bookLock(client,initial.book_id);session=await lockEditingSession(client,sessionId);assertEditingSession(session,input.expectedSessionRevision);
    const receipt=await inSettlementTransaction(client,async()=>{
      const itemId=await command(client,session as EditingRow),workspace=await readEditingWorkspace(client,sessionId);
      const receipt:SettlementEditingReceipt={sessionId,requestKey:input.requestKey,operation,itemId,workspace,repeated:false};
      await appendEditingReceipt(client,session as EditingRow,input.requestKey,hash,receipt,input.actor??"user");return receipt;
    });
    committing=true;await client.query("COMMIT");return receipt;
  }catch(error){
    let rolledBack=false;try{await client.query("ROLLBACK");rolledBack=true;}catch{/* The write outcome stays unknown. */}
    if(committing||!rolledBack)throw new SettlementEditingError("服务器未确认保存结果，请保留当前输入，使用原请求核对保存结果，不重复提交。",503,session,undefined,"核对保存回执");
    const reported=error instanceof SettlementEditingError?error:error instanceof NewDesignError?new SettlementEditingError(error.message,error.status,session,error.issues):new SettlementEditingError("保存未完成，服务器已确认回滚；请保留输入，修复服务后重新读取清单并明确重新准备。",503,session,undefined,"保存章节清单");
    reported.recovery.mutationOutcome="not_written";reported.recovery.savedResult="本次操作已回滚，未写入；已保存的正文、清单和正式事实，以及当前输入保留。";throw reported;
  }finally{client.release();}
}
export async function getChapterSettlementEditingWorkspace(id:string):Promise<ChapterSettlementEditingWorkspace>{
  const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const workspace=await inSettlementTransaction(client,()=>readEditingWorkspace(client,id));await client.query("COMMIT");return workspace;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function getChapterSettlementEditingCatalog(id:string):Promise<SettlementEditingCatalog>{return(await getChapterSettlementEditingWorkspace(id)).catalog;}
export async function getChapterSettlementEditingCatalogInTransaction(client:PoolClient,session:EditingRow,lock=true):Promise<SettlementEditingCatalog>{return readEditingCatalog(client,session,lock);}
export async function readChapterSettlementEditingReceipt(id:string,key:string):Promise<SettlementEditingReceipt|null>{
  if(typeof key!=="string"||key.length<8||key.length>160)fail(null,"原请求标识无效。",422,"requestKey");
  const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN");await requestLock(client,id,key);const session=(await client.query("SELECT id FROM new_design.chapter_adoption_sessions WHERE id=$1 FOR SHARE",[id])).rows[0];if(!session)fail(null,"章节确认会话不存在。",404);const prior=await receiptByKey(client,id,key);await client.query("COMMIT");return prior?{...prior.receipt,repeated:true}:null;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function createChapterSettlementEditingItem(id:string,input:SettlementEditingCreateInput):Promise<SettlementEditingReceipt>{
  return mutate(id,"create",input,input,async(client,session)=>{
    const catalog=await readEditingCatalog(client,session,true),validated=await validateEditingDraft(client,session,input.draft,catalog.subjects);
    const before=new Set((await client.query("SELECT id FROM new_design.chapter_settlement_items WHERE session_id=$1",[id])).rows.map(row=>String(row.id)));
    const workspace=await addChapterSettlementItem(id,validated.draft,input.actor??"user"),item=workspace.items.find(item=>!before.has(item.id));
    if(!item)fail(session,"新增提案未形成保存结果。",503);
    await freezeEditingItem(client,session,item.id,validated.draft,validated.field,input.actor??"user");
    if(item.canonicalFactId)await detectCanonicalFactConflictsInTransaction(client,(await client.query("SELECT * FROM new_design.canonical_facts WHERE id=$1",[item.canonicalFactId])).rows[0]);
    return item.id;
  });
}
async function itemSession(itemId:string):Promise<string>{const row=(await(await getNewDesignPool()).query("SELECT session_id FROM new_design.chapter_settlement_items WHERE id=$1",[itemId])).rows[0];if(!row)fail(null,"变化提案不存在。",404);return String(row.session_id);}
export async function updateChapterSettlementEditingItem(itemId:string,input:SettlementEditingUpdateInput):Promise<SettlementEditingReceipt>{
  const id=await itemSession(itemId);
  return mutate(id,"update",input,{itemId,...input},async(client,session)=>{
    const item=(await client.query("SELECT * FROM new_design.chapter_settlement_items WHERE id=$1 AND session_id=$2 FOR UPDATE",[itemId,id])).rows[0];
    if(!item||Number(item.revision)!==input.expectedRevision)fail(session,"变化提案已被修改，请重新读取后核对当前输入。",409,"expectedRevision");
    const contract=await frozenItemContract(client,id,itemId),domain=await readDomain(client,session,item,true);
    if(!contract||domain.status!=="proposed"||domain.hash!==contract.domainHash)fail(session,"领域提案来源已变化或缺少正式编辑规格，不能覆盖；请重新补充待核对提案。",409,"itemId");
    const catalog=await readEditingCatalog(client,session,true),validated=await validateEditingDraft(client,session,input.draft,catalog.subjects);
    await updateChapterSettlementItem(itemId,{expectedRevision:input.expectedRevision,draft:validated.draft,actor:input.actor,note:input.note});
    await freezeEditingItem(client,session,itemId,validated.draft,validated.field,input.actor??"user");
    if(item.canonical_fact_id)await detectCanonicalFactConflictsInTransaction(client,(await client.query("SELECT * FROM new_design.canonical_facts WHERE id=$1",[item.canonical_fact_id])).rows[0]);
    return itemId;
  });
}
export async function decideChapterSettlementEditingItems(id:string,input:SettlementEditingDecisionsInput):Promise<SettlementEditingReceipt>{
  return mutate(id,"decide",input,input,async(client,session)=>{
    const catalog=await readEditingCatalog(client,session,true),seen=new Set<string>();
    for(const decision of input.decisions){
      if(seen.has(decision.itemId))fail(session,"同一提案不能在本次决定中重复出现。",422,"decisions");seen.add(decision.itemId);
      const item=(await client.query("SELECT * FROM new_design.chapter_settlement_items WHERE id=$1 AND session_id=$2 FOR UPDATE",[decision.itemId,id])).rows[0];
      if(!item||Number(item.revision)!==decision.expectedRevision)fail(session,"待核对提案已变化，请重新读取清单。",409,"decisions.expectedRevision");
      const domain=await readDomain(client,session,item,true);if(domain.status!=="proposed")fail(session,`“${item.title}”已在其他页面处理，不能重复决定。`,409,"decisions");
      if(decision.decision==="confirm"){
        const contract=await frozenItemContract(client,id,decision.itemId);if(!contract||domain.hash!==contract.domainHash)fail(session,`“${item.title}”缺少真实冻结规格或已被改动，不能确认。`,409,"decisions");
        await validateEditingDraft(client,session,contract.draft,catalog.subjects);
      }
    }
    // Normalize the existing status graph before the first decision, preserving
    // the source request's original expected revision in its receipt hash.
    let revision=Number(session.revision);
    if(session.status==="adopted_pending_proposals"||session.status==="failed"){
      await client.query("UPDATE new_design.chapter_adoption_sessions SET status='pending_review',revision=revision+1,error_summary='',updated_at=now() WHERE id=$1",[id]);revision++;
    }
    await decideChapterSettlementItems(id,{expectedRevision:revision,decisions:input.decisions,actor:input.actor});return null;
  });
}
export async function commitChapterSettlementEditing(id:string,input:SettlementEditingCommitInput):Promise<SettlementEditingReceipt>{
  return mutate(id,"commit",input,input,async(client,session)=>{
    const catalog=await readEditingCatalog(client,session,true),items=(await client.query("SELECT * FROM new_design.chapter_settlement_items WHERE session_id=$1 ORDER BY id FOR UPDATE",[id])).rows,states=new Set<string>();
    for(const item of items){
      const domain=await readDomain(client,session,item,true);if(domain.status!=="proposed")fail(session,`“${item.title}”已在其他页面处理，请核对领域结果，不能重复结算。`,409,"items");
      if(item.decision==="confirm"){
        const contract=await frozenItemContract(client,id,String(item.id));if(!contract||domain.hash!==contract.domainHash)fail(session,`“${item.title}”的冻结提案版本已失效，不能确认。`,409,"items");
        const validated=await validateEditingDraft(client,session,contract.draft,catalog.subjects);
        if(isStateCategory(validated.draft.category)){
          const key=`${validated.subject.subjectKind}:${validated.subject.id}:${validated.field.key}`;
          if(states.has(key))fail(session,`${validated.subject.label} · ${validated.field.label}存在多条确认变化，请仅保留一条明确的前后变化。`,409,"items");states.add(key);
          if((domain.data.state as EditingRow).before_known!==true)fail(session,"状态提案没有已核对前值，不能结算。",409,"beforeValue");
        }else if(item.canonical_fact_id){
          const fact=domain.data.fact as EditingRow;validateCanonicalFactValueInTransaction(fact.value_kind as "text",fact.value_json,fact.object_card_id as string|null);
          await detectCanonicalFactConflictsInTransaction(client,fact);
          if((await client.query("SELECT 1 FROM new_design.canonical_fact_conflicts WHERE status='open' AND (fact_a_id=$1 OR fact_b_id=$1) LIMIT 1",[item.canonical_fact_id])).rowCount)
            fail(session,`${validated.subject.label} · ${validated.field.label}与已保存事实存在冲突。请在本章点击该提案的“不纳入”，核对正确字段或变化类型后重新补充；原正文和记录保留。`,409,`items.${item.id}.afterValue`,"核对事实冲突");
        }
      }
    }
    await settleChapterAdoptionSession(id,{expectedRevision:input.expectedSessionRevision,idempotencyKey:`editing:${input.requestKey}`,actor:input.actor,note:input.note});
    return null;
  });
}
export async function establishChapterSettlementEditingInitialState(id:string,input:SettlementEditingInitialInput):Promise<SettlementEditingReceipt>{
  return mutate(id,"initial",input,input,async(client,session)=>{
    const catalog=await readEditingCatalog(client,session,true),subject=catalog.subjects.find(subject=>subject.id===input.subjectId&&subject.subjectKind===input.subjectKind),field=subject?.fields.find(field=>field.key===input.stateKey);
    if(!subject||subject.unavailableReason||!field)fail(session,"所选对象字段没有正式可结算规格。",422,"stateKey");
    if(field.specificationHash!==input.specificationHash)fail(session,"正式字段规格已变化，请重新读取后建立初始状态。",409,"specificationHash");
    if(field.baseline.known||field.baseline.stale)fail(session,"该字段已有前值或来源需核对，不能覆盖建立初始状态。",409,"value");
    if(!Object.hasOwn(input,"value"))fail(session,"请明确填写初始状态。",422,"value");
    const issue=validateFieldValue(field.field,input.value),bindings=await validateDictionaryTreeBindings(client,[field.field]),values=await validateDictionaryTreeValues(client,[field.field],{[field.key]:input.value});
    if(issue||bindings[field.key]||values[field.key])fail(session,`${subject.label} · ${field.label}：${issue??bindings[field.key]??values[field.key]}`,422,"value");
    const prior=await client.query("SELECT id FROM new_design.entity_initial_states WHERE book_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state_key=$4 FOR UPDATE",[session.book_id,input.subjectKind,input.subjectId,input.stateKey]);
    if(prior.rowCount)fail(session,"该字段已有初始状态记录，请核对前值来源，不能新增覆盖。",409,"value");
    const stateId=randomUUID(),versionId=randomUUID();
    await client.query("INSERT INTO new_design.entity_initial_states(id,book_id,subject_kind,subject_id,state_key) VALUES($1,$2,$3,$4,$5)",[stateId,session.book_id,input.subjectKind,input.subjectId,input.stateKey]);
    await client.query("INSERT INTO new_design.entity_initial_state_versions(id,initial_state_id,version,value_json,value_hash,actor,note) VALUES($1,$2,1,$3::jsonb,$4,$5,$6)",[versionId,stateId,JSON.stringify(input.value),stableHash(input.value),input.actor??"user",input.note??"在章节结果确认中明确建立初始状态。"]);
    await client.query("UPDATE new_design.entity_initial_states SET current_version_id=$2,updated_at=now() WHERE id=$1",[stateId,versionId]);
    await client.query("INSERT INTO new_design.current_state_projections(book_id,subject_kind,subject_id,state_key,value_json,source_initial_version_id,is_stale) VALUES($1,$2,$3,$4,$5::jsonb,$6,false)",[session.book_id,input.subjectKind,input.subjectId,input.stateKey,JSON.stringify(input.value),versionId]);
    await client.query("UPDATE new_design.chapter_adoption_sessions SET revision=revision+1,updated_at=now() WHERE id=$1",[id]);return null;
  });
}

export async function startChapterAdoptionSession(preparationId:string,input:{expectedRevision:number;idempotencyKey:string;actor?:string}):Promise<ChapterSettlementEditingWorkspace>{
  const client=await(await getNewDesignPool()).connect();let session:EditingRow|null=null,committing=false;
  const hash=stableHash({preparationId,expectedRevision:input.expectedRevision,idempotencyKey:input.idempotencyKey,actor:input.actor??"user"});
  try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter_settlement_preparation:${preparationId}`]);
    const prep=(await client.query("SELECT * FROM new_design.chapter_adoption_preparations WHERE id=$1 FOR UPDATE",[preparationId])).rows[0];if(!prep)fail(null,"采用确认准备记录不存在。",404);
    await bookLock(client,prep.book_id);
    const prior=(await client.query("SELECT * FROM new_design.chapter_adoption_sessions WHERE preparation_id=$1 OR (book_id=$2 AND idempotency_key=$3) ORDER BY created_at LIMIT 1",[preparationId,prep.book_id,input.idempotencyKey])).rows[0];
    if(prior){
      session=prior;
      const receipt=(await client.query("SELECT detail FROM new_design.chapter_settlement_events WHERE session_id=$1 AND detail->>'editingKind'='start'",[prior.id])).rows[0];
      if(prior.preparation_id!==preparationId||!receipt||receipt.detail.inputHash!==hash)fail(prior,"原采用请求已用于不同输入，或历史请求没有严格凭证，请核对原会话，不能覆盖。",409,"idempotencyKey");
      const workspace=await inSettlementTransaction(client,()=>readEditingWorkspace(client,String(prior.id)));committing=true;await client.query("COMMIT");return workspace;
    }
    const workspace=await inSettlementTransaction(client,async()=>{
      const base=await startLegacySession(preparationId,input);session=(await client.query("SELECT * FROM new_design.chapter_adoption_sessions WHERE id=$1",[base.session.id])).rows[0];
      if(!session||session.preparation_id!==preparationId)fail(session,"原采用请求归属不一致。",409);
      await client.query("INSERT INTO new_design.chapter_settlement_events(id,session_id,event_kind,to_status,actor,detail) VALUES($1,$2,'session_started',$3,$4,$5::jsonb)",[randomUUID(),session.id,session.status,input.actor??"user",JSON.stringify({editingKind:"start",inputHash:hash,preparationId})]);
      return readEditingWorkspace(client,String(session.id));
    });committing=true;await client.query("COMMIT");return workspace;
  }catch(error){
    let rollback=false;try{await client.query("ROLLBACK");rollback=true;}catch{/* unknown */}
    if(committing||!rollback)throw new SettlementEditingError("未确认采用准备是否完成，请保留原准备记录，先核对对应章节会话。",503,session,undefined,"核对采用准备结果");
    const reported=error instanceof SettlementEditingError?error:error instanceof NewDesignError?new SettlementEditingError(error.message,error.status,session,error.issues,"准备章节结果确认"):new SettlementEditingError("采用准备未完成，服务器已确认回滚；请保留正文与准备记录，修复服务后明确重新准备。",503,session,undefined,"准备章节结果确认");reported.recovery.mutationOutcome="not_written";reported.recovery.savedResult="本次采用准备已回滚，未写入；正文与原准备记录保留。";throw reported;
  }finally{client.release();}
}
export async function getChapterSettlementEditingByPreparation(preparationId:string):Promise<ChapterSettlementEditingWorkspace|null>{
  const client=await(await getNewDesignPool()).connect();try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter_settlement_preparation:${preparationId}`]);
    const prep=(await client.query("SELECT id FROM new_design.chapter_adoption_preparations WHERE id=$1 FOR SHARE",[preparationId])).rows[0];if(!prep)fail(null,"采用准备记录不存在。",404);
    const row=(await client.query("SELECT id FROM new_design.chapter_adoption_sessions WHERE preparation_id=$1 FOR SHARE",[preparationId])).rows[0];
    const workspace=row?await inSettlementTransaction(client,()=>readEditingWorkspace(client,String(row.id))):null;await client.query("COMMIT");return workspace;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function createChapterSettlementEditingAiItems(id:string,input:SettlementEditingAiImportInput):Promise<SettlementEditingReceipt>{
  return mutate(id,"create",input,input,async(client,session)=>{
    const task=(await client.query("SELECT * FROM new_design.ai_tasks WHERE id=$1 FOR SHARE",[input.taskId])).rows[0],attempt=(await client.query("SELECT * FROM new_design.ai_task_attempts WHERE id=$1 AND task_id=$2 FOR SHARE",[input.attemptId,input.taskId])).rows[0];
    if(!task||!attempt||task.book_id!==session.book_id||task.source_kind!=="chapter_settlement_extraction"||!["running","succeeded"].includes(String(attempt.status)))fail(session,"AI 候选缺少本章真实执行凭证，不能入库。",409,"attemptId");
    const request=(await client.query("SELECT * FROM new_design.chapter_proposal_extraction_requests WHERE id=$1 AND session_id=$2 AND ai_task_id=$3 FOR UPDATE",[task.source_id,id,task.id])).rows[0];
    if(request?.status!=="running"||Number(request?.expected_session_revision)!==input.expectedSessionRevision)fail(session,"AI 原请求已导入或清单版本已变化，请核对原保存结果；不能用新请求重复导入。",409,"requestKey");
    if(!request||!request.frozen_plan||!request.generated_output||request.body_version_id!==input.bodyVersionId||input.bodyVersionId!==session.body_version_id||request.context_manifest_id!==input.contextManifestId||request.model_route_snapshot_id!==input.modelRouteSnapshotId||attempt.context_manifest_id!==input.contextManifestId||attempt.model_route_snapshot_id!==input.modelRouteSnapshotId||attempt.task_contract_version_id!==request.task_contract_version_id||attempt.prompt_recipe_version_id!==request.prompt_recipe_version_id||attempt.input_hash!==request.frozen_input_hash)
      fail(session,"AI 执行正文、上下文或模型快照与本章冻结请求不一致，不能导入；模型结果保留供核对。",409,"attemptId");
    const plan=request.frozen_plan as {input:{sessionId:string;bodyVersionId:string;bodyContentHash:string;catalog:SettlementEditingCatalog}},output=request.generated_output as {items:unknown[]},catalog=await readEditingCatalog(client,session,true);
    if(plan.input.sessionId!==id||plan.input.bodyVersionId!==session.body_version_id||plan.input.bodyContentHash!==catalog.bodyContentHash||plan.input.catalog.specificationHash!==input.catalogHash||catalog.specificationHash!==input.catalogHash||stableHash(output.items)!==stableHash(input.items))fail(session,"AI 原候选或正式字段规格已变化，不能改写旧模型结果；请核对原结果后重新准备提取。",409,"items");
    if(input.items.length>1000)fail(session,"AI 候选超出本章可核对数量。",422,"items");
    for(const item of input.items){
      const validated=await validateEditingDraft(client,session,item,catalog.subjects),materializedId=await materializeAiEditingItem(client,session,validated.draft,input.taskId,input.attemptId,input.actor??"AI");
      await freezeEditingItem(client,session,materializedId,validated.draft,validated.field,input.actor??"AI");
      const raw=(await client.query("SELECT canonical_fact_id FROM new_design.chapter_settlement_items WHERE id=$1",[materializedId])).rows[0];
      if(raw.canonical_fact_id)await detectCanonicalFactConflictsInTransaction(client,(await client.query("SELECT * FROM new_design.canonical_facts WHERE id=$1",[raw.canonical_fact_id])).rows[0]);
    }
    await client.query("UPDATE new_design.chapter_adoption_sessions SET status='pending_review',revision=revision+1,error_summary='',updated_at=now() WHERE id=$1",[id]);
    await client.query("UPDATE new_design.chapter_proposal_extraction_requests SET status='succeeded',failure=NULL,updated_at=now() WHERE id=$1",[request.id]);return null;
  });
}

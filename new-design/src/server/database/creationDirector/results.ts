import type {CreationPreparationOutput,CreationPreparationReceipt,CreationPreparationFailure,CreationPreparationAdoptionReceipt,AdoptCreationPreparationInput} from "../../../common/creationReviewAi";
import {CREATION_DIRECTOR_STAGES,creationDirectorState} from "../../../common/creationDirector";
import {NewDesignError,assertFound} from "../../domain/errors";
import {getCreationPool as getNewDesignPool} from "../bookCreationStore";
import {adoptCreationPreparationInTransaction} from "../bookCreationStore";
import {stableHash} from "../aiContracts";
import {directorTransaction,CreationPreparationError,preparationFailure} from "./transaction";
import {batchSessionId,readOwnedCreationBatch,creationPreparationReceipt,getCreationPreparationResult,type CreationPreparationClaim} from "./preparation";

export async function saveCreationPreparationGeneratedOutput(claim:CreationPreparationClaim,output:CreationPreparationOutput,execution:Record<string,unknown>):Promise<void>{
 await directorTransaction(claim.sessionId,async db=>{
  await db.query("SELECT id FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[claim.sessionId]);const batch=await readOwnedCreationBatch(db,claim.batchId,true);
  if(batch.status!=="running"||batch.preparation_terminal||batch.frozen_plan.inputHash!==claim.plan.inputHash)throw new NewDesignError("此准备已结束，迟到模型输出未覆盖任何表单。",409);
  if(batch.preparation_generated_output){if(stableHash(batch.preparation_generated_output)!==stableHash(output))throw new NewDesignError("原模型结果不可换成另一次输出。",409);return;}
  await db.query("UPDATE new_design.ai_generation_batches SET preparation_generated_output=$2::jsonb,preparation_execution=$3::jsonb,updated_at=now() WHERE id=$1",[claim.batchId,JSON.stringify(output),JSON.stringify({...execution,providerOutput:output,providerOutputHash:stableHash(output),sourceBatches:claim.plan.sourceBatches})]);
 });
}

export async function saveCreationPreparationOutput(claim:CreationPreparationClaim,output:CreationPreparationOutput,execution:Record<string,unknown>):Promise<CreationPreparationReceipt>{
 return directorTransaction(claim.sessionId,async db=>{
  const session=assertFound((await db.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[claim.sessionId])).rows[0],"开书流程不存在。"),batch=await readOwnedCreationBatch(db,claim.batchId,true);
  if(batch.preparation_terminal||batch.status!=="running"||batch.frozen_plan.inputHash!==claim.plan.inputHash)throw new NewDesignError("这次准备已被结束或接管，迟到模型结果没有覆盖开书表单。",409);
  if(batch.output_payload&&Array.isArray(batch.output_payload.candidates))throw new NewDesignError("原结果已经保存，请读取旧结果，不再生成。",409);
  if(!batch.preparation_generated_output||stableHash(batch.preparation_generated_output)!==stableHash(output))throw new NewDesignError("请先核对已经保存的原模型输出，不允许替换结果。",409);
  // Cumulative pending candidates retain an exact prior-batch chain, never pretend those candidates were adopted.
  const carried=claim.plan.carriedOutput;
  for(const source of claim.plan.sourceBatches){const previous=await readOwnedCreationBatch(db,source.id,true);if(previous.session_id!==claim.sessionId||previous.frozen_plan.inputHash!==source.inputHash||stableHash(previous.output_payload)!==source.outputHash||previous.status!=="review"||previous.preparation_terminal)throw new NewDesignError("前阶段待审来源已被采用或结束，本次迟到结果未覆盖表单；请读取已有阶段结果。",409);}
  const noTypes=Boolean(claim.stage)&&claim.stage!=="direction"&&claim.plan.input.schemaTypes.length===0;
  const stageNotes=noTypes?[...output.notes,`${CREATION_DIRECTOR_STAGES.find(stage=>stage.key===claim.stage)!.name}：所选模板没有本阶段内容类型，本阶段未生成这类资料，明确跳过。`]:output.notes;
  const combined:CreationPreparationOutput=carried?{candidates:[...carried.candidates,...output.candidates],directions:output.directions.length?output.directions:carried.directions,relations:[...carried.relations,...output.relations],plans:output.plans.length?output.plans:carried.plans,notes:[...carried.notes,...stageNotes].slice(-30)}:{...output,notes:stageNotes};
  if(combined.candidates.length>300||combined.relations.length>500||combined.plans.length>500||new Set(combined.candidates.map(card=>card.reviewCardId)).size!==combined.candidates.length)throw new NewDesignError("累计候选的资料数量或精确引用重复，请读取前阶段保存结果。",422);
  await db.query("UPDATE new_design.ai_generation_batches SET status='review',output_payload=$2::jsonb,preparation_execution=$3::jsonb,preparation_failure=NULL,progress=100,completed_at=now(),updated_at=now() WHERE id=$1",[claim.batchId,JSON.stringify(combined),JSON.stringify({...execution,providerOutput:output,providerOutputHash:stableHash(output),sourceBatches:claim.plan.sourceBatches})]);
  for(const source of claim.plan.sourceBatches)await db.query("UPDATE new_design.ai_generation_batches SET preparation_superseded_by=$2 WHERE id=$1",[source.id,claim.batchId]);
  const state=creationDirectorState(session.input_payload);
  if(claim.stage&&state?.activeBatchId===claim.batchId){const next={...state,cursor:state.cursor+1,completedStages:[...new Set([...state.completedStages,claim.stage])],skippedStages:noTypes?[...new Set([...state.skippedStages,claim.stage])]:state.skippedStages,activeBatchId:null,leaseUntil:null};
   await db.query("UPDATE new_design.book_creation_sessions SET input_payload=jsonb_set(input_payload,'{creationDirector}',$2::jsonb),director_active_command_key=CASE WHEN $4 THEN NULL ELSE director_active_command_key END,status='review',stage=$3,error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[claim.sessionId,JSON.stringify(next),next.cursor>=CREATION_DIRECTOR_STAGES.length?"review_initial_content":`director_${CREATION_DIRECTOR_STAGES[next.cursor].key}`,next.mode!=="automatic"||next.cursor>=CREATION_DIRECTOR_STAGES.length]);
  }else await db.query("UPDATE new_design.book_creation_sessions SET status='review',stage='review_initial_content',error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[claim.sessionId]);
  const current=await readOwnedCreationBatch(db,claim.batchId);return creationPreparationReceipt(current);
 });
}
export async function failCreationPreparation(claim:CreationPreparationClaim,failure:CreationPreparationFailure,execution:Record<string,unknown>|null):Promise<CreationPreparationReceipt>{
 return directorTransaction(claim.sessionId,async db=>{
  const session=assertFound((await db.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[claim.sessionId])).rows[0],"开书流程不存在。"),batch=await readOwnedCreationBatch(db,claim.batchId,true);
  if(batch.status!=="running"||batch.preparation_terminal||Array.isArray(batch.output_payload?.candidates)||batch.preparation_generated_output)return creationPreparationReceipt(batch);
  await db.query("UPDATE new_design.ai_generation_batches SET status='failed',preparation_failure=$2::jsonb,preparation_execution=$3::jsonb,error_message=$4,completed_at=now(),updated_at=now() WHERE id=$1",[claim.batchId,JSON.stringify(failure),execution?JSON.stringify(execution):null,failure.message]);
  const state=creationDirectorState(session.input_payload),next=state?.activeBatchId===claim.batchId?{...state,activeBatchId:null,leaseUntil:null}:state;
  await db.query("UPDATE new_design.book_creation_sessions SET input_payload=CASE WHEN $2::jsonb IS NULL THEN input_payload ELSE jsonb_set(input_payload,'{creationDirector}',$2::jsonb) END,director_active_command_key=NULL,status='failed',error_message=$3,last_failed_stage=stage,revision=revision+1,updated_at=now() WHERE id=$1",[claim.sessionId,next?JSON.stringify(next):null,failure.message]);
  return creationPreparationReceipt(await readOwnedCreationBatch(db,claim.batchId));
 });
}
export async function releaseCreationPreparation(batchId:string,unknownRun=false):Promise<CreationPreparationReceipt>{
 const sessionId=await batchSessionId(batchId);
 return directorTransaction(sessionId,async db=>{
  const session=assertFound((await db.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[sessionId])).rows[0],"开书流程不存在。"),batch=await readOwnedCreationBatch(db,batchId,true),receipt=creationPreparationReceipt(batch);
  const activeState=creationDirectorState(session.input_payload);if(session.director_active_command_key&&activeState?.activeBatchId!==batchId)throw new NewDesignError("一键准备正在继续其他阶段，请核对当前运行，不能从前阶段结束正在生成的后阶段。",409);
  if(batch.preparation_terminal===(unknownRun?"ended_unknown":"released"))return receipt;
  if(unknownRun?!receipt.canEndExpiredUnknownRun:!receipt.canReleaseSavedResult)throw new NewDesignError(unknownRun?"只有已过期且没有保存结果的未知运行可以结束。请先读取原请求。":"只有尚未采用的已保存结果可以结束；旧结果会保留。",409);
  const terminal=unknownRun?"ended_unknown":"released",state=creationDirectorState(session.input_payload),next=state?.activeBatchId===batchId?{...state,activeBatchId:null,leaseUntil:null}:state;
  await db.query("UPDATE new_design.ai_generation_batches SET status='discarded',preparation_terminal=$2,error_message=$3,completed_at=COALESCE(completed_at,now()),updated_at=now() WHERE id=$1",[batchId,terminal,unknownRun?"作者明确结束已过期未知运行；模型发送与用量仍未知，迟到结果不会覆盖。":"作者保留旧模型结果并结束本次采用；不是模型生成失败。"]);
  await db.query("UPDATE new_design.book_creation_sessions SET input_payload=CASE WHEN $2::jsonb IS NULL THEN input_payload ELSE jsonb_set(input_payload,'{creationDirector}',$2::jsonb) END,director_active_command_key=NULL,status='review',error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[sessionId,next?JSON.stringify(next):null]);
  return creationPreparationReceipt(await readOwnedCreationBatch(db,batchId));
 });
}
export async function adoptCreationPreparation(batchId:string,input:AdoptCreationPreparationInput):Promise<CreationPreparationAdoptionReceipt>{
 const sessionId=await batchSessionId(batchId);
 const original=await getCreationPreparationResult(batchId);if(!original.modelResultSaved){const failure=preparationFailure(sessionId,batchId,"采用勾选候选到开书表单","此批尚无可以采用的已保存模型候选；本次没有填入表单，请核对原运行。","not_written",original.failure?.modelRequestState??"sent_unknown");failure.recovery.nextAction="只读原运行，有已保存候选才继续采用；本次采用没有重新调用模型。";throw new CreationPreparationError(failure,409);}
 return directorTransaction(sessionId,async db=>{
  await db.query("SELECT id FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[sessionId]);
  const batch=await readOwnedCreationBatch(db,batchId,true),receipt=creationPreparationReceipt(batch);
  const previous=(batch.preparation_adoption_receipts??[]).find((item:Record<string,any>)=>item.receipt.requestKey===input.requestKey);
  if(previous){if(previous.inputHash!==stableHash(input))throw new NewDesignError("同一次采用的勾选内容已改变，请读取原采用回执。",409);return{...previous.receipt,repeated:true};}
  if(!receipt.canAdoptSavedResult)throw new NewDesignError("此批候选不能继续采用，请读取保存结果或原采用回执。",409);
  const adopted=await adoptCreationPreparationInTransaction(db,sessionId,{...input,batchId,frozenSessionRevision:Number(batch.base_revision),templateVersionId:batch.frozen_plan.input.catalog.templateVersionId,specificationHash:batch.frozen_plan.input.specificationHash,output:receipt.output!});
  await db.query("UPDATE new_design.ai_generation_batches SET status='applied',stage='review_adopted',preparation_adoption_receipts=preparation_adoption_receipts||$2::jsonb,updated_at=now() WHERE id=$1",[batchId,JSON.stringify([{inputHash:stableHash(input),receipt:adopted}])]);
  return adopted;
 },false,input.requestKey,true);
}
export async function getCreationPreparationAdoptionReceipt(batchId:string,key:string):Promise<CreationPreparationAdoptionReceipt|null>{
 const sessionId=await batchSessionId(batchId);return directorTransaction(sessionId,async db=>{const row=await readOwnedCreationBatch(db,batchId);return row.preparation_adoption_receipts?.find((item:Record<string,any>)=>item.receipt.requestKey===key)?.receipt??null;},false,key);
}
export async function recoverSavedCreationPreparation(batchId:string):Promise<CreationPreparationReceipt>{
 const sessionId=await batchSessionId(batchId),saved=await directorTransaction(sessionId,db=>readOwnedCreationBatch(db,batchId));
 if(Array.isArray(saved.output_payload?.candidates))return creationPreparationReceipt(saved);
 if(!creationPreparationReceipt(saved).canRecoverSavedResult)throw new NewDesignError("此批没有可恢复的已保存模型输出，请先读取原请求。",409);
 return saveCreationPreparationOutput({sessionId,batchId,requestKey:String(saved.preparation_request_key),stage:saved.frozen_plan.input.stage,plan:saved.frozen_plan},saved.preparation_generated_output,saved.preparation_execution??{});
}

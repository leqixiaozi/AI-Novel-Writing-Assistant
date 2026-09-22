import type {CreationPreparationOutput,CreationPreparationReceipt,CreationPreparationFailure,CreationPreparationAdoptionReceipt,AdoptCreationPreparationInput} from "../../../common/creationReviewAi";
import {CREATION_DIRECTOR_STAGES,creationDirectorState} from "../../../common/creationDirector";
import {NewDesignError} from "../../domain/errors";
import {adoptCreationPreparationInTransaction} from "../bookCreationStore";
import {stableHash} from "../aiContracts";
import {lockCreationSession,updateCreationSession,updateGenerationBatch} from "../bookCreationProduction/repository";
import {directorTransaction,CreationPreparationError,preparationFailure} from "./transaction";
import {batchSessionId,readOwnedCreationBatch,creationPreparationReceipt,getCreationPreparationResult,type CreationPreparationClaim} from "./preparation";

export async function saveCreationPreparationGeneratedOutput(claim:CreationPreparationClaim,output:CreationPreparationOutput,execution:Record<string,unknown>):Promise<void>{
 await directorTransaction(claim.sessionId,async db=>{
  await lockCreationSession(db,claim.sessionId);const batch=await readOwnedCreationBatch(db,claim.batchId,true);
  if(batch.status!=="running"||batch.preparation_terminal||batch.frozen_plan.inputHash!==claim.plan.inputHash)throw new NewDesignError("此准备已结束，迟到模型输出未覆盖任何表单。",409);
  if(batch.preparation_generated_output){if(stableHash(batch.preparation_generated_output)!==stableHash(output))throw new NewDesignError("原模型结果不可换成另一次输出。",409);return;}
  await updateGenerationBatch(db,claim.batchId,{preparation_generated_output:output,preparation_execution:{...execution,providerOutput:output,providerOutputHash:stableHash(output),sourceBatches:claim.plan.sourceBatches}});
 });
}

export async function saveCreationPreparationOutput(claim:CreationPreparationClaim,output:CreationPreparationOutput,execution:Record<string,unknown>):Promise<CreationPreparationReceipt>{
 return directorTransaction(claim.sessionId,async db=>{
  const session=await lockCreationSession(db,claim.sessionId),batch=await readOwnedCreationBatch(db,claim.batchId,true);
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
  await updateGenerationBatch(db,claim.batchId,{status:'review',output_payload:combined,preparation_execution:{...execution,providerOutput:output,providerOutputHash:stableHash(output),sourceBatches:claim.plan.sourceBatches},preparation_failure:null,progress:100,completed_at:new Date().toISOString()});
  for(const source of claim.plan.sourceBatches)await updateGenerationBatch(db,source.id,{preparation_superseded_by:claim.batchId});
  const state=creationDirectorState(session.input_payload);
  if(claim.stage&&state?.activeBatchId===claim.batchId){const next={...state,cursor:state.cursor+1,completedStages:[...new Set([...state.completedStages,claim.stage])],skippedStages:noTypes?[...new Set([...state.skippedStages,claim.stage])]:state.skippedStages,activeBatchId:null,leaseUntil:null};
   await updateCreationSession(db,session,{input_payload:{...session.input_payload,creationDirector:next},director_active_command_key:next.mode!=='automatic'||next.cursor>=CREATION_DIRECTOR_STAGES.length?null:session.director_active_command_key,status:'review',stage:next.cursor>=CREATION_DIRECTOR_STAGES.length?'review_initial_content':`director_${CREATION_DIRECTOR_STAGES[next.cursor].key}`,error_message:null,last_failed_stage:null});
  }else await updateCreationSession(db,session,{status:'review',stage:'review_initial_content',error_message:null,last_failed_stage:null});
  const current=await readOwnedCreationBatch(db,claim.batchId);return creationPreparationReceipt(current);
 });
}
export async function failCreationPreparation(claim:CreationPreparationClaim,failure:CreationPreparationFailure,execution:Record<string,unknown>|null):Promise<CreationPreparationReceipt>{
 return directorTransaction(claim.sessionId,async db=>{
  const session=await lockCreationSession(db,claim.sessionId),batch=await readOwnedCreationBatch(db,claim.batchId,true);
  if(batch.status!=="running"||batch.preparation_terminal||Array.isArray(batch.output_payload?.candidates)||batch.preparation_generated_output)return creationPreparationReceipt(batch);
  await updateGenerationBatch(db,claim.batchId,{status:'failed',preparation_failure:failure,preparation_execution:execution,error_message:failure.message,completed_at:new Date().toISOString()});
  const state=creationDirectorState(session.input_payload),next=state?.activeBatchId===claim.batchId?{...state,activeBatchId:null,leaseUntil:null}:state;
  await updateCreationSession(db,session,{input_payload:next?{...session.input_payload,creationDirector:next}:session.input_payload,director_active_command_key:null,status:'failed',error_message:failure.message,last_failed_stage:session.stage});
  return creationPreparationReceipt(await readOwnedCreationBatch(db,claim.batchId));
 });
}
export async function releaseCreationPreparation(batchId:string,unknownRun=false):Promise<CreationPreparationReceipt>{
 const sessionId=await batchSessionId(batchId);
 return directorTransaction(sessionId,async db=>{
  const session=await lockCreationSession(db,sessionId),batch=await readOwnedCreationBatch(db,batchId,true),receipt=creationPreparationReceipt(batch);
  const activeState=creationDirectorState(session.input_payload);if(session.director_active_command_key&&activeState?.activeBatchId!==batchId)throw new NewDesignError("一键准备正在继续其他阶段，请核对当前运行，不能从前阶段结束正在生成的后阶段。",409);
  if(batch.preparation_terminal===(unknownRun?"ended_unknown":"released"))return receipt;
  if(unknownRun?!receipt.canEndExpiredUnknownRun:!receipt.canReleaseSavedResult)throw new NewDesignError(unknownRun?"只有已过期且没有保存结果的未知运行可以结束。请先读取原请求。":"只有尚未采用的已保存结果可以结束；旧结果会保留。",409);
  const terminal=unknownRun?"ended_unknown":"released",state=creationDirectorState(session.input_payload),next=state?.activeBatchId===batchId?{...state,activeBatchId:null,leaseUntil:null}:state;
  await updateGenerationBatch(db,batchId,{status:'discarded',preparation_terminal:terminal,error_message:unknownRun?'作者明确结束已过期未知运行；模型发送与用量仍未知，迟到结果不会覆盖。':'作者保留旧模型结果并结束本次采用；不是模型生成失败。',completed_at:batch.completed_at??new Date().toISOString()});
  await updateCreationSession(db,session,{input_payload:next?{...session.input_payload,creationDirector:next}:session.input_payload,director_active_command_key:null,status:'review',error_message:null,last_failed_stage:null});
  return creationPreparationReceipt(await readOwnedCreationBatch(db,batchId));
 });
}
export async function adoptCreationPreparation(batchId:string,input:AdoptCreationPreparationInput):Promise<CreationPreparationAdoptionReceipt>{
 const sessionId=await batchSessionId(batchId);
 const original=await getCreationPreparationResult(batchId);if(!original.modelResultSaved){const failure=preparationFailure(sessionId,batchId,"采用勾选候选到开书表单","此批尚无可以采用的已保存模型候选；本次没有填入表单，请核对原运行。","not_written",original.failure?.modelRequestState??"sent_unknown");failure.recovery.nextAction="只读原运行，有已保存候选才继续采用；本次采用没有重新调用模型。";throw new CreationPreparationError(failure,409);}
 return directorTransaction(sessionId,async db=>{
  await lockCreationSession(db,sessionId);
  const batch=await readOwnedCreationBatch(db,batchId,true),receipt=creationPreparationReceipt(batch);
  const previous=(batch.preparation_adoption_receipts??[]).find(item=>item.receipt.requestKey===input.requestKey);
  if(previous){if(previous.inputHash!==stableHash(input))throw new NewDesignError("同一次采用的勾选内容已改变，请读取原采用回执。",409);return{...previous.receipt,repeated:true};}
  if(!receipt.canAdoptSavedResult)throw new NewDesignError("此批候选不能继续采用，请读取保存结果或原采用回执。",409);
  const adopted=await adoptCreationPreparationInTransaction(db,sessionId,{...input,batchId,frozenSessionRevision:Number(batch.base_revision),templateVersionId:batch.frozen_plan.input.catalog.templateVersionId,specificationHash:batch.frozen_plan.input.specificationHash,output:receipt.output!});
  await updateGenerationBatch(db,batchId,{status:'applied',stage:'review_adopted',preparation_adoption_receipts:[...(batch.preparation_adoption_receipts??[]),{inputHash:stableHash(input),receipt:adopted}]});
  return adopted;
 },false,input.requestKey,true);
}
export async function getCreationPreparationAdoptionReceipt(batchId:string,key:string):Promise<CreationPreparationAdoptionReceipt|null>{
 const sessionId=await batchSessionId(batchId);return directorTransaction(sessionId,async db=>{const row=await readOwnedCreationBatch(db,batchId);return row.preparation_adoption_receipts?.find(item=>item.receipt.requestKey===key)?.receipt??null;},false,key);
}
export async function recoverSavedCreationPreparation(batchId:string):Promise<CreationPreparationReceipt>{
 const sessionId=await batchSessionId(batchId),saved=await directorTransaction(sessionId,db=>readOwnedCreationBatch(db,batchId));
 if(Array.isArray(saved.output_payload?.candidates))return creationPreparationReceipt(saved);
 if(!creationPreparationReceipt(saved).canRecoverSavedResult||!saved.preparation_generated_output)throw new NewDesignError("此批没有可恢复的已保存模型输出，请先读取原请求。",409);
 return saveCreationPreparationOutput({sessionId,batchId,requestKey:String(saved.preparation_request_key),stage:saved.frozen_plan.input.stage,plan:saved.frozen_plan},saved.preparation_generated_output,saved.preparation_execution??{});
}

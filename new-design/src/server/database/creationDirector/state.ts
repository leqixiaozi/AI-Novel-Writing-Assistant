import type {BookDirectionCandidate} from "../../../common/contracts";
import {CREATION_DIRECTOR_STAGES,creationDirectorState,type CreationDirectorCommand,type CreationDirectorControl,type CreationDirectorControlReceipt,type CreationDirectorState,type CreationDirectorCommandReceipt} from "../../../common/creationDirector";
import {NewDesignError,assertFound} from "../../domain/errors";
import {stableHash} from "../aiContracts";
import {getCreationPool} from "../bookCreationStore";
import {getBookCreationSession,readBookCreationSessionInTransaction} from "../bookCreationStore";
import {directorTransaction} from "./transaction";
import {creationPreparationReceipt,preparationBatches} from "./preparation";
import {requireRecordCard,replaceRecordCard} from "../recordCards";
import {lockCreationSession,updateCreationSession,updateGenerationBatch} from "../bookCreationProduction/repository";
import type {CreationPreparationFailure} from "../../../common/creationReviewAi";

export async function controlCreationDirector(id:string,input:CreationDirectorControl):Promise<CreationDirectorControlReceipt>{
 return directorTransaction(id,async db=>{
  const row=await lockCreationSession(db,id);
  const hash=stableHash(input),prior=(row.director_control_receipts??[]).find((entry:Record<string,any>)=>entry.receipt.requestKey===input.idempotencyKey);
  if(prior){if(prior.inputHash!==hash)throw new NewDesignError("同一次开书控制请求的内容已改变，请核对原回执。",409);return{...prior.receipt,repeated:true};}
  if(Number(row.revision)!==input.expectedRevision)throw new NewDesignError("开书草稿已更新，请读取最新内容后继续。",409);
  if(["creating","completed"].includes(String(row.status)))throw new NewDesignError("已确认的开书流程不能继续准备。",409);
  const previous=creationDirectorState(row.input_payload);
  if((row.status==="generating"||row.director_active_command_key)&&!input.takeOver)throw new NewDesignError("AI 正在准备，请读取原结果，或明确选择人工接管。",409);
  if(input.directionId&&!row.direction_candidates.some((item:BookDirectionCandidate)=>item.id===input.directionId))throw new NewDesignError("请选择已经采用到本表单的创作方向。",422);
  if(row.status==="generating"){
   const active=previous?.activeBatchId??(await preparationBatches(db,id)).filter(batch=>batch.status==='running').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]?.id;
   if(!active)throw new NewDesignError("这次准备不属于受控开书步骤，请等待原步骤完成。",409);
   const batch=await requireRecordCard(db,active,'ai_generation_batch','本次开书准备不存在。',{lock:true});
   if(batch.session_id===id&&batch.preparation_contract==='creation_preparation_v1'&&batch.status==='running')await updateGenerationBatch(db,active,{status:'discarded',preparation_terminal:batch.preparation_generated_output==null?'ended_unknown':'released',error_message:batch.preparation_generated_output==null?'作者明确人工接管；模型发送与用量未确认，迟到结果不会覆盖。':'作者明确人工接管，已保存模型输出与用量保留，不自动采用。',completed_at:new Date().toISOString()});
  }
  const cursor=input.cursor??previous?.cursor??(row.selected_direction_id?1:0);
  const state:CreationDirectorState={mode:input.takeOver?"manual":input.mode,cursor,completedStages:previous?.completedStages??[],skippedStages:previous?.skippedStages??[],activeBatchId:null,leaseUntil:null};
  const updated=await updateCreationSession(db,row,{input_payload:{...row.input_payload,creationDirector:state},director_active_command_key:null,selected_direction_id:input.directionId??row.selected_direction_id,status:'review',stage:cursor===CREATION_DIRECTOR_STAGES.length?'review_initial_content':`director_${CREATION_DIRECTOR_STAGES[cursor].key}`,error_message:null,last_failed_stage:null});
  const session=await readBookCreationSessionInTransaction(db,id),receipt:CreationDirectorControlReceipt={sessionId:id,requestKey:input.idempotencyKey,operation:"director_control",repeated:false,session};
  await replaceRecordCard(db,{id,spaceId:updated.recordSpaceId,typeKey:'book_creation_session',values:{...updated,director_control_receipts:[...(updated.director_control_receipts??[]),{inputHash:hash,receipt}]}});
  return receipt;
 },true);
}
export async function getCreationDirectorControlReceipt(id:string,key:string):Promise<CreationDirectorControlReceipt|null>{
 return directorTransaction(id,async db=>{const row=await requireRecordCard(db,id,'book_creation_session','开书流程不存在。');return row.director_control_receipts?.find((entry:Record<string,any>)=>entry.receipt.requestKey===key)?.receipt??null;});
}
export async function getCreationDirectorCommandReceipt(id:string,key:string):Promise<CreationDirectorCommandReceipt|null>{
 return directorTransaction(id,async db=>{
  const rows=(await preparationBatches(db,id)).filter(batch=>batch.input_payload?.commandKey===key);
  if(!rows.length)return null;
  const receipts=rows.map(creationPreparationReceipt),row=await requireRecordCard(db,id,'book_creation_session','开书流程不存在。');
  return{sessionId:id,requestKey:key,status:row.director_active_command_key===key||receipts.some(receipt=>receipt.status==="running")?"running":row.director_command_failure?.requestKey===key||receipts.some(receipt=>receipt.status==="failed"||receipt.status==="ended_unknown")?"failed":"review",session:await readBookCreationSessionInTransaction(db,id),receipts};
 });
}
export async function recordDirectorPreparationFailure(id:string,key:string,failure:CreationPreparationFailure):Promise<void>{
 await directorTransaction(id,async db=>{const row=await lockCreationSession(db,id);
  if(row.director_active_command_key!==key||creationDirectorState(row.input_payload)?.activeBatchId)return;
  await updateCreationSession(db,row,{director_active_command_key:null,director_command_failure:{requestKey:key,failure},last_failed_stage:row.stage,error_message:failure.message,status:'failed'});
 },true);
}
export async function findDirectorReceipt(id:string,input:CreationDirectorCommand):Promise<CreationDirectorCommandReceipt|null>{
 const row=(await preparationBatches(await getCreationPool(),id)).find(batch=>batch.input_payload?.commandKey===input.idempotencyKey);
 if(!row)return null;if(row.input_payload.commandHash!==stableHash(input))throw new NewDesignError("原导演请求的内容已改变，请读取原阶段结果。",409);return getCreationDirectorCommandReceipt(id,input.idempotencyKey);
}

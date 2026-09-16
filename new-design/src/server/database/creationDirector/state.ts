import type {BookDirectionCandidate} from "../../../common/contracts";
import {CREATION_DIRECTOR_STAGES,creationDirectorState,type CreationDirectorCommand,type CreationDirectorControl,type CreationDirectorControlReceipt,type CreationDirectorState,type CreationDirectorCommandReceipt} from "../../../common/creationDirector";
import {NewDesignError,assertFound} from "../../domain/errors";
import {stableHash} from "../aiContracts";
import {getCreationPool} from "../bookCreationStore";
import {getBookCreationSession,readBookCreationSessionInTransaction} from "../bookCreationStore";
import {directorTransaction} from "./transaction";
import {creationPreparationReceipt} from "./preparation";
import type {CreationPreparationFailure} from "../../../common/creationReviewAi";

export async function controlCreationDirector(id:string,input:CreationDirectorControl):Promise<CreationDirectorControlReceipt>{
 return directorTransaction(id,async db=>{
  const row=assertFound((await db.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[id])).rows[0],"开书流程不存在。");
  const hash=stableHash(input),prior=(row.director_control_receipts??[]).find((entry:Record<string,any>)=>entry.receipt.requestKey===input.idempotencyKey);
  if(prior){if(prior.inputHash!==hash)throw new NewDesignError("同一次开书控制请求的内容已改变，请核对原回执。",409);return{...prior.receipt,repeated:true};}
  if(Number(row.revision)!==input.expectedRevision)throw new NewDesignError("开书草稿已更新，请读取最新内容后继续。",409);
  if(["creating","completed"].includes(String(row.status)))throw new NewDesignError("已确认的开书流程不能继续准备。",409);
  const previous=creationDirectorState(row.input_payload);
  if((row.status==="generating"||row.director_active_command_key)&&!input.takeOver)throw new NewDesignError("AI 正在准备，请读取原结果，或明确选择人工接管。",409);
  if(input.directionId&&!row.direction_candidates.some((item:BookDirectionCandidate)=>item.id===input.directionId))throw new NewDesignError("请选择已经采用到本表单的创作方向。",422);
  if(row.status==="generating"){
   const active=previous?.activeBatchId??(await db.query("SELECT id FROM new_design.ai_generation_batches WHERE session_id=$1 AND preparation_contract='creation_preparation_v1' AND status='running' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[id])).rows[0]?.id;
   if(!active)throw new NewDesignError("这次准备不属于受控开书步骤，请等待原步骤完成。",409);
   await db.query("UPDATE new_design.ai_generation_batches SET status='discarded',preparation_terminal=CASE WHEN preparation_generated_output IS NULL THEN 'ended_unknown' ELSE 'released' END,error_message=CASE WHEN preparation_generated_output IS NULL THEN '作者明确人工接管；模型发送与用量未确认，迟到结果不会覆盖。' ELSE '作者明确人工接管，已保存模型输出与用量保留，不自动采用。' END,completed_at=now(),updated_at=now() WHERE id=$1 AND session_id=$2 AND preparation_contract='creation_preparation_v1' AND status='running'",[active,id]);
  }
  const cursor=input.cursor??previous?.cursor??(row.selected_direction_id?1:0);
  const state:CreationDirectorState={mode:input.takeOver?"manual":input.mode,cursor,completedStages:previous?.completedStages??[],skippedStages:previous?.skippedStages??[],activeBatchId:null,leaseUntil:null};
  await db.query("UPDATE new_design.book_creation_sessions SET input_payload=jsonb_set(input_payload,'{creationDirector}',$2::jsonb),director_active_command_key=NULL,selected_direction_id=COALESCE($3,selected_direction_id),status='review',stage=$4,error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[id,JSON.stringify(state),input.directionId??null,cursor===CREATION_DIRECTOR_STAGES.length?"review_initial_content":`director_${CREATION_DIRECTOR_STAGES[cursor].key}`]);
  const session=await readBookCreationSessionInTransaction(db,id),receipt:CreationDirectorControlReceipt={sessionId:id,requestKey:input.idempotencyKey,operation:"director_control",repeated:false,session};
  await db.query("UPDATE new_design.book_creation_sessions SET director_control_receipts=director_control_receipts||$2::jsonb WHERE id=$1",[id,JSON.stringify([{inputHash:hash,receipt}])]);
  return receipt;
 },true);
}
export async function getCreationDirectorControlReceipt(id:string,key:string):Promise<CreationDirectorControlReceipt|null>{
 return directorTransaction(id,async db=>{const row=assertFound((await db.query("SELECT director_control_receipts FROM new_design.book_creation_sessions WHERE id=$1",[id])).rows[0],"开书流程不存在。");return row.director_control_receipts?.find((entry:Record<string,any>)=>entry.receipt.requestKey===key)?.receipt??null;});
}
export async function getCreationDirectorCommandReceipt(id:string,key:string):Promise<CreationDirectorCommandReceipt|null>{
 return directorTransaction(id,async db=>{
  const rows=(await db.query("SELECT batch.*,session.revision AS current_session_revision,now()>=batch.preparation_lease_until AS expired FROM new_design.ai_generation_batches batch JOIN new_design.book_creation_sessions session ON session.id=batch.session_id WHERE batch.session_id=$1 AND batch.preparation_contract='creation_preparation_v1' AND batch.input_payload->>'commandKey'=$2 ORDER BY batch.created_at,batch.id",[id,key])).rows;
  if(!rows.length)return null;
  const receipts=rows.map(creationPreparationReceipt),row=(await db.query("SELECT director_active_command_key,director_command_failure FROM new_design.book_creation_sessions WHERE id=$1",[id])).rows[0];
  return{sessionId:id,requestKey:key,status:row.director_active_command_key===key||receipts.some(receipt=>receipt.status==="running")?"running":row.director_command_failure?.requestKey===key||receipts.some(receipt=>receipt.status==="failed"||receipt.status==="ended_unknown")?"failed":"review",session:await readBookCreationSessionInTransaction(db,id),receipts};
 });
}
export async function recordDirectorPreparationFailure(id:string,key:string,failure:CreationPreparationFailure):Promise<void>{
 await directorTransaction(id,async db=>{const row=assertFound((await db.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[id])).rows[0],"开书流程不存在。");
  if(row.director_active_command_key!==key||creationDirectorState(row.input_payload)?.activeBatchId)return;
  await db.query("UPDATE new_design.book_creation_sessions SET director_active_command_key=NULL,director_command_failure=$2::jsonb,last_failed_stage=stage,error_message=$3,status='failed',revision=revision+1,updated_at=now() WHERE id=$1",[id,JSON.stringify({requestKey:key,failure}),failure.message]);
 },true);
}
export async function findDirectorReceipt(id:string,input:CreationDirectorCommand):Promise<CreationDirectorCommandReceipt|null>{
 const row=(await(await getCreationPool()).query("SELECT input_payload FROM new_design.ai_generation_batches WHERE session_id=$1 AND preparation_contract='creation_preparation_v1' AND input_payload->>'commandKey'=$2 ORDER BY created_at LIMIT 1",[id,input.idempotencyKey])).rows[0];
 if(!row)return null;if(row.input_payload.commandHash!==stableHash(input))throw new NewDesignError("原导演请求的内容已改变，请读取原阶段结果。",409);return getCreationDirectorCommandReceipt(id,input.idempotencyKey);
}

import {z} from "zod";
import {CREATION_DIRECTOR_MODES,CREATION_DIRECTOR_STAGES,creationDirectorState,type CreationDirectorCommand,type CreationDirectorCommandReceipt} from "../../../common/creationDirector";
import type {NewDesignAiGateway} from "../../ai/gateway";
import {getBookCreationSession} from "../../database/bookCreationStore";
import {findDirectorReceipt,getCreationDirectorCommandReceipt,recordDirectorPreparationFailure} from "../../database/creationDirector";
import {runCreationPreparationStage} from "../creationReviewAi";
import {stableHash} from "../../database/aiContracts";
import {NewDesignError} from "../../domain/errors";
import type {ExecutionDependencies} from "../../ai/runtime/managedExecution";
import {CreationPreparationError} from "../creationReviewAi";

export const directorCommandSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160)}).strict();
export const directorControlSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),mode:z.enum(CREATION_DIRECTOR_MODES),cursor:z.number().int().min(0).max(CREATION_DIRECTOR_STAGES.length).optional(),takeOver:z.boolean().optional(),directionId:z.string().trim().min(1).max(160).optional()}).strict();
export {getCreationDirectorCommandReceipt,getCreationDirectorControlReceipt,controlCreationDirector} from "../../database/creationDirector";
export async function executeCreationDirector(id:string,command:CreationDirectorCommand,_gateway?:NewDesignAiGateway,dependencies:ExecutionDependencies={}):Promise<CreationDirectorCommandReceipt>{
 const input=directorCommandSchema.parse(command),previous=await findDirectorReceipt(id,input);if(previous)return previous;
 let session=await getBookCreationSession(id);if(session.revision!==input.expectedRevision)throw new NewDesignError("开书草稿已更新，请保存或读取最新内容后继续。",409);
 const commandHash=stableHash(input);
 for(let count=0;count<CREATION_DIRECTOR_STAGES.length;count++){
  const state=creationDirectorState(session.inputPayload),stage=state&&CREATION_DIRECTOR_STAGES[state.cursor];
  if(!stage||state!.mode==="manual")throw new NewDesignError("请先选择一键或分步 AI 准备方式。",409);
  const requestKey=`director_${stableHash({sessionId:id,key:input.idempotencyKey,cursor:state!.cursor})}`;
  let receipt;
  try{receipt=await runCreationPreparationStage(id,{expectedSessionRevision:session.revision,requestKey,mode:"all"},stage.key,input.idempotencyKey,commandHash,dependencies);}
  catch(error){if(error instanceof CreationPreparationError&&error.failure.mutationOutcome==="not_written"&&error.failure.modelRequestState==="not_sent")await recordDirectorPreparationFailure(id,input.idempotencyKey,error.failure);throw error;}
  if(receipt.status!=="review")return (await getCreationDirectorCommandReceipt(id,input.idempotencyKey))!;
  session=await getBookCreationSession(id);const next=creationDirectorState(session.inputPayload);
  if(next?.mode!=="automatic"||next.cursor>=CREATION_DIRECTOR_STAGES.length)break;
 }
 return (await getCreationDirectorCommandReceipt(id,input.idempotencyKey))!;
}

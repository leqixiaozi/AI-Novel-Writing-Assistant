import {z} from "zod";
import {CREATION_REVIEW_AI_MODES,type CreationReviewAiInput,type CreationPreparationReceipt,type CreationPreparationOutput} from "../../../common/creationReviewAi";
import type {CreationDirectorStage} from "../../../common/creationDirector";
import {claimCreationPreparation,getCreationPreparationByKey,getCreationPreparationResult,listCreationPreparationBatches} from "../../database/creationDirector/preparation";
import {saveCreationPreparationOutput,saveCreationPreparationGeneratedOutput,failCreationPreparation,adoptCreationPreparation,getCreationPreparationAdoptionReceipt,releaseCreationPreparation,recoverSavedCreationPreparation} from "../../database/creationDirector/results";
import {CreationPreparationError,preparationFailure} from "../../database/creationDirector/transaction";
import {preparePrompt} from "../../ai/prompts";
import {executeManagedPrompt,type ExecutionDependencies} from "../../ai/runtime/managedExecution";
import {AiExecutionError} from "../../ai/runtime/errors";
import {stableHash} from "../../database/aiContracts";
import {NewDesignError} from "../../domain/errors";

export const creationReviewAiInputSchema=z.object({expectedSessionRevision:z.number().int().positive(),requestKey:z.string().trim().min(8).max(160),mode:z.enum(CREATION_REVIEW_AI_MODES),reviewCardId:z.uuid().optional()}).strict();
export const adoptCreationPreparationInputSchema=z.object({expectedSessionRevision:z.number().int().positive(),requestKey:z.string().trim().min(8).max(160),selections:z.array(z.object({reviewCardId:z.uuid(),title:z.boolean(),fieldKeys:z.array(z.string().min(1).max(160)).max(300)}).strict()).max(300),relationIds:z.array(z.uuid()).max(300),planIds:z.array(z.uuid()).max(300),directionId:z.string().trim().min(1).max(160).optional()}).strict().superRefine((input,ctx)=>{if(new Set(input.selections.map(item=>item.reviewCardId)).size!==input.selections.length)ctx.addIssue({code:"custom",path:["selections"],message:"同一资料不能重复勾选。"});for(const item of input.selections)if(new Set(item.fieldKeys).size!==item.fieldKeys.length)ctx.addIssue({code:"custom",path:["selections"],message:"字段不能重复勾选。"});if(new Set(input.relationIds).size!==input.relationIds.length||new Set(input.planIds).size!==input.planIds.length)ctx.addIssue({code:"custom",message:"关系或规划不能重复勾选。"});});
export {getCreationPreparationByKey,getCreationPreparationResult,listCreationPreparationBatches,getCreationPreparationAdoptionReceipt,recoverSavedCreationPreparation,CreationPreparationError};
export const adoptSavedCreationPreparation=(batchId:string,input:unknown)=>adoptCreationPreparation(batchId,adoptCreationPreparationInputSchema.parse(input));
export const releaseSavedCreationPreparation=(batchId:string)=>releaseCreationPreparation(batchId,false);
export const endExpiredUnknownCreationPreparation=(batchId:string)=>releaseCreationPreparation(batchId,true);

// All production prompt input, model configuration and exact source refs are frozen before any request is sent.
export async function runCreationReviewAi(sessionId:string,value:unknown,dependencies:ExecutionDependencies={}):Promise<CreationPreparationReceipt>{return runCreationPreparationStage(sessionId,creationReviewAiInputSchema.parse(value),null,undefined,undefined,dependencies);}
export async function runCreationPreparationStage(sessionId:string,input:CreationReviewAiInput,stage:CreationDirectorStage|null,commandKey?:string,commandHash?:string,dependencies:ExecutionDependencies={}):Promise<CreationPreparationReceipt>{
 let claim;
 try{claim=await claimCreationPreparation(sessionId,input,stage,commandKey,commandHash);}catch(error){if(error instanceof CreationPreparationError)throw error;if(error instanceof NewDesignError)throw new CreationPreparationError(preparationFailure(sessionId,null,"准备开书来源与模型",error.message,"not_written","not_sent"),error.status);throw new CreationPreparationError(preparationFailure(sessionId,null,"核对开书准备来源","开书准备回执尚未确认，请只读取原请求，不要重复发送。","unknown","not_sent"));}
 if("status" in claim)return claim;
 let output:CreationPreparationOutput,modelSnapshot:Record<string,unknown>,usedTokens:number;
 try{
  const prepared=preparePrompt(claim.plan.taskType,claim.plan.input);
  if(prepared.assetId!==claim.plan.assetId||prepared.version!==claim.plan.assetVersion||stableHash(prepared.outputSchema)!==stableHash(claim.plan.outputSchema)||stableHash(prepared.messages)!==stableHash(claim.plan.messages))throw new AiExecutionError("核对受控开书规格","本次受控提示规格已改变，模型请求尚未发送；请保留原请求并重新核对来源。",409);
  const result=await executeManagedPrompt<CreationPreparationOutput>(claim.plan.taskType,prepared,{...dependencies,environment:undefined,routeResolver:async()=>claim.plan.route,snapshotWriter:async()=>claim.plan.modelSnapshot});
  output=result.output;modelSnapshot=result.modelSnapshot;usedTokens=result.usedTokens;
 }catch(error){
  const trace=error instanceof AiExecutionError?error.executionSnapshot??null:null,attempts=Array.isArray(trace?.attempts)?trace!.attempts as Array<{requestSent?:boolean;responseReceived?:boolean}>:[],lastSent=[...attempts].reverse().find(attempt=>attempt.requestSent),requestState=lastSent?.responseReceived?"completed":lastSent?"sent_unknown":"not_sent";
  const failure=preparationFailure(sessionId,claim.batchId,error instanceof AiExecutionError?error.recovery.failedStep:"准备开书候选",error instanceof AiExecutionError?error.message:"本次模型候选没有完成确认，请读取原请求后检查模型设置。","not_written",requestState);
  if(error instanceof AiExecutionError&&error.issues)failure.issues=error.issues;
  try{return await failCreationPreparation(claim,failure,trace);}catch{throw new CreationPreparationError(preparationFailure(sessionId,claim.batchId,"核对失败运行回执","本次模型运行的失败回执尚未保存确认，请读取原请求，不要重复发送。","unknown",requestState));}
 }
 // A save failure after an external model response must never be treated as a pre-send failure or invoke again.
 try{const execution={modelSnapshot,usedTokens,promptSnapshot:{assetId:claim.plan.assetId,version:claim.plan.assetVersion,inputHash:claim.plan.inputHash,modelRouteSnapshotId:claim.plan.modelSnapshot.id,outputSchema:claim.plan.outputSchema}};await saveCreationPreparationGeneratedOutput(claim,output,execution);return await saveCreationPreparationOutput(claim,output,execution);}
 catch{throw new CreationPreparationError(preparationFailure(sessionId,claim.batchId,"核对模型结果保存","模型已经返回，但结果保存回执尚未确认。请读取原批次；若结果已保存，直接采用旧结果，不要重新生成。","unknown","completed"));}
}

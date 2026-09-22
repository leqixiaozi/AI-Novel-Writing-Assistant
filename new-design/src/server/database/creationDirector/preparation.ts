import {randomUUID} from "node:crypto";
import {readStoryFormat} from '../../../common/storyFormat';
import type {PoolClient} from "pg";
import type {CreationPreparationOutput,CreationPreparationReceipt,CreationReviewAiInput,CreationPreparationTarget} from "../../../common/creationReviewAi";
import {CREATION_DIRECTOR_STAGES,creationDirectorState,type CreationDirectorStage} from "../../../common/creationDirector";
import {getCreationPool as getNewDesignPool} from "../bookCreationStore";
import {stableHash} from "../aiContracts";
import {getCreationPreparationContext} from "../bookCreationStore";
import {resolveManagedTaskRoute,captureManagedModelSnapshot,getManagedCredentialEnvironment} from "../modelManagement";
import {preparePrompt,creationPreparationPromptInputSchema,type PreparedPrompt,type PromptTaskType,type CreationPreparationPromptInput} from "../../ai/prompts";
import {configurationForConnection,validateExecutionPolicy} from "../../ai/runtime/managedExecution";
import {NewDesignError,assertFound} from "../../domain/errors";
import {directorTransaction} from "./transaction";
import type {ManagedModelSnapshot,ManagedTaskRoute} from "../../../common/modelRouting";
import {isBlankCreationReviewValue} from "../../../common/creationReviewAi";
import {formAiFieldVisible} from "../../../common/formAssist";
import {findRecordCard,listRecordCards,requireRecordCard,type RecordCardDb} from "../recordCards";
import {lockCreationSession,updateCreationSession,createGenerationBatch} from "../bookCreationProduction/repository";

export const isBlankCreationValue=isBlankCreationReviewValue;
export interface CreationPreparationPlan {format:1;input:CreationPreparationPromptInput;inputHash:string;taskType:"directions"|"initial_content"|"form_assist";assetId:string;assetVersion:string;messages:PreparedPrompt["messages"];outputSchema:Record<string,unknown>;route:ManagedTaskRoute;modelSnapshot:ManagedModelSnapshot;templateSnapshot:unknown;catalogHash:string;carriedOutput:CreationPreparationOutput|null;sourceBatches:Array<{id:string;outputHash:string;inputHash:string}>;}
export interface CreationPreparationClaim {batchId:string;sessionId:string;requestKey:string;stage:CreationDirectorStage|null;plan:CreationPreparationPlan;}
async function withSessionRevision(db:RecordCardDb,batch:Record<string,any>){const session=await requireRecordCard(db,String(batch.session_id),'book_creation_session','开书流程不存在。');return {...batch,current_session_revision:session.revision,expired:batch.preparation_lease_until?Date.now()>=new Date(batch.preparation_lease_until).getTime():false};}
export async function readOwnedCreationBatch(db:PoolClient,id:string,lock=false){const batch=await requireRecordCard(db,id,'ai_generation_batch','本次开书准备不存在。',{lock});if(batch.preparation_contract!=='creation_preparation_v1')throw new NewDesignError('本次开书准备不存在。',404);return withSessionRevision(db,batch);}
export async function preparationBatches(db:RecordCardDb,sessionId:string){const rows=await listRecordCards(db,'ai_generation_batch',{where:{session_id:sessionId,preparation_contract:'creation_preparation_v1'}});return Promise.all(rows.map(row=>withSessionRevision(db,row)));}
export function creationPreparationReceipt(row:Record<string,any>):CreationPreparationReceipt {
 const terminal=row.preparation_terminal as string|null,materialized=row.output_payload&&Array.isArray(row.output_payload.candidates)?row.output_payload as CreationPreparationOutput:null,generated=row.preparation_generated_output as CreationPreparationOutput|null,output=materialized??generated,actionable=!row.preparation_superseded_by;
 const status=terminal==="released"?"released":terminal==="ended_unknown"?"ended_unknown":row.status as CreationPreparationReceipt["status"];
 return{sessionId:String(row.session_id),batchId:String(row.id),requestKey:String(row.preparation_request_key),stage:row.frozen_plan?.input?.stage??null,status,baseSessionRevision:Number(row.base_revision),currentSessionRevision:Number(row.current_session_revision),modelResultSaved:Boolean(output),reviewSaved:row.status==="applied",canAdoptSavedResult:Boolean(materialized)&&row.status==="review"&&!terminal&&actionable,canReleaseSavedResult:Boolean(output)&&["running","review"].includes(row.status)&&!terminal&&actionable,canRecoverSavedResult:Boolean(generated)&&!materialized&&row.status==="running"&&!terminal,canEndExpiredUnknownRun:row.status==="running"&&!output&&!terminal&&Boolean(row.expired),supersededByBatchId:row.preparation_superseded_by?String(row.preparation_superseded_by):null,leaseUntil:row.preparation_lease_until?new Date(row.preparation_lease_until).toISOString():null,output,failure:row.preparation_failure??null};
}
export async function getCreationPreparationByKey(sessionId:string,key:string):Promise<CreationPreparationReceipt|null>{return directorTransaction(sessionId,async db=>{const row=(await preparationBatches(db,sessionId)).find(batch=>batch.preparation_request_key===key);return row?creationPreparationReceipt(row):null;});}
export async function getCreationPreparationResult(id:string):Promise<CreationPreparationReceipt>{return directorTransaction((await batchSessionId(id)),async db=>creationPreparationReceipt(await readOwnedCreationBatch(db,id)));}
export async function batchSessionId(id:string):Promise<string>{const row=await requireRecordCard(await getNewDesignPool(),id,'ai_generation_batch','本次开书准备不存在。');if(row.preparation_contract!=='creation_preparation_v1'||!row.session_id)throw new NewDesignError('本次开书准备不存在。',404);return String(row.session_id);}
export async function listCreationPreparationBatches(sessionId:string):Promise<CreationPreparationReceipt[]>{return directorTransaction(sessionId,async db=>(await preparationBatches(db,sessionId)).map(creationPreparationReceipt));}

export async function claimCreationPreparation(sessionId:string,input:CreationReviewAiInput,stage:CreationDirectorStage|null=null,commandKey?:string,commandHash?:string):Promise<CreationPreparationClaim|CreationPreparationReceipt>{
 return directorTransaction(sessionId,async db=>{
  const row=await lockCreationSession(db,sessionId);
  const previous=(await preparationBatches(db,sessionId)).find(batch=>batch.preparation_request_key===input.requestKey);
  const requestHash=stableHash({input,stage,commandKey:commandKey??null,commandHash:commandHash??null});
  if(previous){if(previous.preparation_request_hash!==requestHash)throw new NewDesignError("原请求的准备范围已改变，请读取原结果；不要复用同一请求标识。",409);return creationPreparationReceipt(previous);}
  if(Number(row.revision)!==input.expectedSessionRevision)throw new NewDesignError("开书表单已更新，请保存或读取最新表单后再准备。",409);
  if(row.director_active_command_key&&row.director_active_command_key!==commandKey)throw new NewDesignError("一键准备仍在执行，请读取原导演请求，或明确人工接管。",409);
  if(["generating","creating","completed"].includes(String(row.status)))throw new NewDesignError("当前开书步骤正在处理或已经确认，请先读取原步骤结果。",409);
  const context=await getCreationPreparationContext(sessionId,db,true),state=creationDirectorState(context.session.inputPayload);
  if(stage&&(!state||CREATION_DIRECTOR_STAGES[state.cursor]?.key!==stage||state.mode==="manual"))throw new NewDesignError("导演阶段已改变，请读取当前开书进度。",409);
  const earlier=stage?(await preparationBatches(db,sessionId)).filter(saved=>saved.status==='review'&&!saved.preparation_terminal&&saved.frozen_plan?.input?.catalog?.reviewCardsHash===context.catalog.reviewCardsHash).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))).filter(saved=>CREATION_DIRECTOR_STAGES.findIndex(item=>item.key===saved.frozen_plan.input.stage)<CREATION_DIRECTOR_STAGES.findIndex(item=>item.key===stage)).slice(0,1):[];
  const contextCards=context.session.reviewCards.map(({id,typeKey,title,values})=>({id,typeKey,title,values:structuredClone(values)}));
  for(const saved of earlier)for(const candidate of saved.output_payload.candidates??[])if(!contextCards.some(card=>card.id===candidate.reviewCardId))contextCards.push({id:candidate.reviewCardId,typeKey:candidate.typeKey,title:candidate.titleSuggestion??"",values:candidate.values});
  let schemaTypes=context.schemaTypes;
  if(stage){const keys=CREATION_DIRECTOR_STAGES.find(item=>item.key===stage)!.typeKeys as readonly string[];schemaTypes=schemaTypes.filter(type=>keys.includes(type.key));}
  const targets:CreationPreparationTarget[]=[];
  for(const type of schemaTypes){let matching=context.session.reviewCards.filter(card=>card.typeKey===type.key&&(!input.reviewCardId||card.id===input.reviewCardId));
   if(!matching.length&&!input.reviewCardId)matching=[{id:randomUUID(),typeKey:type.key,title:"",values:{},sourceKind:"ai",sourceId:null,sourceVersionId:null,originalTitle:"",originalValues:{}}];
   for(const card of matching){const fieldKeys=type.fields.filter(field=>formAiFieldVisible(field,card.values)&&field.aiSuggestible!==false&&isBlankCreationValue(card.values[field.key])&&(input.mode!=="required"||field.required)).map(field=>field.key);const allowTitle=isBlankCreationValue(card.title);if(fieldKeys.length||allowTitle)targets.push({reviewCardId:card.id,typeKey:type.key,isNew:!context.session.reviewCards.some(item=>item.id===card.id),title:card.title,values:card.values,allowTitle,fieldKeys});}
  }
  if(input.reviewCardId&&!context.session.reviewCards.some(card=>card.id===input.reviewCardId))throw new NewDesignError("请从当前开书表单选择要补全的资料。",404);
  if(!targets.length&&stage===null)throw new NewDesignError("当前范围没有可补全的空白字段或名称，已填写的内容不会覆盖。",422);
  const selected=context.session.directionCandidates.find(item=>item.id===context.session.selectedDirectionId)??earlier.flatMap(saved=>saved.output_payload.directions??[])[0]??null;
  if(stage&&stage!=="direction"&&!selected)throw new NewDesignError("请先准备并选择创作方向。",422);
  const specificationHash=stableHash({templateVersionId:context.session.templateVersionId,templateSnapshot:context.templateSnapshot,catalog:context.catalog,reviewCards:context.session.reviewCards});
  const promptInput=creationPreparationPromptInputSchema.parse({contract:"creation_preparation_v1",sessionId,sessionRevision:context.session.revision,specificationHash,stage,mode:input.mode,method:context.session.method,storyFormat:readStoryFormat(context.session.inputPayload.storyFormat),bookName:context.session.bookName,sourceReference:context.session.sourceReference,sourceText:context.sourceText,direction:selected,schemaTypes,targets,contextCards,catalog:context.catalog});
  const taskType=stage==="direction"?"directions":input.reviewCardId?"form_assist":"initial_content",prompt=preparePrompt(taskType,promptInput),route=await resolveManagedTaskRoute(taskType,{client:db});validateExecutionPolicy(route);
  await configurationForConnection(route.primary,route.policy,{credentialResolver:(id,provider)=>getManagedCredentialEnvironment(id,provider,{client:db})});
  const snapshot=await captureManagedModelSnapshot(taskType,route,{client:db}),batchId=randomUUID();
  const sourceBatch=earlier[0],sourceBatches=sourceBatch?[...(sourceBatch.frozen_plan.sourceBatches??[]),{id:String(sourceBatch.id),outputHash:stableHash(sourceBatch.output_payload),inputHash:String(sourceBatch.frozen_plan.inputHash)}]:[];
  const plan:CreationPreparationPlan={format:1,input:promptInput,inputHash:stableHash(promptInput),taskType,assetId:prompt.assetId,assetVersion:prompt.version,messages:prompt.messages,outputSchema:prompt.outputSchema,route,modelSnapshot:snapshot,templateSnapshot:context.templateSnapshot,catalogHash:stableHash(context.catalog),carriedOutput:sourceBatch?.output_payload??null,sourceBatches};
  await createGenerationBatch(db,row.recordSpaceId,{id:batchId,session_id:sessionId,operation:taskType,status:'running',stage:stage??'review_ai',input_payload:{contract:'creation_preparation_v1',commandKey:commandKey??null,commandHash:commandHash??null},base_revision:context.session.revision,prompt_id:prompt.assetId,prompt_version:prompt.version,preparation_contract:'creation_preparation_v1',preparation_request_key:input.requestKey,preparation_request_hash:requestHash,frozen_plan:plan,model_route_snapshot_id:snapshot.id,preparation_lease_until:new Date(Date.now()+15*60_000).toISOString(),preparation_adoption_receipts:[]});
  const next=state&&stage?{...state,activeBatchId:batchId,leaseUntil:new Date(Date.now()+15*60_000).toISOString()}:state;
  await updateCreationSession(db,row,{input_payload:next?{...row.input_payload,creationDirector:next}:row.input_payload,director_active_command_key:stage&&state?.mode==='automatic'?commandKey??null:null,status:'generating',stage:stage?`director_${stage}`:'review_ai',error_message:null,last_failed_stage:null});
  return{sessionId,batchId,requestKey:input.requestKey,stage,plan};
 },true);
}

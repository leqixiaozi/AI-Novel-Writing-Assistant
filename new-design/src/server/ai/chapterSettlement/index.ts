import { z } from "zod";
import type { ChapterSettlementAiInput,ChapterSettlementAiReceipt,ChapterSettlementAiStatus } from "../../../common/chapterSettlementAi";
import type { AiRuntimeRecovery } from "../../../common/aiRuntime";
import { getChapterSettlementEditingWorkspace,createChapterSettlementEditingAiItems } from "../../database/chapterSettlement";
import { resolveManagedTaskRoute } from "../../database/modelManagement";
import { stableHash } from "../../database/aiContracts";
import { assertFound,NewDesignError } from "../../domain/errors";
import { configurationForConnection,executeManagedPrompt,type ExecutionDependencies } from "../runtime/managedExecution";
import { AiExecutionError } from "../runtime/errors";
import { preparePrompt,listPromptAssets } from "../prompts";
import { database } from "./database";
import { claimSettlementAi,getSettlementAiReceipt,readRequest,receipt,saveSettlementModelOutput,recordSettlementImportFailure } from "./requests";
import { finishSettlementAiLedger } from "./ledger";
import type { SettlementAiClaim,SettlementAiOutput,SettlementFrozenPlan } from "./contracts";
import { ChapterSettlementAiError } from "./errors";

export const chapterSettlementAiInputSchema=z.object({expectedSessionRevision:z.number().int().positive(),requestKey:z.string().trim().min(8).max(120),catalogHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const getChapterSettlementAiReceipt=getSettlementAiReceipt;
export {withChapterSettlementAiDatabasePool} from "./database";
export async function getChapterSettlementAiStatus():Promise<ChapterSettlementAiStatus>{
  try{if(!listPromptAssets().some(asset=>asset.taskType==="chapter_settlement"&&asset.assetId==="new_design.chapter.settlement_candidates"&&asset.version==="v1"))throw new Error("提取提示词未注册");const route=await resolveManagedTaskRoute("chapter_settlement");await configurationForConnection(route.primary,route.policy);return{configured:true,taskType:"chapter_settlement",message:"可从本章正文整理有证据的变化候选；需要逐项审阅并明确结算。",recovery:null};}
  catch(error){const failure=error instanceof AiExecutionError?error:new AiExecutionError("读取章节提取模型设置","请打开模型设置，配置默认模型或“整理章节变化”任务模型并保存启用；人工补充可以继续。",422);failure.recovery.savedResult="尚未提交模型请求；已保存正文、人工草稿和候选清单保留。配置后返回本章，检查 AI 配置再明确整理。";return{configured:false,taskType:"chapter_settlement",message:failure.message,recovery:failure.recovery};}
}
export async function getChapterSettlementAiResult(requestId:string):Promise<ChapterSettlementAiReceipt>{z.string().uuid().parse(requestId);return database(async client=>receipt(assertFound(await readRequest(client,"request.id=$3",[requestId]),"本章变化提取回执不存在。")));}
const sourceFailure=(claim:SettlementAiClaim,step:string,summary:string,savedResult:string):AiRuntimeRecovery=>({failedStep:step,summary,savedResult,sourceRoute:claim.sourceRoute,actionLabel:"返回章节结算"});
async function readSavedClaim(requestId:string):Promise<SettlementAiClaim>{
  return database(async client=>{
    const row=assertFound(await readRequest(client,"request.id=$3",[requestId]),"本章提取记录不存在。"),plan=row.frozen_plan as SettlementFrozenPlan;
    if(!plan||plan.format!==1||!row.lease_token&&row.attempt_status==="running"||stableHash(plan.input)!==row.frozen_input_hash)throw new NewDesignError("本章提取冻结规格或领取回执不完整，请核对原请求。",409);
    return{requestId:row.id,sessionId:row.session_id,bookId:row.book_id,chapterDocumentId:row.chapter_document_id,sourceRoute:receipt(row).sourceRoute,taskId:row.ai_task_id,stepId:row.step_id,attemptId:row.attempt_id,leaseToken:row.lease_token??"",requestKey:row.idempotency_key,expectedSessionRevision:Number(row.expected_session_revision),contextManifestId:row.context_manifest_id,modelRouteSnapshotId:row.model_route_snapshot_id,taskContractVersionId:row.task_contract_version_id,promptRecipeVersionId:row.prompt_recipe_version_id,plan};
  });
}
async function importSaved(claim:SettlementAiClaim):Promise<ChapterSettlementAiReceipt>{
  const saved=await database(async client=>assertFound(await readRequest(client,"request.id=$3",[claim.requestId]),"本章提取结果不存在。"));
  const finalizeFailure=():ChapterSettlementAiReceipt=>({...receipt({...saved,status:"succeeded",attempt_status:"running"}),failure:sourceFailure(claim,"完成提取运行回执","变化候选已入库，运行终止回执未确认；请核对原结果并点击“完成运行回执”，不会再次提取或导入候选。","正文、模型结果和本章候选均已保存；逐项审阅可继续，正式状态仍需明确结算。")});
  if(saved.status==="succeeded"){
    if(saved.attempt_status==="running"){try{return await finishSettlementAiLedger(claim,null);}catch{return finalizeFailure();}}
    return receipt(saved,true);
  }
  if(saved.status!=="running"||saved.attempt_status!=="running")throw new NewDesignError("本次提取已结束，原模型结果只供核对，不能再次导入。",409);
  if(!saved.generated_output)throw new NewDesignError("本次没有已确认保存的模型结果，请先只读核对原提取回执；不能重新导入或重复调用模型。",409);
  const prompt=preparePrompt("chapter_settlement",claim.plan.input);
  if(prompt.assetId!==claim.plan.assetId||prompt.version!==claim.plan.assetVersion||stableHash(prompt.messages)!==stableHash(claim.plan.messages)||stableHash(prompt.outputSchema)!==stableHash(claim.plan.outputSchema))throw new NewDesignError("已保存结果的受控提示词规格不一致，不能导入；原模型结果保留。",409);
  const output=prompt.parseOutput(saved.generated_output) as SettlementAiOutput;
  try{
    await createChapterSettlementEditingAiItems(claim.sessionId,{expectedSessionRevision:claim.expectedSessionRevision,requestKey:`ai_import:${claim.requestKey}`,items:output.items,taskId:claim.taskId,attemptId:claim.attemptId,bodyVersionId:claim.plan.input.bodyVersionId,catalogHash:claim.plan.input.catalog.specificationHash,contextManifestId:claim.contextManifestId,modelRouteSnapshotId:claim.modelRouteSnapshotId});
  }catch(error){
    const original=error instanceof NewDesignError?error.message:"变化候选保存未完成确认，请核对本章清单后恢复导入。";
    const recovery=sourceFailure(claim,"保存本章变化候选",original,"本章正文、正式字段规格、原模型结果与已保存清单保留；未确认入库的候选不能结算。点击“导入已保存结果”仅恢复候选保存，不会再次调用模型。");
    try{return await recordSettlementImportFailure(claim.requestId,recovery);}
    catch{return{...receipt(saved),canImportSavedResult:false,canReleaseSavedResult:false,failure:{...sourceFailure(claim,"核对候选入库回执","变化候选入库与失败记录保存回执均未确认，请只读核对原请求，不要再次提交。","原正文、规格、模型输出已确认保存；候选入库结果须核对原请求，不会重新调用模型。"),mutationOutcome:"unknown"}};}
  }
  try{return await finishSettlementAiLedger(claim,null);}
  catch{return finalizeFailure();}
}
export async function importSavedChapterSettlementAiResult(requestId:string):Promise<ChapterSettlementAiReceipt>{z.string().uuid().parse(requestId);return importSaved(await readSavedClaim(requestId));}
export { releaseSavedChapterSettlementAiResult } from "./release";
export { endExpiredUnknownChapterSettlementAiExtraction } from "./expiredUnknown";
export async function runChapterSettlementAiExtraction(sessionId:string,value:ChapterSettlementAiInput,dependencies:ExecutionDependencies={}):Promise<ChapterSettlementAiReceipt>{
  z.string().uuid().parse(sessionId);const input=chapterSettlementAiInputSchema.parse(value);
  const prior=await database(async client=>{const row=await readRequest(client,"request.session_id=$3 AND request.idempotency_key=$4",[sessionId,input.requestKey]);if(row&&row.request_hash!==stableHash({sessionId,...input}))throw new NewDesignError("同一提取请求不能提交不同清单或规格，请核对原结果。",409);return row?receipt(row,true):null;});
  if(prior)return prior;
  // Receipt equality is checked again in claim; no prior request ever dispatches a second model invocation.
  const workspace=await getChapterSettlementEditingWorkspace(sessionId);
  let claimed:SettlementAiClaim|ChapterSettlementAiReceipt;
  try{claimed=await claimSettlementAi(workspace,input);}
  catch(error){
    const outcome=error instanceof ChapterSettlementAiError?error.mutationOutcome:error instanceof NewDesignError?"not_written":"unknown";
    const failure=new ChapterSettlementAiError(error instanceof AiExecutionError?error.recovery.failedStep:"准备本章变化提取",error instanceof NewDesignError?error.message:"本章提取准备回执未确认，请只读核对原请求。",error instanceof NewDesignError?error.status:502,outcome,"not_sent");
    if(error instanceof AiExecutionError){failure.recovery.sourceRoute=error.recovery.sourceRoute;failure.recovery.actionLabel=error.recovery.actionLabel;}
    if(failure.status===409||outcome==="unknown"){failure.recovery.sourceRoute=`/new-design/books/${workspace.session.bookId}/writing?chapterDocument=${workspace.session.chapterDocumentId}&session=${sessionId}`;failure.recovery.actionLabel="返回章节结算";}
    failure.recovery.savedResult=outcome==="not_written"?"本次提取准备已确认回滚，未保存领取，尚未调用模型；原正文、人工编辑和已保存清单保留。恢复后可重新准备。":"原正文、人工编辑和已保存清单保留；本次尚未调用模型。领取记录保存回执未知，请只读核对原请求，不能重复提取。";
    throw failure;
  }
  if(!("requestId"in claimed))return claimed;
  const claim=claimed,prompt=preparePrompt("chapter_settlement",claim.plan.input),started=Date.now();
  let result:Awaited<ReturnType<typeof executeManagedPrompt<SettlementAiOutput>>>;
  try{result=await executeManagedPrompt<SettlementAiOutput>("chapter_settlement",prompt,{...dependencies,routeResolver:async()=>claim.plan.route,snapshotWriter:async()=>({id:claim.modelRouteSnapshotId,snapshotHash:claim.plan.snapshotHash,taskType:"chapter_settlement",route:claim.plan.route})});}
  catch(error){
    const failure=error instanceof AiExecutionError?error:new AiExecutionError("提取本章变化","模型执行未完成确认，请核对原请求结果。"),recovery={...failure.recovery,savedResult:"本章正文、正式规格、人工编辑、上下文和模型配置快照保留；本次没有已确认的可导入模型结果。"};
    if(["核对创作结果","核对章节变化候选","解析创作结果"].includes(failure.recovery.failedStep)){recovery.sourceRoute=claim.sourceRoute;recovery.actionLabel="返回章节结算";}
    try{return await finishSettlementAiLedger(claim,recovery,failure.executionSnapshot?{...failure.executionSnapshot,durationMs:Date.now()-started}:null,failure.category??"unknown");}
    catch{const failure=new ChapterSettlementAiError("保存提取失败回执","本次模型调用没有已确认结果，运行终止回执也未确认；请只读核对原请求，不要再次调用。",502,"unknown",failureSnapshotSent(error)?"sent_unknown":"not_sent");Object.assign(failure.recovery,sourceFailure(claim,failure.recovery.failedStep,failure.message,"本章正文、规格、人工编辑和原领取记录保留；失败终止记录保存回执未知，须核对原请求，不会自动重发模型。"));throw failure;}
  }
  try{await saveSettlementModelOutput(claim,result.output,{...result.modelSnapshot,durationMs:Date.now()-started});}
  catch{const failure=new ChapterSettlementAiError("保存模型输出回执","模型已回复，服务器保存回执未确认；请只读核对原请求结果，不能再次调用模型。",502,"unknown","completed");Object.assign(failure.recovery,sourceFailure(claim,failure.recovery.failedStep,failure.message,"原正文、规格、上下文和运行领取记录保留；本次模型结果是否保存须核对原请求，不能把未知回执当作生成失败重跑。"));throw failure;}
  return importSaved(claim);
}
function failureSnapshotSent(error:unknown):boolean {const traces=error instanceof AiExecutionError?error.executionSnapshot?.attempts:null;return Array.isArray(traces)&&traces.some(trace=>trace&&typeof trace==="object"&&(trace as Record<string,unknown>).requestSent===true);}

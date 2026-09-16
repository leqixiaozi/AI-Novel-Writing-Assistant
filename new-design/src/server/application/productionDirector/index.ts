import type {DirectorCommand,DirectorReceipt,ChapterGenerationOutput,SavedChapterWritingReply} from "../../../common/productionDirector";
import {directorBoundaryDecision,originalChapterCandidateContent} from "../../../common/productionDirector";
import {getDirectorRun,controlDirectorRun,directorLease,renewDirectorLease,directorRecovery,attachDirectorChapter,directorChapterRequestKey,finishDirectorBoundary,finishDirectorChapterBoundary} from "../../database/productionDirector";
import {prepareChapterProduction,prepareSelectedChapterProduction,readChapterProduction,markChapterProductionRunning,retainChapterProductionOutput,recordChapterProductionFailure,completeChapterProductionLedger,type SelectedChapterProductionInput} from "../../database/chapterProduction";
import {getChapterDocument,createChapterDocument} from "../../database/chapterBodyStore";
import {getChapterWritingWorkspace,getChapterWritingRequest,ingestChapterWritingResult} from "../../database/chapterWriting";
import {getAiTask,startAiTaskAttempt} from "../../database/aiTasks";
import {preparePrompt} from "../../ai/prompts";
import {executeManagedPrompt,AiExecutionError} from "../../ai";
import {writeChapterProductionReplyReceipt,readChapterProductionReplyReceipt} from '../../ai/chapterProductionReceipts';
import {stableHash} from "../../database/aiContracts";
import {assertFound,NewDesignError} from "../../domain/errors";

const workers=new Map<string,Promise<void>>();
const chapterWorkers=new Map<string,Promise<ChapterGenerationOutput>>();
/** Manual and whole-book modes share the same original request/candidate execution. */
export async function createControlledChapterWritingRequest(documentId:string,input:SelectedChapterProductionInput){
  const prepared=await prepareSelectedChapterProduction(documentId,input);
  const receipt=await getChapterWritingRequest(prepared.requestId);
  if(!prepared.repeated&&!chapterWorkers.has(prepared.requestId)){
    const work=produceChapter(prepared.bookId,prepared.requestId).finally(()=>chapterWorkers.delete(prepared.requestId));chapterWorkers.set(prepared.requestId,work);
    void work.catch(()=>{/* The source page reads the original immutable request, never a substitute. */});
  }
  return receipt;
}
/** Pure original-reply completion. Missing or unknown replies cannot issue a new model call. */
export async function completeSavedChapterWritingRequest(requestId:string){
  const receipt=await getChapterWritingRequest(requestId),saved=await readChapterProduction(receipt.bookId,requestId);
  if(!saved.output)throw new NewDesignError('原模型回复未保存，只能读取原请求；禁止以恢复为名重新生成。',409);
  if(!chapterWorkers.has(requestId)){const work=produceChapter(receipt.bookId,requestId).finally(()=>chapterWorkers.delete(requestId));chapterWorkers.set(requestId,work);await work;}else await chapterWorkers.get(requestId);
  return getChapterWritingRequest(requestId);
}
/** Read exact retained output even if a newer manual candidate blocks its original import. */
export async function getSavedChapterWritingReply(requestId:string):Promise<SavedChapterWritingReply>{
  const request=await getChapterWritingRequest(requestId),saved=await readChapterProduction(request.bookId,requestId);
  const local=!saved.output&&saved.attemptId?await readChapterProductionReplyReceipt({bookId:request.bookId,requestId,attemptId:saved.attemptId,inputHash:stableHash(saved.snapshot.input)}):null;
  const output=assertFound(saved.output??local?.output,'原回复未保存，不显示另一次生成结果代替。');
  if(local&&(local.execution.routeSnapshotId!==saved.snapshot.snapshotId||local.execution.routeSnapshotHash!==saved.snapshot.snapshotHash))throw new NewDesignError('本地原回复与冻结模型路线不一致，不显示替代结果。',409);
  return {requestId,bookId:request.bookId,chapterDocumentId:request.chapterDocumentId,chapterCardId:saved.snapshot.input.chapterCardId,inputBodyVersionId:request.inputBodyVersionId,expectedDocumentRevision:request.expectedDocumentRevision,replyHash:stableHash(output),sourceStatus:saved.output?'database':'local_receipt',content:originalChapterCandidateContent(saved.snapshot.input,output),decision:output.decision,warnings:output.warnings,reason:output.reason};
}
async function produceChapter(bookId:string,requestId:string):Promise<ChapterGenerationOutput>{
  let saved=await readChapterProduction(bookId,requestId);
  if(saved.request.resultBodyVersionId){await completeChapterProductionLedger(bookId,requestId);return assertFound(saved.output,"原候选没有受控模型回复，不能伪造导演判断。");}
  if(!saved.output){
    const task=await getAiTask(assertFound(saved.request.aiTaskId,"原章节任务不可用。")),step=assertFound(task.steps.find(item=>item.stepKey==='generate_candidate'),"原章节生成步骤不可用。");
    if(saved.request.status!=='queued'||step.currentAttemptId)throw new NewDesignError("本章已领取而模型结果未确认，请只读核对原请求，禁止重新调用模型。",409);
    const prompt=preparePrompt("chapter_generation",saved.snapshot.input);
    if(stableHash(prompt.messages)!==stableHash(saved.snapshot.messages)||stableHash(prompt.outputSchema)!==stableHash(saved.snapshot.outputSchema)||prompt.assetId!==saved.snapshot.assetId||prompt.version!==saved.snapshot.assetVersion)throw new NewDesignError("冻结章节输入、提示词或输出合同不一致，请保留原记录并回规划核对。",409);
    const policy=saved.snapshot.route.policy,leaseMs=Math.min(3600000,policy.timeoutMs*(policy.maxRetries+1)*(saved.snapshot.route.fallbacks.length+1)+120000);
    const lease=await startAiTaskAttempt({taskId:task.id,stepId:step.id,expectedStepRevision:step.revision,triggerKind:'initial',owner:'production_director',actorKind:'user',leaseMs,taskContractVersionId:saved.request.taskContractVersionId,promptRecipeVersionId:saved.request.promptRecipeVersionId,contextManifestId:saved.request.contextManifestId,modelRouteSnapshotId:saved.request.modelRouteSnapshotId,inputHash:stableHash(saved.snapshot.input),outputSchemaVersion:stableHash(prompt.outputSchema),checkpointKey:'generate_candidate'});
    await markChapterProductionRunning(bookId,requestId);
    let generated;
    try{generated=await executeManagedPrompt<ChapterGenerationOutput>("chapter_generation",prompt,{routeResolver:async()=>saved.snapshot.route,snapshotWriter:async()=>({id:saved.snapshot.snapshotId,snapshotHash:saved.snapshot.snapshotHash,taskType:'chapter_generation',route:saved.snapshot.route}),stopOnUnknownResponse:true});}
    catch(error){
      const execution=error instanceof AiExecutionError?error.executionSnapshot??null:null;
      const traces=execution?.attempts as Array<{requestSent?:boolean;responseReceived?:boolean}>|undefined;
      const unknown=!traces||traces.some(trace=>trace.requestSent&&!trace.responseReceived);
      const message=error instanceof NewDesignError?error.message:"原模型结果未确认，请保留请求并只读核对；没有以其他结果代替。";
      await recordChapterProductionFailure(bookId,requestId,execution,message,unknown,error instanceof AiExecutionError?error.category??'structure_parse':'unknown');
      throw error;
    }
    // Reply persistence failure stays unknown. Never classifies this as a model failure or calls twice.
    const execution={...generated.modelSnapshot,routeSnapshotHash:saved.snapshot.snapshotHash};
    await writeChapterProductionReplyReceipt({bookId,requestId,attemptId:lease.attempt.id,inputHash:stableHash(saved.snapshot.input),output:generated.output,execution});
    await retainChapterProductionOutput(bookId,requestId,lease.attempt.id,generated.output,execution);
    saved=await readChapterProduction(bookId,requestId);
  }
  const output=assertFound(saved.output,"原模型回复待核对。"),attemptId=assertFound(saved.attemptId,"原模型尝试待核对。");
  await ingestChapterWritingResult(requestId,{attemptId,content:originalChapterCandidateContent(saved.snapshot.input,output),idempotencyKey:`director-result:${requestId}`,createdBy:'controlled_chapter_executor'});
  await completeChapterProductionLedger(bookId,requestId);
  return output;
}

async function run(bookId:string,id:string):Promise<void>{const token=await directorLease(bookId,id);let activeTitle='导演章边界',activeChapterId:string|null=null;try{
  for(;;){const current=await getDirectorRun(bookId,id);if(current.status!=='running')return;
    if(current.pauseRequested){await finishDirectorBoundary(bookId,id,token,'paused');return;}
    await renewDirectorLease(bookId,id,token);
    const ledger=current.chapters.find(item=>item.ledgerPending||item.boundaryPending);
    if(ledger?.requestId){
      activeTitle=ledger.title;activeChapterId=ledger.chapterCardId;
      const source=await readChapterProduction(bookId,ledger.requestId);await completeChapterProductionLedger(bookId,ledger.requestId);
      const output=assertFound(source.output,'原候选没有受控模型回复，不能跳过章边界判断。'),boundary=directorBoundaryDecision(current.issuePolicy,output);
      await finishDirectorChapterBoundary(bookId,id,ledger.chapterCardId,token,boundary,boundary==='continue'?null:directorRecovery(bookId,boundary==='pause'?`审阅“${ledger.title}”`:`重新规划“${ledger.title}”`,output.reason||'原候选已保存，请明确处理本章来源后继续。'));
      if(boundary!=='continue')return;continue;
    }
    const next=current.chapters.find(item=>item.status!=='candidate_saved');
    if(!next){await finishDirectorBoundary(bookId,id,token,'completed');return;}
    activeTitle=next.title;activeChapterId=next.chapterCardId;let requestId=next.requestId;
    if(!requestId){const writing=await getChapterWritingWorkspace(bookId),chapter=assertFound(writing.chapters.find(item=>item.chapterCardId===next.chapterCardId),"原导演目标章已不存在，请回规划核对。");
      // Creation is an explicit workflow step; a lost creation response is resolved by the unique original document.
      let document=chapter.documentId?await getChapterDocument(chapter.documentId):null;
      if(!document){try{document=await createChapterDocument({bookId,chapterCardId:next.chapterCardId,logicalOrder:writing.chapters.findIndex(item=>item.chapterCardId===next.chapterCardId)+1,title:next.title});}catch(error){const refreshed=await getChapterWritingWorkspace(bookId),source=refreshed.chapters.find(item=>item.chapterCardId===next.chapterCardId);if(!source?.documentId)throw error;document=await getChapterDocument(source.documentId);}}
      const prepared=await prepareChapterProduction({requestKey:await directorChapterRequestKey(bookId,id,next.chapterCardId),bookId,chapterCardId:next.chapterCardId,planningObjectId:next.planningObjectId,planningVersionId:next.planningVersionId,expectedPlanningRevision:next.expectedPlanningRevision,documentId:document.id,expectedDocumentRevision:document.revision,instruction:current.instruction,issuePolicy:current.issuePolicy,knowledgeSources:current.knowledgeSources});
      requestId=prepared.requestId;await attachDirectorChapter(bookId,id,next.chapterCardId,requestId,token);
    }
    const output=await produceChapter(bookId,requestId),boundary=directorBoundaryDecision(current.issuePolicy,output);
    await finishDirectorChapterBoundary(bookId,id,next.chapterCardId,token,boundary,boundary==='continue'?null:directorRecovery(bookId,boundary==='pause'?`审阅“${next.title}”`:`重新规划“${next.title}”`,output.reason||'本章候选已保存，请回章节创作审阅或回规划调整后明确准备新范围。'));
    if(boundary!=='continue')return;
  }
}catch(error){const current=await getDirectorRun(bookId,id),chapter=current.chapters.find(item=>item.chapterCardId===activeChapterId&&(item.status==='running'||item.status==='unknown'||item.ledgerPending||item.boundaryPending));const unknown=Boolean(chapter);await finishDirectorBoundary(bookId,id,token,unknown?'waiting_recovery':'failed',directorRecovery(bookId,`处理“${activeTitle}”`,error instanceof NewDesignError?error.message:'本章执行未确认，请保留原请求和已保存回复，只读核对对应章来源。'));}}
/** Dispatch only after an explicit accepted source-page command. GET never resumes a worker. */
export async function dispatchDirectorCommand(bookId:string,id:string,input:DirectorCommand):Promise<DirectorReceipt>{const receipt=await controlDirectorRun(bookId,id,input);
  if(!receipt.repeated&&['run','resume','retry_failed'].includes(input.action)){const previous=workers.get(id);const work=(previous?previous.catch(()=>{}):Promise.resolve()).then(()=>run(bookId,id)).finally(()=>{if(workers.get(id)===work)workers.delete(id);});workers.set(id,work);void work.catch(()=>{/* Persistent original receipts remain authoritative; source GET reports expiry/unknown. */});}
  return receipt;
}

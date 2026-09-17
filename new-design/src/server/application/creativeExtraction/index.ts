import {preparePrompt} from '../../ai/prompts';
import {executeManagedPrompt,AiExecutionError} from '../../ai';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
import {stableHash} from '../../database/aiContracts';
import {claimCreativeExtraction,retainCreativeExtractionOutput,finishCreativeExtraction,readCreativeExtractionPreview,parsedCreativeOutput,CreativeExtractionError,loadCreativeRecoveryClaim,type CreativeClaim} from '../../database/creativeExtraction';
import {CREATIVE_EXTRACTION_ROUTE,creativeSavedOutputSchema} from '../../../common/creativeExtraction';
import {writeCreativeEvidence,readCreativeEvidence} from './evidence';
import {sanitizeChapterProductionExecutionReceipt} from '../../ai/chapterProductionReceipts';
const references=(claim:CreativeClaim)=>({bookId:claim.preview.bookId,previewId:claim.preview.id,attemptId:claim.attemptId,planHash:claim.plan.hash});
export async function runCreativeExtraction(id:string,input:{requestKey:string;expectedRevision:number},dependencies:ExecutionDependencies={}){
 const claim=await claimCreativeExtraction(id,input);if(!claim.claimed)return readCreativeExtractionPreview(id);
 let returned=false;
 try{const prompt=preparePrompt('creative_extraction',claim.plan.input),result=await executeManagedPrompt<unknown>('creative_extraction',prompt,{...dependencies,stopOnUnknownResponse:true,routeResolver:async()=>claim.plan.route,snapshotWriter:async()=>({id:claim.plan.snapshotId,snapshotHash:claim.plan.snapshotHash,taskType:'creative_extraction',route:claim.plan.route}),credentialResolver:dependencies.credentialResolver??getManagedCredentialEnvironment});returned=true;
 const output=parsedCreativeOutput(claim.plan,result.output),execution=sanitizeChapterProductionExecutionReceipt(result.modelSnapshot);await writeCreativeEvidence(references(claim),output,execution);await retainCreativeExtractionOutput(claim,output,execution);return await finishCreativeExtraction(id);
 }catch(error){if(returned){throw new CreativeExtractionError('模型回复已收到；保存或运行回执尚未核对。读取原回复并完成保存，不重复调用模型。',503,'核对原创作提炼回复保存','unknown',claim.preview.bookId);}
 if(error instanceof AiExecutionError){const trace=error.executionSnapshot??{},attempts=Array.isArray(trace.attempts)?trace.attempts:[],unknown=attempts.some(attempt=>typeof attempt==='object'&&attempt!==null&&'requestSent' in attempt&&attempt.requestSent===true&&'responseReceived' in attempt&&attempt.responseReceived===false);const recovery={...error.recovery,savedResult:'原参考、完整输入和运行领取已保存；原资源、书名及正文保留。',mutationOutcome:'unknown' as const};if(unknown){error.recovery.savedResult=recovery.savedResult;error.recovery.mutationOutcome='unknown';throw error;}return await finishCreativeExtraction(id,recovery,trace);}
 throw new CreativeExtractionError('原调用结果未核对；保留请求与人工输入，先读取原结果，不重新调用模型。',503,'核对原创作提炼执行','unknown',claim.preview.bookId);
 }
}
/** Explicit bookkeeping-only recovery; never enters the model executor. */
export async function completeSavedCreativeExtraction(id:string){const preview=await readCreativeExtractionPreview(id);if(preview.status==='succeeded')return preview;if(!preview.attemptId||preview.status!=='running')throw new CreativeExtractionError('原预览没有可核对的在途尝试，请保留原记录。',409,'核对原创作提炼回复','unknown',preview.bookId);
 // The by-id row is a technical frozen record, not an author-selected current input.
 const claim=await loadCreativeRecoveryClaim(id);
 if(!preview.replySaved){const evidence=await readCreativeEvidence(references(claim));if(!evidence)throw new CreativeExtractionError('尚未读取到原回复凭证；未找到不证明原模型未调用。继续只读核对，不发新请求。',409,'读取原创作提炼回复','unknown',preview.bookId);const raw={candidates:evidence.output.candidates.map(({id,...candidate})=>candidate),notes:evidence.output.notes};preparePrompt('creative_extraction',claim.plan.input).parseOutput(raw);const saved=creativeSavedOutputSchema.parse(evidence.output);if(stableHash(saved)!==evidence.outputHash)throw new CreativeExtractionError('原回复校验不同，拒绝保存替代结果。',409,'核对原回复来源','unknown',preview.bookId);await retainCreativeExtractionOutput(claim,saved,evidence.execution);}
 return finishCreativeExtraction(id);
}

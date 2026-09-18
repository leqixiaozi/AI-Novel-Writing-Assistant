import {z} from 'zod';
import type {ChapterQualityInput,ChapterQualityOutput} from '../../../common/chapterQuality';
import * as store from '../../database/chapterQuality';
import {preparePrompt} from '../../ai/prompts';
import {executeManagedPrompt,type ExecutionDependencies} from '../../ai/runtime/managedExecution';
import {AiExecutionError} from '../../ai/runtime/errors';
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
export * from '../../database/chapterQuality';
export {prepareChapterQualityRepair,recordChapterQualityRepair,getChapterQualityRepairState,getChapterQualityRepairRecord} from '../../database/chapterQuality/repairs';
export async function runChapterQuality(bookId:string,value:ChapterQualityInput,dependencies:ExecutionDependencies={}){
 z.string().uuid().parse(bookId);const claim=await store.claimChapterQuality(bookId,value);if(!claim.claimed)return claim.receipt;
 const snapshot=claim.snapshot,prompt=preparePrompt('quality_audit',snapshot.input),started=Date.now();await store.markChapterQualitySending(bookId,claim.receipt.id);
 let executed:Awaited<ReturnType<typeof executeManagedPrompt<ChapterQualityOutput>>>;
 try{executed=await executeManagedPrompt<ChapterQualityOutput>('quality_audit',prompt,{...dependencies,stopOnUnknownResponse:true,routeResolver:async()=>snapshot.route,snapshotWriter:async()=>({id:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,taskType:'quality_audit',route:snapshot.route}),credentialResolver:dependencies.credentialResolver??((id,provider)=>store.qualityTransaction(bookId,client=>getManagedCredentialEnvironment(id,provider,{client})))});}
 catch(error){const failure=error instanceof AiExecutionError?error:null,trace=failure?.executionSnapshot??null,attempts=trace&&Array.isArray(trace.attempts)?trace.attempts:[],sent=attempts.some(a=>a&&typeof a==='object'&&'requestSent' in a&&a.requestSent===true),received=attempts.some(a=>a&&typeof a==='object'&&'responseReceived' in a&&a.responseReceived===true);return store.failChapterQuality(bookId,claim.receipt.id,received?'completed':sent||!trace?'sent_unknown':'not_sent',trace?{...trace,durationMs:Date.now()-started}:null,failure?.message??'原诊断调用结果未知，请只读核对原请求。');}
 await store.retainChapterQualityOutput(bookId,claim.receipt.id,executed.output,{...executed.modelSnapshot,durationMs:Date.now()-started});return store.importChapterQualityOutput(bookId,claim.receipt.id);
}

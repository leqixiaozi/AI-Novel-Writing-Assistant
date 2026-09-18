import type {PublicTitleInput,PublicTitleOutput} from '../../../common/publicTitles';
import {claimPublicTitle,completePublicTitle,failPublicTitle,titleTransaction,PublicTitleError} from '../../database/publicTitles';
import {writePublicTitleReply} from '../../ai/imageGeneration/receipts';
import {preparePrompt} from '../../ai/prompts';
import {executeManagedPrompt,AiExecutionError} from '../../ai';
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
export async function runPublicTitles(input:PublicTitleInput,dependencies:ExecutionDependencies={}){
 const claim=await claimPublicTitle(input);if(!claim.claimed)return claim.result;const plan=claim.plan,started=Date.now();let reply;
 try{const result=await executeManagedPrompt<PublicTitleOutput>('creative_extraction',preparePrompt('public_title_factory',plan.promptInput),{...dependencies,stopOnUnknownResponse:true,routeResolver:async()=>plan.route,snapshotWriter:async()=>({id:plan.snapshotId,snapshotHash:plan.snapshotHash,taskType:'creative_extraction',route:plan.route}),credentialResolver:dependencies.credentialResolver??((id,provider)=>titleTransaction(undefined,client=>getManagedCredentialEnvironment(id,provider,{client})))});reply={output:result.output,execution:{...result.modelSnapshot,durationMs:Date.now()-started}};}
 catch(error){const execution=error instanceof AiExecutionError?error.executionSnapshot:null,traces=Array.isArray(execution?.attempts)?execution.attempts:[];return failPublicTitle(claim.result.id,execution??null,execution!==null&&execution!==undefined&&(!traces.some(trace=>trace.requestSent)||traces.some(trace=>trace.responseReceived)));}
 try{await writePublicTitleReply({scopeKind:'public_title_factory',resourceId:claim.result.source.id,resourceVersionId:claim.result.source.versionId,requestId:claim.result.id,attemptId:claim.attemptId,inputHash:plan.inputHash},reply);return await completePublicTitle(claim.result.id);}
 catch{throw new PublicTitleError('原标题原回复保存未确认，请保留原键只读核对或续存原回复，不重新调用模型。',503,'unknown');}
}

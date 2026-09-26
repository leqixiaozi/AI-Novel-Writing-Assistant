import type {ImagePreparationInput,ImagePreparationOutput} from '../../../common/imagePreparation';
import {prepareImageOptimization,completeImagePreparation,failImagePreparation,preparationTransaction,ImagePreparationError} from '../../database/imagePreparation';
import {writeImagePreparationReply} from '../../ai/imageGeneration/receipts';
import {preparePrompt} from '../../ai/prompts';
import {executeManagedPrompt,AiExecutionError} from '../../ai';
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
export async function runImagePreparation(input:ImagePreparationInput,dependencies:ExecutionDependencies={}){
 const claimed=await prepareImageOptimization(input);if(!claimed.claimed)return claimed.result;const plan=claimed.plan,started=Date.now();let value;
 try{const result=await executeManagedPrompt<ImagePreparationOutput>('form_assist',preparePrompt('image_prompt_preparation',plan.promptInput),{...dependencies,stopOnUnknownResponse:true,routeResolver:async()=>plan.route,snapshotWriter:async()=>({id:plan.snapshotId,snapshotHash:plan.snapshotHash,taskType:'form_assist',route:plan.route}),credentialResolver:dependencies.credentialResolver??((id,provider)=>preparationTransaction(client=>getManagedCredentialEnvironment(id,provider,{client})))});value={output:result.output,execution:{...result.modelSnapshot,durationMs:Date.now()-started}};}catch(error){const execution=error instanceof AiExecutionError?error.executionSnapshot:null,attempts=Array.isArray(execution?.attempts)?execution.attempts:[];return failImagePreparation(claimed.result.id,execution??null,execution!==null&&execution!==undefined&&(!attempts.some(attempt=>attempt.requestSent)||attempts.some(attempt=>attempt.responseReceived)));}
 try{await writeImagePreparationReply({scopeKind:'image_prompt_preparation',scope:input.scope,requestId:claimed.result.id,attemptId:claimed.attemptId,inputHash:plan.inputHash},value);return await completeImagePreparation(claimed.result.id);}catch{throw new ImagePreparationError('原优化回复保存未确认；保留原键，只读核对或保存已有回复，不重新调用模型。',503,'unknown',input.scope);}
}

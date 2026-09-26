import type {CharacterAuthorInput,CharacterAuthorOutput} from '../../../common/characterAuthor';
import {claimCharacterAuthor,completeCharacterAuthor,failCharacterAuthor,authorTransaction,CharacterAuthorError} from '../../database/characterAuthor';
import {writeCharacterAuthorReply} from '../../ai/imageGeneration/receipts';
import {preparePrompt} from '../../ai/prompts';
import {executeManagedPrompt,AiExecutionError} from '../../ai';
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
export async function runCharacterAuthor(input:CharacterAuthorInput,dependencies:ExecutionDependencies={}){
 const claimed=await claimCharacterAuthor(input);if(!claimed.claimed)return claimed.result;const plan=claimed.plan,started=Date.now();let reply;
 try{const result=await executeManagedPrompt<CharacterAuthorOutput>('character_dialogue',preparePrompt('character_author',plan.promptInput),{...dependencies,stopOnUnknownResponse:true,routeResolver:async()=>plan.route,snapshotWriter:async()=>({id:plan.snapshotId,snapshotHash:plan.snapshotHash,taskType:'character_dialogue',route:plan.route}),credentialResolver:dependencies.credentialResolver??((id,provider)=>authorTransaction(client=>getManagedCredentialEnvironment(id,provider,{client})))});reply={output:result.output,execution:{...result.modelSnapshot,durationMs:Date.now()-started}};}
 catch(error){const execution=error instanceof AiExecutionError?error.executionSnapshot:null,attempts=Array.isArray(execution?.attempts)?execution.attempts:[];return failCharacterAuthor(claimed.result.id,execution??null,execution!==null&&execution!==undefined&&(!attempts.some(attempt=>attempt.requestSent)||attempts.some(attempt=>attempt.responseReceived)));}
 try{await writeCharacterAuthorReply({scopeKind:'character_author',bookId:input.bookId,cardId:input.cardId,requestId:claimed.result.id,attemptId:claimed.attemptId,inputHash:plan.inputHash},reply);return await completeCharacterAuthor(claimed.result.id);}
 catch{throw new CharacterAuthorError('原人物回复保存未确认，请保留原键，只读核对或续存已收到回复，不重新调用模型。',503,'unknown',input.bookId,input.cardId);}
}

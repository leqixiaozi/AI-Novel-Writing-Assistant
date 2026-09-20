import type {PublicCharacterTrialInput,PublicDialogueOutput,PublicDialoguePromptInput} from '../../../common/publicCharacters';
import type {PublicImageProtocolInput} from '../../../common/imageGeneration';
import {preparePublicCharacterTrial,retainPublicCharacterReply,completePublicCharacterTrial,recordPublicCharacterFailure,PublicCharacterError} from '../../database/publicCharacters';
import {transaction} from '../../database/publicCharacters/repository';
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
import {executeManagedPrompt,AiExecutionError} from '../../ai';
import type {ExecutionDependencies} from '../../ai/runtime/managedExecution';
import {preparePrompt} from '../../ai/prompts';
import {executeImageProtocol} from '../../ai/imageGeneration';
import {writeImageReply,writePublicDialogueReply} from '../../ai/imageGeneration/receipts';
export interface PublicCharacterExecutionDependencies {text?:ExecutionDependencies;image?:typeof executeImageProtocol;}
export async function runPublicCharacterTrial(input:PublicCharacterTrialInput,dependencies:PublicCharacterExecutionDependencies={}){
 const claimed=await preparePublicCharacterTrial(input);if(!claimed.claimed)return claimed.trial;
 const plan=claimed.plan,started=Date.now();let reply:unknown,execution:Record<string,unknown>;
 try{
  if(input.kind==='dialogue'){
   const prompt=preparePrompt('public_character_dialogue',plan.promptInput as PublicDialoguePromptInput),route=plan.route!;
   const result=await executeManagedPrompt<PublicDialogueOutput>('character_dialogue',prompt,{...dependencies.text,stopOnUnknownResponse:true,routeResolver:async()=>route,snapshotWriter:async()=>({id:plan.snapshotId,snapshotHash:plan.snapshotHash,taskType:'character_dialogue',route}),credentialResolver:dependencies.text?.credentialResolver??((id,provider)=>transaction(undefined,client=>getManagedCredentialEnvironment(id,provider,{client})))});
   reply=result.output;execution={...result.modelSnapshot,durationMs:Date.now()-started};
  }else{
   const connection=plan.connection!,credential=await transaction(undefined,client=>getManagedCredentialEnvironment(connection.credentialId,connection.provider,{client}));
   const result=await(dependencies.image??executeImageProtocol)(plan.promptInput as PublicImageProtocolInput,connection,credential);
   reply=result;execution={provider:connection.provider,model:connection.model,routeSnapshotId:plan.snapshotId,routeSnapshotHash:plan.snapshotHash,inputTokens:result.inputTokens,outputTokens:result.outputTokens,durationMs:result.durationMs,attempts:[{status:'succeeded',requestSent:true,responseReceived:true}]};
  }
 }catch(error){const trace=error instanceof AiExecutionError?error.executionSnapshot??null:null,attempts=trace&&Array.isArray(trace.attempts)?trace.attempts:[],received=attempts.some(attempt=>attempt?.responseReceived===true),sent=attempts.some(attempt=>attempt?.requestSent===true);return recordPublicCharacterFailure(claimed.trial.id,trace?{...trace,durationMs:Date.now()-started}:null,received,trace!==null&&!sent);}
 try{
  const refs={resourceId:plan.source.id,resourceVersionId:plan.source.versionId,requestId:claimed.trial.id,attemptId:claimed.attemptId,inputHash:plan.inputHash};
  if(input.kind==='dialogue')await writePublicDialogueReply({...refs,scopeKind:'public_character_dialogue'},{output:reply as PublicDialogueOutput,execution});
  else await writeImageReply({...refs,scopeKind:'public_character'},reply as import('../../../common/imageGeneration').ImageGenerationReply);
  await retainPublicCharacterReply(claimed.trial.id,reply,execution);return await completePublicCharacterTrial(claimed.trial.id);
 }catch{throw new PublicCharacterError('模型原回复的保存回执未确认；保留原键，只读核对或保存已有回复，不再次调用模型。');}
}

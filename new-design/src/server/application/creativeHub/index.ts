import {creativeHubTurnRequestSchema,type CreativeHubTurnRequest} from '../../../common/creativeHub';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {AiExecutionError} from '../../ai';
import * as repository from '../../database/creativeHub';
import {NewDesignError} from '../../domain/errors';

export const listCreativeHubThreads=repository.listCreativeHubThreads;
export const getCreativeHubCapability=repository.getCreativeHubCapability;
export const getCreativeHubThread=repository.getCreativeHubThread;
export const createCreativeHubThread=repository.createCreativeHubThread;
export const updateCreativeHubThread=repository.updateCreativeHubThread;
export const archiveCreativeHubThread=repository.archiveCreativeHubThread;
export const restoreCreativeHubThread=repository.restoreCreativeHubThread;
export const readCreativeHubState=repository.readCreativeHubState;
export const listCreativeHubTurns=repository.listCreativeHubTurns;

function unknownExecution(error:unknown):boolean{
  const attempts=error instanceof AiExecutionError?error.executionSnapshot?.attempts:undefined;
  return Array.isArray(attempts)&&attempts.some(attempt=>Boolean((attempt as {requestSent?:boolean}).requestSent)&&!(attempt as {responseReceived?:boolean}).responseReceived);
}

async function execute(turn:Awaited<ReturnType<typeof repository.getCreativeHubTurn>>,binding:Awaited<ReturnType<typeof repository.getCreativeHubThread>>['binding'],ai?:NewDesignAiGateway){
  if(!ai?.diagnoseCreativeHub){await repository.failCreativeHubTurn(turn.id,'创作中枢模型能力尚未接入。');throw new NewDesignError('创作中枢模型能力尚未接入，请检查新版模型设置。',503);}
  try{const generated=await ai.diagnoseCreativeHub({question:turn.question,binding,state:turn.frozenState});return repository.completeCreativeHubTurn(turn.id,generated.output,generated.promptSnapshot,generated.modelSnapshot,generated.usedTokens);}
  catch(error){await repository.failCreativeHubTurn(turn.id,error instanceof NewDesignError?error.message:'诊断执行未完成，请读取原回执后处理。',unknownExecution(error));throw error;}
}

export async function runCreativeHubTurn(threadId:string,raw:unknown,ai?:NewDesignAiGateway){
  const input:CreativeHubTurnRequest=creativeHubTurnRequestSchema.parse(raw),[current,state]=await Promise.all([repository.getCreativeHubThread(threadId),repository.readCreativeHubState(threadId)]),started=await repository.startCreativeHubTurn(threadId,input,state);
  if(started.repeated||started.turn.status!=='running')return started;
  return{turn:await execute(started.turn,current.binding,ai),repeated:false};
}

export async function resumeCreativeHubTurn(threadId:string,turnId:string,ai?:NewDesignAiGateway){
  const current=await repository.getCreativeHubThread(threadId),existing=await repository.getCreativeHubTurn(turnId);if(existing.threadId!==threadId)throw new NewDesignError('原诊断不属于当前会话。',404);const resumed=await repository.resumeCreativeHubTurn(turnId);return execute(resumed,current.binding,ai);
}

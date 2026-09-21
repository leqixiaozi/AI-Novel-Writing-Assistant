import {worldGenerationRegenerateSchema,type WorldGenerationCandidateContent} from '../../../common/worldGeneration';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {AiExecutionError} from '../../ai';
import * as repository from '../../database/worldGeneration';
import {NewDesignError} from '../../domain/errors';

export const getWorldGenerationCapability=repository.getWorldGenerationCapability;
export const listWorldGenerationSessions=repository.listWorldGenerationSessions;
export const getWorldGenerationSession=repository.getWorldGenerationSession;
export const readWorldGenerationOriginal=repository.readWorldGenerationOriginal;
export const startWorldGeneration=repository.createWorldGenerationSession;
export const saveWorldGenerationCandidate=repository.saveWorldGenerationCandidate;
export const publishWorldCandidate=repository.publishWorldCandidate;

function requestWasSentWithoutReply(error:unknown):boolean{
  const attempts=error instanceof AiExecutionError?error.executionSnapshot?.attempts:undefined;
  return Array.isArray(attempts)&&attempts.some(attempt=>Boolean((attempt as {requestSent?:boolean}).requestSent)&&!(attempt as {responseReceived?:boolean}).responseReceived);
}

export async function generateWorldCandidate(sessionId:string,raw:unknown,ai?:NewDesignAiGateway){
  const input=worldGenerationRegenerateSchema.parse(raw),session=await repository.getWorldGenerationSession(sessionId),existing=session.candidates.find(item=>item.requestKey===input.requestKey);
  if(existing)return{session,candidate:existing,repeated:true};
  if(session.status==='result_unknown')throw new NewDesignError('上一条世界生成请求结果待核对；原输入已保留，不能换键重发。',409);
  if(session.revision!==input.expectedSessionRevision)throw new NewDesignError('世界会话已有新候选，请读取最新版本后再生成。',409);
  const previous=input.basedOnCandidateId?session.candidates.find(item=>item.id===input.basedOnCandidateId):null;
  if(input.basedOnCandidateId&&!previous)throw new NewDesignError('深化基础候选不属于当前世界会话。',422);
  if(!ai?.generateWorldCandidate){await repository.failWorldGenerationSession(sessionId,'世界生成模型能力尚未接入。');throw new NewDesignError('世界生成模型能力尚未接入，请检查新版模型设置。',503);}
  let modelCompleted=false;
  try{
    const generated=await ai.generateWorldCandidate({mode:previous?input.mode:'generate',name:session.name,blueprint:session.blueprint,previous:previous?.content??null,instruction:input.instruction});
    modelCompleted=true;
    return repository.saveWorldGenerationCandidate(sessionId,{requestKey:input.requestKey,expectedSessionRevision:input.expectedSessionRevision,basedOnCandidateId:input.basedOnCandidateId,source:'ai',candidate:generated.output as WorldGenerationCandidateContent},{promptSnapshot:generated.promptSnapshot,modelSnapshot:generated.modelSnapshot,usedTokens:generated.usedTokens});
  }catch(error){
    await repository.failWorldGenerationSession(sessionId,error instanceof Error?error.message:'世界候选生成未完成，请按原请求核对。',modelCompleted||requestWasSentWithoutReply(error));
    throw error;
  }
}

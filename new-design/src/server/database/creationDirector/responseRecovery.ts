import {createHash} from 'node:crypto';
import {preparePrompt} from '../../ai/prompts';
import {decodeModelObject,type OutputSyntaxRepair} from '../../ai/runtime/structuredResponse';
import {NewDesignError} from '../../domain/errors';
import {stableHash} from '../aiContracts';
import {creationDirectorState,CREATION_DIRECTOR_STAGES} from '../../../common/creationDirector';
import type {CreationPreparationOutput} from '../../../common/creationReviewAi';
import type {CreationPreparationPlan} from './preparation';

// Private evidence can be revalidated only through an explicit source-page command.
export function hasRecoverableResponse(batch:Record<string,any>):boolean {
  const evidence=batch.preparation_execution?.failedResponseEvidence;
  return batch.status==='failed'&&!batch.preparation_terminal&&!batch.preparation_superseded_by
    &&batch.preparation_failure?.modelRequestState==='completed'
    &&typeof evidence?.content==='string'&&evidence.content.length>0&&evidence.truncated===false
    &&['stop','end_turn','stop_sequence'].includes(evidence.finishReason);
}

export function validateRetainedResponse(batch:Record<string,any>,session:Record<string,any>) {
  const fail=()=>new NewDesignError('原回复、冻结规格或开书阶段已改变，不能恢复覆盖；请核对原批次。',409);
  const state=creationDirectorState(session.input_payload),plan=batch.frozen_plan as CreationPreparationPlan;
  if(!hasRecoverableResponse(batch)||batch.session_id!==session.id||session.status!=='failed'
    ||Number(session.revision)!==Number(batch.base_revision)+2||session.director_active_command_key
    ||state?.activeBatchId||!plan||stableHash(plan.input)!==plan.inputHash
    ||plan.input.sessionId!==session.id||plan.input.sessionRevision!==Number(batch.base_revision))throw fail();
  if(plan.input.stage&&(!state||state.mode==='manual'||CREATION_DIRECTOR_STAGES[state.cursor]?.key!==plan.input.stage))throw fail();
  const evidence=batch.preparation_execution.failedResponseEvidence;
  const bytes=Buffer.byteLength(evidence.content,'utf8');
  if(bytes!==evidence.contentBytes||bytes!==evidence.retainedBytes
    ||createHash('sha256').update(evidence.content,'utf8').digest('hex')!==evidence.contentSha256)throw fail();
  let output:CreationPreparationOutput,outputRepair:OutputSyntaxRepair|undefined;
  try {
    const prompt=preparePrompt(plan.taskType,plan.input,plan.assetVersion);
    if(prompt.assetId!==plan.assetId||prompt.version!==plan.assetVersion||stableHash(prompt.messages)!==stableHash(plan.messages)||stableHash(prompt.outputSchema)!==stableHash(plan.outputSchema))throw fail();
    const decoded=decodeModelObject(evidence.content);outputRepair=decoded.outputRepair;
    output=prompt.parseOutput(decoded.value) as CreationPreparationOutput;
  }catch {throw new NewDesignError('原回复仍不符合完整的冻结规格；没有修补、保存或重新调用模型。',422);}
  const {failedResponseEvidence,...originalSnapshot}=batch.preparation_execution;
  return {output,execution:{modelSnapshot:{...originalSnapshot,...(outputRepair?{outputRepair}:{}),recoveredResponse:{batchId:batch.id,contentSha256:evidence.contentSha256}},recoveredResponseEvidence:failedResponseEvidence,usedTokens:batch.preparation_execution.knownTokens,
    originalFailure:batch.preparation_failure,promptSnapshot:{assetId:plan.assetId,version:plan.assetVersion,inputHash:plan.inputHash,modelRouteSnapshotId:plan.modelSnapshot.id,outputSchema:plan.outputSchema}}};
}

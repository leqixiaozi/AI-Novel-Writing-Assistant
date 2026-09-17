import type { PoolClient } from "pg";
import { NewDesignError } from "../../../domain/errors";
import {stableHash} from "../../aiContracts/integrity";
import type {ResourceSupplementFrozenSource} from "../../../../common/resourceSupplements/correction";

/** Candidate-only manual contract. Full settlement and initial-state writes stay closed. */
export async function assertResourceSupplementCandidateContract(client:PoolClient,session:Record<string,unknown>,operation:string,lock=true):Promise<void> {
  if(session.adoption_kind!=="resource_supplement")return;
  if(operation==="commit"||operation==="initial")throw new NewDesignError("资源补充尚需完成下游复核，暂不可结算或回溯建立初始状态。原正文和确认记录保留。",503);
  const available=await client.query(`SELECT 1 FROM new_design.schema_migrations
    WHERE id='088_stable_resource_supplement_candidates'
      AND position('stable_resource_supplement_candidates_v1' IN pg_get_functiondef(to_regprocedure('new_design.block_unavailable_resource_supplement_extraction()')))>0`);
  if(!available.rowCount)throw new NewDesignError("资源补充候选合同未开放，请保留原请求和来源核对。",503);
  if(!(await client.query(`SELECT base.id FROM new_design.chapter_stable_checkpoints base
    JOIN new_design.chapter_adoption_sessions original ON original.id=base.session_id AND original.status='stable'
    JOIN new_design.chapter_settlements settlement ON settlement.id=base.settlement_id AND settlement.status='committed'
    WHERE base.id=$1 AND base.book_id=$2 AND base.chapter_document_id=$3 AND base.body_version_id=$4 AND base.status='stable'
    ${lock?'FOR SHARE OF base,original,settlement':''}`,[session.supplement_base_checkpoint_id,session.book_id,session.chapter_document_id,session.body_version_id])).rowCount)
    throw new NewDesignError("原稳定结算已变化，请核对原补充来源，不能重复写入。",409);
  const saved=(await client.query('SELECT source_snapshot FROM new_design.chapter_resource_supplements WHERE session_id=$1 AND book_id=$2',[session.id,session.book_id])).rows[0]?.source_snapshot as ResourceSupplementFrozenSource|undefined;
  const owner=await import('../../resourceSupplements');
  const current=await owner.readStableResourceSupplementBasisInTransaction(client,String(session.book_id),String(session.supplement_base_checkpoint_id));
  const currentPlan=current.original.planning_version as Record<string,unknown>,savedPlan=saved?.basis?.original.planning_version as Record<string,unknown>|undefined;
  if(!saved?.basis||stableHash(current.confirmed)!==stableHash(saved.basis.confirmed)
    ||stableHash(current.original.confirmedSources)!==stableHash(saved.basis.original.confirmedSources)
    ||!savedPlan||currentPlan.id!==savedPlan.id||currentPlan.content_hash!==savedPlan.content_hash
    ||stableHash(currentPlan.content)!==stableHash(savedPlan.content)
    ||stableHash(current.original.planningReferences)!==stableHash(saved.basis.original.planningReferences))
    throw new NewDesignError('原确认来源或正文所用计划已失效，请保留原补充请求核对。',409);
  if(saved.contract==='stable_resource_correction_preview_v1'){
    if(!(await client.query(`SELECT id FROM new_design.schema_migrations WHERE id='093_resource_supplement_correction_candidates'
      AND position('resource_correction_candidates_v1' IN coalesce(pg_get_functiondef(to_regprocedure('new_design.block_unavailable_resource_correction_candidates()')),''))>0`)).rowCount)
      throw new NewDesignError('修正候选的实际来源合同尚不可用，请保留原修正请求核对。',503);
    await owner.readFrozenResourceSupplementCorrectionInTransaction(client,session,current.bodyContentHash);
    const fresh=await owner.previewResourceSupplementCorrectionInTransaction(client,String(session.book_id),saved.input);
    if(stableHash(fresh.correction.issue)!==stableHash(saved.correction.issue)||stableHash(fresh.correction.prefixSource)!==stableHash(saved.correction.prefixSource)
      ||stableHash(fresh.relatedIssues)!==stableHash(saved.relatedIssues)||stableHash(fresh.resourceScope)!==stableHash(saved.resourceScope))
      throw new NewDesignError('实际冲突、章前证明或资源来源已变化，请保留原修正清单核对，不能套用旧候选。',409);
    return;
  }
  await owner.assertResourceSupplementHistoricalSourceAvailableInTransaction(client,String(session.book_id),current.chapterOrder,saved.catalog.subjects);
  for(const subject of saved.catalog.subjects)for(const field of subject.fields){
    const actual=await owner.readResourceSupplementHistoricalStateInTransaction(client,{bookId:String(session.book_id),checkpointId:current.checkpointId,subjectKind:subject.subjectKind,subjectId:subject.id,stateKey:field.key});
    if(actual.hash!==field.baseline.hash)throw new NewDesignError('该章实际历史前值已变化，请保留原清单核对，不能按新来源解释旧候选。',409);
  }
}

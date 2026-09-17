import type { PoolClient } from "pg";
import { NewDesignError } from "../../../domain/errors";
import {stableHash} from "../../aiContracts/integrity";
import type {ResourceSupplementPreview} from "../../../../common/resourceSupplements";

/** Candidate-only manual contract. Full settlement and initial-state writes stay closed. */
export async function assertResourceSupplementCandidateContract(client:PoolClient,session:Record<string,unknown>,operation:string):Promise<void> {
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
    FOR SHARE OF base,original,settlement`,[session.supplement_base_checkpoint_id,session.book_id,session.chapter_document_id,session.body_version_id])).rowCount)
    throw new NewDesignError("原稳定结算已变化，请核对原补充来源，不能重复写入。",409);
  const saved=(await client.query('SELECT source_snapshot FROM new_design.chapter_resource_supplements WHERE session_id=$1 AND book_id=$2',[session.id,session.book_id])).rows[0]?.source_snapshot as ResourceSupplementPreview|undefined;
  const owner=await import('../../resourceSupplements');
  const current=await owner.readStableResourceSupplementBasisInTransaction(client,String(session.book_id),String(session.supplement_base_checkpoint_id));
  const currentPlan=current.original.planning_version as Record<string,unknown>,savedPlan=saved?.basis?.original.planning_version as Record<string,unknown>|undefined;
  if(!saved?.basis||stableHash(current.confirmed)!==stableHash(saved.basis.confirmed)
    ||stableHash(current.original.confirmedSources)!==stableHash(saved.basis.original.confirmedSources)
    ||!savedPlan||currentPlan.id!==savedPlan.id||currentPlan.content_hash!==savedPlan.content_hash
    ||stableHash(currentPlan.content)!==stableHash(savedPlan.content)
    ||stableHash(current.original.planningReferences)!==stableHash(saved.basis.original.planningReferences))
    throw new NewDesignError('原确认来源或正文所用计划已失效，请保留原补充请求核对。',409);
}

import {insertRevisionRecords,resourceSupplementImpactReviewRows} from '../persistence';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {requireCardWorkflowTypes} from '../persistence';
import type {ResourceSupplementSettlementImpact} from '../../../../common/resourceSupplements';
import type {ResourceSupplementMergedWrite} from '../../chapterSettlement';
import {NewDesignError} from '../../../domain/errors';
import {stable,stableHash} from '../../aiContracts/integrity';

/** Transaction-owned journal. It cannot publish or resolve an issue by itself.
 * Journal, source fence, merged state and the full formal receipt must be atomic. */
export async function recordResourceSupplementIntegrityInTransaction(client:PoolClient,bookId:string,merged:ResourceSupplementMergedWrite,impact:ResourceSupplementSettlementImpact):Promise<{settlementId:string;issueIds:string[]}>{
  await requireCardWorkflowTypes(client,['resource_supplement_integrity_journal','resource_supplement_integrity_issue'],true);
  const marker=await client.query(`SELECT id FROM new_design.schema_migrations WHERE id IN ('132_card_kernel_tables_only','133_card_kernel_tables_only_upgrade')
    AND position('resource_supplement_integrity_v1' IN coalesce(pg_get_functiondef(to_regprocedure('new_design.validate_resource_supplement_integrity_journal()')),''))>0`);
  if(!marker.rowCount)throw new NewDesignError('真实资源来源完整性存储尚不可用，请保留原补充清单。',503);
  if(impact.bookId!==bookId||merged.sessionId!==impact.sessionId||merged.impactHash!==impact.impactHash||merged.baseCheckpointId!==impact.baseCheckpointId)
    throw new NewDesignError('合并来源与完整实际影响不一致，不能记录冲突或发布补充。',409);
  const saved=(await client.query(`SELECT impact_snapshot FROM ${resourceSupplementImpactReviewRows} resource_supplement_impact_review_record WHERE review_id=$1 AND book_id=$2 AND session_id=$3 FOR SHARE`,[merged.reviewId,bookId,merged.sessionId])).rows[0];
  if(!saved||stableHash(saved.impact_snapshot)!==stableHash(impact))throw new NewDesignError('原影响确认缺失或不一致，不能写入资源完整性标志。',409);
  await insertRevisionRecords(client, 'resource_supplement_integrity_journal', `SELECT ($1)::uuid AS settlement_id,($2)::uuid AS book_id,($3)::uuid AS review_id,($4)::uuid AS checkpoint_id,($5::jsonb)::jsonb AS merged_write,($6)::char(64) AS merged_hash,($7)::text AS canonical_merged,(now())::timestamptz AS created_at`, [merged.settlementId,bookId,merged.reviewId,merged.checkpointId,JSON.stringify(merged),stableHash(merged),stable(merged)], [["settlement_id"],["checkpoint_id"]]);
  const issueIds:string[]=[];
  for(const row of impact.stateChain.filter(row=>row.reason!=='compatible')){
    const id=randomUUID(),route=`/new-design/books/${bookId}/writing?chapterDocument=${row.chapterDocumentId}&resourceIssue=${id}`;
    await insertRevisionRecords(client, 'resource_supplement_integrity_issue', `SELECT ($1)::uuid AS issue_id,($2)::uuid AS settlement_id,($3)::uuid AS book_id,($4)::uuid AS chapter_document_id,($5)::uuid AS body_version_id,($6)::uuid AS state_change_id,($7)::text AS subject_kind,($8)::uuid AS subject_id,($9)::text AS state_key,($10::jsonb)::jsonb AS impact,($11)::text AS source_route,(now())::timestamptz AS created_at`, [id,merged.settlementId,bookId,row.chapterDocumentId,row.bodyVersionId,row.stateChangeId,row.subjectKind,row.subjectId,row.stateKey,JSON.stringify(row),route], [["issue_id"],["settlement_id","state_change_id"]]);
    issueIds.push(id);
  }
  return{settlementId:merged.settlementId,issueIds};
}

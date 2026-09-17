import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ResourceSupplementSettlementImpact} from '../../../../common/resourceSupplements';
import type {ResourceSupplementMergedWrite} from '../../chapterSettlement';
import {NewDesignError} from '../../../domain/errors';
import {stable,stableHash} from '../../aiContracts/integrity';

/** Transaction-owned journal. It cannot publish or resolve an issue by itself.
 * Journal, source fence, merged state and the full formal receipt must be atomic. */
export async function recordResourceSupplementIntegrityInTransaction(client:PoolClient,bookId:string,merged:ResourceSupplementMergedWrite,impact:ResourceSupplementSettlementImpact):Promise<{settlementId:string;issueIds:string[]}>{
  const marker=await client.query(`SELECT id FROM new_design.schema_migrations WHERE id='090_resource_supplement_integrity'
    AND position('resource_supplement_integrity_v1' IN coalesce(pg_get_functiondef(to_regprocedure('new_design.validate_resource_supplement_integrity_journal()')),''))>0`);
  if(!marker.rowCount)throw new NewDesignError('真实资源来源完整性存储尚不可用，请保留原补充清单。',503);
  if(impact.bookId!==bookId||merged.sessionId!==impact.sessionId||merged.impactHash!==impact.impactHash||merged.baseCheckpointId!==impact.baseCheckpointId)
    throw new NewDesignError('合并来源与完整实际影响不一致，不能记录冲突或发布补充。',409);
  const saved=(await client.query('SELECT impact_snapshot FROM new_design.resource_supplement_impact_reviews WHERE review_id=$1 AND book_id=$2 AND session_id=$3 FOR SHARE',[merged.reviewId,bookId,merged.sessionId])).rows[0];
  if(!saved||stableHash(saved.impact_snapshot)!==stableHash(impact))throw new NewDesignError('原影响确认缺失或不一致，不能写入资源完整性标志。',409);
  await client.query(`INSERT INTO new_design.resource_supplement_integrity_journals(settlement_id,book_id,review_id,checkpoint_id,merged_write,merged_hash,canonical_merged)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,[merged.settlementId,bookId,merged.reviewId,merged.checkpointId,JSON.stringify(merged),stableHash(merged),stable(merged)]);
  const issueIds:string[]=[];
  for(const row of impact.stateChain.filter(row=>row.reason!=='compatible')){
    const id=randomUUID(),route=`/new-design/books/${bookId}/writing?chapterDocument=${row.chapterDocumentId}&resourceIssue=${id}`;
    await client.query(`INSERT INTO new_design.resource_supplement_integrity_issues(issue_id,settlement_id,book_id,chapter_document_id,body_version_id,state_change_id,subject_kind,subject_id,state_key,impact,source_route)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,[id,merged.settlementId,bookId,row.chapterDocumentId,row.bodyVersionId,row.stateChangeId,row.subjectKind,row.subjectId,row.stateKey,JSON.stringify(row),route]);
    issueIds.push(id);
  }
  return{settlementId:merged.settlementId,issueIds};
}

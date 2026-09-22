import {resourceSupplementIntegrityIssueRows,resourceSupplementIntegrityResolutionRows} from '../persistence';
import type {PoolClient} from 'pg';
import {requireCardWorkflowTypes} from '../persistence';
import {NewDesignError} from '../../../domain/errors';

/** Ordinary END-of-chapter preparation cannot clear a real source conflict by
 * rereading its unchanged committed value. Earlier healthy prefixes remain usable. */
export async function assertResourceSupplementHistoricalSourceAvailableInTransaction(client:PoolClient,bookId:string,chapterOrder:number,subjects:Array<{subjectKind:'card'|'relation';id:string}>):Promise<void>{
  await requireCardWorkflowTypes(client,['resource_supplement_integrity_issue','resource_supplement_integrity_resolution']);
  const issue=(await client.query(`SELECT issue.issue_id FROM ${resourceSupplementIntegrityIssueRows} issue
    JOIN new_design.chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
    JOIN jsonb_to_recordset($2::jsonb) scope(subject_kind text,subject_id uuid) ON scope.subject_kind=issue.subject_kind AND scope.subject_id=issue.subject_id
    WHERE issue.book_id=$1 AND document.logical_order<=$3
      AND NOT EXISTS(SELECT 1 FROM ${resourceSupplementIntegrityResolutionRows} resolution WHERE resolution.issue_id=issue.issue_id)
    ORDER BY document.logical_order,issue.issue_id LIMIT 1`,[bookId,JSON.stringify(subjects.map(subject=>({subject_kind:subject.subjectKind,subject_id:subject.id}))),chapterOrder])).rows[0];
  if(issue)throw new NewDesignError('所选资源的章末来源存在未修正的真实冲突，请返回对应章节核对修正来源；不能把原状态重新读取为可用前值。',409);
}

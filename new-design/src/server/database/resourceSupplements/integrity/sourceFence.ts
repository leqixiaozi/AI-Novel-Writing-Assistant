import type {PoolClient} from 'pg';
import {NewDesignError} from '../../../domain/errors';

/** Ordinary END-of-chapter preparation cannot clear a real source conflict by
 * rereading its unchanged committed value. Earlier healthy prefixes remain usable. */
export async function assertResourceSupplementHistoricalSourceAvailableInTransaction(client:PoolClient,bookId:string,chapterOrder:number,subjects:Array<{subjectKind:'card'|'relation';id:string}>):Promise<void>{
  const tables=(await client.query("SELECT to_regclass('new_design.resource_supplement_integrity_issues') issues,to_regclass('new_design.resource_supplement_integrity_resolutions') resolutions")).rows[0];
  if(!tables.issues&&!tables.resolutions)return;
  if(!tables.issues||!tables.resolutions)throw new NewDesignError('资源来源完整性存储不完整，请保留原请求核对。',503);
  const issue=(await client.query(`SELECT issue.issue_id FROM new_design.resource_supplement_integrity_issues issue
    JOIN new_design.chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
    JOIN jsonb_to_recordset($2::jsonb) scope(subject_kind text,subject_id uuid) ON scope.subject_kind=issue.subject_kind AND scope.subject_id=issue.subject_id
    WHERE issue.book_id=$1 AND document.logical_order<=$3
      AND NOT EXISTS(SELECT 1 FROM new_design.resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)
    ORDER BY document.logical_order,issue.issue_id LIMIT 1`,[bookId,JSON.stringify(subjects.map(subject=>({subject_kind:subject.subjectKind,subject_id:subject.id}))),chapterOrder])).rows[0];
  if(issue)throw new NewDesignError('所选资源的章末来源存在未修正的真实冲突，请返回对应章节核对修正来源；不能把原状态重新读取为可用前值。',409);
}

import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {NewDesignError} from '../../../domain/errors';
import {stableHash} from '../../aiContracts';
import {readStableResourceSupplementBasisInTransaction} from '../basis';

/** Explicit issue-owned BEFORE-chapter source. Kept separate from the normal
 * END-of-chapter v1 contract; no arbitrary before-value or latest initial fallback. */
export async function readResourceSupplementCorrectionBasisInTransaction(client:PoolClient,bookId:string,issueId:string):Promise<{
  contract:'resource_supplement_correction_basis_v1';bookId:string;issueId:string;chapterDocumentId:string;bodyVersionId:string;
  baseCheckpointId:string;subjectKind:'card'|'relation';subjectId:string;stateKey:string;
  beforeValue:unknown;originalRecordedBefore:unknown;originalRecordedAfter:unknown;
  issue:Record<string,unknown>;chapterEndBasis:Awaited<ReturnType<typeof readStableResourceSupplementBasisInTransaction>>;
  prefixSource:Record<string,any>;sourceHash:string;
}>{
  z.string().uuid().parse(bookId);z.string().uuid().parse(issueId);
  const issue=(await client.query(`SELECT issue.*,to_jsonb(checkpoint) current_checkpoint
    FROM new_design.resource_supplement_integrity_issues issue
    JOIN new_design.chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
      AND document.status='active' AND document.adopted_version_id=issue.body_version_id
    LEFT JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.book_id=issue.book_id AND checkpoint.chapter_document_id=document.id
      AND checkpoint.body_version_id=issue.body_version_id AND checkpoint.status='stable'
    WHERE issue.issue_id=$1 AND issue.book_id=$2 AND NOT EXISTS(
      SELECT 1 FROM new_design.resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)`,[issueId,bookId])).rows[0];
  if(!issue||!issue.current_checkpoint?.summary?.confirmed?.states?.includes(issue.state_change_id))throw new NewDesignError('请选择本书仍有原确认来源的真实资源冲突；原正文或确认状态已变化时不能套用修正。',409);
  const basis=await readStableResourceSupplementBasisInTransaction(client,bookId,String(issue.current_checkpoint.id));
  // Select the actual latest row first, then validate its proof. Invalid proof
  // must reject; filtering it out and falling back to an older source is unsafe.
  const row=(await client.query(`SELECT to_jsonb(change) change,to_jsonb(proposal) proposal,to_jsonb(settlement) settlement,
    to_jsonb(anchor) anchor,to_jsonb(document) document,to_jsonb(body) body,to_jsonb(checkpoint) checkpoint,
    to_jsonb(checkpoint_commit) checkpoint_commit,to_jsonb(checkpoint_session) checkpoint_session
    FROM new_design.state_changes change
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id
      AND document.status='active' AND document.adopted_version_id=change.body_version_id
    LEFT JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
    LEFT JOIN new_design.state_change_proposals proposal ON proposal.id=change.proposal_id
    LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
    LEFT JOIN new_design.chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
    LEFT JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.book_id=change.book_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
    LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id
    LEFT JOIN new_design.chapter_adoption_sessions checkpoint_session ON checkpoint_session.id=checkpoint.session_id
    WHERE change.book_id=$1 AND change.subject_kind=$2 AND change.subject_id=$3 AND change.state_key=$4 AND change.status='active'
      AND document.logical_order<$5 AND coalesce(change.effective_story_order,document.logical_order)<$5
    ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1`,
    [bookId,issue.subject_kind,issue.subject_id,issue.state_key,basis.chapterOrder])).rows[0];
  const fail=()=>{throw new NewDesignError('修正所需的真实章前状态来源缺失或失效；保留原冲突，不能用章末值、旧来源或后建初始值补齐。',409);};
  if(!row)fail();
  const {change,proposal,settlement,anchor,body,checkpoint,checkpoint_commit,checkpoint_session}=row;
  const same=(a:unknown,b:unknown)=>stableHash(a)===stableHash(b);
  if(!proposal||proposal.book_id!==bookId||proposal.status!=='confirmed'||proposal.confirmed_state_change_id!==change.id
    ||proposal.chapter_document_id!==change.chapter_document_id||proposal.body_version_id!==change.body_version_id
    ||proposal.subject_kind!==change.subject_kind||proposal.subject_id!==change.subject_id||proposal.state_key!==change.state_key
    ||!same(proposal.before_json,change.before_json)||!same(proposal.after_json,change.after_json)
    ||!settlement||settlement.book_id!==bookId||settlement.status!=='committed'||settlement.chapter_document_id!==change.chapter_document_id||settlement.body_version_id!==change.body_version_id
    ||!body||body.archived_at!==null||typeof body.content!=='string'||createHash('sha256').update(body.content,'utf8').digest('hex')!==body.content_hash
    ||!checkpoint||!Array.isArray(checkpoint.summary?.confirmed?.states)||!checkpoint.summary.confirmed.states.includes(change.id)||new Set(checkpoint.summary.confirmed.states).size!==checkpoint.summary.confirmed.states.length
    ||checkpoint_commit?.status!=='committed'||checkpoint_commit.book_id!==bookId||checkpoint_commit.chapter_document_id!==change.chapter_document_id||checkpoint_commit.body_version_id!==change.body_version_id
    ||checkpoint_session?.status!=='stable'||checkpoint_session.book_id!==bookId||checkpoint_session.chapter_document_id!==change.chapter_document_id||checkpoint_session.body_version_id!==change.body_version_id||checkpoint_session.settlement_id!==checkpoint_commit.id
    ||change.text_anchor_id!==null&&(!anchor||anchor.status!=='active'||anchor.book_id!==bookId||anchor.chapter_document_id!==change.chapter_document_id||anchor.body_version_id!==change.body_version_id))fail();
  const frame={contract:'resource_supplement_correction_basis_v1' as const,bookId,issueId,chapterDocumentId:issue.chapter_document_id,bodyVersionId:issue.body_version_id,
    baseCheckpointId:basis.checkpointId,subjectKind:issue.subject_kind as 'card'|'relation',subjectId:issue.subject_id,stateKey:issue.state_key,
    beforeValue:change.after_json,originalRecordedBefore:issue.impact.recordedBefore,originalRecordedAfter:issue.impact.recordedAfter,
    issue,chapterEndBasis:basis,prefixSource:row};
  const normalized=JSON.parse(JSON.stringify(frame)) as typeof frame;
  return {...normalized,sourceHash:stableHash(normalized)};
}

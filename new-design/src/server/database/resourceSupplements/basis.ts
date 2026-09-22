import {canonicalFactEvidenceRows,canonicalFactRows,chapterAdoptionPreparationRows,chapterAdoptionSessionRows,chapterStableCheckpointRows,knowledgeStateChangeRows,knowledgeStateProposalRows,knowledgeStateProposalVersionRows,planningVersionReferenceRows,planningVersionRows,stateChangeProposalRows,stateChangeRows} from './persistence';
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { StableResourceSupplementBasis } from "../../../common/resourceSupplements";
import { NewDesignError } from "../../domain/errors";
import { stableHash } from "../aiContracts/integrity";

type Row = Record<string, unknown>;
const idList = z.array(z.string().uuid()).refine(ids => new Set(ids).size === ids.length);
const confirmedSchema = z.object({ facts: idList, knowledge: idList, states: idList }).strict();
const normalize = (value: unknown): Row => JSON.parse(JSON.stringify(value)) as Row;
const unavailable = (message: string): never => { throw new NewDesignError(message, 409); };

/** Caller owns the repeatable-read transaction. This function issues only SELECT. */
export async function readStableResourceSupplementBasisInTransaction(
  client: PoolClient, bookId: string, checkpointId: string,
): Promise<StableResourceSupplementBasis> {
  if (!z.string().uuid().safeParse(bookId).success || !z.string().uuid().safeParse(checkpointId).success)
    throw new NewDesignError("请选择本书的稳定章节。", 422);
  const row = (await client.query(`SELECT to_jsonb(checkpoint) checkpoint, to_jsonb(document) document,
    to_jsonb(body) body, to_jsonb(session) session, to_jsonb(settlement) settlement,
    to_jsonb(preparation) preparation, to_jsonb(adoption) adoption, to_jsonb(plan) planning_version
    FROM ${chapterStableCheckpointRows} checkpoint
    JOIN new_design.books book ON book.id=checkpoint.book_id AND book.status='active'
    JOIN new_design.chapter_documents document ON document.id=checkpoint.chapter_document_id
      AND document.book_id=book.id AND document.status='active' AND document.adopted_version_id=checkpoint.body_version_id
    JOIN new_design.chapter_body_versions body ON body.id=checkpoint.body_version_id
      AND body.chapter_document_id=document.id AND body.archived_at IS NULL
    JOIN ${chapterAdoptionSessionRows} session ON session.id=checkpoint.session_id
      AND session.book_id=book.id AND session.chapter_document_id=document.id AND session.body_version_id=body.id
      AND session.status='stable' AND session.settlement_id=checkpoint.settlement_id
    JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id
      AND settlement.book_id=book.id AND settlement.chapter_document_id=document.id AND settlement.body_version_id=body.id
      AND settlement.status='committed'
    JOIN ${chapterAdoptionPreparationRows} preparation ON preparation.id=session.preparation_id
      AND preparation.book_id=book.id AND preparation.chapter_document_id=document.id AND preparation.body_version_id=body.id
      AND preparation.status='consumed' AND preparation.dependency_hash=session.dependency_hash
    JOIN new_design.chapter_body_adoptions adoption ON adoption.id=session.adoption_id
      AND adoption.chapter_document_id=document.id AND adoption.to_version_id=body.id
    JOIN ${planningVersionRows} plan ON plan.id=session.planning_version_id
      AND plan.object_id=session.planning_object_id AND plan.book_id=book.id
    WHERE checkpoint.id=$2 AND checkpoint.book_id=$1 AND checkpoint.status='stable'`, [bookId, checkpointId])).rows[0];
  if (!row) unavailable("该稳定章节的原正文、结算或来源已失效，请在章节中核对。原历史保留。");
  const { checkpoint, document, body, session, preparation, planning_version: plan } = row as Record<string, Row>;
  if (Number(checkpoint.chapter_order) !== Number(document.logical_order)
    || body.planning_version_id !== session.planning_version_id
    || preparation.planning_version_id !== session.planning_version_id
    || preparation.planning_object_id !== session.planning_object_id
    || preparation.context_manifest_id !== session.context_manifest_id
    || body.context_manifest_id !== session.context_manifest_id
    || preparation.planning_content_hash !== plan.content_hash
    || stableHash(preparation.dependency_snapshot) !== preparation.dependency_hash
    || createHash("sha256").update(String(body.content), "utf8").digest("hex") !== body.content_hash)
    unavailable("稳定章节的冻结来源不完整，不能把其他正文或计划作为补充依据。");
  const summary = checkpoint.summary as Row | undefined;
  const parsed = confirmedSchema.safeParse(summary?.confirmed);
  if (!parsed.success) return unavailable("该稳定章节缺少完整确认清单，请保留原结算并核对来源。");
  const confirmed = parsed.data;
  const facts = (await client.query(`SELECT DISTINCT fact.* FROM ${canonicalFactRows} fact
    JOIN ${canonicalFactEvidenceRows} evidence ON evidence.fact_id=fact.id AND evidence.stale_at IS NULL
    JOIN new_design.text_anchors anchor ON anchor.id=evidence.chapter_text_anchor_id AND anchor.status='active'
    WHERE fact.book_id=$1 AND fact.status='confirmed' AND anchor.book_id=$1
      AND anchor.chapter_document_id=$2 AND anchor.body_version_id=$3 AND fact.id=ANY($4::uuid[])
    ORDER BY fact.id`, [bookId, document.id, body.id, confirmed.facts])).rows;
  const knowledge = (await client.query(`SELECT change.*,to_jsonb(knowledge_version) proposal_version
    FROM ${knowledgeStateChangeRows} change
    JOIN ${knowledgeStateProposalRows} proposal ON proposal.id=change.proposal_id
      AND proposal.book_id=change.book_id AND proposal.status='confirmed' AND proposal.confirmed_change_id=change.id
    JOIN ${knowledgeStateProposalVersionRows} knowledge_version ON knowledge_version.id=change.proposal_version_id
      AND knowledge_version.proposal_id=proposal.id AND knowledge_version.id=proposal.current_version_id
    JOIN new_design.text_anchors anchor ON anchor.id=knowledge_version.text_anchor_id AND anchor.status='active'
    WHERE change.book_id=$1 AND change.status='active' AND anchor.book_id=$1
      AND knowledge_version.chapter_document_id=$2 AND knowledge_version.body_version_id=$3
      AND anchor.chapter_document_id=$2 AND anchor.body_version_id=$3 AND change.id=ANY($4::uuid[])
    ORDER BY change.sequence`, [bookId, document.id, body.id, confirmed.knowledge])).rows;
  const states = (await client.query(`SELECT change.* FROM ${stateChangeRows} change
    JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
      AND settlement.book_id=change.book_id AND settlement.status='committed'
    JOIN ${stateChangeProposalRows} proposal ON proposal.id=change.proposal_id
      AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
      AND proposal.book_id=change.book_id AND proposal.chapter_document_id=change.chapter_document_id
      AND proposal.body_version_id=change.body_version_id AND proposal.subject_kind=change.subject_kind
      AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key AND proposal.after_json=change.after_json
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    WHERE change.book_id=$1 AND change.chapter_document_id=$2 AND change.body_version_id=$3 AND change.status='active'
      AND settlement.chapter_document_id=$2 AND settlement.body_version_id=$3
      AND (change.text_anchor_id IS NULL OR (anchor.status='active' AND anchor.book_id=$1
        AND anchor.chapter_document_id=$2 AND anchor.body_version_id=$3))
      AND change.id=ANY($4::uuid[]) ORDER BY change.sequence`, [bookId, document.id, body.id, confirmed.states])).rows;
  if (facts.length !== confirmed.facts.length || knowledge.length !== confirmed.knowledge.length || states.length !== confirmed.states.length)
    unavailable("原结算的确认事实、认知或状态有失效来源，请先核对；补充不能覆盖或丢弃原确认记录。");
  const planningReferences = (await client.query(`SELECT to_jsonb(reference)||jsonb_build_object('source_version',to_jsonb(card_version)) full_reference
    FROM ${planningVersionReferenceRows} reference
    JOIN new_design.card_versions card_version ON card_version.id=reference.card_version_id AND card_version.card_id=reference.card_id
    WHERE reference.book_id=$1 AND reference.planning_object_id=$2 AND reference.planning_version_id=$3
    ORDER BY reference.id`, [bookId, session.planning_object_id, session.planning_version_id])).rows.map(row=>row.full_reference);
  const original = normalize({ ...row, planningReferences, confirmedSources: { facts, knowledge, states } });
  const basis: Omit<StableResourceSupplementBasis, "sourceHash"> = {
    contract: "stable_resource_supplement_basis_v1", bookId, chapterDocumentId: String(document.id),
    chapterCardId: String(document.chapter_card_id), chapterOrder: Number(checkpoint.chapter_order),
    documentRevision: Number(document.revision), checkpointId, checkpointCreatedAt: String(checkpoint.created_at),
    sessionId: String(session.id), settlementId: String(checkpoint.settlement_id), adoptionId: String(session.adoption_id),
    preparationId: String(preparation.id), bodyVersionId: String(body.id), bodyContent: String(body.content),
    bodyContentHash: String(body.content_hash), planningObjectId: String(session.planning_object_id),
    planningVersionId: String(session.planning_version_id), contextManifestId: session.context_manifest_id ? String(session.context_manifest_id) : null,
    policyVersionId: String(session.policy_version_id), confirmed, original,
  };
  return { ...basis, sourceHash: stableHash(basis) };
}

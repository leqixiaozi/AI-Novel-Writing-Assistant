import {entityInitialStateRows,entityInitialStateVersionRows,stateChangeProposalRows,stateChangeRows} from './persistence';
import type { PoolClient } from "pg";
import { z } from "zod";
import type { ResourceSupplementStateInput, ResourceSupplementHistoricalState, StableResourceSupplementBasis } from "../../../common/resourceSupplements";
import { NewDesignError } from "../../domain/errors";
import { stableHash } from "../aiContracts/integrity";
import { readStableResourceSupplementBasisInTransaction } from "./basis";

const inputSchema = z.object({ bookId: z.string().uuid(), checkpointId: z.string().uuid(),
  subjectKind: z.enum(["card", "relation"]), subjectId: z.string().uuid(), stateKey: z.string().min(1).max(160), }).strict();

/** End of the selected stable chapter, including its existing confirmations.
 * Never reads the latest-book projection or creates a retrospective initial value. */
export async function readResourceSupplementHistoricalStateInTransaction(
  client: PoolClient, raw: ResourceSupplementStateInput,
): Promise<ResourceSupplementHistoricalState> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new NewDesignError("请选择本书的明确资源状态和稳定章节。", 422);
  const input = parsed.data;
  const basis = await readStableResourceSupplementBasisInTransaction(client, input.bookId, input.checkpointId);
  return readHistoricalStateForValidatedBasis(client, basis, input);
}

/** Owned preflight reuses its already-validated basis in the same transaction. */
export async function readHistoricalStateForValidatedBasis(client: PoolClient, basis: StableResourceSupplementBasis,
  raw: ResourceSupplementStateInput): Promise<ResourceSupplementHistoricalState> {
  const input = inputSchema.parse(raw);
  if (basis.bookId !== input.bookId || basis.checkpointId !== input.checkpointId)
    throw new NewDesignError("历史状态与所选稳定章节不一致。", 422);
  const subjectRows = input.subjectKind === "card"
    ? `(SELECT card.id,card.space_id,card.status FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal)`
    : `new_design.card_relations`;
  if (!(await client.query(`SELECT subject.id FROM ${subjectRows} subject
    JOIN new_design.books book ON book.space_id=subject.space_id AND book.id=$1
    WHERE subject.id=$2 AND subject.status='active'`, [input.bookId, input.subjectId])).rowCount)
    throw new NewDesignError("所选资源状态不属于本书，或对象已停用。", 422);
  const change = (await client.query(`SELECT change.* FROM ${stateChangeRows} change
    JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
      AND settlement.book_id=change.book_id AND settlement.status='committed'
      AND settlement.chapter_document_id=change.chapter_document_id AND settlement.body_version_id=change.body_version_id
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id
      AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
    JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
    JOIN ${stateChangeProposalRows} proposal ON proposal.id=change.proposal_id
      AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
      AND proposal.book_id=change.book_id AND proposal.chapter_document_id=change.chapter_document_id
      AND proposal.body_version_id=change.body_version_id AND proposal.subject_kind=change.subject_kind
      AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key AND proposal.after_json=change.after_json
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    WHERE change.book_id=$1 AND change.subject_kind=$2 AND change.subject_id=$3 AND change.state_key=$4 AND change.status='active'
      AND document.logical_order<=$5 AND COALESCE(change.effective_story_order,document.logical_order)<=$5
      AND (change.text_anchor_id IS NULL OR (anchor.status='active' AND anchor.book_id=$1
        AND anchor.chapter_document_id=document.id AND anchor.body_version_id=body.id))
    ORDER BY COALESCE(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1`,
    [input.bookId, input.subjectKind, input.subjectId, input.stateKey, basis.chapterOrder])).rows[0];
  const initial = change ? null : (await client.query(`SELECT version.* FROM ${entityInitialStateRows} state
    JOIN ${entityInitialStateVersionRows} version ON version.initial_state_id=state.id
    WHERE state.book_id=$1 AND state.subject_kind=$2 AND state.subject_id=$3 AND state.state_key=$4
      AND version.created_at<=$5::timestamptz ORDER BY version.version DESC LIMIT 1`,
    [input.bookId, input.subjectKind, input.subjectId, input.stateKey, basis.checkpointCreatedAt])).rows[0];
  const source = change ?? initial ?? null;
  const state: Omit<ResourceSupplementHistoricalState, "hash"> = {
    contract: "resource_supplement_historical_state_v1", ...input, chapterOrder: basis.chapterOrder,
    known: source !== null, value: change ? change.after_json : initial ? initial.value_json : null,
    sourceKind: change ? "state_change" : initial ? "initial_state" : "unknown", sourceId: source ? String(source.id) : null,
    source: source ? JSON.parse(JSON.stringify(source)) as Record<string, unknown> : null,
  };
  return { ...state, hash: stableHash(state) };
}

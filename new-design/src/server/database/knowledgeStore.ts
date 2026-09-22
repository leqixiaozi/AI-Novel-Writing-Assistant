import {storyRecordCtes,insertStoryRecords,updateStoryRecords,insertStoryReviewActions,deleteStoryRecords,lockedStoryRecordQuery} from './storyTimeline/persistence';
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  CanonicalFactValueKind,
  CurrentKnowledgeState,
  EpistemicClaim,
  KnowledgeAcquisitionMethod,
  KnowledgeHolderKind,
  KnowledgeStance,
  KnowledgeStateChange,
  KnowledgeStateProposal,
  KnowledgeStateProposalVersion,
  KnowledgeStateReviewAction,
} from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
export { findOrCreateClaim as findOrCreateKnowledgeClaimInTransaction, rebuildKnowledgeProjection as rebuildKnowledgeProjectionInTransaction };
import { getNewDesignPool } from "./runtime";

type ProposalVersionInput = {
  stance: KnowledgeStance;
  confidence?: number | null;
  acquisitionMethod: KnowledgeAcquisitionMethod;
  sourceCharacterCardId?: string | null;
  sourceEventCardId?: string | null;
  chapterDocumentId?: string | null;
  bodyVersionId?: string | null;
  textAnchorId?: string | null;
  effectiveStoryOrder?: number | null;
  effectiveNarrativeOrder?: number | null;
  reason: string;
  editor?: string;
};

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new NewDesignError("认知命题必须可以保存为 JSON。", 422);
  return encoded;
}

export function knowledgeClaimValueHash(value: unknown, objectCardId?: string | null): string {
  return createHash("sha256").update(stable({ value, objectCardId: objectCardId ?? null }), "utf8").digest("hex");
}

const valueHash=knowledgeClaimValueHash;

function mapClaim(row: Record<string, unknown>): EpistemicClaim {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    subjectCardId: row.subject_card_id ? String(row.subject_card_id) : null,
    predicate: String(row.predicate),
    valueKind: row.value_kind as CanonicalFactValueKind,
    value: row.value_json,
    objectCardId: row.object_card_id ? String(row.object_card_id) : null,
    valueHash: String(row.value_hash),
    truthFactId: row.truth_fact_id ? String(row.truth_fact_id) : null,
    createdBy: String(row.created_by),
    createdAt: asDate(row.created_at),
  };
}

function mapVersion(row: Record<string, unknown>): KnowledgeStateProposalVersion {
  return {
    id: String(row.id), proposalId: String(row.proposal_id), version: Number(row.version),
    stance: row.stance as KnowledgeStance,
    confidence: row.confidence === null ? null : Number(row.confidence),
    acquisitionMethod: row.acquisition_method as KnowledgeAcquisitionMethod,
    sourceCharacterCardId: row.source_character_card_id ? String(row.source_character_card_id) : null,
    sourceEventCardId: row.source_event_card_id ? String(row.source_event_card_id) : null,
    chapterDocumentId: row.chapter_document_id ? String(row.chapter_document_id) : null,
    bodyVersionId: row.body_version_id ? String(row.body_version_id) : null,
    textAnchorId: row.text_anchor_id ? String(row.text_anchor_id) : null,
    effectiveStoryOrder: row.effective_story_order === null ? null : Number(row.effective_story_order),
    effectiveNarrativeOrder: row.effective_narrative_order === null ? null : Number(row.effective_narrative_order),
    reason: String(row.reason), editor: String(row.editor), createdAt: asDate(row.created_at),
  };
}

function mapReview(row: Record<string, unknown>): KnowledgeStateReviewAction {
  return {
    id: String(row.id), proposalId: String(row.proposal_id), proposalVersionId: String(row.proposal_version_id),
    action: row.action as KnowledgeStateReviewAction["action"], actor: String(row.actor), note: String(row.note ?? ""),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null, createdAt: asDate(row.created_at),
  };
}

async function loadClaim(client: PoolClient, id: string): Promise<EpistemicClaim> {
  return mapClaim(assertFound((await client.query(`WITH ${storyRecordCtes.epistemic_claims}
SELECT * FROM epistemic_claims WHERE id=$1`, [id])).rows[0], "认知命题不存在。"));
}

async function requireBookCard(client: PoolClient, bookId: string, cardId: string, typeKey?: string): Promise<void> {
  const result = await client.query(
    "SELECT type.type_key FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal WHERE book.id=$1 AND card.id=$2",
    [bookId, cardId],
  );
  if (!result.rowCount || (typeKey && String(result.rows[0].type_key) !== typeKey)) {
    throw new NewDesignError(typeKey === "character" ? "人物不属于该书。" : typeKey === "event" ? "事件不属于该书。" : "资料不属于该书。", 422);
  }
}

async function validateVersionSource(client: PoolClient, bookId: string, source: string, input: ProposalVersionInput): Promise<void> {
  if (input.confidence !== undefined && input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) throw new NewDesignError("认知置信度必须在 0 到 1 之间。", 422);
  if (input.sourceCharacterCardId) await requireBookCard(client, bookId, input.sourceCharacterCardId, "character");
  if (input.sourceEventCardId) await requireBookCard(client, bookId, input.sourceEventCardId, "event");
  if (input.chapterDocumentId || input.bodyVersionId || input.textAnchorId) {
    if (!input.chapterDocumentId || !input.bodyVersionId) throw new NewDesignError("正文来源必须同时指定章节档案和正文版本。", 422);
    const body = await client.query(
      "SELECT 1 FROM new_design.chapter_body_versions version JOIN new_design.chapter_documents document ON document.id=version.chapter_document_id WHERE document.id=$1 AND version.id=$2 AND document.book_id=$3",
      [input.chapterDocumentId, input.bodyVersionId, bookId],
    );
    if (!body.rowCount) throw new NewDesignError("认知来源正文不属于该书章节。", 422);
    if (input.textAnchorId) {
      const anchor = await client.query(`SELECT 1 FROM new_design.text_anchors WHERE id=$1 AND body_version_id=$2`, [input.textAnchorId, input.bodyVersionId]);
      if (!anchor.rowCount) throw new NewDesignError("认知来源锚点不属于该正文版本。", 422);
    }
  }
  if (source === "ai" && (!input.bodyVersionId || !input.textAnchorId)) throw new NewDesignError("AI 认知提案必须绑定正文版本和精确锚点。", 422);
}

async function resolveHolder(client: PoolClient, bookId: string, holderKind: KnowledgeHolderKind, holderKey?: string, holderCardId?: string | null): Promise<{ holderKey: string; holderCardId: string | null }> {
  if (holderKind === "character") {
    if (!holderCardId) throw new NewDesignError("人物知情必须指定人物。", 422);
    await requireBookCard(client, bookId, holderCardId, "character");
    return { holderKey: holderCardId, holderCardId };
  }
  if (holderCardId) throw new NewDesignError("读者知情不能绑定人物卡片。", 422);
  return { holderKey: holderKey?.trim() || "default", holderCardId: null };
}

async function findOrCreateClaim(client: PoolClient, input: {bookId:string;subjectCardId?:string|null;predicate:string;valueKind:CanonicalFactValueKind;value:unknown;objectCardId?:string|null;truthFactId?:string|null;createdBy?:string}): Promise<EpistemicClaim> {
  stable(input.value);
  if (input.subjectCardId) await requireBookCard(client, input.bookId, input.subjectCardId);
  if (input.valueKind === "card_reference") {
    if (!input.objectCardId) throw new NewDesignError("卡片引用命题必须指定对象资料。", 422);
    await requireBookCard(client, input.bookId, input.objectCardId);
  } else if (input.objectCardId) throw new NewDesignError("只有卡片引用命题可以指定对象资料。", 422);
  if (input.truthFactId) {
    const fact = await client.query(`WITH ${storyRecordCtes.canonical_facts}
SELECT 1 FROM canonical_facts WHERE id=$1 AND book_id=$2 AND status='confirmed'`, [input.truthFactId, input.bookId]);
    if (!fact.rowCount) throw new NewDesignError("客观真相引用必须是本书已确认事实。", 422);
  }
  const hash = valueHash(input.value, input.objectCardId);
  const existing = await client.query(
    `WITH ${storyRecordCtes.epistemic_claims}
SELECT * FROM epistemic_claims WHERE book_id=$1 AND subject_card_id IS NOT DISTINCT FROM $2::uuid AND predicate=$3 AND value_hash=$4`,
    [input.bookId, input.subjectCardId ?? null, input.predicate, hash],
  );
  if (existing.rows[0]) return mapClaim(existing.rows[0]);
  const row = (await insertStoryRecords(client,"epistemic_claim",`SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS subject_card_id,($4)::text AS predicate,($5)::text AS value_kind,($6::jsonb)::jsonb AS value_json,($7)::uuid AS object_card_id,($8)::char(64) AS value_hash,($9)::uuid AS truth_fact_id,($10)::text AS created_by`,
    [randomUUID(), input.bookId, input.subjectCardId ?? null, input.predicate, input.valueKind, stable(input.value), input.objectCardId ?? null, hash, input.truthFactId ?? null, input.createdBy ?? "system"],
  )).rows[0];
  return mapClaim(row);
}

async function insertVersion(client: PoolClient, proposalId: string, version: number, input: ProposalVersionInput): Promise<KnowledgeStateProposalVersion> {
  const row = (await insertStoryRecords(client,"knowledge_state_proposal_version",`SELECT ($1)::uuid AS id,($2)::uuid AS proposal_id,($3)::integer AS version,($4)::text AS stance,($5)::numeric AS confidence,($6)::text AS acquisition_method,($7)::uuid AS source_character_card_id,($8)::uuid AS source_event_card_id,($9)::uuid AS chapter_document_id,($10)::uuid AS body_version_id,($11)::uuid AS text_anchor_id,($12)::numeric AS effective_story_order,($13)::numeric AS effective_narrative_order,($14)::text AS reason,($15)::text AS editor`,
    [randomUUID(), proposalId, version, input.stance, input.confidence ?? null, input.acquisitionMethod, input.sourceCharacterCardId ?? null, input.sourceEventCardId ?? null, input.chapterDocumentId ?? null, input.bodyVersionId ?? null, input.textAnchorId ?? null, input.effectiveStoryOrder ?? null, input.effectiveNarrativeOrder ?? null, input.reason, input.editor ?? "system"],
  )).rows[0];
  return mapVersion(row);
}

export async function getKnowledgeStateProposal(id: string): Promise<KnowledgeStateProposal> {
  const pool = await getNewDesignPool();
  const row = assertFound((await pool.query(`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT * FROM knowledge_state_proposals WHERE id=$1`, [id])).rows[0], "认知提案不存在。");
  const client = await pool.connect();
  try {
    const claim = await loadClaim(client, String(row.claim_id));
    const versions = await client.query(`WITH ${storyRecordCtes.knowledge_state_proposal_versions}
SELECT * FROM knowledge_state_proposal_versions WHERE proposal_id=$1 ORDER BY version DESC`, [id]);
    const reviews = await client.query(`WITH ${storyRecordCtes.knowledge_state_review_actions}
SELECT * FROM knowledge_state_review_actions WHERE proposal_id=$1 ORDER BY created_at,id`, [id]);
    const mappedVersions = versions.rows.map(mapVersion);
    return {
      id: String(row.id), bookId: String(row.book_id), claim,
      holderKind: row.holder_kind, holderKey: String(row.holder_key), holderCardId: row.holder_card_id ? String(row.holder_card_id) : null,
      currentVersionId: String(row.current_version_id), source: row.source, status: row.status,
      confirmedChangeId: row.confirmed_change_id ? String(row.confirmed_change_id) : null,
      revision: Number(row.revision),
      currentVersion: assertFound(mappedVersions.find((item) => item.id === String(row.current_version_id)), "认知提案当前版本不存在。"),
      versions: mappedVersions, reviewActions: reviews.rows.map(mapReview), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
    };
  } finally { client.release(); }
}

export async function listKnowledgeStateProposals(bookId: string, status?: KnowledgeStateProposal["status"]): Promise<KnowledgeStateProposal[]> {
  const pool = await getNewDesignPool();
  const rows = await pool.query(`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT id FROM knowledge_state_proposals WHERE book_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at,id`, [bookId, status ?? null]);
  return Promise.all(rows.rows.map((row) => getKnowledgeStateProposal(String(row.id))));
}

export async function proposeKnowledgeState(input: {
  bookId:string; holderKind:KnowledgeHolderKind; holderKey?:string; holderCardId?:string|null;
  claim:{subjectCardId?:string|null;predicate:string;valueKind:CanonicalFactValueKind;value:unknown;objectCardId?:string|null;truthFactId?:string|null};
  source:"ai"|"manual"|"import"|"system";
} & ProposalVersionInput): Promise<KnowledgeStateProposal> {
  const pool = await getNewDesignPool(), client = await pool.connect();
  try {
    await client.query("BEGIN");
    const book = await client.query("SELECT 1 FROM new_design.books WHERE id=$1 AND status='active'", [input.bookId]);
    if (!book.rowCount) throw new NewDesignError("书籍不存在或已归档。", 404);
    const holder = await resolveHolder(client, input.bookId, input.holderKind, input.holderKey, input.holderCardId);
    await validateVersionSource(client, input.bookId, input.source, input);
    const claim = await findOrCreateClaim(client, { bookId:input.bookId, ...input.claim, createdBy:input.editor ?? input.source });
    const proposalId = randomUUID();
    await insertStoryRecords(client,"knowledge_state_proposal",`SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS claim_id,($4)::text AS holder_kind,($5)::text AS holder_key,($6)::uuid AS holder_card_id,($7)::text AS source`,
      [proposalId, input.bookId, claim.id, input.holderKind, holder.holderKey, holder.holderCardId, input.source],
    );
    const version = await insertVersion(client, proposalId, 1, input);
    await updateStoryRecords(client,"knowledge_state_proposal",`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT knowledge_state_proposals.*,($2)::uuid AS current_version_id FROM knowledge_state_proposals WHERE id=$1`, [proposalId, version.id]);
    await insertStoryReviewActions(client,"knowledge_state",`SELECT ($1)::uuid AS id,($2)::uuid AS proposal_id,($3)::uuid AS proposal_version_id,('propose')::text AS action,($4)::text AS actor,($5)::text AS note`, [randomUUID(), proposalId, version.id, input.editor ?? input.source, input.reason]);
    await client.query("COMMIT");
    return getKnowledgeStateProposal(proposalId);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function editKnowledgeStateProposal(id: string, input: ProposalVersionInput & {expectedRevision:number;actor?:string;note?:string}): Promise<KnowledgeStateProposal> {
  const pool = await getNewDesignPool(), client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposal = assertFound((await lockedStoryRecordQuery(client,`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT * FROM knowledge_state_proposals WHERE id=$1`, [id])).rows[0], "认知提案不存在。");
    if (proposal.status !== "proposed") throw new NewDesignError("只有待确认提案可以直接修改；已确认内容请新增修正提案。", 409);
    if (Number(proposal.revision) !== input.expectedRevision) throw new NewDesignError("认知提案已更新，请刷新后重试。", 409);
    await validateVersionSource(client, String(proposal.book_id), String(proposal.source), input);
    const nextVersion = Number((await client.query(`WITH ${storyRecordCtes.knowledge_state_proposal_versions}
SELECT COALESCE(max(version),0)+1 AS version FROM knowledge_state_proposal_versions WHERE proposal_id=$1`, [id])).rows[0].version);
    const version = await insertVersion(client, id, nextVersion, { ...input, editor:input.actor ?? input.editor ?? "user" });
    await updateStoryRecords(client,"knowledge_state_proposal",`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT knowledge_state_proposals.*,($2)::uuid AS current_version_id,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM knowledge_state_proposals WHERE id=$1`, [id, version.id]);
    await insertStoryReviewActions(client,"knowledge_state",`SELECT ($1)::uuid AS id,($2)::uuid AS proposal_id,($3)::uuid AS proposal_version_id,('edit')::text AS action,($4)::text AS actor,($5)::text AS note`, [randomUUID(), id, version.id, input.actor ?? "user", input.note ?? ""]);
    await client.query("COMMIT");
    return getKnowledgeStateProposal(id);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function rebuildKnowledgeProjection(client: PoolClient, key: {bookId:string;holderKind:KnowledgeHolderKind;holderKey:string;claimId:string}): Promise<void> {
  const change = (await client.query(
    `WITH ${storyRecordCtes.knowledge_state_changes}
SELECT * FROM knowledge_state_changes WHERE book_id=$1 AND holder_kind=$2 AND holder_key=$3 AND claim_id=$4 AND status='active' ORDER BY effective_narrative_order DESC NULLS LAST,sequence DESC LIMIT 1`,
    [key.bookId, key.holderKind, key.holderKey, key.claimId],
  )).rows[0];
  if (!change) {
    await deleteStoryRecords(client,"current_knowledge_state_projection",`WITH ${storyRecordCtes.current_knowledge_state_projections}
SELECT current_knowledge_state_projections.* FROM current_knowledge_state_projections WHERE book_id=$1 AND holder_kind=$2 AND holder_key=$3 AND claim_id=$4`, [key.bookId, key.holderKind, key.holderKey, key.claimId]);
    return;
  }
  await insertStoryRecords(client,"current_knowledge_state_projection",`SELECT ($1)::uuid AS book_id,($2)::text AS holder_kind,($3)::text AS holder_key,($4)::uuid AS holder_card_id,($5)::uuid AS claim_id,($6)::uuid AS source_change_id,($7)::text AS stance,($8)::numeric AS confidence,($9)::numeric AS effective_story_order,($10)::numeric AS effective_narrative_order`,
    [key.bookId, key.holderKind, key.holderKey, key.holderKind === "character" ? key.holderKey : null, key.claimId, change.id, change.stance, change.confidence, change.effective_story_order, change.effective_narrative_order],
  {keys:["book_id","holder_kind","holder_key","claim_id"],update:(previous,incoming)=>({holder_card_id:incoming.holder_card_id,source_change_id:incoming.source_change_id,stance:incoming.stance,confidence:incoming.confidence,effective_story_order:incoming.effective_story_order,effective_narrative_order:incoming.effective_narrative_order,projection_revision:Number(previous.projection_revision)+1,rebuilt_at:new Date().toISOString()})});
}

export async function reviewKnowledgeStateProposal(id: string, input: {action:"confirm"|"reject";expectedRevision:number;idempotencyKey:string;actor?:string;note?:string}): Promise<KnowledgeStateProposal> {
  const pool = await getNewDesignPool();
  const repeated = await pool.query(`WITH ${storyRecordCtes.knowledge_state_review_actions}
SELECT proposal_id FROM knowledge_state_review_actions WHERE idempotency_key=$1`, [input.idempotencyKey]);
  if (repeated.rows[0]) {
    if (String(repeated.rows[0].proposal_id) !== id) throw new NewDesignError("幂等键已用于其他认知提案。", 409);
    return getKnowledgeStateProposal(id);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposal = assertFound((await lockedStoryRecordQuery(client,`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT * FROM knowledge_state_proposals WHERE id=$1`, [id])).rows[0], "认知提案不存在。");
    if (proposal.status !== "proposed") throw new NewDesignError("认知提案已处理，请刷新后重试。", 409);
    if (Number(proposal.revision) !== input.expectedRevision) throw new NewDesignError("认知提案已更新，请刷新后重试。", 409);
    const version = assertFound((await client.query(`WITH ${storyRecordCtes.knowledge_state_proposal_versions}
SELECT * FROM knowledge_state_proposal_versions WHERE id=$1`, [proposal.current_version_id])).rows[0], "认知提案当前版本不存在。");
    if (input.action === "confirm") {
      if (version.body_version_id) {
        const document = assertFound((await client.query("SELECT adopted_version_id FROM new_design.chapter_documents WHERE id=$1", [version.chapter_document_id])).rows[0], "认知来源章节不存在。");
        if (String(document.adopted_version_id ?? "") !== String(version.body_version_id)) throw new NewDesignError("只能确认当前已采用正文中的认知变化。", 409);
      }
      const changeId = randomUUID();
      await insertStoryRecords(client,"knowledge_state_change",`SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS proposal_id,($4)::uuid AS proposal_version_id,($5)::uuid AS claim_id,($6)::text AS holder_kind,($7)::text AS holder_key,($8)::uuid AS holder_card_id,($9)::text AS stance,($10)::numeric AS confidence,($11)::numeric AS effective_story_order,($12)::numeric AS effective_narrative_order,($13)::text AS confirmed_by`,
        [changeId, proposal.book_id, id, version.id, proposal.claim_id, proposal.holder_kind, proposal.holder_key, proposal.holder_card_id, version.stance, version.confidence, version.effective_story_order, version.effective_narrative_order, input.actor ?? "user"],
      );
      await updateStoryRecords(client,"knowledge_state_proposal",`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT knowledge_state_proposals.*,('confirmed')::text AS status,($2)::uuid AS confirmed_change_id,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM knowledge_state_proposals WHERE id=$1`, [id, changeId]);
      await rebuildKnowledgeProjection(client, { bookId:String(proposal.book_id), holderKind:proposal.holder_kind, holderKey:String(proposal.holder_key), claimId:String(proposal.claim_id) });
    } else {
      await updateStoryRecords(client,"knowledge_state_proposal",`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT knowledge_state_proposals.*,('rejected')::text AS status,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM knowledge_state_proposals WHERE id=$1`, [id]);
    }
    await insertStoryReviewActions(client,"knowledge_state",`SELECT ($1)::uuid AS id,($2)::uuid AS proposal_id,($3)::uuid AS proposal_version_id,($4)::text AS action,($5)::text AS actor,($6)::text AS note,($7)::text AS idempotency_key`, [randomUUID(), id, version.id, input.action, input.actor ?? "user", input.note ?? "", input.idempotencyKey]);
    await client.query("COMMIT");
    return getKnowledgeStateProposal(id);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as {code?:string}).code === "23505") {
      const found = await pool.query(`WITH ${storyRecordCtes.knowledge_state_review_actions}
SELECT proposal_id FROM knowledge_state_review_actions WHERE idempotency_key=$1`, [input.idempotencyKey]);
      if (String(found.rows[0]?.proposal_id) === id) return getKnowledgeStateProposal(id);
    }
    throw error;
  } finally { client.release(); }
}

async function mapChange(client: PoolClient, row: Record<string, unknown>): Promise<KnowledgeStateChange> {
  return {
    id:String(row.id), sequence:Number(row.sequence), bookId:String(row.book_id), proposalId:String(row.proposal_id), proposalVersionId:String(row.proposal_version_id),
    claim:await loadClaim(client,String(row.claim_id)), holderKind:row.holder_kind as KnowledgeHolderKind, holderKey:String(row.holder_key), holderCardId:row.holder_card_id?String(row.holder_card_id):null,
    stance:row.stance as KnowledgeStance, confidence:row.confidence===null?null:Number(row.confidence), effectiveStoryOrder:row.effective_story_order===null?null:Number(row.effective_story_order),
    effectiveNarrativeOrder:row.effective_narrative_order===null?null:Number(row.effective_narrative_order), status:row.status as KnowledgeStateChange["status"], confirmedBy:String(row.confirmed_by), createdAt:asDate(row.created_at),
  };
}

async function mapProjection(client: PoolClient, row: Record<string, unknown>): Promise<CurrentKnowledgeState> {
  return {
    bookId:String(row.book_id), holderKind:row.holder_kind as KnowledgeHolderKind, holderKey:String(row.holder_key), holderCardId:row.holder_card_id?String(row.holder_card_id):null,
    claim:await loadClaim(client,String(row.claim_id)), sourceChangeId:String(row.source_change_id), stance:row.stance as KnowledgeStance,
    confidence:row.confidence===null?null:Number(row.confidence), effectiveStoryOrder:row.effective_story_order===null?null:Number(row.effective_story_order), effectiveNarrativeOrder:row.effective_narrative_order===null?null:Number(row.effective_narrative_order),
    projectionRevision:Number(row.projection_revision), rebuiltAt:asDate(row.rebuilt_at),
  };
}

export async function listCurrentKnowledgeState(bookId: string, holderKind?: KnowledgeHolderKind, holderKey?: string): Promise<CurrentKnowledgeState[]> {
  const pool = await getNewDesignPool(), client = await pool.connect();
  try {
    const rows = await client.query(`WITH ${storyRecordCtes.current_knowledge_state_projections}
SELECT * FROM current_knowledge_state_projections WHERE book_id=$1 AND ($2::text IS NULL OR holder_kind=$2) AND ($3::text IS NULL OR holder_key=$3) ORDER BY holder_kind,holder_key,claim_id`, [bookId, holderKind ?? null, holderKey ?? null]);
    const result:CurrentKnowledgeState[]=[];
    for (const row of rows.rows) result.push(await mapProjection(client,row));
    return result;
  } finally { client.release(); }
}

export async function listKnowledgeStateAt(bookId: string, input: {holderKind:KnowledgeHolderKind;holderKey:string;narrativeOrder:number}): Promise<KnowledgeStateChange[]> {
  const pool = await getNewDesignPool(), client = await pool.connect();
  try {
    const rows = await client.query(
      `WITH ${storyRecordCtes.knowledge_state_changes}
SELECT DISTINCT ON (claim_id) * FROM knowledge_state_changes WHERE book_id=$1 AND holder_kind=$2 AND holder_key=$3 AND status='active' AND effective_narrative_order IS NOT NULL AND effective_narrative_order<=$4 ORDER BY claim_id,effective_narrative_order DESC,sequence DESC`,
      [bookId, input.holderKind, input.holderKey, input.narrativeOrder],
    );
    const result:KnowledgeStateChange[]=[];
    for (const row of rows.rows) result.push(await mapChange(client,row));
    return result;
  } finally { client.release(); }
}

export async function rebuildKnowledgeState(bookId: string): Promise<CurrentKnowledgeState[]> {
  const pool = await getNewDesignPool(), client = await pool.connect();
  try {
    await client.query("BEGIN");
    const keys = await client.query(`WITH ${storyRecordCtes.knowledge_state_changes}
SELECT DISTINCT holder_kind,holder_key,claim_id FROM knowledge_state_changes WHERE book_id=$1`, [bookId]);
    await deleteStoryRecords(client,"current_knowledge_state_projection",`WITH ${storyRecordCtes.current_knowledge_state_projections}
SELECT current_knowledge_state_projections.* FROM current_knowledge_state_projections WHERE book_id=$1`, [bookId]);
    for (const row of keys.rows) await rebuildKnowledgeProjection(client, { bookId, holderKind:row.holder_kind, holderKey:String(row.holder_key), claimId:String(row.claim_id) });
    await client.query("COMMIT");
    return listCurrentKnowledgeState(bookId);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function invalidateKnowledgeForBodySwitch(client: PoolClient, chapterDocumentId: string, bodyVersionId: string): Promise<void> {
  const changes = await updateStoryRecords(client,"knowledge_state_change",`WITH ${storyRecordCtes.knowledge_state_changes},
${storyRecordCtes.knowledge_state_proposal_versions}
SELECT change.*,('invalidated')::text AS status FROM knowledge_state_changes change, knowledge_state_proposal_versions version WHERE change.proposal_version_id=version.id AND version.chapter_document_id=$1 AND version.body_version_id<>$2 AND change.status='active'`,
    [chapterDocumentId, bodyVersionId],
  );
  if (!changes.rowCount) return;
  for (const row of changes.rows) {
    await updateStoryRecords(client,"knowledge_state_proposal",`WITH ${storyRecordCtes.knowledge_state_proposals}
SELECT knowledge_state_proposals.*,('invalidated')::text AS status,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM knowledge_state_proposals WHERE id=$1`, [row.proposal_id]);
    await insertStoryReviewActions(client,"knowledge_state",`SELECT ($1)::uuid AS id,($2)::uuid AS proposal_id,($3)::uuid AS proposal_version_id,('invalidate')::text AS action,('system')::text AS actor,($4)::text AS note`, [randomUUID(), row.proposal_id, row.proposal_version_id, "章节采用了其他正文版本，原认知变化失效。"]) ;
    await rebuildKnowledgeProjection(client, { bookId:String(row.book_id), holderKind:row.holder_kind, holderKey:String(row.holder_key), claimId:String(row.claim_id) });
  }
}

import {chapterAdoptionPreparationRows,chapterResourceSupplementRows,chapterStableCheckpointRows,insertRevisionRecords,insertSupplementSettlementEvents,updateRevisionRecords} from './persistence';
import { randomUUID } from "node:crypto";
import {requireCardWorkflowTypes} from './persistence';
import type { PoolClient } from "pg";
import { resourceSupplementPreviewInputSchema, resourceSupplementStartInputSchema, resourceSupplementStartReceiptSchema,
  type ResourceSupplementPreviewInput, type ResourceSupplementPreview, type ResourceSupplementStartInput,
  type ResourceSupplementStartReceipt } from "../../../common/resourceSupplements";
import { NewDesignError } from "../../domain/errors";
import { stableHash } from "../aiContracts/integrity";
import { getNewDesignPool } from "../runtime";
import { previewResourceSupplementInTransaction } from "./preview";

export class ResourceSupplementError extends NewDesignError {
  constructor(message: string, status: number, public readonly mutationOutcome: "unknown" | "not_written") { super(message, status); }
}
const json = (value: unknown) => JSON.stringify(value);
const requestHash = (bookId: string, input: ResourceSupplementStartInput) => stableHash({ contract: "stable_resource_supplement_start_v1", bookId, input });

async function original(client: PoolClient, bookId: string, input: ResourceSupplementStartInput): Promise<ResourceSupplementStartReceipt | null> {
  const row = (await client.query(`SELECT input_hash,full_input,original_receipt FROM ${chapterResourceSupplementRows} chapter_resource_supplement_record
    WHERE book_id=$1 AND request_key=$2`, [bookId, input.requestKey])).rows[0];
  if (!row) return null;
  const parsed = resourceSupplementStartReceiptSchema.safeParse(row.original_receipt), hash = requestHash(bookId, input);
  if (!parsed.success || row.input_hash !== hash || stableHash(row.full_input) !== stableHash(input)
    || parsed.data.bookId !== bookId || parsed.data.inputHash !== hash || stableHash(parsed.data.input) !== stableHash(input))
    throw new ResourceSupplementError("原补充请求与完整输入不一致，或原回执不完整；请保留原键核对，不能覆盖。", 409, "unknown");
  return { ...parsed.data, repeated: true };
}
async function storageContract(client: PoolClient): Promise<void> {
  await requireCardWorkflowTypes(client,['chapter_resource_supplement','chapter_adoption_preparation','chapter_adoption_session'],true);
  if (!(await client.query(`SELECT id FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only'
    AND to_regprocedure('new_design.require_resource_supplement_closure()') IS NOT NULL
    AND to_regprocedure('new_design.validate_resource_supplement_origin()') IS NOT NULL
    AND position('NEW.source_snapshot->>''sourceHash''' IN pg_get_functiondef(to_regprocedure('new_design.validate_resource_supplement_origin()')))>0`)).rowCount)
    throw new NewDesignError("稳定章补充存储尚不可用，请保留原正文和填写并核对服务。", 503);
}
export async function previewResourceSupplement(bookId: string, input: ResourceSupplementPreviewInput): Promise<ResourceSupplementPreview> {
  const parsed = resourceSupplementPreviewInputSchema.parse(input), client = await (await getNewDesignPool()).connect();
  try { await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const preview = await previewResourceSupplementInTransaction(client, bookId, parsed); await client.query("COMMIT"); return preview;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
/** Reads only the saved complete original; archive/source changes do not reinterpret it. */
export async function readResourceSupplementStartOriginal(bookId: string, raw: ResourceSupplementStartInput): Promise<ResourceSupplementStartReceipt | null> {
  const input = resourceSupplementStartInputSchema.parse(raw), client = await (await getNewDesignPool()).connect();
  try { await client.query("BEGIN READ ONLY"); await storageContract(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`resource-supplement:${bookId}:${input.requestKey}`]);
    const saved = await original(client, bookId, input); await client.query("COMMIT"); return saved;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
/** Infrastructure command only; no HTTP/UI caller until downstream closure exists. */
export async function startResourceSupplement(bookId: string, raw: ResourceSupplementStartInput): Promise<ResourceSupplementStartReceipt> {
  const input = resourceSupplementStartInputSchema.parse(raw), pool = await getNewDesignPool();
  const client = await pool.connect().catch(() => { throw new ResourceSupplementError("原补充结果未能读取，请保留完整原请求核对，勿更换请求标识。", 503, "unknown"); });
  const locks = [`resource-supplement:${bookId}:${input.requestKey}`, `chapter_settlement_editing_book:${bookId}`];
  let committing = false, readingOriginal = true;
  try {
    for (const lock of locks) await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lock]);
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await storageContract(client);
    const saved = await original(client, bookId, input); readingOriginal = false;
    if (saved) { await client.query("ROLLBACK"); return saved; }
    await client.query("SELECT id FROM new_design.books WHERE id=$1 FOR SHARE", [bookId]);
    await client.query(`SELECT id FROM new_design.chapter_documents WHERE book_id=$1 AND id=(SELECT chapter_document_id FROM ${chapterStableCheckpointRows} chapter_stable_checkpoint_record WHERE id=$2) FOR UPDATE`, [bookId, input.checkpointId]);
    const { requestKey, expectedSourceHash, ...scope } = input;
    const preview = await previewResourceSupplementInTransaction(client, bookId, scope);
    if (preview.sourceHash !== expectedSourceHash) throw new NewDesignError("稳定章、人物、资源、关系或章末前值已变化，请保留范围重新预览；本次未创建补充。", 409);
    const basis = preview.basis, preparationId = randomUUID(), sessionId = randomUUID(), hash = requestHash(bookId, input);
    const dependency = { ...basis.original.preparation as Record<string, unknown> };
    const frozenDependency = { ...(dependency.dependency_snapshot as Record<string, unknown>), documentRevision: basis.documentRevision,
      supplementBaseCheckpointId: basis.checkpointId, supplementSourceHash: preview.sourceHash };
    const dependencyHash = stableHash(frozenDependency);
    await insertRevisionRecords(client, 'chapter_adoption_preparation', `SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS chapter_document_id,($4)::uuid AS body_version_id,($5)::integer AS expected_document_revision,($6)::uuid AS planning_object_id,($7)::uuid AS planning_version_id,($8)::char(64) AS planning_content_hash,($9)::uuid AS context_manifest_id,($10::jsonb)::jsonb AS dependency_snapshot,($11)::char(64) AS dependency_hash,('prepared')::text AS status,($12)::text AS idempotency_key,('')::text AS created_by,(now())::timestamptz AS created_at,($13)::uuid AS supplement_base_checkpoint_id`, [preparationId,bookId,basis.chapterDocumentId,basis.bodyVersionId,basis.documentRevision,
      basis.planningObjectId,basis.planningVersionId,(basis.original.planning_version as Record<string,unknown>).content_hash,basis.contextManifestId,
      json(frozenDependency),dependencyHash,`resource-supplement-preparation:${requestKey}`,basis.checkpointId], [["id"],["book_id","idempotency_key"]]);
    await updateRevisionRecords(client, 'chapter_adoption_preparation', `SELECT to_jsonb(record) AS record_values,jsonb_build_object('status',('consumed')::text) AS record_patch FROM ${chapterAdoptionPreparationRows} record WHERE id=$1 FOR UPDATE OF record`, [preparationId], ["id"]);
    await insertRevisionRecords(client, 'chapter_adoption_session', `SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS chapter_document_id,($4)::uuid AS body_version_id,($5)::uuid AS preparation_id,(NULL)::uuid AS prior_body_version_id,($6)::uuid AS adoption_id,(NULL)::uuid AS settlement_id,($7)::uuid AS policy_version_id,($8)::uuid AS planning_object_id,($9)::uuid AS planning_version_id,($10)::uuid AS context_manifest_id,($11)::char(64) AS dependency_hash,('resource_supplement')::text AS adoption_kind,('adopted_pending_proposals')::text AS status,(1)::integer AS revision,($12)::text AS idempotency_key,('')::text AS created_by,('')::text AS error_summary,(now())::timestamptz AS created_at,(now())::timestamptz AS updated_at,($13)::uuid AS supplement_base_checkpoint_id`, [sessionId,bookId,basis.chapterDocumentId,basis.bodyVersionId,preparationId,basis.adoptionId,basis.policyVersionId,basis.planningObjectId,
      basis.planningVersionId,basis.contextManifestId,dependencyHash,`resource-supplement-session:${requestKey}`,basis.checkpointId], [["id"],["preparation_id"],["adoption_id"],["settlement_id"],["book_id","idempotency_key"]]);
    const receipt: ResourceSupplementStartReceipt = { contract: "stable_resource_supplement_start_v1", bookId, chapterDocumentId: basis.chapterDocumentId,
      sessionId, preparationId, baseCheckpointId: basis.checkpointId, bodyVersionId: basis.bodyVersionId, requestKey, input, inputHash: hash,
      sourceHash: preview.sourceHash, sourceRoute: `/new-design/books/${bookId}/writing?chapterDocument=${basis.chapterDocumentId}&session=${sessionId}`, repeated: false };
    await insertRevisionRecords(client, 'chapter_resource_supplement', `SELECT ($1)::uuid AS session_id,($2)::uuid AS book_id,($3)::uuid AS base_checkpoint_id,($4)::text AS request_key,($5::jsonb)::jsonb AS full_input,($6)::char(64) AS input_hash,($7::jsonb)::jsonb AS source_snapshot,($8)::char(64) AS source_hash,($9::jsonb)::jsonb AS original_receipt,('user')::text AS actor,(now())::timestamptz AS created_at`, [sessionId,bookId,basis.checkpointId,requestKey,json(input),hash,json(preview),preview.sourceHash,json(receipt)], [["session_id"],["book_id","request_key"]]);
    await insertSupplementSettlementEvents(client, `SELECT ($1)::uuid AS id,($2)::uuid AS session_id,('session_started')::text AS event_kind,(NULL)::text AS from_status,('adopted_pending_proposals')::text AS to_status,(NULL)::uuid AS item_id,(NULL)::text AS idempotency_key,('user')::text AS actor,($3::jsonb)::jsonb AS detail,(now())::timestamptz AS created_at,(NULL)::text AS editing_request_key,(NULL)::char(64) AS editing_input_hash,(NULL)::jsonb AS editing_receipt`, [randomUUID(),sessionId,json({kind:"resource_supplement",baseCheckpointId:basis.checkpointId,bodyVersionId:basis.bodyVersionId,sourceHash:preview.sourceHash})]);
    committing = true; await client.query("COMMIT"); return receipt;
  } catch (error) {
    let rolledBack = false; try { await client.query("ROLLBACK"); rolledBack = true; } catch { /* Preserve unknown. */ }
    if (error instanceof ResourceSupplementError) throw error;
    throw new ResourceSupplementError(error instanceof NewDesignError ? error.message : "补充请求未确认，请保留完整原请求核对。",
      error instanceof NewDesignError ? error.status : 503, readingOriginal || committing || !rolledBack ? "unknown" : "not_written");
  } finally {
    let broken = false; for (const lock of [...locks].reverse()) try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]); } catch { broken = true; }
    client.release(broken);
  }
}

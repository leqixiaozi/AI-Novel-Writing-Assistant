import {settlementRecordCtes} from '../recordStorage';
import type { PoolClient } from "pg";
import type { SettlementEditingCatalog } from "../../../../common/chapterSettlementEditing";
import { resourceSupplementStartReceiptSchema, type ResourceSupplementPreview } from "../../../../common/resourceSupplements";
import { NewDesignError } from "../../../domain/errors";
import { stableHash } from "../../aiContracts/integrity";
import {resourceCorrectionCandidateCatalog,type ResourceSupplementFrozenSource} from '../../../../common/resourceSupplements/correction';
export {assertResourceSupplementCandidateContract} from "./candidates";

/** Settlement owns its read view. No dependency on supplement creation commands. */
export async function readFrozenSupplementSource(client: PoolClient, session: Record<string,unknown>, bodyHash: string): Promise<ResourceSupplementFrozenSource> {
  const row = (await client.query(`WITH ${settlementRecordCtes.chapter_resource_supplements}
SELECT * FROM chapter_resource_supplements WHERE session_id=$1 AND book_id=$2`, [session.id,session.book_id])).rows[0];
  const unavailable = (): never => { throw new NewDesignError("原补充清单来源不完整，请保留原请求和记录核对，不能按当前状态补全。",409); };
  if (!row) return unavailable();
  if(row.source_snapshot?.contract==='stable_resource_correction_preview_v1'){
    const owner=await import('../../resourceSupplements');
    return owner.readFrozenResourceSupplementCorrectionInTransaction(client,session,bodyHash);
  }
  const receipt = resourceSupplementStartReceiptSchema.safeParse(row.original_receipt);
  if (!receipt.success) return unavailable();
  const preview = row.source_snapshot as ResourceSupplementPreview | null;
  if (!preview || preview.contract !== "stable_resource_supplement_preview_v1" || !preview.catalog || !preview.basis) return unavailable();
  const { sourceHash, ...source } = preview;
  if (sourceHash !== row.source_hash || stableHash(source) !== sourceHash
    || receipt.data.sourceHash !== sourceHash || receipt.data.sessionId !== session.id
    || receipt.data.inputHash !== row.input_hash || receipt.data.requestKey !== row.request_key
    || stableHash(row.full_input) !== stableHash(receipt.data.input)
    || receipt.data.inputHash !== stableHash({contract:"stable_resource_supplement_start_v1",bookId:receipt.data.bookId,input:receipt.data.input})
    || receipt.data.bookId !== session.book_id || receipt.data.bodyVersionId !== session.body_version_id
    || receipt.data.chapterDocumentId !== session.chapter_document_id || receipt.data.preparationId !== session.preparation_id
    || receipt.data.baseCheckpointId !== session.supplement_base_checkpoint_id || receipt.data.baseCheckpointId !== row.base_checkpoint_id
    || preview.basis.bookId !== session.book_id || preview.basis.bodyVersionId !== session.body_version_id
    || preview.basis.checkpointId !== row.base_checkpoint_id || preview.basis.chapterDocumentId !== session.chapter_document_id
    || preview.basis.planningVersionId !== session.planning_version_id || preview.basis.bodyContentHash !== bodyHash
    || preview.catalog.bodyVersionId !== session.body_version_id || preview.catalog.bodyContentHash !== preview.basis.bodyContentHash
    || stableHash(preview.input) !== stableHash({checkpointId:receipt.data.input.checkpointId,resourceScope:receipt.data.input.resourceScope}))
    return unavailable();
  return preview;
}

export async function readFrozenSupplementCatalog(client: PoolClient, session: Record<string,unknown>, bodyHash: string): Promise<SettlementEditingCatalog> {
  const preview = await readFrozenSupplementSource(client, session, bodyHash);
  if(preview.contract==='stable_resource_correction_preview_v1')return resourceCorrectionCandidateCatalog(preview,String(session.id),Number(session.revision));
  return { ...preview.catalog, sessionId: String(session.id), sessionRevision: Number(session.revision) };
}

import type { PoolClient } from "pg";
import { resourceSupplementPreviewInputSchema, type ResourceSupplementPreviewInput, type ResourceSupplementPreview } from "../../../common/resourceSupplements";
import { NewDesignError } from "../../domain/errors";
import { stableHash } from "../aiContracts/integrity";
import { getChapterSettlementEditingCatalogInTransaction, displaySettlementValue } from "../chapterSettlement";
import { freezeResourceBackfillScope } from "../characterResources";
import { readStableResourceSupplementBasisInTransaction } from "./basis";
import { readHistoricalStateForValidatedBasis } from "./history";

/** Pure read contract; normal editing catalog supplies actual published specs. */
export async function previewResourceSupplementInTransaction(
  client: PoolClient, bookId: string, raw: ResourceSupplementPreviewInput,
): Promise<ResourceSupplementPreview> {
  const parsed = resourceSupplementPreviewInputSchema.safeParse(raw);
  if (!parsed.success) throw new NewDesignError("请选择完整的稳定章节、人物及资源范围。", 422);
  const input = parsed.data, basis = await readStableResourceSupplementBasisInTransaction(client, bookId, input.checkpointId);
  if ((await client.query(`SELECT id FROM new_design.chapter_adoption_sessions WHERE chapter_document_id=$1
    AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed')`, [basis.chapterDocumentId])).rowCount)
    throw new NewDesignError("本章有待处理清单，请先返回本章核对原请求。原稳定结算保留。", 409);
  const catalog = await getChapterSettlementEditingCatalogInTransaction(client, basis.original.session as Record<string, unknown>, false);
  const selected = new Set([...input.resourceScope.resourceIds, ...input.resourceScope.relationIds]);
  for (const subject of catalog.subjects.filter(subject => selected.has(subject.id))) {
    for (const field of subject.fields) {
      const history = await readHistoricalStateForValidatedBasis(client, basis, {
        bookId, checkpointId: input.checkpointId, subjectKind: subject.subjectKind, subjectId: subject.id, stateKey: field.key,
      });
      field.baseline = { known: history.known, value: history.value,
        display: history.known ? displaySettlementValue(field.field, history.value, field.dictionaryNodes) : "尚未建立前值",
        revision: history.source ? Number(history.source.sequence ?? history.source.version) : null,
        sourceKind: history.sourceKind, sourceId: history.sourceId, stale: false, hash: history.hash };
    }
  }
  // The scope freezer receives only actual frozen origin members. Preview
  // neither creates a session nor impersonates an editable workspace.
  const view = { session: { bookId, bodyVersionId: basis.bodyVersionId }, candidate: { content: basis.bodyContent }, catalog };
  const frozen = await freezeResourceBackfillScope(client, view, input.resourceScope);
  frozen.catalog.specificationHash = stableHash({ basisHash: basis.sourceHash, bodyVersionId: basis.bodyVersionId,
    bodyContentHash: basis.bodyContentHash, subjects: frozen.catalog.subjects,
    objectChoices: frozen.catalog.objectChoices, holderChoices: frozen.catalog.holderChoices });
  const preview: Omit<ResourceSupplementPreview, "sourceHash"> = {
    contract: "stable_resource_supplement_preview_v1", bookId, input, basis, ...frozen,
  };
  const persisted = JSON.parse(JSON.stringify(preview)) as Omit<ResourceSupplementPreview, "sourceHash">;
  return { ...persisted, sourceHash: stableHash(persisted) };
}

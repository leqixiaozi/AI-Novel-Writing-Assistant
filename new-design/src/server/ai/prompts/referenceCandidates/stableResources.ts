import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResourceSupplementPreview } from "../../../../common/resourceSupplements";
import type { SettlementEditingDraft } from "../../../../common/chapterSettlementEditing";
import { stableHash } from "../../../database/aiContracts";
import { characterResourceBackfillAsset } from "./index";
import type { PromptAsset } from "../contracts";

export interface StableResourceSupplementPromptInput {
  sessionId: string;
  sessionRevision: number;
  source: ResourceSupplementPreview;
}

/** Reads the original creation frame; cannot fall back to present projections. */
export const stableResourceSupplementAsset: PromptAsset = {
  ...characterResourceBackfillAsset,
  assetId: "new_design.character.stable_resource_supplement", version: "v1",
  taskType: "stable_resource_supplement", label: "补充稳定章节资源变化",
  instruction: characterResourceBackfillAsset.instruction +
    "本次正文已稳定结算。stableOrigin包含原确认事实、认知、状态及原正文所用计划；它们是已发生的资料，不能当成待重复确认的候选。baseline是本章结束时的实际历史前值，不是本书最新状态。只提出原确认清单遗漏、且仍有确切正文证据的资源净变化；已有变化与无变化均不得重复提案。不得重开原会话、复制正文、删除原确认记录、改写后续章或自动结算。无法区分遗漏与已有变化时返回空items并说明待作者核对的来源。",
  prepare(value) {
    const parsed = z.object({sessionId:z.string().uuid(),sessionRevision:z.number().int().positive(),
      source:z.custom<ResourceSupplementPreview>(value => Boolean(value) && typeof value === "object" && !Array.isArray(value))}).strict().parse(value);
    const source = parsed.source, basis = source.basis;
    const unavailable = (): never => { throw new Error("稳定章补充的原正文、计划或确认清单不完整。"); };
    if (source.contract !== "stable_resource_supplement_preview_v1" || !basis
      || basis.contract !== "stable_resource_supplement_basis_v1" || !source.catalog || !basis.original) return unavailable();
    const {sourceHash, ...frame} = source, {sourceHash:basisHash, ...origin} = basis;
    if (stableHash(frame) !== sourceHash || stableHash(origin) !== basisHash
      || source.bookId !== basis.bookId || source.input.checkpointId !== basis.checkpointId
      || source.catalog.bodyVersionId !== basis.bodyVersionId || source.catalog.bodyContentHash !== basis.bodyContentHash
      || createHash("sha256").update(basis.bodyContent,"utf8").digest("hex") !== basis.bodyContentHash) return unavailable();
    const plan = basis.original.planning_version as Record<string,unknown> | undefined;
    const confirmedSources = basis.original.confirmedSources as Record<string,unknown> | undefined;
    if (!plan || plan.id !== basis.planningVersionId || !plan.content || !confirmedSources) return unavailable();
    const rows: Record<string,unknown>[] = [];
    for (const kind of ["facts","knowledge","states"] as const) {
      const ids = basis.confirmed?.[kind], actual = confirmedSources[kind];
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || !Array.isArray(actual)
        || actual.length !== ids.length || actual.some(row => !row || typeof row !== "object" || !ids.includes(row.id))
        || new Set(actual.map(row => row.id)).size !== actual.length) return unavailable();
      if (kind === "states") rows.push(...actual);
    }
    const catalog = {...source.catalog, sessionId:parsed.sessionId, sessionRevision:parsed.sessionRevision};
    if (catalog.subjects.some(subject => subject.categories.some(category => category !== (subject.subjectKind === "relation" ? "relationship" : "prop")))) return unavailable();
    const base = {sessionId:parsed.sessionId,bodyVersionId:basis.bodyVersionId,bodyContentHash:basis.bodyContentHash,
      catalog,bodyContent:basis.bodyContent,expectedChanges:[],resourceScope:source.resourceScope};
    const prepared = characterResourceBackfillAsset.prepare(base);
    const schema = prepared.schema.superRefine((output,ctx) => {
      for (const [index,item] of (output as {items:SettlementEditingDraft[]}).items.entries()) {
        if (stableHash(item.beforeValue) === stableHash(item.afterValue)
          || rows.some(row => row.subject_kind === item.subjectKind && row.subject_id === item.subjectId
            && row.state_key === item.stateKey && stableHash(row.before_json) === stableHash(item.beforeValue)
            && stableHash(row.after_json) === stableHash(item.afterValue)))
          ctx.addIssue({code:"custom",path:["items",index],message:"已有确认变化或无变化不能再次提案。"});
      }
    });
    return {...prepared,schema,input:{...base,stableOrigin:{bookId:basis.bookId,baseCheckpointId:basis.checkpointId,
      sourceHash,planningVersionId:basis.planningVersionId,planning:plan,confirmed:basis.confirmed,confirmedSources}}};
  },
};

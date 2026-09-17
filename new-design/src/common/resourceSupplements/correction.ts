import {z} from 'zod';
import {resourceSupplementPreviewInputSchema,type StableResourceSupplementBasis,type ResourceSupplementPreview} from './index';
import type {SettlementEditingCatalog} from '../chapterSettlementEditing';
export const resourceSupplementCorrectionPreviewInputSchema=resourceSupplementPreviewInputSchema.omit({checkpointId:true}).extend({issueId:z.string().uuid()}).strict();
export type ResourceSupplementCorrectionPreviewInput=z.infer<typeof resourceSupplementCorrectionPreviewInputSchema>;
export interface ResourceSupplementCorrectionBasis {
  contract:'resource_supplement_correction_basis_v1';bookId:string;issueId:string;chapterDocumentId:string;bodyVersionId:string;
  baseCheckpointId:string;subjectKind:'card'|'relation';subjectId:string;stateKey:string;
  beforeValue:unknown;originalRecordedBefore:unknown;originalRecordedAfter:unknown;
  issue:Record<string,unknown>;chapterEndBasis:StableResourceSupplementBasis;prefixSource:Record<string,unknown>;sourceHash:string;
}
/** Distinct from ordinary chapter-end v1. A preview is not a session or a claim. */
export interface ResourceSupplementCorrectionPreview extends Omit<ResourceSupplementPreview,'contract'|'input'> {
  contract:'stable_resource_correction_preview_v1';input:ResourceSupplementCorrectionPreviewInput;
  correction:ResourceSupplementCorrectionBasis;
  relatedIssues:Record<string,unknown>[];
}
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid();
/** Explicit current checkpoint plus actual issue; never a free before-value. */
export const resourceSupplementCorrectionStartInputSchema=resourceSupplementCorrectionPreviewInputSchema.extend({checkpointId:uuid,requestKey:uuid,expectedSourceHash:hash}).strict();
export type ResourceSupplementCorrectionStartInput=z.infer<typeof resourceSupplementCorrectionStartInputSchema>;
export const resourceSupplementCorrectionStartReceiptSchema=z.object({
  contract:z.literal('stable_resource_correction_start_v1'),bookId:uuid,chapterDocumentId:uuid,sessionId:uuid,preparationId:uuid,baseCheckpointId:uuid,bodyVersionId:uuid,
  issueId:uuid,relatedIssueIds:z.array(uuid).min(1).max(5000).refine(ids=>new Set(ids).size===ids.length),requestKey:uuid,
  input:resourceSupplementCorrectionStartInputSchema,inputHash:hash,sourceHash:hash,sourceRoute:z.string(),repeated:z.boolean(),
}).strict().refine(value=>value.requestKey===value.input.requestKey&&value.issueId===value.input.issueId&&value.relatedIssueIds.includes(value.issueId)
  &&value.baseCheckpointId===value.input.checkpointId&&value.sourceHash===value.input.expectedSourceHash
  &&value.sourceRoute===`/new-design/books/${value.bookId}/writing?chapterDocument=${value.chapterDocumentId}&session=${value.sessionId}&resourceIssue=${value.issueId}`);
export type ResourceSupplementCorrectionStartReceipt=z.infer<typeof resourceSupplementCorrectionStartReceiptSchema>;
export type ResourceSupplementFrozenSource=ResourceSupplementPreview|ResourceSupplementCorrectionPreview;
/** The full source remains frozen. Operations are limited to its proven issue field. */
export function resourceCorrectionCandidateCatalog(source:ResourceSupplementCorrectionPreview,sessionId:string,sessionRevision:number):SettlementEditingCatalog{
  const bound=source.correction;
  const subjects=source.catalog.subjects.filter(subject=>subject.subjectKind===bound.subjectKind&&subject.id===bound.subjectId)
    .map(subject=>({...subject,fields:subject.fields.filter(field=>field.key===bound.stateKey)}));
  if(subjects.length!==1||subjects[0]?.fields.length!==1)throw new Error('修正清单必须保留唯一的实际冲突字段。');
  return {...source.catalog,sessionId,sessionRevision,subjects};
}

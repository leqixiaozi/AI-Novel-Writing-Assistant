import {z} from 'zod';
import {resourceSupplementPreviewInputSchema,type StableResourceSupplementBasis,type ResourceSupplementPreview} from './index';
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

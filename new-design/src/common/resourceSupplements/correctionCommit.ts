import {z} from 'zod';
import {resourceSupplementCorrectionStartReceiptSchema} from './correction';
import {resourceSupplementImpactReviewReceiptSchema} from './review';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),ids=z.array(uuid).max(10000).refine(value=>new Set(value).size===value.length);
import {resourceSupplementCommitInputSchema} from './commit';
export {resourceSupplementCommitInputSchema} from './commit';
export type {ResourceSupplementCommitInput} from './commit';
export const resourceSupplementCorrectionCommitReceiptSchema=z.object({
  contract:z.literal('resource_supplement_correction_commit_v1'),bookId:uuid,sessionId:uuid,chapterDocumentId:uuid,
  input:resourceSupplementCommitInputSchema,inputHash:hash,
  merged:z.object({sessionId:uuid,settlementId:uuid,checkpointId:uuid,baseCheckpointId:uuid,bodyVersionId:uuid,
    newStateChangeIds:ids,confirmed:z.object({facts:ids,knowledge:ids,states:ids}).strict(),reviewId:uuid,impactHash:hash}).strict(),
  originalStart:resourceSupplementCorrectionStartReceiptSchema,originalReview:resourceSupplementImpactReviewReceiptSchema,
  issues:z.array(z.record(z.string(),z.unknown())).max(5000),resolutions:z.array(z.record(z.string(),z.unknown())).min(1).max(5000),sourceRoute:z.string(),repeated:z.boolean(),
}).strict().refine(value=>value.merged.sessionId===value.sessionId&&value.originalStart.bookId===value.bookId&&value.originalStart.sessionId===value.sessionId
  &&value.originalStart.chapterDocumentId===value.chapterDocumentId&&value.originalStart.baseCheckpointId===value.merged.baseCheckpointId
  &&value.originalStart.bodyVersionId===value.merged.bodyVersionId&&value.originalReview.bookId===value.bookId&&value.originalReview.sessionId===value.sessionId
  &&value.originalReview.reviewId===value.input.reviewId&&value.merged.reviewId===value.input.reviewId
  &&value.originalReview.sessionRevision===value.input.expectedSessionRevision&&value.originalReview.impact.impactHash===value.input.expectedImpactHash
  &&value.merged.impactHash===value.input.expectedImpactHash&&value.originalReview.baseCheckpointId===value.merged.baseCheckpointId
  &&value.originalReview.bodyVersionId===value.merged.bodyVersionId
  &&new Set(value.issues.map(issue=>issue.issue_id)).size===value.issues.length
  &&value.issues.every(issue=>z.string().uuid().safeParse(issue.issue_id).success&&issue.book_id===value.bookId&&issue.settlement_id===value.merged.settlementId)
  &&value.resolutions.length===value.originalStart.relatedIssueIds.length
  &&new Set(value.resolutions.map(row=>row.issue_id)).size===value.resolutions.length
  &&value.resolutions.every(row=>value.originalStart.relatedIssueIds.includes(String(row.issue_id))&&row.book_id===value.bookId&&row.correction_checkpoint_id===value.merged.checkpointId)
  &&value.sourceRoute===`/new-design/books/${value.bookId}/writing?chapterDocument=${value.chapterDocumentId}&session=${value.sessionId}`);
export type ResourceSupplementCorrectionCommitReceipt=z.infer<typeof resourceSupplementCorrectionCommitReceiptSchema>;

import {z} from 'zod';
import {resourceSupplementStartReceiptSchema} from './index';
import {resourceSupplementImpactReviewReceiptSchema} from './review';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),ids=z.array(uuid).max(10000).refine(value=>new Set(value).size===value.length);
export const resourceSupplementCommitInputSchema=z.object({requestKey:uuid,reviewId:uuid,expectedSessionRevision:z.number().int().positive(),expectedImpactHash:hash}).strict();
export type ResourceSupplementCommitInput=z.infer<typeof resourceSupplementCommitInputSchema>;
export const resourceSupplementCommitReceiptSchema=z.object({
  contract:z.literal('resource_supplement_formal_commit_v1'),bookId:uuid,sessionId:uuid,chapterDocumentId:uuid,
  input:resourceSupplementCommitInputSchema,inputHash:hash,
  merged:z.object({sessionId:uuid,settlementId:uuid,checkpointId:uuid,baseCheckpointId:uuid,bodyVersionId:uuid,
    newStateChangeIds:ids,confirmed:z.object({facts:ids,knowledge:ids,states:ids}).strict(),reviewId:uuid,impactHash:hash}).strict(),
  originalStart:resourceSupplementStartReceiptSchema,originalReview:resourceSupplementImpactReviewReceiptSchema,
  issues:z.array(z.record(z.string(),z.unknown())).max(5000),sourceRoute:z.string(),repeated:z.boolean(),
}).strict().refine(value=>value.merged.sessionId===value.sessionId&&value.originalStart.bookId===value.bookId&&value.originalStart.sessionId===value.sessionId
  &&value.originalStart.chapterDocumentId===value.chapterDocumentId&&value.originalStart.baseCheckpointId===value.merged.baseCheckpointId
  &&value.originalStart.bodyVersionId===value.merged.bodyVersionId&&value.originalReview.bookId===value.bookId&&value.originalReview.sessionId===value.sessionId
  &&value.originalReview.reviewId===value.input.reviewId&&value.merged.reviewId===value.input.reviewId
  &&value.originalReview.sessionRevision===value.input.expectedSessionRevision&&value.originalReview.impact.impactHash===value.input.expectedImpactHash
  &&value.merged.impactHash===value.input.expectedImpactHash&&value.originalReview.baseCheckpointId===value.merged.baseCheckpointId
  &&value.originalReview.bodyVersionId===value.merged.bodyVersionId
  &&new Set(value.issues.map(issue=>issue.issue_id)).size===value.issues.length
  &&value.issues.every(issue=>z.string().uuid().safeParse(issue.issue_id).success&&issue.book_id===value.bookId&&issue.settlement_id===value.merged.settlementId)
  &&value.sourceRoute===`/new-design/books/${value.bookId}/writing?chapterDocument=${value.chapterDocumentId}&session=${value.sessionId}`);
export type ResourceSupplementCommitReceipt=z.infer<typeof resourceSupplementCommitReceiptSchema>;

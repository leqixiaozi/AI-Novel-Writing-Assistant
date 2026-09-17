import {z} from 'zod';
import type {ResourceSupplementSettlementImpact} from './index';

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
/** Acknowledging a conflict records awareness; it never resolves its source. */
export const resourceSupplementImpactReviewInputSchema=z.object({
  requestKey:uuid,expectedSessionRevision:z.number().int().positive(),expectedImpactHash:hash,
  acknowledgedConflictStateChangeIds:z.array(uuid).max(5000).refine(ids=>new Set(ids).size===ids.length),
  note:z.string().trim().min(1).max(4000),
}).strict();
export type ResourceSupplementImpactReviewInput=z.infer<typeof resourceSupplementImpactReviewInputSchema>;
export interface ResourceSupplementImpactReviewReceipt {
  contract:'resource_supplement_impact_review_v1';reviewId:string;bookId:string;sessionId:string;
  chapterDocumentId:string;bodyVersionId:string;baseCheckpointId:string;sessionRevision:number;
  input:ResourceSupplementImpactReviewInput;inputHash:string;
  impact:ResourceSupplementSettlementImpact;sourceRoute:string;repeated:boolean;
}
export const resourceSupplementImpactReviewReceiptSchema=z.object({
  contract:z.literal('resource_supplement_impact_review_v1'),reviewId:uuid,bookId:uuid,sessionId:uuid,
  chapterDocumentId:uuid,bodyVersionId:uuid,baseCheckpointId:uuid,sessionRevision:z.number().int().positive(),
  input:resourceSupplementImpactReviewInputSchema,inputHash:hash,
  impact:z.object({contract:z.literal('resource_supplement_settlement_impact_v1'),bookId:uuid,sessionId:uuid,
    sessionRevision:z.number().int().positive(),baseCheckpointId:uuid,bodyVersionId:uuid,sourceHash:hash,
    changes:z.array(z.object({itemId:uuid,proposalId:uuid,subjectKind:z.enum(['card','relation']),subjectId:uuid,stateKey:z.string(),before:z.unknown(),after:z.unknown()}).strict()),
    stateChain:z.array(z.object({chapterDocumentId:uuid,bodyVersionId:uuid,chapterOrder:z.number(),stateChangeId:uuid,
      subjectKind:z.enum(['card','relation']),subjectId:uuid,stateKey:z.string(),expectedBefore:z.unknown(),recordedBefore:z.unknown(),recordedAfter:z.unknown(),
      effectiveStoryOrder:z.number().nullable(),reason:z.enum(['compatible','before_conflict','backdated_source'])}).strict()),
    downstreamSource:z.object({chapters:z.array(z.record(z.string(),z.unknown())),states:z.array(z.record(z.string(),z.unknown())),planningReferences:z.array(z.record(z.string(),z.unknown()))}).strict(),
    inputSnapshot:z.record(z.string(),z.unknown()),impactHash:hash,
  }).strict(),sourceRoute:z.string(),repeated:z.boolean(),
}).strict().refine(r=>r.impact.bookId===r.bookId&&r.impact.sessionId===r.sessionId
  &&r.impact.baseCheckpointId===r.baseCheckpointId&&r.impact.bodyVersionId===r.bodyVersionId
  &&r.impact.sessionRevision===r.sessionRevision&&r.input.expectedSessionRevision===r.sessionRevision
  &&r.input.expectedImpactHash===r.impact.impactHash
  &&r.sourceRoute===`/new-design/books/${r.bookId}/writing?chapterDocument=${r.chapterDocumentId}&session=${r.sessionId}`);

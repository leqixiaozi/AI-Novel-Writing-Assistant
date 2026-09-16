import type {EmbeddingIndexGeneration,EmbeddingRequestDetail,EmbeddingProfileVersion,SemanticRetrievalRun} from "../contracts";
import type {ManagedEmbeddingConnectionVersion} from "../modelRouting";
export interface KnowledgeIndexSource {assetId:string;sourceVersionId:string;parsedVersionId:string;checksum:string}
export interface PrepareKnowledgeIndexInput {requestKey:string;profileVersionId:string;connectionVersionId:string;sources:KnowledgeIndexSource[]}
export interface KnowledgeEmbeddingIdentity {bookId:string;requestId:string;chunkId:string;sourceSnapshotId:string;sourceStableId:string;sourceVersionId:string;sourceHash:string;chunkHash:string;profileVersionId:string;profileHash:string;connectionVersionId:string;connectionHash:string;provider:"ollama"|"openai-compatible";model:string;dimensions:number;normalize:boolean;inputHash:string}
export interface KnowledgePreparedEmbedding extends EmbeddingRequestDetail {identity:KnowledgeEmbeddingIdentity}
export interface KnowledgeIndexReceipt {bookId:string;requestKey:string;profileVersionId:string;connectionVersionId:string;inputHash:string;requestIds:string[];requests:KnowledgePreparedEmbedding[];generation:EmbeddingIndexGeneration|null;mutationOutcome:"committed";repeated:boolean}
export interface KnowledgeIndexWorkspace {bookId:string;profiles:Array<EmbeddingProfileVersion&{label:string}>;connections:ManagedEmbeddingConnectionVersion[];generations:EmbeddingIndexGeneration[];preparedIndexes:KnowledgeIndexReceipt[];configured:boolean;reason:string}
export interface CreateKnowledgeProfileInput {requestKey:string;connectionVersionId:string;name:string;dimensions:number;maxChunkChars:number;overlapChars:number;distanceMetric:"cosine"|"l2"|"inner_product";normalize:boolean}
export interface KnowledgeProfileReceipt {requestKey:string;inputHash:string;profileId:string;profileVersionId:string;connectionVersionId:string;repeated:boolean;mutationOutcome:"committed"}
export interface ExecuteKnowledgeEmbeddingInput {requestKey:string;expectedInput:KnowledgeEmbeddingIdentity}
export interface KnowledgeEmbeddingReceipt {bookId:string;requestId:string;identity:KnowledgeEmbeddingIdentity;requestKey:string|null;detail:EmbeddingRequestDetail;modelRequestState:"not_sent"|"sent_unknown"|"completed";usage:KnowledgeEmbeddingUsage;replySaved:boolean;replyStorage:"none"|"database"|"local_evidence";canCompleteSavedResult:boolean;canEndExpiredUnknown:boolean;failure:string|null}
export interface BuildKnowledgeIndexInput {requestKey:string;profileVersionId:string}
export interface KnowledgeGenerationReceipt extends EmbeddingIndexGeneration {requestKey:string;inputHash:string;repeated:boolean}
export interface KnowledgeGenerationIdentity {generationId:string;profileVersionId:string;profileHash:string;connectionHash:string}
export interface SearchKnowledgeSemanticInput {requestKey:string;profileId:string;connectionVersionId:string;query:string;topK:number;expectedGeneration:KnowledgeGenerationIdentity}
export interface KnowledgeSemanticReceipt {bookId:string;requestKey:string;run:SemanticRetrievalRun;modelRequestState:"not_sent"|"sent_unknown"|"completed";usage:KnowledgeEmbeddingUsage;replySaved:boolean;replyStorage:"none"|"database"|"local_evidence";canCompleteSavedResult:boolean;canEndExpiredUnknown:boolean;failure:string|null;items:Array<{assetId:string;parsedVersionId:string;title:string;excerpt:string;score:number}>}
export interface KnowledgeEmbeddingReply {vector:number[];inputTokens:number|null;provider:"ollama"|"openai-compatible";model:string;responseReceived:true}
export interface KnowledgeEmbeddingUsage {knownInputTokens:number|null;unknownUsage:boolean}

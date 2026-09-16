import {z} from "zod";
import {stableHash} from "../aiContracts";
import {NewDesignError} from "../../domain/errors";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const createKnowledgeProfileSchema=z.object({requestKey:uuid,connectionVersionId:uuid,name:z.string().min(1).max(120).refine(value=>Boolean(value.trim())),dimensions:z.number().int().min(1).max(2000),maxChunkChars:z.number().int().min(128).max(50000),overlapChars:z.number().int().nonnegative(),distanceMetric:z.enum(["cosine","l2","inner_product"]),normalize:z.boolean()}).strict().refine(value=>value.overlapChars<value.maxChunkChars,{path:["overlapChars"],message:"重叠字符数必须小于分块长度。"});
export const prepareKnowledgeIndexSchema=z.object({requestKey:uuid,profileVersionId:uuid,connectionVersionId:uuid,sources:z.array(z.object({assetId:uuid,sourceVersionId:uuid,parsedVersionId:uuid,checksum:hash}).strict()).min(1).max(20)}).strict().refine(value=>new Set(value.sources.map(item=>item.assetId)).size===value.sources.length,{message:"同一参考不能重复准备。"});
export const embeddingIdentitySchema=z.object({bookId:uuid,requestId:uuid,chunkId:uuid,sourceSnapshotId:uuid,sourceStableId:uuid,sourceVersionId:uuid,sourceHash:hash,chunkHash:hash,profileVersionId:uuid,profileHash:hash,connectionVersionId:uuid,connectionHash:hash,provider:z.enum(["ollama","openai-compatible"]),model:z.string().min(1).max(300),dimensions:z.number().int().min(1).max(2000),normalize:z.boolean(),inputHash:hash}).strict();
export const executeKnowledgeEmbeddingSchema=z.object({requestKey:uuid,expectedInput:embeddingIdentitySchema}).strict();
export const buildKnowledgeIndexSchema=z.object({requestKey:uuid,profileVersionId:uuid}).strict();
export const generationIdentitySchema=z.object({generationId:uuid,profileVersionId:uuid,profileHash:hash,connectionHash:hash}).strict();
export const searchKnowledgeSemanticSchema=z.object({requestKey:uuid,profileId:uuid,connectionVersionId:uuid,query:z.string().min(1).max(4000).refine(value=>Boolean(value.trim())),topK:z.number().int().min(1).max(20),expectedGeneration:generationIdentitySchema}).strict();
export const embeddingFreezeSchema=z.object({contract:z.literal("knowledge_embedding_v1"),bookId:uuid,requestId:uuid.optional(),chunkId:uuid.optional(),sourceSnapshotId:uuid.optional(),sourceStableId:uuid.optional(),sourceVersionId:uuid.optional(),profileVersionId:uuid,profileHash:hash,connectionVersionId:uuid,connectionHash:hash,provider:z.enum(["ollama","openai-compatible"]),model:z.string().min(1).max(300),dimensions:z.number().int().min(1).max(2000),normalize:z.boolean(),inputHash:hash,sourceHash:hash.optional(),chunkHash:hash.optional(),query:z.string().max(4000).optional(),generationId:uuid.optional(),topK:z.number().int().min(1).max(20).optional()}).strict();
export function knowledgeEmbeddingIdentity(value:unknown){const freeze=embeddingFreezeSchema.parse(value);return embeddingIdentitySchema.parse({bookId:freeze.bookId,requestId:freeze.requestId,chunkId:freeze.chunkId,sourceSnapshotId:freeze.sourceSnapshotId,sourceStableId:freeze.sourceStableId,sourceVersionId:freeze.sourceVersionId,sourceHash:freeze.sourceHash,chunkHash:freeze.chunkHash,profileVersionId:freeze.profileVersionId,profileHash:freeze.profileHash,connectionVersionId:freeze.connectionVersionId,connectionHash:freeze.connectionHash,provider:freeze.provider,model:freeze.model,dimensions:freeze.dimensions,normalize:freeze.normalize,inputHash:freeze.inputHash});}
export type EmbeddingFreeze=z.infer<typeof embeddingFreezeSchema>;
export const embeddingReplySchema=z.object({vector:z.array(z.number().finite()).min(1).max(2000),inputTokens:z.number().int().nonnegative().nullable(),provider:z.enum(["ollama","openai-compatible"]),model:z.string().min(1).max(300),responseReceived:z.literal(true)}).strict();
/** Registered deterministic UTF-16 splitter; preserves every character, never disguises truncation as indexing. */
export function partitionKnowledgeText(text:string,max:number,overlap:number){
 if(!text.length||!Number.isInteger(max)||max<128||max>50000||!Number.isInteger(overlap)||overlap<0||overlap>=max)throw new NewDesignError("正文或分块规格不完整，请在嵌入规格中核对分块长度与重叠。",422);
 const chunks:Array<{ordinal:number;anchor:{start:number;end:number};text:string}>=[];
 for(let start=0;start<text.length;){let end=Math.min(text.length,start+max);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  chunks.push({ordinal:chunks.length,anchor:{start,end},text:text.slice(start,end)});if(chunks.length>64)throw new NewDesignError("此次参考超过 64 个分块，请减少参考范围或明确调整分块规格；没有截断正文。",422);
  if(end===text.length)break;const next=end-overlap;start=next>start?next:end;if(start>0&&/[\uDC00-\uDFFF]/.test(text[start])&&/[\uD800-\uDBFF]/.test(text[start-1]))start++;
 }return chunks;
}
export const knowledgeIndexInputHash=(bookId:string,value:unknown)=>stableHash({contract:"knowledge_index_v1",bookId,input:value});

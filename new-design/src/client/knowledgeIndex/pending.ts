import {z} from "zod";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),base={bookId:uuid};
const profile=z.object({requestKey:uuid,connectionVersionId:uuid,name:z.string().min(1).max(120),dimensions:z.number().int().min(1).max(2000),maxChunkChars:z.number().int().min(128).max(50000),overlapChars:z.number().int().nonnegative(),distanceMetric:z.enum(["cosine","l2","inner_product"]),normalize:z.boolean()}).strict().refine(value=>value.overlapChars<value.maxChunkChars);
const prepare=z.object({requestKey:uuid,profileVersionId:uuid,connectionVersionId:uuid,sources:z.array(z.object({assetId:uuid,sourceVersionId:uuid,parsedVersionId:uuid,checksum:hash}).strict()).min(1).max(20)}).strict();
const build=z.object({requestKey:uuid,profileVersionId:uuid}).strict();
const identity=z.object({bookId:uuid,requestId:uuid,chunkId:uuid,sourceSnapshotId:uuid,sourceStableId:uuid,sourceVersionId:uuid,sourceHash:hash,chunkHash:hash,profileVersionId:uuid,profileHash:hash,connectionVersionId:uuid,connectionHash:hash,provider:z.enum(["ollama","openai-compatible"]),model:z.string().min(1).max(300),dimensions:z.number().int().min(1).max(2000),normalize:z.boolean(),inputHash:hash}).strict();
const execute=z.object({requestKey:uuid,expectedInput:identity}).strict();
const query=z.object({requestKey:uuid,profileId:uuid,connectionVersionId:uuid,query:z.string().min(1).max(4000),topK:z.number().int().min(1).max(20),expectedGeneration:z.object({generationId:uuid,profileVersionId:uuid,profileHash:hash,connectionHash:hash}).strict()}).strict();
export const pendingKnowledgeIndexSchema=z.discriminatedUnion("kind",[
 z.object({...base,kind:z.literal("profile"),input:profile}).strict(),z.object({...base,kind:z.literal("prepare"),input:prepare}).strict(),z.object({...base,kind:z.literal("build"),input:build}).strict(),z.object({...base,kind:z.literal("semantic"),input:query}).strict(),
 z.object({...base,kind:z.enum(["embedding","embedding_complete","embedding_end"]),id:uuid,input:execute}).strict(),
 z.object({...base,kind:z.enum(["semantic_complete","semantic_end"]),id:uuid,input:query}).strict()
]);
export type PendingKnowledgeIndex=z.infer<typeof pendingKnowledgeIndexSchema>;
const storageKey=(bookId:string)=>`new-design:knowledge-index-pending:${bookId}`;
export function stableKnowledgeInput(value:unknown):string{if(Array.isArray(value))return`[${value.map(stableKnowledgeInput).join(",")}]`;if(typeof value==="object"&&value!==null)return`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableKnowledgeInput(item)}`).join(",")}}`;return JSON.stringify(value);}
export async function knowledgePendingHash(value:unknown){const bytes=new TextEncoder().encode(stableKnowledgeInput(value)),digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");}
export async function readKnowledgeIndexPending(bookId:string):Promise<PendingKnowledgeIndex|null>{const raw=sessionStorage.getItem(storageKey(bookId));if(!raw)return null;const envelope=z.object({payload:pendingKnowledgeIndexSchema,inputHash:hash}).strict().parse(JSON.parse(raw));if(envelope.payload.bookId!==bookId||envelope.inputHash!==await knowledgePendingHash(envelope.payload))throw new Error("原索引凭证无法核对，保留原存储，不发起新请求。");return envelope.payload;}
export async function saveKnowledgeIndexPending(value:PendingKnowledgeIndex){const payload=pendingKnowledgeIndexSchema.parse(value);sessionStorage.setItem(storageKey(payload.bookId),JSON.stringify({payload,inputHash:await knowledgePendingHash(payload)}));}
export function clearKnowledgeIndexPending(bookId:string){sessionStorage.removeItem(storageKey(bookId));}
export const pureKnowledgeIndexOperation=(pending:PendingKnowledgeIndex)=>["profile","prepare","build"].includes(pending.kind);

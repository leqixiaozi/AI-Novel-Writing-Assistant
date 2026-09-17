import {z} from "zod";
import {stableWorldConsistencyValue,type WorldConsistencyInput} from "../../common/worldConsistency";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const worldPendingSchema=z.discriminatedUnion('kind',[
 z.object({bookId:uuid,kind:z.literal('check'),input:z.object({requestKey:uuid,catalogHash:hash,cardIds:z.array(uuid).max(100),relationIds:z.array(uuid).max(100),recheckIssueId:uuid.optional()}).strict()}).strict(),
 z.object({bookId:uuid,kind:z.literal('saved'),candidateId:uuid,input:z.object({requestKey:uuid,authorWriteRequestKey:uuid,allowManualRevision:z.boolean().optional()}).strict()}).strict()
]);
export type WorldPending={bookId:string;kind:'check';input:WorldConsistencyInput}|{bookId:string;kind:'saved';candidateId:string;input:{requestKey:string;authorWriteRequestKey:string;allowManualRevision?:boolean}};
export async function worldDigest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableWorldConsistencyValue(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function parseWorldPending(raw:string,bookId:string):Promise<WorldPending>{const envelope=z.object({value:worldPendingSchema,hash}).strict().parse(JSON.parse(raw));if(envelope.value.bookId!==bookId||envelope.hash!==await worldDigest(envelope.value))throw new Error('原凭证不属于当前书籍或完整内容已变化');return envelope.value;}

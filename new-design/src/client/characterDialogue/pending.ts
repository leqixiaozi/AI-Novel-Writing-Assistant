import {z} from 'zod';
import {stableDialogueValue} from '../../common/characterDialogue';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const create=z.object({requestKey:uuid,checkpointId:uuid,participantCardIds:z.array(uuid).min(2).max(10),sourceHash:hash,situation:z.string().min(1).max(6000)}).strict();
const round=z.object({requestKey:uuid,expectedSessionRevision:z.number().int().positive(),sourceHash:hash,actorCardId:uuid,instruction:z.string().max(4000)}).strict();
const selection=z.object({requestKey:uuid,roundId:uuid,actionKeys:z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/)).min(1).max(20),planningObjectId:uuid,expectedPlanningRevision:z.number().int().positive(),planningVersionId:uuid,sourceHash:hash}).strict();
export const dialoguePendingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('session'),bookId:uuid,input:create}).strict(),
 z.object({kind:z.literal('round'),bookId:uuid,sessionId:uuid,input:round,recovery:z.enum(['complete','release','end']).optional()}).strict(),
 z.object({kind:z.literal('selection'),bookId:uuid,sessionId:uuid,input:selection}).strict()
]);
export type DialoguePending=z.infer<typeof dialoguePendingSchema>;
export async function dialogueDigest(value:unknown):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableDialogueValue(value)))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function parseDialoguePending(raw:string,bookId:string):Promise<DialoguePending>{const result=z.object({value:dialoguePendingSchema,hash}).strict().parse(JSON.parse(raw));if(result.value.bookId!==bookId||result.hash!==await dialogueDigest(result.value))throw new Error('原人物模拟凭证范围或完整输入不匹配。');return result.value;}

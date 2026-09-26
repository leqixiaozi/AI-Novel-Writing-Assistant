import {imagePreparationSelectionSchema} from '../imagePreparation';
import {z} from 'zod';
import type {FieldDefinition} from '../contracts';
import {IMAGE_SIZES,type ImageConnectionVersion} from '../imageGeneration';
export const PUBLIC_CHARACTER_ROUTE='/new-design/resources/characters/workshop';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const source={requestKey:uuid,resourceId:uuid,resourceVersionId:uuid,sourceHash:hash};
export const publicCharacterTrialSchema=z.discriminatedUnion('kind',[
 z.object({...source,kind:z.literal('dialogue'),message:z.string().trim().min(1).max(2000),historyKeys:z.array(uuid).max(30).refine(keys=>new Set(keys).size===keys.length)}).strict(),
 z.object({...source,kind:z.literal('portrait'),connectionVersionId:uuid,title:z.string().trim().min(1).max(240),prompt:z.string().trim().min(1).max(4000),description:z.string().max(4000),size:z.enum(IMAGE_SIZES),preparation:imagePreparationSelectionSchema.optional()}).strict(),
]);
export type PublicCharacterTrialInput=z.infer<typeof publicCharacterTrialSchema>;
export interface PublicCharacterSource {id:string;versionId:string;revision:number;typeVersionId:string;title:string;values:Record<string,unknown>;fields:FieldDefinition[];localFields:Array<{definitionId:string;versionId:string;field:FieldDefinition;value:unknown}>;hash:string;}
export const publicDialogueOutputSchema=z.object({resourceId:uuid,resourceVersionId:uuid,utterance:z.string().trim().min(1).max(6000),profileObservations:z.array(z.string().trim().min(1).max(1000)).max(10),missingProfile:z.array(z.string().trim().min(1).max(500)).max(10)}).strict();
export type PublicDialogueOutput=z.infer<typeof publicDialogueOutputSchema>;
export interface PublicDialoguePromptInput {contract:'public_character_dialogue_v1';source:PublicCharacterSource;message:string;history:Array<{requestKey:string;message:string;utterance:string}>;}
export interface PublicPortraitOutput {contentObjectId:string;checksum:string;byteSize:number;mimeType:'image/png'|'image/jpeg'|'image/webp';title:string;description:string;}
export interface PublicCharacterTrial {id:string;requestKey:string;input:PublicCharacterTrialInput;source:PublicCharacterSource;status:'running'|'succeeded'|'failed'|'ended_unknown';requestState:'not_sent'|'sending'|'sent_unknown'|'completed';output:PublicDialogueOutput|PublicPortraitOutput|null;execution:Record<string,unknown>|null;canCompleteSaved:boolean;canEndExpired:boolean;summary:string;createdAt:string;}
export const publicPortraitCommandSchema=z.object({requestKey:uuid,resourceId:uuid,trialId:uuid,operation:z.enum(['primary','archive']),expectedLatestEventId:uuid.nullable()}).strict();
export type PublicPortraitCommand=z.infer<typeof publicPortraitCommandSchema>;
export interface PublicPortraitReceipt {id:string;input:PublicPortraitCommand;repeated:boolean;}
export interface PublicCharacterWorkspace {catalog:Array<{id:string;title:string;versionsTruncated:boolean;versions:Array<{id:string;revision:number;title:string}>}>;catalogTruncated:boolean;source:PublicCharacterSource|null;sourceWritable:boolean;capability:{installed:boolean;operational:boolean};connections:ImageConnectionVersion[];configurationIssue:string|null;trials:PublicCharacterTrial[];portraits:Array<{trial:PublicCharacterTrial;primary:boolean;archived:boolean}>;latestPortraitEventId:string|null;}
export interface PublicCharactersApi {workspace(resourceId?:string,versionId?:string):Promise<PublicCharacterWorkspace>;run(input:PublicCharacterTrialInput):Promise<PublicCharacterTrial>;byKey(key:string):Promise<PublicCharacterTrial|null>;complete(id:string):Promise<PublicCharacterTrial>;endExpired(id:string):Promise<PublicCharacterTrial>;portraitCommand(input:PublicPortraitCommand):Promise<PublicPortraitReceipt>;portraitReceipt(key:string):Promise<PublicPortraitReceipt|null>;}

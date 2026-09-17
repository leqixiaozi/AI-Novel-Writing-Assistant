import type {FieldDefinition, PlanningLevel} from '../contracts';
import type {FormAssistTarget} from '../formAssist';
export {canonicalWriteInput,writeInputHash,type PlanningWriteReceipt} from './receipts';
export {initialWriteInput,type InitialStateWriteInput,type InitialStateWriteReceipt} from './initialReceipts';

export type StoryBatchRequest = {requestKey:string;instruction:string} & (
 {mode:'setting';typeIds:string[];newTypeId:string;newCount:number} |
 {mode:'planning';scopeId:string} |
 {mode:'visible_prepare';cardIds:string[]} |
 {mode:'visible_adjust';cardIds:string[]}
);
export interface StoryBatchSlot {
 id:string;title:string;values:Record<string,unknown>;fields:FieldDefinition[];
 target:FormAssistTarget|null;planningId:string|null;revision:number|null;
 baseVersionId:string|null;parentVersionId:string|null;level:PlanningLevel|null;
 sourceHash:string;references?:Array<{role:string;cardId:string}>;
}
export interface StoryBatchPromptInput {
 bookName:string;bookDescription:string;mode:'setting'|'planning'|'visible_prepare'|'visible_adjust';instruction:string;
 slots:StoryBatchSlot[];materials:Array<{id:string;versionId:string;title:string;typeKey:string;values:Record<string,unknown>}>;
 adoptedPlans:Array<{id:string;versionId:string;title:string;content:Record<string,unknown>}>;
}
export interface StoryBatchOutput {candidates:Record<string,Record<string,unknown>>}
export interface StoryBatchRecord {
 id:string;bookId:string;requestKey:string;request:StoryBatchRequest;
 status:'running'|'review'|'applied'|'failed'|'ended_unknown';stage:string;error:string;
 snapshot:StoryBatchPromptInput;output:StoryBatchOutput|null;createdAt:string;
}
export interface VisibleAdoptionInput {slotId:string;fieldKeys:string[];sourceHash:string;requestKey:string;}
export interface StoryBatchDraft {decisionId?:string;key:string;bookId:string;slot:StoryBatchSlot;values:Record<string,unknown>}

export interface VisibleBatchWriteInput {requestKey:string;items:Array<VisibleAdoptionInput&{saveRequestKey:string}>;}
export interface VisibleBatchWriteReceipt {contract:"visible_batch_write_v1";bookId:string;batchKey:string;requestKey:string;inputHash:string;items:import("../authorMaterials").AuthorMaterialWriteReceipt[];}

import {z} from 'zod';
import {prepareCreativeSchema,creativeCommandSchema,creativeRunSchema,type CreativePreview,type CreativeWriteReceipt} from '../../common/creativeExtraction';
const uuid=z.string().uuid();
export const creativePendingSchema=z.discriminatedUnion('phase',[
 z.object({phase:z.literal('prepare'),bookId:uuid,input:prepareCreativeSchema}).strict(),
 z.object({phase:z.literal('run'),bookId:uuid,previewId:uuid,input:creativeRunSchema}).strict(),
 z.object({phase:z.literal('save'),bookId:uuid,previewId:uuid,input:creativeCommandSchema}).strict(),
]).superRefine((pending,context)=>{if(pending.phase==='prepare'&&pending.bookId!==pending.input.bookId||pending.phase==='save'&&pending.previewId!==pending.input.previewId)context.addIssue({code:'custom',message:'原恢复凭证范围不一致。'});});
export type CreativePending=z.infer<typeof creativePendingSchema>;
export function creativeCanonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(creativeCanonical).join(',')}]`;return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${creativeCanonical(item)}`).join(',')}}`;}
export function creativeKnownNotWritten(error:unknown){if(!error||typeof error!=='object'||!('recovery' in error))return false;const recovery=error.recovery;return recovery!==null&&typeof recovery==='object'&&'mutationOutcome' in recovery&&recovery.mutationOutcome==='not_written';}
export function creativePreviewMatches(result:CreativePreview,pending:CreativePending):boolean{
 if(result.bookId!==pending.bookId||result.input.book.id!==pending.bookId||pending.phase==='save')return false;
 if(pending.phase==='prepare')return result.requestKey===pending.input.requestKey&&result.mode===pending.input.mode&&creativeCanonical(result.originalInput)===creativeCanonical(pending.input);
 return result.id===pending.previewId&&creativeCanonical(result.runInput)===creativeCanonical(pending.input)&&Boolean(result.taskId&&result.attemptId)&&['running','succeeded','failed'].includes(result.status);
}
export function creativeRunSettled(result:CreativePreview,pending:CreativePending):boolean{return creativePreviewMatches(result,pending)&&(pending.phase==='prepare'||result.status==='succeeded'||result.status==='failed');}
export function creativeReceiptMatches(result:CreativeWriteReceipt,pending:CreativePending):boolean{
 if(pending.phase!=='save'||result.bookId!==pending.bookId||result.previewId!==pending.previewId||result.requestKey!==pending.input.requestKey||result.operation!==pending.input.operation||creativeCanonical(result.command)!==creativeCanonical(pending.input))return false;
 if(result.operation==='save_resource')return Boolean(result.resourceId&&result.versionId)&&result.bodyVersionId===null&&result.bookRevision===null;
 if(result.operation==='save_body_candidate')return Boolean(result.bodyVersionId)&&result.resourceId===null&&result.versionId===null&&result.bookRevision===null;
 return pending.input.operation==='adopt_title'&&typeof result.bookRevision==='number'&&Number.isSafeInteger(result.bookRevision)&&result.bookRevision>pending.input.expectedBookRevision&&result.resourceId===null&&result.versionId===null&&result.bodyVersionId===null;
}

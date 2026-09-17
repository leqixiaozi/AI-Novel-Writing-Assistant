import {z} from 'zod';
import {resourceSupplementStartInputSchema,resourceSupplementStartReceiptSchema} from '../resourceSupplements';
import type {ChapterSettlementAiReceipt} from '../chapterSettlementAi';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const resourceBackfillSeriesInputSchema=z.object({resourceScope:resourceSupplementStartInputSchema.shape.resourceScope,documentIds:z.array(uuid).min(1).max(5).refine(ids=>new Set(ids).size===ids.length)}).strict();
export type ResourceBackfillSeriesInput=z.infer<typeof resourceBackfillSeriesInputSchema>;
const chapter=z.object({documentId:uuid,chapterCardId:uuid,bodyVersionId:uuid,bodyContentHash:hash,title:z.string(),logicalOrder:z.number().int().positive()}).strict();
export const resourceBackfillAiCommandSchema=z.object({sessionId:uuid,input:z.object({expectedSessionRevision:z.number().int().positive(),requestKey:uuid,catalogHash:hash,resourceScope:resourceSupplementStartInputSchema.shape.resourceScope}).strict()}).strict();
export type ResourceBackfillAiCommand=z.infer<typeof resourceBackfillAiCommandSchema>;
export const resourceBackfillAiReceiptSchema=z.object({id:uuid,sessionId:uuid,requestKey:uuid,taskId:uuid,status:z.enum(['running','succeeded','failed','released','ended_unknown']),modelResultSaved:z.boolean(),proposalCount:z.number().int().nonnegative(),proposalsSaved:z.boolean(),notes:z.array(z.string()),failure:z.unknown().nullable(),sourceRoute:z.string(),canImportSavedResult:z.boolean(),repeated:z.boolean(),ledgerPending:z.boolean(),canReleaseSavedResult:z.boolean(),canEndExpiredUnknownRun:z.boolean()}).strict();
export const resourceBackfillSeriesPartSchema=z.object({chapter,kind:z.enum(['stable','editable']),aiRequestKey:uuid,startInput:resourceSupplementStartInputSchema.nullable(),startReceipt:resourceSupplementStartReceiptSchema.nullable(),ai:resourceBackfillAiCommandSchema.nullable(),receipt:z.unknown().nullable()}).strict();
export type ResourceBackfillSeriesPart=Omit<z.infer<typeof resourceBackfillSeriesPartSchema>,'receipt'>&{receipt:ChapterSettlementAiReceipt|null};
export interface ResourceBackfillSeries {format:1;id:string;bookId:string;characterId:string;input:ResourceBackfillSeriesInput;parts:ResourceBackfillSeriesPart[];next:number;stage:'ready'|'pending_start'|'pending_ai'|'complete'|'stopped';message:string;}

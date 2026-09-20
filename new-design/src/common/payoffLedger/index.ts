import {z} from 'zod';

const uuid=z.string().uuid();
const chapterOrder=z.number().int().positive().max(1000000);

export const savePayoffWindowInputSchema=z.object({
  startChapterOrder:chapterOrder.nullable(),
  endChapterOrder:chapterOrder.nullable(),
  expectedRevision:z.number().int().nonnegative(),
  idempotencyKey:uuid,
}).strict().refine(value=>value.startChapterOrder===null||value.endChapterOrder===null||value.startChapterOrder<=value.endChapterOrder,{
  path:['endChapterOrder'],message:'截止章节不得早于起始章节。',
});

export type SavePayoffWindowInput=z.infer<typeof savePayoffWindowInputSchema>;
export interface PayoffWindowReceipt {
  id:string;bookId:string;cardId:string;version:number;revision:number;
  startChapterOrder:number|null;endChapterOrder:number|null;
  idempotencyKey:string;createdAt:string;
}
export interface PayoffLedgerSource {
  kind:'card'|'adopted_plan'|'narrative_placement'|'settlement'|'manual_window';
  id:string;label:string;chapterOrder:number|null;versionId:string|null;
}
export interface PayoffLedgerItem {
  cardId:string;cardVersionId:string;title:string;summary:string;authorPlan:string;
  status:'pending'|'urgent'|'overdue'|'paid_off'|'abandoned';
  targetStartChapterOrder:number|null;targetEndChapterOrder:number|null;
  windowSource:'manual'|'adopted_plan'|'unknown';windowRevision:number;
  settlementUnavailableReason:string|null;
  lastTouchedChapterOrder:number|null;paidOffChapterOrder:number|null;
  sources:PayoffLedgerSource[];
}
export interface PayoffLedgerWorkspace {
  bookId:string;available:boolean;windowEditingAvailable:boolean;throughStableChapterOrder:number;
  summary:{pendingCount:number;urgentCount:number;overdueCount:number;paidOffCount:number;unknownWindowCount:number};
  items:PayoffLedgerItem[];updatedAt:string;
}

export function classifyPayoffStatus(formalStatus:unknown,start:number|null,end:number|null,throughStableChapterOrder:number):PayoffLedgerItem['status']{
  if(formalStatus==='paid_off')return 'paid_off';
  if(formalStatus==='abandoned')return 'abandoned';
  if(end!==null&&end<throughStableChapterOrder)return 'overdue';
  if(end!==null&&end<=throughStableChapterOrder+1||start!==null&&start<=throughStableChapterOrder)return 'urgent';
  return 'pending';
}

import type {BookSummary,ChapterAdoptionPreparation,ChapterDocumentDetail,ChapterWritingRequest,ChapterWritingWorkspace,PlanningCenterWorkspace,PlanningLevel} from "../contracts";

/** A read projection of the existing plans and chapter workflow, never another body store. */
export interface BookCompositionWorkspace {bookId:string;book:BookSummary;planning:PlanningCenterWorkspace;writing:ChapterWritingWorkspace;orderBasisHash:string;}
export interface BookCompositionOrderInput {requestKey:string;parentObjectId:string;level:Exclude<PlanningLevel,"story">;expectedBookOrderHash:string;items:Array<{objectId:string;expectedRevision:number}>;}
export interface BookCompositionOrderPreview {bookId:string;input:BookCompositionOrderInput;previewHash:string;chapters:Array<{chapterCardId:string;title:string;beforeOrder:number|null;afterOrder:number;documentRevision:number|null}>;warnings:string[];}
export interface BookCompositionOrderSaveInput extends BookCompositionOrderInput {previewHash:string;}
export interface BookCompositionOrderReceipt {bookId:string;requestKey:string;inputHash:string;parentObjectId:string;level:Exclude<PlanningLevel,"story">;items:Array<{objectId:string;sortOrder:number;revision:number}>;chapters:BookCompositionOrderPreview["chapters"];requiresReview:boolean;repeated:boolean;}
export type ChapterCompositionWriteReceipt={kind:"candidate";bookId:string;chapterCardId:string;requestKey:string;bodyVersionId:string;resultRevision:number;document:ChapterDocumentDetail}|{kind:"ai";bookId:string;chapterCardId:string;requestKey:string;request:ChapterWritingRequest}|{kind:"adoption";bookId:string;chapterCardId:string;requestKey:string;preparation:ChapterAdoptionPreparation};
export const compositionLevelLabels:Record<PlanningLevel,string>={story:"全书",volume:"卷",chapter:"章节",scene:"场景"};

export function moveCompositionItem<T>(items:readonly T[],from:number,to:number):T[]{if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<0||from>=items.length||to>=items.length)return [...items];const result=[...items],item=result.splice(from,1)[0];result.splice(to,0,item);return result;}

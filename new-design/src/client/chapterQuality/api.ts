import type {ChapterQualityInput,ChapterQualityReceipt} from '../../common/chapterQuality';
import type {ChapterWritingRequest} from '../../common/contracts';
export interface QualityRepairState {candidateId:string;chapterDocumentId:string;candidateVersionId:string;candidateStatus:string;issueStatus:string;documentRevision:number;adoptedBodyVersionId:string|null;requests:Array<{id:string;status:string;bodyVersionId:string|null;requestKey:string}>;}
export function createChapterQualityApi(request:<T>(path:string,init?:RequestInit)=>Promise<T>){const base=(bookId:string)=>`/books/${bookId}/chapter-quality`,post=(value:unknown)=>({method:'POST',body:JSON.stringify(value)});return{
 readChapterTensionCurve:(bookId:string)=>request<import('../../common/planningRhythm').ObservedChapterTension[]>(`${base(bookId)}/tension-curve`),
 listChapterQuality:(bookId:string,documentId:string)=>request<ChapterQualityReceipt[]>(`${base(bookId)}/documents/${documentId}`),
 runChapterQuality:(bookId:string,input:ChapterQualityInput)=>request<ChapterQualityReceipt>(`${base(bookId)}/runs`,post(input)),
 getChapterQualityByKey:(bookId:string,key:string)=>request<ChapterQualityReceipt|null>(`${base(bookId)}/by-key/${key}`),
 importChapterQuality:(bookId:string,id:string)=>request<ChapterQualityReceipt>(`${base(bookId)}/runs/${id}/import-saved`,post({})),
 endChapterQuality:(bookId:string,id:string,kind:'release-saved'|'end-expired-unknown')=>request<ChapterQualityReceipt>(`${base(bookId)}/runs/${id}/${kind}`,post({})),
 getQualityRepairState:(bookId:string,id:string)=>request<QualityRepairState>(`${base(bookId)}/repairs/${id}`),
 generateQualityRepair:(bookId:string,id:string,input:{candidateVersionId:string;expectedDocumentRevision:number;requestKey:string})=>request<ChapterWritingRequest>(`${base(bookId)}/repairs/${id}/generate`,post(input)),
 recordQualityRepair:(bookId:string,id:string,input:{candidateVersionId:string;chapterWritingRequestId:string;requestKey:string})=>request<{candidateId:string;bodyVersionId:string;recorded:true}>(`${base(bookId)}/repairs/${id}/record`,post(input)),
 getQualityRepairRecord:(bookId:string,id:string,key:string)=>request<{candidateId:string;candidateVersionId:string;bodyVersionId:string;requestKey:string}|null>(`${base(bookId)}/repairs/${id}/records/${key}`),
 };}

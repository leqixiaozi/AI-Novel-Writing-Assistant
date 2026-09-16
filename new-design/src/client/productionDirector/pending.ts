import {directorCreateSchema,directorCommandSchema,chapterKnowledgeSelectionSchema,type DirectorCreateInput,type DirectorCommand} from '../../common/productionDirector';
import {z} from 'zod';
export type DirectorPending={bookId:string;kind:'create';input:DirectorCreateInput}|{bookId:string;kind:'command';runId:string;input:DirectorCommand};
export const directorPendingKey=(bookId:string)=>`new-design:director:pending:${bookId}`;
export const directorDraftKey=(bookId:string)=>`new-design:director:draft:${bookId}`;
export const directorDraftSchema=z.object({bookId:z.string().uuid(),chapters:z.array(z.string().uuid()).max(500),instruction:z.string().max(4000),policy:z.enum(['completion_first','quality_first']),knowledgeSources:z.array(chapterKnowledgeSelectionSchema).max(20).optional()}).strict();
export function parseDirectorDraft(raw:string,bookId:string){const value=directorDraftSchema.parse(JSON.parse(raw));if(value.bookId!==bookId)throw new Error('未提交范围不属于本书。');return value;}
export function parseDirectorPending(raw:string,bookId:string):DirectorPending{const value=JSON.parse(raw);if(value.bookId!==bookId)throw new Error('恢复凭证不属于本书。');if(value.kind==='create')return {bookId,kind:'create',input:directorCreateSchema.parse(value.input)};if(value.kind==='command'&&z.string().uuid().safeParse(value.runId).success)return {bookId,kind:'command',runId:value.runId,input:directorCommandSchema.parse(value.input)};throw new Error('原导演凭证无法确认，不能新发任务。');}
export function retainDirectorPending(value:DirectorPending):void{const raw=JSON.stringify(value),key=directorPendingKey(value.bookId);sessionStorage.setItem(key,raw);if(sessionStorage.getItem(key)!==raw)throw new Error('本机无法保留原凭证，任务未提交。');}

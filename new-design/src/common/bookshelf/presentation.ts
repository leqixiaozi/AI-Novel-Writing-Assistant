import {hasLiveWork,needsConfirmation,homeBookAction} from '../home/presentation';
import type {ShelfBook,ShelfFilter,ShelfSort} from './index';
export const SHELF_PAGE_SIZE=24;
export interface ShelfClassificationFilters {form:string;publication:string;mode:string;platform:string;}
export function shelfClassificationValue(book:ShelfBook,key:'publicationStatus'|'writingMode'|'platform'|'creationExperience'){
 return book.classificationSource==='adopted_book_contract'?book.classification?.[key]??null:null;
}
export function shelfStoryForm(book:ShelfBook){return book.storyFormatSource==='adopted_story_plan'?book.storyFormat?.form??null:null;}
export function filterShelfClassifications(books:ShelfBook[],filters:ShelfClassificationFilters):ShelfBook[]{return books.filter(book=>{
 const form=shelfStoryForm(book)??'unset',publication=shelfClassificationValue(book,'publicationStatus')??'unset',mode=shelfClassificationValue(book,'writingMode')??'unset',platform=shelfClassificationValue(book,'platform')??'unset';
 return (filters.form==='all'||form===filters.form)&&(filters.publication==='all'||publication===filters.publication)&&(filters.mode==='all'||mode===filters.mode)&&(filters.platform==='all'||platform===filters.platform);
});}
export function shelfProgress(book:ShelfBook):number|null {return book.adoptedChapterPlanCount>0?Math.min(100,Math.floor(book.writtenChapterCount/book.adoptedChapterPlanCount*100)):null;}
export function shelfAttention(book:ShelfBook):boolean {return needsConfirmation(book)||Boolean(book.latestDirector&&(['failed','waiting_recovery'].includes(book.latestDirector.status)||book.latestDirector.leaseExpired))||book.latestTask?.status==='failed';}
export function shelfAction(book:ShelfBook){
 const root=`/new-design/books/${encodeURIComponent(book.id)}`;
 if(book.latestDirector&&(['failed','paused','waiting_recovery','running','ready'].includes(book.latestDirector.status)||book.latestDirector.leaseExpired))return homeBookAction(book);
 const source=book.latestTask?.sourceRoute??'';let sameBook=false;try{const url=new URL(source,'http://shelf.invalid');sameBook=source.startsWith(root+'/')&&url.origin==='http://shelf.invalid'&&url.pathname.startsWith(root+'/')&&!/[\\\s]/.test(source)&&!/%(?:2f|5c|00)/i.test(url.pathname);}catch{}
 if(book.latestTask&&['failed','review','waiting_approval','waiting_recovery'].includes(book.latestTask.status)&&sameBook)return {label:'核对原创作结果',href:source,reason:'原任务的来源与已保存内容保留。'};
 if(book.pendingFacts+book.pendingChanges>0)return {label:'审阅正文与变化',href:book.lastChapterCardId?`${root}/chapters/${book.lastChapterCardId}/write`:`${root}/writing`,reason:'变化须在对应章节明确确认。'};
 if(book.writableChapterPlanCount>0||book.writtenChapterCount>0)return {label:'继续正文创作',href:shelfClassificationValue(book,'creationExperience')==='simple'?`${root}/${shelfStoryForm(book)==='short_story'?'short-story':'simple'}`:book.lastChapterCardId?`${root}/chapters/${book.lastChapterCardId}/write`:`${root}/writing`,reason:'沿本书采用计划与原章节继续。'};
 if(!book.characterCount||!book.worldCount)return {label:'继续故事设定',href:root+'/story-setting',reason:'在本书维护人物、世界与资料。'};
 return {label:'继续故事规划',href:root+'/planning',reason:'准备并明确采用故事与章节计划。'};
}
export function selectShelf(books:ShelfBook[],query:string,filter:ShelfFilter,sort:ShelfSort,page:number){
 const term=query.trim().toLocaleLowerCase(),filtered=books.filter(book=>(!term||`${book.name}\n${book.description}`.toLocaleLowerCase().includes(term))&&(filter==='all'||filter==='running'&&hasLiveWork(book)||filter==='attention'&&shelfAttention(book)||filter==='readable'&&book.writtenChapterCount>0||filter==='preparing'&&book.writtenChapterCount===0));
 filtered.sort((a,b)=>(sort==='progress'?(shelfProgress(b)??-1)-(shelfProgress(a)??-1):Date.parse(sort==='created'?b.createdAt:b.updatedAt)-Date.parse(sort==='created'?a.createdAt:a.updatedAt))||a.id.localeCompare(b.id));
 const totalPages=Math.max(1,Math.ceil(filtered.length/SHELF_PAGE_SIZE)),current=Math.max(1,Math.min(totalPages,Number.isSafeInteger(page)?page:1));
 return {items:filtered.slice((current-1)*SHELF_PAGE_SIZE,current*SHELF_PAGE_SIZE),total:filtered.length,totalPages,page:current};
}

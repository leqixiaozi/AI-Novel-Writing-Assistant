import {z} from 'zod';
import {listAuthorTasks,getAuthorTask} from '../authorTasks';
import {directorFollowupFilterSchema,directorFollowupKindSchema,followupSourceNavigation,FOLLOWUP_BATCH_UNAVAILABLE,type DirectorFollowupFilter,type DirectorFollowupWorkspace,type DirectorFollowupDetail} from '../../../common/directorFollowup';
import {readDirectorFollowup} from './repository';
import {readFollowupBooks,readFollowupBook} from './books';
import {readFollowupSources} from './detail';
export {withDirectorFollowupPool,DirectorFollowupReadError} from './repository';
const batch=()=>({enabled:false as const,reason:FOLLOWUP_BATCH_UNAVAILABLE});
export async function getDirectorFollowupWorkspace(raw:DirectorFollowupFilter={}):Promise<DirectorFollowupWorkspace>{const {bookStatus,...filter}=directorFollowupFilterSchema.parse(raw);return readDirectorFollowup('读取跨书导演汇总',async(client,original)=>{const books=await readFollowupBooks(client,bookStatus),selectedBook=filter.bookId?await readFollowupBook(client,filter.bookId):null,records=await original(()=>listAuthorTasks(filter));return{books:books.books,booksTotal:books.total,booksTruncated:books.truncated,selectedBook,records,readAt:records.readAt,batchRecovery:batch()};});}
export async function getDirectorFollowupDetail(kind:DirectorFollowupDetail['record']['kind'],id:string):Promise<DirectorFollowupDetail>{directorFollowupKindSchema.parse(kind);z.string().uuid().parse(id);return readDirectorFollowup('读取原导演跟进来源与版本',async(client,original)=>{const record=await original(()=>getAuthorTask(kind,id)),book=record.bookId?await readFollowupBook(client,record.bookId):null,sources=await readFollowupSources(client,record,id);return{record,book,...sources,navigation:followupSourceNavigation(record),batchRecovery:batch(),readAt:new Date().toISOString()};});}

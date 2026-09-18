import type {z} from 'zod';
import type {bookHistoryWorkspaceSchema,bookHistoryPreviewSchema,bookHistorySaveSchema,bookHistorySummarySchema,bookHistoryReceiptSchema,BookHistoryRestore} from '../../common/bookHistory';
export function createBookHistoryApi(request:<T>(path:string,init?:RequestInit)=>Promise<T>){const base=(book:string)=>`/book-history/${encodeURIComponent(book)}`,post=(input:unknown)=>({method:'POST',body:JSON.stringify(input)});return{
 workspace:(book:string,before?:string)=>request<z.infer<typeof bookHistoryWorkspaceSchema>>(`${base(book)}/workspace${before?`?before=${encodeURIComponent(before)}`:''}`),
 preview:(book:string,id:string)=>request<z.infer<typeof bookHistoryPreviewSchema>>(`${base(book)}/${encodeURIComponent(id)}/preview`),
 save:(book:string,input:z.infer<typeof bookHistorySaveSchema>)=>request<z.infer<typeof bookHistorySummarySchema>>(`${base(book)}/save`,post(input)),
 prepare:(book:string,input:BookHistoryRestore)=>request<z.infer<typeof bookHistoryReceiptSchema>>(`${base(book)}/prepare-restore`,post(input)),
 saveByKey:(book:string,key:string)=>request<z.infer<typeof bookHistorySummarySchema>|null>(`${base(book)}/save-by-key/${encodeURIComponent(key)}`),
 restoreByKey:(book:string,key:string)=>request<z.infer<typeof bookHistoryReceiptSchema>|null>(`${base(book)}/restore-by-key/${encodeURIComponent(key)}`)
};}

import type {WorldUsageWorkspace,WorldUsageCandidate,WorldUsagePrepareInput,WorldUsageAdoptInput,WorldUsageAdoptionReceipt} from '../../common/worldUsage';
export function createWorldUsageApi(request:<T>(path:string,init?:RequestInit)=>Promise<T>){
 const base=(book:string,root:string)=>`/books/${encodeURIComponent(book)}/world-usage/${encodeURIComponent(root)}`;
 return{
  workspace:(book:string,root:string)=>request<WorldUsageWorkspace>(base(book,root)),
  prepare:(book:string,root:string,input:WorldUsagePrepareInput)=>request<WorldUsageCandidate>(`${base(book,root)}/candidates`,{method:'POST',body:JSON.stringify(input)}),
  candidateByKey:(book:string,root:string,key:string)=>request<WorldUsageCandidate|null>(`${base(book,root)}/candidates/by-key/${encodeURIComponent(key)}`),
  adopt:(book:string,root:string,input:WorldUsageAdoptInput)=>request<WorldUsageAdoptionReceipt>(`${base(book,root)}/adopt`,{method:'POST',body:JSON.stringify(input)}),
  adoptionByKey:(book:string,root:string,key:string)=>request<WorldUsageAdoptionReceipt|null>(`${base(book,root)}/adoptions/by-key/${encodeURIComponent(key)}`),
 };
}

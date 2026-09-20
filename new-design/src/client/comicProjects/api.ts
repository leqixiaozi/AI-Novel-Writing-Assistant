import type {ComicCapability,ComicCreateInput,ComicCreateReceipt,ComicProjectDetail,ComicProjectSummary} from '../../common/comicProjects';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createComicProjectsApi(request:Request){const e=encodeURIComponent;return {
 capability:()=>request<ComicCapability>('/comic/capability'),
 list:()=>request<ComicProjectSummary[]>('/comic/projects'),
 detail:(id:string)=>request<ComicProjectDetail>(`/comic/projects/${e(id)}`),
 create:(input:ComicCreateInput)=>request<ComicCreateReceipt>('/comic/projects',{method:'POST',body:JSON.stringify(input)}),
 original:(key:string)=>request<ComicCreateReceipt|null>(`/comic/create-requests/${e(key)}`),
};}

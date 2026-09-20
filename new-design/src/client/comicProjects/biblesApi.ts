import type {ComicBibleAdoptionInput,ComicBibleAdoptionReceipt,ComicBibleProposalInput,ComicBibleProposalReceipt,ComicBibleWorkspace} from '../../common/comicBibles';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createComicBiblesApi(request:Request){const e=encodeURIComponent,base=(id:string)=>`/comic/projects/${e(id)}`;return {
 workspace:(projectId:string)=>request<ComicBibleWorkspace>(`${base(projectId)}/bibles`),
 propose:(projectId:string,input:ComicBibleProposalInput)=>request<ComicBibleProposalReceipt>(`${base(projectId)}/bibles`,{method:'POST',body:JSON.stringify(input)}),
 proposalOriginal:(projectId:string,key:string)=>request<ComicBibleProposalReceipt|null>(`${base(projectId)}/bible-requests/${e(key)}`),
 adopt:(projectId:string,entityId:string,input:ComicBibleAdoptionInput)=>request<ComicBibleAdoptionReceipt>(`${base(projectId)}/bibles/${e(entityId)}/adoptions`,{method:'POST',body:JSON.stringify(input)}),
 adoptionOriginal:(projectId:string,key:string)=>request<ComicBibleAdoptionReceipt|null>(`${base(projectId)}/bible-adoptions/${e(key)}`),
};}

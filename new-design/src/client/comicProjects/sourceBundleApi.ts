import type {ComicSourceBundleAdoptionInput,ComicSourceBundleAdoptionReceipt,ComicSourceBundleProposalInput,ComicSourceBundleProposalReceipt,ComicSourceBundleWorkspace} from '../../common/comicSourceBundle';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createComicSourceBundleApi(request:Request){const e=encodeURIComponent,base=(id:string)=>`/comic/projects/${e(id)}`;return{
 workspace:(projectId:string)=>request<ComicSourceBundleWorkspace>(`${base(projectId)}/source-bundle`),
 propose:(projectId:string,input:ComicSourceBundleProposalInput)=>request<ComicSourceBundleProposalReceipt>(`${base(projectId)}/source-bundle`,{method:'POST',body:JSON.stringify(input)}),
 proposalOriginal:(projectId:string,key:string)=>request<ComicSourceBundleProposalReceipt|null>(`${base(projectId)}/source-bundle-requests/${e(key)}`),
 adopt:(projectId:string,input:ComicSourceBundleAdoptionInput)=>request<ComicSourceBundleAdoptionReceipt>(`${base(projectId)}/source-bundle/adoptions`,{method:'POST',body:JSON.stringify(input)}),
 adoptionOriginal:(projectId:string,key:string)=>request<ComicSourceBundleAdoptionReceipt|null>(`${base(projectId)}/source-bundle-adoptions/${e(key)}`),
};}

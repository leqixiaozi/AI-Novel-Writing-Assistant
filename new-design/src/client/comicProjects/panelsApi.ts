import type {ComicGenerationReceipt,ComicPanelAdoptionInput,ComicPanelAdoptionReceipt,ComicPanelProposalInput,ComicPanelProposalReceipt,ComicPanelScriptInput,ComicPanelWorkspace} from '../../common/comicPanels';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createComicPanelsApi(request:Request){const e=encodeURIComponent,base=(projectId:string,episodeId:string)=>`/comic/projects/${e(projectId)}/episodes/${e(episodeId)}`;return {
 workspace:(projectId:string,episodeId:string)=>request<ComicPanelWorkspace>(`${base(projectId,episodeId)}/panels`),
 propose:(projectId:string,episodeId:string,input:ComicPanelProposalInput)=>request<ComicPanelProposalReceipt>(`${base(projectId,episodeId)}/panels`,{method:'POST',body:JSON.stringify(input)}),
 generate:(projectId:string,episodeId:string,input:ComicPanelScriptInput)=>request<ComicGenerationReceipt>(`${base(projectId,episodeId)}/panels/generate`,{method:'POST',body:JSON.stringify(input)}),
 generationOriginal:(projectId:string,key:string)=>request<ComicGenerationReceipt|null>(`/comic/projects/${e(projectId)}/generation-requests/${e(key)}`),
 proposalOriginal:(projectId:string,key:string)=>request<ComicPanelProposalReceipt|null>(`/comic/projects/${e(projectId)}/panel-requests/${e(key)}`),
 adopt:(projectId:string,episodeId:string,input:ComicPanelAdoptionInput)=>request<ComicPanelAdoptionReceipt>(`${base(projectId,episodeId)}/panel-adoptions`,{method:'POST',body:JSON.stringify(input)}),
 adoptionOriginal:(projectId:string,key:string)=>request<ComicPanelAdoptionReceipt|null>(`/comic/projects/${e(projectId)}/panel-adoptions/${e(key)}`),
};}

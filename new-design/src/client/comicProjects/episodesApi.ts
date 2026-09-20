import type {ComicEpisodeAdoptionInput,ComicEpisodeAdoptionReceipt,ComicEpisodeProposalInput,ComicEpisodeProposalReceipt,ComicEpisodeWorkspace} from '../../common/comicEpisodes';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createComicEpisodesApi(request:Request){const e=encodeURIComponent,base=(projectId:string)=>`/comic/projects/${e(projectId)}`;return {
 workspace:(projectId:string)=>request<ComicEpisodeWorkspace>(`${base(projectId)}/episodes`),
 propose:(projectId:string,input:ComicEpisodeProposalInput)=>request<ComicEpisodeProposalReceipt>(`${base(projectId)}/episodes`,{method:'POST',body:JSON.stringify(input)}),
 proposalOriginal:(projectId:string,key:string)=>request<ComicEpisodeProposalReceipt|null>(`${base(projectId)}/episode-requests/${e(key)}`),
 adopt:(projectId:string,episodeId:string,input:ComicEpisodeAdoptionInput)=>request<ComicEpisodeAdoptionReceipt>(`${base(projectId)}/episodes/${e(episodeId)}/adoptions`,{method:'POST',body:JSON.stringify(input)}),
 adoptionOriginal:(projectId:string,key:string)=>request<ComicEpisodeAdoptionReceipt|null>(`${base(projectId)}/episode-adoptions/${e(key)}`),
};}

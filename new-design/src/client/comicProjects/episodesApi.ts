import type {ComicEpisodeAdoptionInput,ComicEpisodeAdoptionReceipt,ComicEpisodeOutlineInput,ComicEpisodeProposalInput,ComicEpisodeProposalReceipt,ComicEpisodeWorkspace} from '../../common/comicEpisodes';
import type {ComicGenerationReceipt} from '../../common/comicPanels';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createComicEpisodesApi(request:Request){const e=encodeURIComponent,base=(projectId:string)=>`/comic/projects/${e(projectId)}`;return {
 workspace:(projectId:string)=>request<ComicEpisodeWorkspace>(`${base(projectId)}/episodes`),
 propose:(projectId:string,input:ComicEpisodeProposalInput)=>request<ComicEpisodeProposalReceipt>(`${base(projectId)}/episodes`,{method:'POST',body:JSON.stringify(input)}),
 generate:(projectId:string,input:ComicEpisodeOutlineInput)=>request<ComicGenerationReceipt>(`${base(projectId)}/episodes/generate`,{method:'POST',body:JSON.stringify(input)}),
 generationOriginal:(projectId:string,key:string)=>request<ComicGenerationReceipt|null>(`${base(projectId)}/generation-requests/${e(key)}`),
 proposalOriginal:(projectId:string,key:string)=>request<ComicEpisodeProposalReceipt|null>(`${base(projectId)}/episode-requests/${e(key)}`),
 adopt:(projectId:string,episodeId:string,input:ComicEpisodeAdoptionInput)=>request<ComicEpisodeAdoptionReceipt>(`${base(projectId)}/episodes/${e(episodeId)}/adoptions`,{method:'POST',body:JSON.stringify(input)}),
 adoptionOriginal:(projectId:string,key:string)=>request<ComicEpisodeAdoptionReceipt|null>(`${base(projectId)}/episode-adoptions/${e(key)}`),
};}

import type {ComicVisualAdoptionInput,ComicVisualAdoptionReceipt,ComicVisualUploadInput,ComicVisualUploadReceipt,ComicVisualWorkspace} from '../../common/comicVisualAssets';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const e=encodeURIComponent;
const base=(id:string)=>`/comic/projects/${e(id)}`;
export function createComicVisualAssetsApi(request:Request){return {
 workspace:(projectId:string,bibleEntityId:string)=>request<ComicVisualWorkspace>(`${base(projectId)}/visual-assets?bibleEntityId=${e(bibleEntityId)}`),
 upload:(projectId:string,input:ComicVisualUploadInput)=>request<ComicVisualUploadReceipt>(`${base(projectId)}/visual-assets`,{method:'POST',body:JSON.stringify(input)}),
 uploadOriginal:(projectId:string,key:string)=>request<ComicVisualUploadReceipt|null>(`${base(projectId)}/visual-asset-requests/${e(key)}`),
 adopt:(projectId:string,assetId:string,input:ComicVisualAdoptionInput)=>request<ComicVisualAdoptionReceipt>(`${base(projectId)}/visual-assets/${e(assetId)}/adoptions`,{method:'POST',body:JSON.stringify(input)}),
 adoptionOriginal:(projectId:string,key:string)=>request<ComicVisualAdoptionReceipt|null>(`${base(projectId)}/visual-asset-adoptions/${e(key)}`),
 imageUrl:(projectId:string,assetId:string,versionId:string)=>`/api/new-design${base(projectId)}/visual-assets/${e(assetId)}/versions/${e(versionId)}/content`,
};}

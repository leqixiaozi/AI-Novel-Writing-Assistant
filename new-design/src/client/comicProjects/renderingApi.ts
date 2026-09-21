import type {ImageConnectionCatalog} from '../../common/imageGeneration';
import type {ComicBibleRenderInput,ComicExportManifest,ComicExportManifestInput,ComicExportReceipt,ComicExportSubmitInput,ComicRenderAdoptionInput,ComicRenderAdoptionReceipt,ComicRenderBatch,ComicRenderBatchInput,ComicRenderWorkspace} from '../../common/comicRendering';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;const e=encodeURIComponent,base=(id:string)=>`/comic/projects/${e(id)}`;
export function createComicRenderingApi(request:Request){return{
 catalog:()=>request<ImageConnectionCatalog>('/models/image-generation/catalog'),
 workspace:(projectId:string,query:{episodeId?:string;bibleEntityId?:string;assetType?:string})=>request<ComicRenderWorkspace>(`${base(projectId)}/rendering?${new URLSearchParams(Object.entries(query).filter(([,value])=>Boolean(value)) as string[][])}`),
 startBatch:(projectId:string,input:ComicRenderBatchInput)=>request<ComicRenderBatch>(`${base(projectId)}/render-batches`,{method:'POST',body:JSON.stringify(input)}),
 startBible:(projectId:string,input:ComicBibleRenderInput)=>request<ComicRenderBatch>(`${base(projectId)}/bible-renders`,{method:'POST',body:JSON.stringify(input)}),
 batchOriginal:(projectId:string,key:string)=>request<ComicRenderBatch|null>(`${base(projectId)}/render-batches/${e(key)}`),
 adopt:(projectId:string,targetKind:'panel'|'bible',targetId:string,assetType:string,input:ComicRenderAdoptionInput)=>request<ComicRenderAdoptionReceipt>(`${base(projectId)}/render-targets/${targetKind}/${e(targetId)}/adoptions?assetType=${e(assetType)}`,{method:'POST',body:JSON.stringify(input)}),
 imageUrl:(projectId:string,versionId:string)=>`/api/new-design${base(projectId)}/render-versions/${e(versionId)}/content`,
 previewExport:(projectId:string,input:ComicExportManifestInput)=>request<ComicExportManifest>(`${base(projectId)}/export-manifests`,{method:'POST',body:JSON.stringify(input)}),
 createExport:(projectId:string,input:ComicExportSubmitInput)=>request<ComicExportReceipt>(`${base(projectId)}/exports`,{method:'POST',body:JSON.stringify(input)}),
 exports:(projectId:string)=>request<ComicExportReceipt[]>(`${base(projectId)}/exports`),
};}

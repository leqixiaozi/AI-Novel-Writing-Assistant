import type {WorldInstallInput,WorldInstallCommit,WorldInstallPreview,WorldInstallReceipt,WorldSyncInput,WorldSyncCommit,WorldSyncPreview,WorldSyncReceipt,WorldSyncWorkspace,WorldCatalogActionInput,WorldCatalogActionReceipt,WorldPackageCatalog} from '../../common/worldPackages';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createWorldPackagesApi(request:Request){const e=encodeURIComponent,base=(book:string)=>`/books/${e(book)}`,post=(body:unknown)=>({method:'POST',body:JSON.stringify(body)});return{
 catalog:(includeArchived=false)=>request<WorldPackageCatalog>(`/world-packages/catalog${includeArchived?'?includeArchived=true':''}`),
 availability:(root:string,input:WorldCatalogActionInput)=>request<WorldCatalogActionReceipt>(`/world-packages/catalog/${e(root)}/availability`,post(input)),
 availabilityOriginal:(root:string,input:WorldCatalogActionInput)=>request<WorldCatalogActionReceipt|null>(`/world-packages/catalog/${e(root)}/original-receipt`,post(input)),
 installFields:(book:string,type:string)=>request<{bookId:string;typeId:string;fields:import('../../common/contracts').FieldDefinition[]}>(`${base(book)}/world-packages/fields/${e(type)}`),
 libraryWorkspace:(book:string,root:string)=>request<import('../../common/worldPackages').WorldLibraryWorkspace>(`${base(book)}/world-library/workspace?rootCardId=${e(root)}`),
 libraryPreview:(book:string,input:import('../../common/worldPackages').WorldLibraryInput)=>request<import('../../common/worldPackages').WorldLibraryPreview>(`${base(book)}/world-library/preview`,post(input)),
 libraryPrepare:(book:string,input:import('../../common/worldPackages').WorldLibraryCommit)=>request<import('../../common/worldPackages').WorldLibraryReceipt>(`${base(book)}/world-library/prepare`,post(input)),
 libraryPublishPreview:(book:string,candidate:string)=>request<{candidate:import('../../common/worldPackages').WorldLibraryCandidate;previewHash:string}>(`${base(book)}/world-library/candidates/${e(candidate)}/preview`),
 libraryPublish:(book:string,input:import('../../common/worldPackages').WorldLibraryPublish)=>request<import('../../common/worldPackages').WorldLibraryReceipt>(`${base(book)}/world-library/publish`,post(input)),
 libraryOriginal:(book:string,input:import('../../common/worldPackages').WorldLibraryCommit|import('../../common/worldPackages').WorldLibraryPublish)=>request<import('../../common/worldPackages').WorldLibraryReceipt|null>(`${base(book)}/world-library/original-receipt`,post(input)),
 workspace:(book:string,root:string,pkg?:string)=>request<{capability:{installed:boolean;operational:boolean};workspace:WorldSyncWorkspace|null}>(`${base(book)}/world-sync/workspace?rootCardId=${e(root)}${pkg?`&packageId=${e(pkg)}`:''}`),
 history:(book:string,installation:string,before?:number)=>request<{items:WorldSyncReceipt[];nextSequence:number|null}>(`${base(book)}/world-sync/history?installationId=${e(installation)}${before!==undefined?`&before=${before}`:''}`),
 installPreview:(book:string,input:WorldInstallInput)=>request<WorldInstallPreview>(`${base(book)}/world-packages/preview`,post(input)),
 install:(book:string,input:WorldInstallCommit)=>request<WorldInstallReceipt>(`${base(book)}/world-packages/install`,post(input)),
 installOriginal:(book:string,input:WorldInstallCommit)=>request<WorldInstallReceipt|null>(`${base(book)}/world-packages/original-receipt`,post(input)),
 preview:(book:string,input:WorldSyncInput)=>request<WorldSyncPreview>(`${base(book)}/world-sync/preview`,post(input)),
 save:(book:string,input:WorldSyncCommit)=>request<WorldSyncReceipt>(`${base(book)}/world-sync/save`,post(input)),
 original:(book:string,input:WorldSyncCommit)=>request<WorldSyncReceipt|null>(`${base(book)}/world-sync/original-receipt`,post(input)),
};}

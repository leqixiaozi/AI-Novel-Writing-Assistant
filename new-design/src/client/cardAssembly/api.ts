import type {BookAssembly,BookAssemblyWorkspace,CardTemplateGraph,CardTemplateDefinition,CardTemplateVersion,MetaCardDefinition,MetaCardVersion} from '../../common/cardAssembly';
import type {TemplateGroupSummary,TemplateGroupVersion} from '../../common/contracts';
import type {FieldDefinition} from '../../common/contracts';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const send=(method:string,body:unknown):RequestInit=>({method,body:JSON.stringify(body)});

export function createCardAssemblyApi(request:Request){return{
  listMetaCards:()=>request<MetaCardDefinition[]>('/meta-cards'),
  saveMetaCard:(input:Partial<MetaCardDefinition>&{key:string;name:string;expectedRevision?:number})=>request<MetaCardDefinition>('/meta-cards',send('POST',input)),
  publishMetaCard:(id:string,expectedRevision:number)=>request<{definition:MetaCardDefinition;version:MetaCardVersion}>(`/meta-cards/${id}/publish`,send('POST',{expectedRevision})),
  metaVersions:(id:string)=>request<MetaCardVersion[]>(`/meta-cards/${id}/versions`),
  listCardTemplates:()=>request<CardTemplateDefinition[]>('/card-templates'),
  saveCardTemplate:(input:Partial<CardTemplateDefinition>&{key:string;name:string;expectedRevision?:number})=>request<CardTemplateDefinition>('/card-templates',send('POST',input)),
  publishCardTemplate:(id:string,expectedRevision:number)=>request<{definition:CardTemplateDefinition;version:CardTemplateVersion}>(`/card-templates/${id}/publish`,send('POST',{expectedRevision})),
  cardTemplateVersions:(id:string)=>request<CardTemplateVersion[]>(`/card-templates/${id}/versions`),
  relationTypes:()=>request<Array<{id:string;relation_key:string;name:string;direction:string}>>('/assembly-relation-types'),
  listBookTemplates:()=>request<TemplateGroupSummary[]>('/book-templates'),
  saveBookTemplate:(input:{id?:string;key:string;name:string;description:string;assembly:BookAssembly;expectedRevision?:number})=>request<TemplateGroupSummary>('/book-templates',send('POST',input)),
  publishBookTemplate:(id:string,expectedRevision:number)=>request<TemplateGroupSummary>(`/book-templates/${id}/publish`,send('POST',{expectedRevision})),
  bookTemplateVersions:(id:string)=>request<TemplateGroupVersion[]>(`/book-templates/${id}/versions`),
  bookTemplateRootFields:(versionId:string)=>request<{versionId:string;metaVersionId:string;fields:FieldDefinition[]}>(`/book-template-versions/${versionId}/root-fields`),
  bookTemplateImpact:(id:string,targetVersionId:string)=>request<Array<{bookId:string;bookName:string;fromTemplateVersionId:string;toTemplateVersionId:string;rootChanged:boolean;modulesChanged:boolean;standaloneChanged:boolean;relationsChanged:boolean;syncStatus:'awaiting_confirmation'}>>(`/book-templates/${id}/impact?targetVersionId=${encodeURIComponent(targetVersionId)}`),
  bookModuleInstances:(bookId:string)=>request<unknown[]>(`/books/${bookId}/module-instances`),
  addBookModuleInstance:(bookId:string,moduleRefNodeId:string)=>request<unknown>(`/books/${bookId}/module-instances`,send('POST',{moduleRefNodeId})),
  bookSlots:(bookId:string)=>request<unknown[]>(`/books/${bookId}/template-slots`),
  bookPendingRelations:(bookId:string)=>request<unknown[]>(`/books/${bookId}/template-relations`),
  bookWorkspace:(bookId:string)=>request<BookAssemblyWorkspace>(`/books/${bookId}/assembly`),
  fillSlot:(bookId:string,slotId:string,input:{expectedRevision:number;title:string;values:Record<string,unknown>})=>request<unknown>(`/books/${bookId}/template-slots/${slotId}/fill`,send('POST',input)),
  confirmRelation:(bookId:string,relationId:string,input:{expectedRevision:number;properties:Record<string,unknown>})=>request<unknown>(`/books/${bookId}/template-relations/${relationId}/confirm`,send('POST',input)),
  createInstanceRelation:(bookId:string,input:{fromSlotId:string;toSlotId:string;relationTypeVersionId:string;properties:Record<string,unknown>})=>request<unknown>(`/books/${bookId}/instance-relations`,send('POST',input)),
  reviseRoot:(bookId:string,input:{expectedBookRevision:number;expectedCardRevision:number;values:Record<string,unknown>})=>request<unknown>(`/books/${bookId}/root-card`,send('PATCH',input)),
}}
export type CardAssemblyApi=ReturnType<typeof createCardAssemblyApi>;
export type {BookAssembly,CardTemplateGraph};

import type {
  ApiEnvelope,
  AiAssistBatch,
  BookCreationMethod,
  BookCreationSession,
  BookSummary,
  BookChangeOperationKey,
  BookChangeSet,
  BookViewKey,
  BookViewWorkspace,
  CardGroupFormInstance,
  CardGroupFormSummary,
  CardGroupFormVersion,
  CardSummary,
  CardTypeCategory,
  CardTypeSummary,
  CardTypeVersion,
  CardVersion,
  DictionarySummary,
  InspirationCandidate,
  RelationTypeSummary,
  ResearchDocument,
  ResearchRecordDetail,
  ResearchRecordSummary,
  ResearchRecordType,
  MarketSourceDefinition,
  MarketScanDetail,
  BookAnalysisPlan,
  BookAnalysisPreset,
  BookAnalysisPurpose,
  ResearchReferencePack,
  ResearchReusePreview,
  BookResearchReference,
  ChapterBodyCreatorKind,
  ChapterBodySource,
  ChapterBodyVersion,
  ChapterDocumentDetail,
  ChapterDocumentSummary,
  ChapterTextAnchor,
  ResourceAdoption,
  StrategyResourceSummary,
  TemplateGroupSummary,
  TemplateGroupVersion,
  TemplateSyncPreview,
} from "../common/contracts";

const API_ROOT = "/api/new-design";

type FormInstanceSaveInput = Pick<CardGroupFormInstance, "spaceId" | "formVersionId" | "primaryCardId" | "title"> & {
  revision?: number;
  mounts: Array<Pick<CardGroupFormInstance["mounts"][number], "slotKey" | "cardId" | "sortOrder" | "localValues">>;
};

export class ApiError extends Error {
  constructor(message: string, public readonly issues: Record<string, string> = {}) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !envelope.success || envelope.data === undefined) {
    throw new ApiError(envelope.error ?? "请求失败，请稍后重试。", envelope.issues);
  }
  return envelope.data;
}

export const newDesignApi = {
  health: () => request<{ mode: "bundled" | "external"; postgresVersion: string; port: number }>("/health"),
  listCardTypes: (spaceId?: string) => request<CardTypeSummary[]>(`/card-types${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""}`),
  listCardTypeCategories: () => request<CardTypeCategory[]>("/card-type-categories"),
  createCardTypeCategory: (input:Pick<CardTypeCategory,"key"|"name"|"parentId"|"sortOrder">) => request<CardTypeCategory>("/card-type-categories",{method:"POST",body:JSON.stringify(input)}),
  createCardType: (input: Pick<CardTypeSummary, "key" | "name" | "description" | "categoryId" | "semanticCapabilities" | "draftFields"> & { spaceId?: string }) => request<CardTypeSummary>("/card-types", {
    method: "POST",
    body: JSON.stringify({ spaceId: input.spaceId, key: input.key, name: input.name, description: input.description, categoryId: input.categoryId, semanticCapabilities: input.semanticCapabilities, fields: input.draftFields }),
  }),
  updateCardType: (input: CardTypeSummary) => request<CardTypeSummary>(`/card-types/${input.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: input.name, description: input.description, categoryId: input.categoryId, semanticCapabilities: input.semanticCapabilities, fields: input.draftFields, revision: input.revision }),
  }),
  publishCardType: (id: string, revision: number) => request<CardTypeSummary>(`/card-types/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ revision }),
  }),
  listCardTypeVersions: (id: string) => request<CardTypeVersion[]>(`/card-types/${id}/versions`),
  listCards: (cardTypeId: string, archived: boolean, spaceId?: string) => request<CardSummary[]>(`/cards?cardTypeId=${encodeURIComponent(cardTypeId)}&archived=${archived}${spaceId ? `&spaceId=${encodeURIComponent(spaceId)}` : ""}`),
  createCard: (input: { cardTypeId: string; title: string; values: Record<string, unknown>; spaceId?: string }) => request<CardSummary>("/cards", {
    method: "POST", body: JSON.stringify(input),
  }),
  updateCard: (input: CardSummary) => request<CardSummary>(`/cards/${input.id}`, {
    method: "PATCH", body: JSON.stringify({ title: input.title, values: input.values, revision: input.revision }),
  }),
  archiveCard: (id: string, revision: number) => request<CardSummary>(`/cards/${id}/archive`, {
    method: "POST", body: JSON.stringify({ revision }),
  }),
  restoreCard: (id: string, revision: number) => request<CardSummary>(`/cards/${id}/restore`, {
    method: "POST", body: JSON.stringify({ revision }),
  }),
  listCardVersions: (id: string) => request<CardVersion[]>(`/cards/${id}/versions`),
  listDictionaries: (spaceId?:string) => request<DictionarySummary[]>(`/dictionaries${spaceId?`?spaceId=${encodeURIComponent(spaceId)}`:""}`),
  createDictionary: (input: Omit<DictionarySummary, "id" | "status" | "revision" | "createdAt" | "updatedAt">) => request<DictionarySummary>("/dictionaries", {
    method: "POST", body: JSON.stringify(input),
  }),
  updateDictionary: (input: DictionarySummary) => request<DictionarySummary>(`/dictionaries/${input.id}`, {
    method: "PATCH", body: JSON.stringify(input),
  }),
  listRelationTypes: (spaceId?:string) => request<RelationTypeSummary[]>(`/relation-types${spaceId?`?spaceId=${encodeURIComponent(spaceId)}`:""}`),
  createRelationType: (input: Omit<RelationTypeSummary, "id" | "status" | "revision" | "createdAt" | "updatedAt">) => request<RelationTypeSummary>("/relation-types", {
    method: "POST", body: JSON.stringify(input),
  }),
  updateRelationType: (input: RelationTypeSummary) => request<RelationTypeSummary>(`/relation-types/${input.id}`, {
    method: "PATCH", body: JSON.stringify(input),
  }),
  listCardGroupForms: (spaceId?:string) => request<CardGroupFormSummary[]>(`/card-group-forms${spaceId?`?spaceId=${encodeURIComponent(spaceId)}`:""}`),
  createCardGroupForm: (input: Pick<CardGroupFormSummary, "key" | "name" | "description" | "draftDefinition">) => request<CardGroupFormSummary>("/card-group-forms", {
    method: "POST", body: JSON.stringify({ key: input.key, name: input.name, description: input.description, definition: input.draftDefinition }),
  }),
  updateCardGroupForm: (input: CardGroupFormSummary) => request<CardGroupFormSummary>(`/card-group-forms/${input.id}`, {
    method: "PATCH", body: JSON.stringify({ key: input.key, name: input.name, description: input.description, definition: input.draftDefinition, revision: input.revision }),
  }),
  publishCardGroupForm: (id: string, revision: number) => request<CardGroupFormSummary>(`/card-group-forms/${id}/publish`, {
    method: "POST", body: JSON.stringify({ revision }),
  }),
  listCardGroupFormVersions: (id: string) => request<CardGroupFormVersion[]>(`/card-group-forms/${id}/versions`),
  listFormInstances: (spaceId: string, formId?: string) => request<CardGroupFormInstance[]>(`/form-instances?spaceId=${encodeURIComponent(spaceId)}${formId ? `&formId=${encodeURIComponent(formId)}` : ""}`),
  createFormInstance: (input: FormInstanceSaveInput) => request<CardGroupFormInstance>("/form-instances", {
    method: "POST", body: JSON.stringify(input),
  }),
  updateFormInstance: (id: string, input: FormInstanceSaveInput) => request<CardGroupFormInstance>(`/form-instances/${id}`, {
    method: "PATCH", body: JSON.stringify(input),
  }),
  listTemplates: () => request<TemplateGroupSummary[]>("/templates"),
  createTemplate: (input: Pick<TemplateGroupSummary, "key" | "name" | "description" | "draftConfig">) => request<TemplateGroupSummary>("/templates", { method:"POST",body:JSON.stringify(input) }),
  updateTemplate: (input: TemplateGroupSummary) => request<TemplateGroupSummary>(`/templates/${input.id}`, { method:"PATCH",body:JSON.stringify(input) }),
  publishTemplate: (id: string, revision: number) => request<TemplateGroupSummary>(`/templates/${id}/publish`, { method:"POST",body:JSON.stringify({revision}) }),
  listTemplateVersions: (id: string) => request<TemplateGroupVersion[]>(`/templates/${id}/versions`),
  listBooks: () => request<BookSummary[]>("/books"),
  getBook: (id: string) => request<BookSummary>(`/books/${id}`),
  getBookViewWorkspace:(bookId:string)=>request<BookViewWorkspace>(`/books/${bookId}/view-workspace`),
  previewBookChange:(bookId:string,operationKey:BookChangeOperationKey,input:Record<string,unknown>)=>request<BookChangeSet>(`/books/${bookId}/change-previews`,{method:"POST",body:JSON.stringify({operationKey,input})}),
  applyBookChange:(changeSetId:string)=>request<BookChangeSet>(`/book-change-sets/${changeSetId}/apply`,{method:"POST",body:"{}"}),
  saveBookViewConfig:(bookId:string,key:BookViewKey,input:{config:Record<string,unknown>;revision:number})=>request(`/books/${bookId}/view-config/${key}`,{method:"PUT",body:JSON.stringify(input)}),
  createBook: (input: {key:string;name:string;description:string;templateVersionId:string}) => request<BookSummary>("/books", {method:"POST",body:JSON.stringify(input)}),
  listInspirationCandidates: () => request<InspirationCandidate[]>("/book-creation/inspirations"),
  listStrategyResources: (input:{typeKey?:string;archived?:boolean;search?:string}={}) => {
    const params=new URLSearchParams();
    if(input.typeKey)params.set("typeKey",input.typeKey);
    if(input.archived)params.set("archived","true");
    if(input.search)params.set("search",input.search);
    const query=params.toString();
    return request<StrategyResourceSummary[]>(`/resources/strategies${query?`?${query}`:""}`);
  },
  installStrategyResource: (resourceId:string,bookId:string) => request<{resource:StrategyResourceSummary;target:CardSummary;adoption:ResourceAdoption}>(`/resources/strategies/${resourceId}/install`,{method:"POST",body:JSON.stringify({bookId})}),
  createBookCreationSession: (input: { method:BookCreationMethod;templateVersionId:string;bookName:string;description:string;sourceReference:string;inputPayload:Record<string,unknown>;researchVersionIds?:string[];researchPackVersionIds?:string[] }) => request<BookCreationSession>("/book-creation/sessions", {method:"POST",body:JSON.stringify(input)}),
  getBookCreationSession: (id:string) => request<BookCreationSession>(`/book-creation/sessions/${id}`),
  generateBookDirections: (id:string) => request<BookCreationSession>(`/book-creation/sessions/${id}/directions`, {method:"POST",body:"{}"}),
  selectBookDirection: (id:string,directionId:string) => request<BookCreationSession>(`/book-creation/sessions/${id}/select-direction`, {method:"POST",body:JSON.stringify({directionId})}),
  generateBookInitialContent: (id:string) => request<BookCreationSession>(`/book-creation/sessions/${id}/initial-content`, {method:"POST",body:"{}"}),
  completeBookCreation: (id:string,keepCurrentResult=false) => request<BookCreationSession>(`/book-creation/sessions/${id}/complete`, {method:"POST",body:JSON.stringify({keepCurrentResult})}),
  createFormAssist: (bookId:string,input:{cardId:string;formKey:string;formName:string;instruction:string;baseRevision:number}) => request<AiAssistBatch>(`/books/${bookId}/ai-assists`, {method:"POST",body:JSON.stringify(input)}),
  applyFormAssist: (batchId:string,fieldKeys:string[],expectedRevision:number) => request<CardSummary>(`/ai-assists/${batchId}/apply`, {method:"POST",body:JSON.stringify({fieldKeys,expectedRevision})}),
  previewBookSync: (bookId:string,targetVersionId:string) => request<TemplateSyncPreview>(`/books/${bookId}/sync-preview`,{method:"POST",body:JSON.stringify({targetVersionId})}),
  applyBookSync: (syncId:string) => request<TemplateSyncPreview>(`/book-syncs/${syncId}/apply`,{method:"POST",body:"{}"}),
  listResearchDocuments:()=>request<ResearchDocument[]>("/research/documents"),
  createResearchDocument:(input:{title:string;content:string;sourceKind:ResearchDocument["sourceKind"];sourceUrl:string})=>request<ResearchDocument>("/research/documents",{method:"POST",body:JSON.stringify(input)}),
  addResearchDocumentVersion:(id:string,content:string,revision:number)=>request<ResearchDocument>(`/research/documents/${id}/versions`,{method:"POST",body:JSON.stringify({content,revision})}),
  listResearchDocumentVersions:(id:string)=>request<ResearchDocument["currentVersion"][]>(`/research/documents/${id}/versions`),
  listResearchRecords:(input:{type?:ResearchRecordType;archived?:boolean;favorite?:boolean;search?:string}={})=>{const params=new URLSearchParams();if(input.type)params.set("type",input.type);if(input.archived)params.set("archived","true");if(input.favorite)params.set("favorite","true");if(input.search)params.set("search",input.search);const query=params.toString();return request<ResearchRecordSummary[]>(`/research/records${query?`?${query}`:""}`);},
  getResearchRecord:(id:string)=>request<ResearchRecordDetail>(`/research/records/${id}`),
  updateResearchRecord:(input:Pick<ResearchRecordSummary,"id"|"title"|"tags"|"favorite"|"notes"|"revision"|"status">)=>request<ResearchRecordSummary>(`/research/records/${input.id}`,{method:"PATCH",body:JSON.stringify(input)}),
  listMarketSources:()=>request<MarketSourceDefinition[]>("/research/market/sources"),
  startMarketScan:(sourceKeys:string[])=>request<{recordId:string;versionId:string;version:number}>("/research/market/scans",{method:"POST",body:JSON.stringify({sourceKeys})}),
  getMarketScan:(id:string,versionId?:string)=>request<MarketScanDetail>(`/research/market/scans/${id}${versionId?`?versionId=${encodeURIComponent(versionId)}`:""}`),
  retryMarketScan:(id:string)=>request<{recordId:string;versionId:string;version:number}>(`/research/market/scans/${id}/retry`,{method:"POST",body:"{}"}),
  cancelResearchRun:(versionId:string)=>request<{cancelRequested:boolean}>(`/research/runs/${versionId}/cancel`,{method:"POST",body:"{}"}),
  startMarketAnalysis:(input:{scanRecordId:string;scanVersionId?:string;itemIds:string[];focus:string;budgetTokens:number})=>request<{recordId:string;versionId:string;version:number}>("/research/market/analyses",{method:"POST",body:JSON.stringify(input)}),
  retryMarketAnalysis:(id:string)=>request<{recordId:string;versionId:string;version:number}>(`/research/market/analyses/${id}/retry`,{method:"POST",body:"{}"}),
  adoptMarketSignal:(candidateId:string)=>request<CardSummary>(`/research/market/signals/${candidateId}/adopt`,{method:"POST",body:"{}"}),
  getBookAnalysisPlan:(purpose:BookAnalysisPurpose,preset:BookAnalysisPreset)=>request<BookAnalysisPlan>(`/research/book-analysis/plan?purpose=${purpose}&preset=${preset}`),
  startBookAnalysis:(input:{documentVersionId:string;purpose:BookAnalysisPurpose;preset:BookAnalysisPreset;rangeMode:"full"|"range";startOffset?:number;endOffset?:number;focus:string;budgetTokens:number})=>request<{recordId:string;versionId:string;version:number}>("/research/book-analyses",{method:"POST",body:JSON.stringify(input)}),
  retryBookAnalysis:(id:string)=>request<{recordId:string;versionId:string;version:number}>(`/research/book-analyses/${id}/retry`,{method:"POST",body:"{}"}),
  applyResearchCandidates:(id:string,decisions:Array<{candidateId:string;action:"create_card"|"merge_card"|"save_resource"|"reference_only"|"ignore";targetSpaceId?:string;targetCardId?:string;expectedRevision?:number}>)=>request<Array<{candidateId:string;action:string;cardId:string|null}>>(`/research/book-analyses/${id}/candidates/apply`,{method:"POST",body:JSON.stringify({decisions})}),
  listReferencePacks:()=>request<ResearchReferencePack[]>("/research/reference-packs"),
  getReferencePack:(id:string)=>request<ResearchReferencePack>(`/research/reference-packs/${id}`),
  publishReferencePack:(input:{id?:string;name:string;description:string;note:string;revision?:number;items:Array<{researchVersionId:string;purpose:string;weight:number;note:string}>})=>request<ResearchReferencePack>("/research/reference-packs/publish",{method:"POST",body:JSON.stringify(input)}),
  previewResearchReuse:(input:{templateVersionId:string;researchVersionIds:string[];packVersionIds:string[];includeTemplateSeed:boolean})=>request<ResearchReusePreview>("/research/reuse-preview",{method:"POST",body:JSON.stringify(input)}),
  listBookResearchReferences:(bookId:string)=>request<BookResearchReference[]>(`/books/${bookId}/research-references`),
  listChapterDocuments:(bookId:string)=>request<ChapterDocumentSummary[]>(`/books/${bookId}/chapter-documents`),
  createChapterDocument:(bookId:string,input:{chapterCardId:string;logicalOrder:number;title:string})=>request<ChapterDocumentDetail>(`/books/${bookId}/chapter-documents`,{method:"POST",body:JSON.stringify(input)}),
  getChapterDocument:(id:string)=>request<ChapterDocumentDetail>(`/chapter-documents/${id}`),
  addChapterBodyVersion:(id:string,input:{content:string;source:ChapterBodySource;parentVersionId?:string|null;baseVersionId?:string|null;sourceRunId?:string|null;createdByKind:ChapterBodyCreatorKind;createdBy?:string})=>request<ChapterBodyVersion>(`/chapter-documents/${id}/versions`,{method:"POST",body:JSON.stringify(input)}),
  adoptChapterBodyVersion:(id:string,input:{versionId:string;expectedRevision:number;idempotencyKey:string;actor?:string})=>request<ChapterDocumentDetail>(`/chapter-documents/${id}/adopt`,{method:"POST",body:JSON.stringify(input)}),
  archiveChapterBodyVersion:(id:string,expectedRevision:number)=>request<ChapterDocumentDetail>(`/chapter-body-versions/${id}/archive`,{method:"POST",body:JSON.stringify({expectedRevision})}),
  createChapterTextAnchor:(bodyVersionId:string,input:{startOffset:number;endOffset:number;excerpt?:string;label:string;role?:string;subjectCardId?:string|null})=>request<ChapterTextAnchor>(`/chapter-body-versions/${bodyVersionId}/anchors`,{method:"POST",body:JSON.stringify(input)}),
};

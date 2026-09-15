import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z, ZodError, type ZodType } from "zod";
import type { ApiEnvelope, FieldDefinition } from "../../common/contracts";
import type { NewDesignAiGateway } from "../ai/gateway";
import {
  archiveCard,
  createCard,
  createCardType,
  getCard,
  getCardType,
  listCards,
  listCardTypeVersions,
  listCardTypes,
  listCardVersions,
  publishCardType,
  restoreCard,
  updateCard,
  updateCardType,
} from "../database/store";
import { getDatabaseRuntimeStatus, getPrivateRuntimeDiagnostics } from "../database/runtime";
import { archiveScopedField, createBookFieldExtension, createCardLocalField, listScopedFieldHistory, listScopedFields, previewFieldExtension, reviseCardLocalField } from "../database/fieldExtensions";
import { getPrivateRuntimeManager } from "../runtime";
import { scrub } from "../runtime/command";
import {
  applyBookSync,
  createBook,
  getBook,
  listBooks,
  listTemplates,
  listTemplateVersions,
  previewBookSync,
  publishTemplate,
  saveTemplate,
} from "../database/templateStore";
import {
  listCardGroupForms,
  listCardGroupFormVersions,
  listDictionaries,
  listFormInstances,
  listRelationTypes,
  publishCardGroupForm,
  saveCardGroupForm,
  saveDictionary,
  saveFormInstance,
  saveRelationType,
} from "../database/compositionStore";
import { NewDesignError } from "../domain/errors";
import { listCardTypeCategories, saveCardTypeCategory } from "../database/categoryStore";
import { installStrategyResource, listStrategyResources } from "../database/resourceStore";
import { getBookViewWorkspace, saveBookViewConfig } from "../database/bookViewStore";
import { addAssociationLocalField, addExistingAssociation, createAndAddAssociation, getAssociationWorkspace, listAssociationHistory, refreshAssociationSource, removeAssociation, reorderAssociations, saveAssociationLocalValues, searchAssociationCandidates } from "../database/associations";
import { archiveMaterialGroup, bulkChangeGroupMemberships, bulkChangeTagMemberships, confirmCardArchive, copySmartMaterialView, createMaterialGroup, createMaterialTag, createSmartMaterialView, getMaterialManagementWorkspace, previewCardArchive, queryMaterials, restoreArchivedCard, reviseMaterialGroup, reviseMaterialTag, reviseSmartMaterialView } from "../database/materialManagement";
import { applyBookChangeSet, previewBookChangeSet } from "../database/changeSetStore";
import { addResearchDocumentVersion, createResearchDocument, getResearchRecord, listResearchDocuments, listResearchDocumentVersions, listResearchRecords, updateResearchRecord } from "../database/researchStore";
import { adoptMarketSignal, getMarketScan, requestMarketScanCancellation } from "../database/marketStore";
import { applyCandidateDecisions, updateResearchCandidate } from "../database/bookAnalysisStore";
import { getReferencePack, listBookResearchReferences, listReferencePacks, previewResearchReuse, publishReferencePack } from "../database/referencePackStore";
import { addChapterBodyVersion, adoptChapterBodyVersion, archiveChapterBodyVersion, createChapterDocument, createChapterTextAnchor, getChapterDocument, listChapterDocuments } from "../database/chapterBodyStore";
import { getCanonicalFact, listCanonicalFacts, listFactConflicts, proposeCanonicalFact, resolveFactConflict, reviewCanonicalFact } from "../database/factStore";
import { commitChapterSettlement, createStateMilestone, editStateChangeProposal, getInitialState, getSettlement, getStateCapabilities, getStateValueMapping, listChapterSettlements, listCurrentState, listInitialStates, listStateChangeProposals, listStateMilestones, proposeStateChange, publishStateValueMapping, rebuildStateProjections, revertChapterSettlement, saveInitialState, saveStateRelationCapability, saveStateTypeCapability } from "../database/stateStore";
import { editKnowledgeStateProposal, getKnowledgeStateProposal, listCurrentKnowledgeState, listKnowledgeStateAt, listKnowledgeStateProposals, proposeKnowledgeState, rebuildKnowledgeState, reviewKnowledgeStateProposal } from "../database/knowledgeStore";
import { editStoryRelationProposal, editStoryTimeProposal, getStoryRelationProposal, getStoryTimeProposal, listCausalGraph, listConcurrentEvents, listCurrentStoryTimings, listStoryEventRelations, listStoryOccurrencesByChapter, listStoryRelationProposals, listStoryTimeProposals, listStoryTimingsInRange, listTemporalNeighbors, proposeStoryRelation, proposeStoryTime, reviewStoryRelationProposal, reviewStoryTimeProposal, saveStoryNarrativeOccurrence } from "../database/storyTimeline";
import { addPlanningVersion, adoptPlanningVersion, createPlanningObject, getAdoptedPlanningTree, getPlanningObject, getPlanningVersionContext, listPlanningAdoptions, listPlanningImpacts, listStalePlanningVersions, rejectPlanningVersion } from "../database/planning";
import { addModelRouteVersion, addPromptRecipeVersion, addTaskContractVersion, createContextManifest, createModelRouteConfig, createModelRouteSnapshot, createPromptRecipe, createTaskContract, getContextManifest, getModelCredentialRef, getModelRouteConfig, getModelRouteSnapshot, getPromptRecipe, getPublishedTaskContract, getTaskContract, listPromptRecipeDependencies, publishModelRouteVersion, publishPromptRecipeVersion, publishTaskContractVersion, rejectPromptRecipeVersion, rejectTaskContractVersion, resolveModelRoute, saveModelCredentialRef } from "../database/aiContracts";
import { createAiTask, decideAiApproval, failAiTaskAttempt, getAiTask, heartbeatAiTaskStep, listAiTasks, listFailedAiAttempts, listPendingAiApprovals, listRecoverableAiTasks, recordAiAttemptUsage, recoverExpiredAiTaskStep, requestAiApproval, startAiTaskAttempt, succeedAiTaskAttempt, summarizeAiUsage } from "../database/aiTasks";
import { createQualityAuditReport, decideQualityFixCandidate, getQualityAuditReport, getQualityFixCandidate, getQualityIssue, listQualityAuditReports, listQualityIssues, listQualityRechecks, recordQualityFixAdoption, recordQualityRecheck, reviseQualityFixCandidate, reviseQualityIssue, transitionQualityIssue } from "../database/qualityAudits";
import { acceptStaleDependency, completeDependencyRecompute, createDependencyEdge, endDependencyEdge, getDependencyBookSummary, getDependencyInvalidation, listCurrentDependencyStates, listDependencyConflicts, listDependencyHistory, listDependencyReceipts, listDependencyRecomputeRequests, listResourceDependencies, previewDependencyChange, recordDependencyInvalidation, registerDependencyResource, resolveDependencyConflict, startDependencyRecompute } from "../database/dependencies";
import { addAssetVersion, adoptAssetVersion, archiveAsset, completeAssetDerivation, createAsset, createAssetDerivation, createAssetMount, endAssetMount, getAsset, getAssetBookSummary, getAssetLineage, listAssetDerivations, listAssetMounts, listAssets, listAssetVersions, previewAssetAdoption, recordAssetIntegrityCheck, registerAssetContent, startAssetDerivation } from "../database/assets";
import { getGraphProjectionBatch, getGraphProjectionHealth, getGraphProjectionState, listGraphProjectionBatches, listGraphProjectionFailures, listGraphProjectionGenerations, listGraphProjectionMappings, listGraphProjectionRequests, processGraphProjectionRequest, rebuildGraphProjection, traverseGraph } from "../database/graph";
import { activateEmbeddingGeneration, addEmbeddingProfileVersion, archiveEmbeddingProfile, archiveEmbeddingSourceSnapshot, buildEmbeddingGeneration, completeChunking, completeEmbeddingAttempt, createEmbeddingProfile, createEmbeddingRequest, createEmbeddingSourceSnapshot, getEmbeddingCoverage, getEmbeddingProfile, getEmbeddingRequest, getSemanticRetrievalRun, listEmbeddingGenerations, listEmbeddingRequests, listEmbeddingStaleReasons, listSemanticRetrievalRuns, retrieveSemantic, startEmbeddingAttempt } from "../database/embeddings";
import { cancelBackgroundJobForBook, getBackgroundBookPause, getBackgroundJob, getBackgroundRuntimeHealth, listBackgroundJobs, listOutboxConsumers, listOutboxEvents, replayBackgroundJobForBook, retryBackgroundJobForBook, setBackgroundBookPause, setOutboxConsumerState } from "../database/outbox";
import type { TransferIngressAdapter } from "../transfers";
import { cancelTransferOperation, confirmTransferImport, getTransferAvailability, getTransferOperation, listTransferOperations, listTransferProfiles, requestImportDryRun, requestTransferExport, resolveTransferArtifactDownload, resolveTransferConflict } from "../transfers";
import { ensureResearchRecovery, listMarketSources, retryMarketAnalysis, retryMarketScan, startMarketAnalysis, startMarketScan } from "../research/marketService";
import { buildBookAnalysisPlan, retryBookAnalysis, startBookAnalysis } from "../research/bookAnalysisService";
import {
  applyFormAssist,
  beginFormAssist,
  beginSessionGeneration,
  completeBookCreation,
  createBookCreationSession,
  failFormAssist,
  failSessionGeneration,
  getBookCreationSession,
  getCardAssistContext,
  getSessionAiContext,
  listInspirationCandidates,
  saveDirectionCandidates,
  saveFormAssist,
  saveInitialCards,
  selectBookDirection,
} from "../database/bookCreationStore";
import {
  createCardSchema,
  createCardTypeSchema,
  cardGroupFormInputSchema,
  cardTypeCategoryInputSchema,
  applyFormAssistSchema,
  bookInputSchema,
  bookCreationSessionInputSchema,
  completeBookCreationSchema,
  dictionaryInputSchema,
  formInstanceInputSchema,
  formAssistSchema,
  relationTypeInputSchema,
  resourceInstallSchema,
  syncPreviewSchema,
  templateInputSchema,
  revisionSchema,
  selectDirectionSchema,
  updateCardSchema,
  updateCardTypeSchema,
  archiveScopedFieldSchema,
  createBookFieldExtensionSchema,
  createLocalFieldSchema,
  fieldExtensionPreviewSchema,
  reviseLocalFieldSchema,
  bookViewConfigSchema,
  bookViewKeySchema,
  bookChangePreviewSchema,
  researchDocumentInputSchema,
  researchDocumentVersionSchema,
  researchRecordTypeSchema,
  researchRecordMetadataSchema,
  marketScanInputSchema,
  marketAnalysisInputSchema,
  bookAnalysisInputSchema,
  bookAnalysisPresetSchema,
  bookAnalysisPurposeSchema,
  candidateDecisionsSchema,
  researchCandidateUpdateSchema,
  referencePackPublishSchema,
  researchReusePreviewSchema,
  chapterDocumentInputSchema,
  chapterBodyVersionInputSchema,
  chapterBodyAdoptionSchema,
  chapterBodyArchiveSchema,
  chapterTextAnchorInputSchema,
  canonicalFactInputSchema,
  canonicalFactReviewSchema,
  canonicalFactConflictReviewSchema,
  canonicalFactStatusSchema,
  stateTypeCapabilitySchema,
  stateRelationCapabilitySchema,
  initialStateInputSchema,
  stateChangeProposalInputSchema,
  stateChangeProposalEditSchema,
  chapterSettlementInputSchema,
  settlementRevertSchema,
  stateMilestoneInputSchema,
  stateValueMappingSchema,
  knowledgeStateProposalInputSchema,
  knowledgeStateProposalEditSchema,
  knowledgeStateReviewSchema,
  knowledgeStateStatusSchema,
  knowledgeStateAtQuerySchema,
  knowledgeHolderKindSchema,
  storyTimeProposalInputSchema,
  storyTimeProposalEditSchema,
  storyProposalReviewSchema,
  storyProposalStatusSchema,
  storyTimingRangeQuerySchema,
  storyNarrativeOccurrenceSchema,
  storyRelationProposalInputSchema,
  storyRelationProposalEditSchema,
  causalGraphQuerySchema,
  storyRelationFamilySchema,
  planningObjectInputSchema,
  planningVersionInputSchema,
  planningVersionRejectSchema,
  planningVersionAdoptSchema,
  planningImpactStatusSchema,
  promptRecipeCreateSchema,
  promptRecipeVersionSchema,
  taskContractCreateSchema,
  taskContractVersionSchema,
  contractPublishSchema,
  contractRejectSchema,
  contextManifestCreateSchema,
  modelCredentialRefSchema,
  modelRouteCreateSchema,
  modelRouteVersionSchema,
  modelRouteResolveSchema,
  aiTaskCreateSchema,
  aiAttemptStartSchema,
  aiStepHeartbeatSchema,
  aiAttemptSuccessSchema,
  aiAttemptFailureSchema,
  aiStepRecoverySchema,
  aiApprovalRequestSchema,
  aiApprovalDecisionSchema,
  aiAttemptUsageSchema,
  aiTaskListQuerySchema,
  aiFailureCategorySchema,
  qualityAuditReportCreateSchema,
  qualityIssueRevisionSchema,
  qualityIssueTransitionSchema,
  qualityFixRevisionSchema,
  qualityFixDecisionSchema,
  qualityFixAdoptionSchema,
  qualityRecheckSchema,
  qualityReportListQuerySchema,
  qualityIssueListQuerySchema,
  dependencyResourceRegisterSchema,
  dependencyEdgeCreateSchema,
  dependencyEdgeEndSchema,
  dependencyPreviewSchema,
  dependencyInvalidationSchema,
  dependencyGraphQuerySchema,
  dependencyStateQuerySchema,
  dependencyRecomputeQuerySchema,
  dependencyHistoryQuerySchema,
  dependencyConflictQuerySchema,
  dependencyConflictResolutionSchema,
  dependencyRecomputeCompletionSchema,
  dependencyStaleAcceptanceSchema,
  assetContentRegisterSchema,
  assetIntegrityCheckSchema,
  assetCreateSchema,
  assetVersionCreateSchema,
  assetPreviewSchema,
  assetAdoptSchema,
  assetArchiveSchema,
  assetMountCreateSchema,
  assetMountEndSchema,
  assetDerivationCreateSchema,
  assetDerivationStartSchema,
  assetDerivationCompleteSchema,
  assetListQuerySchema,
  assetMountListQuerySchema,
  assetDerivationListQuerySchema,
  graphProjectionRequestQuerySchema,
  graphProjectionListQuerySchema,
  graphProjectionMappingQuerySchema,
  graphProjectionRebuildSchema,
  graphTraversalSchema,
  embeddingProfileCreateSchema,
  embeddingProfileVersionSchema,
  embeddingProfileArchiveSchema,
  embeddingSourceSnapshotSchema,
  chunkingCompletionSchema,
  embeddingRequestCreateSchema,
  embeddingAttemptStartSchema,
  embeddingAttemptCompletionVerifiedSchema,
  embeddingGenerationCreateSchema,
  semanticRetrievalSchema,
  embeddingListQuerySchema,
  embeddingCoverageQuerySchema,
  embeddingRequestListQuerySchema,
  embeddingStaleListQuerySchema,
  embeddingSourceArchiveSchema,
  backgroundJobListQuerySchema,
  outboxEventListQuerySchema,
  backgroundJobCancelSchema,
  backgroundJobReplaySchema,
  outboxConsumerStateSchema,
  backgroundBookPauseSchema,
  transferExportRequestSchema,
  transferImportDryRunSchema,
  transferImportConfirmSchema,
  transferOperationListSchema,
  transferCancelSchema,
  transferConflictResolveSchema,
  associationSearchSchema,
  associationAddSchema,
  associationCreateAndAddSchema,
  associationRemoveSchema,
  associationReorderSchema,
  associationLocalValuesSchema,
  associationLocalFieldSchema,
  materialTagCreateSchema,
  materialTagRevisionSchema,
  materialMembershipSchema,
  materialGroupCreateSchema,
  materialGroupRevisionSchema,
  materialGroupArchiveSchema,
  smartViewCreateSchema,
  smartViewRevisionSchema,
  smartViewCopySchema,
  materialQuerySchema,
  cardArchivePreviewSchema,
  cardArchiveConfirmSchema,
  cardRestoreManagedSchema,
} from "../domain/validation";

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => void handler(req, res).catch(next);
}

function body<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.body);
}

function success<T>(res: Response, data: T, status = 200): void {
  const envelope: ApiEnvelope<T> = { success: true, data };
  res.status(status).json(envelope);
}

function zodIssues(error: ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]));
}

function normalizeFields(fields: Array<Omit<FieldDefinition, "defaultValue"> & { defaultValue?: unknown }>): FieldDefinition[] {
  return fields.map((field) => ({ ...field, defaultValue: field.defaultValue ?? null }));
}

const materialScopeSchema=z.object({bookId:z.string().uuid().optional(),spaceId:z.string().uuid().optional()}).refine(value=>Boolean(value.bookId)!==Boolean(value.spaceId),"必须且只能指定书籍或公共资源空间。");
function materialScope(req:Request):{bookId?:string;spaceId?:string}{return materialScopeSchema.parse({bookId:typeof req.query.bookId==="string"?req.query.bookId:undefined,spaceId:typeof req.query.spaceId==="string"?req.query.spaceId:undefined});}

export function createNewDesignRouter(dependencies: { ai?: NewDesignAiGateway; transferIngress?:TransferIngressAdapter } = {}): Router {
  const router = Router();
  router.use((_req,_res,next)=>{void ensureResearchRecovery().then(()=>next(),next);});

  router.get("/health", asyncRoute(async (_req, res) => {
    success(res, await getDatabaseRuntimeStatus());
  }));

  router.get("/card-types", asyncRoute(async (req, res) => success(res, await listCardTypes(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.get("/card-type-categories", asyncRoute(async (_req, res) => success(res, await listCardTypeCategories())));
  router.post("/card-type-categories", asyncRoute(async (req, res) => success(res, await saveCardTypeCategory(body(cardTypeCategoryInputSchema, req)), 201)));
  router.patch("/card-type-categories/:id", asyncRoute(async (req, res) => success(res, await saveCardTypeCategory({ ...body(cardTypeCategoryInputSchema, req), id: String(req.params.id) }))));
  router.post("/card-types", asyncRoute(async (req, res) => {
    const input = body(createCardTypeSchema, req);
    success(res, await createCardType({ ...input, fields: normalizeFields(input.fields) }, input.spaceId), 201);
  }));
  router.get("/card-types/:id", asyncRoute(async (req, res) => success(res, await getCardType(String(req.params.id)))));
  router.patch("/card-types/:id", asyncRoute(async (req, res) => {
    const input = body(updateCardTypeSchema, req);
    success(res, await updateCardType(String(req.params.id), { ...input, fields: normalizeFields(input.fields) }));
  }));
  router.post("/card-types/:id/publish", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await publishCardType(String(req.params.id), input.revision));
  }));
  router.get("/card-types/:id/versions", asyncRoute(async (req, res) => success(res, await listCardTypeVersions(String(req.params.id)))));

  router.get("/cards", asyncRoute(async (req, res) => {
    success(res, await listCards({
      cardTypeId: typeof req.query.cardTypeId === "string" ? req.query.cardTypeId : undefined,
      archived: req.query.archived === "true",
      spaceId: typeof req.query.spaceId === "string" ? req.query.spaceId : undefined,
    }));
  }));
  router.post("/cards", asyncRoute(async (req, res) => success(res, await createCard(body(createCardSchema, req)), 201)));
  router.get("/cards/:id", asyncRoute(async (req, res) => success(res, await getCard(String(req.params.id)))));
  router.patch("/cards/:id", asyncRoute(async (req, res) => success(res, await updateCard(String(req.params.id), body(updateCardSchema, req)))));
  router.post("/cards/:id/archive", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await archiveCard(String(req.params.id), input.revision));
  }));
  router.post("/cards/:id/restore", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await restoreCard(String(req.params.id), input.revision));
  }));
  router.get("/cards/:id/versions", asyncRoute(async (req, res) => success(res, await listCardVersions(String(req.params.id)))));

  router.get("/books/:bookId/field-definitions", asyncRoute(async(req,res)=>{
    const cardTypeId=typeof req.query.cardTypeId==="string"?req.query.cardTypeId:"";
    if(!cardTypeId)throw new NewDesignError("缺少内容类型。",422);
    success(res,await listScopedFields(String(req.params.bookId),cardTypeId,typeof req.query.cardId==="string"?req.query.cardId:undefined));
  }));
  router.get("/books/:bookId/field-definitions/:fieldId/history",asyncRoute(async(req,res)=>success(res,await listScopedFieldHistory(String(req.params.bookId),String(req.params.fieldId)))));
  router.post("/books/:bookId/field-extensions/preview",asyncRoute(async(req,res)=>success(res,await previewFieldExtension(String(req.params.bookId),body(fieldExtensionPreviewSchema,req)))));
  router.post("/books/:bookId/field-extensions",asyncRoute(async(req,res)=>success(res,await createBookFieldExtension(String(req.params.bookId),body(createBookFieldExtensionSchema,req)),201)));
  router.post("/books/:bookId/cards/:cardId/local-fields",asyncRoute(async(req,res)=>success(res,await createCardLocalField(String(req.params.bookId),String(req.params.cardId),body(createLocalFieldSchema,req)),201)));
  router.patch("/books/:bookId/field-definitions/:fieldId",asyncRoute(async(req,res)=>success(res,await reviseCardLocalField(String(req.params.bookId),String(req.params.fieldId),body(reviseLocalFieldSchema,req)))));
  router.post("/books/:bookId/field-definitions/:fieldId/archive",asyncRoute(async(req,res)=>success(res,await archiveScopedField(String(req.params.bookId),String(req.params.fieldId),body(archiveScopedFieldSchema,req)))));

  router.get("/dictionaries", asyncRoute(async (req, res) => success(res, await listDictionaries(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/dictionaries", asyncRoute(async (req, res) => success(res, await saveDictionary(body(dictionaryInputSchema, req)), 201)));
  router.patch("/dictionaries/:id", asyncRoute(async (req, res) => {
    const input = body(dictionaryInputSchema, req);
    success(res, await saveDictionary({ ...input, id: String(req.params.id) }));
  }));

  router.get("/relation-types", asyncRoute(async (req, res) => success(res, await listRelationTypes(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/relation-types", asyncRoute(async (req, res) => success(res, await saveRelationType(body(relationTypeInputSchema, req)), 201)));
  router.patch("/relation-types/:id", asyncRoute(async (req, res) => {
    const input = body(relationTypeInputSchema, req);
    success(res, await saveRelationType({ ...input, id: String(req.params.id), revision: input.revision ?? 0 }));
  }));

  router.get("/card-group-forms", asyncRoute(async (req, res) => success(res, await listCardGroupForms(typeof req.query.spaceId === "string" ? req.query.spaceId : undefined))));
  router.post("/card-group-forms", asyncRoute(async (req, res) => success(res, await saveCardGroupForm(body(cardGroupFormInputSchema, req)), 201)));
  router.patch("/card-group-forms/:id", asyncRoute(async (req, res) => {
    const input = body(cardGroupFormInputSchema, req);
    success(res, await saveCardGroupForm({ ...input, id: String(req.params.id) }));
  }));
  router.post("/card-group-forms/:id/publish", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await publishCardGroupForm(String(req.params.id), input.revision));
  }));
  router.get("/card-group-forms/:id/versions", asyncRoute(async (req, res) => success(res, await listCardGroupFormVersions(String(req.params.id)))));

  router.get("/form-instances", asyncRoute(async (req, res) => {
    if (typeof req.query.spaceId !== "string") throw new NewDesignError("缺少数据空间。", 422);
    success(res, await listFormInstances(req.query.spaceId, typeof req.query.formId === "string" ? req.query.formId : undefined));
  }));
  router.post("/form-instances", asyncRoute(async (req, res) => success(res, await saveFormInstance(body(formInstanceInputSchema, req)), 201)));
  router.patch("/form-instances/:id", asyncRoute(async (req, res) => {
    const input = body(formInstanceInputSchema, req);
    success(res, await saveFormInstance({ ...input, id: String(req.params.id) }));
  }));

  router.get("/templates", asyncRoute(async (_req, res) => success(res, await listTemplates())));
  router.post("/templates", asyncRoute(async (req, res) => success(res, await saveTemplate(body(templateInputSchema, req)), 201)));
  router.patch("/templates/:id", asyncRoute(async (req, res) => {
    const input = body(templateInputSchema, req);
    success(res, await saveTemplate({ ...input, id: String(req.params.id) }));
  }));
  router.post("/templates/:id/publish", asyncRoute(async (req, res) => {
    const input = body(revisionSchema, req);
    success(res, await publishTemplate(String(req.params.id), input.revision));
  }));
  router.get("/templates/:id/versions", asyncRoute(async (req, res) => success(res, await listTemplateVersions(String(req.params.id)))));

  router.get("/books", asyncRoute(async (_req, res) => success(res, await listBooks())));
  router.post("/books", asyncRoute(async (req, res) => success(res, await createBook(body(bookInputSchema, req)), 201)));
  router.get("/books/:id", asyncRoute(async (req, res) => success(res, await getBook(String(req.params.id)))));
  router.get("/books/:id/view-workspace", asyncRoute(async (req,res)=>success(res,await getBookViewWorkspace(String(req.params.id)))));
  router.get("/material-management/workspace",asyncRoute(async(req,res)=>success(res,await getMaterialManagementWorkspace(materialScope(req)))));
  router.post("/material-management/query",asyncRoute(async(req,res)=>success(res,await queryMaterials(materialScope(req),body(materialQuerySchema,req)))));
  router.post("/material-management/tags",asyncRoute(async(req,res)=>success(res,await createMaterialTag(materialScope(req),body(materialTagCreateSchema,req)),201)));
  router.patch("/material-management/tags/:id",asyncRoute(async(req,res)=>success(res,await reviseMaterialTag(materialScope(req),String(req.params.id),body(materialTagRevisionSchema,req)))));
  router.post("/material-management/tags/:id/archive",asyncRoute(async(req,res)=>success(res,await reviseMaterialTag(materialScope(req),String(req.params.id),body(materialTagRevisionSchema,req),"archived"))));
  router.post("/material-management/tags/:id/memberships",asyncRoute(async(req,res)=>{const input=body(materialMembershipSchema,req);success(res,await bulkChangeTagMemberships(materialScope(req),{tagId:String(req.params.id),...input}));}));
  router.post("/material-management/groups",asyncRoute(async(req,res)=>success(res,await createMaterialGroup(materialScope(req),body(materialGroupCreateSchema,req)),201)));
  router.patch("/material-management/groups/:id",asyncRoute(async(req,res)=>success(res,await reviseMaterialGroup(materialScope(req),String(req.params.id),body(materialGroupRevisionSchema,req)))));
  router.post("/material-management/groups/:id/archive",asyncRoute(async(req,res)=>success(res,await archiveMaterialGroup(materialScope(req),String(req.params.id),body(materialGroupArchiveSchema,req)))));
  router.post("/material-management/groups/:id/memberships",asyncRoute(async(req,res)=>{const input=body(materialMembershipSchema,req);success(res,await bulkChangeGroupMemberships(materialScope(req),{groupId:String(req.params.id),...input}));}));
  router.post("/material-management/views",asyncRoute(async(req,res)=>success(res,await createSmartMaterialView(materialScope(req),body(smartViewCreateSchema,req)),201)));
  router.patch("/material-management/views/:id",asyncRoute(async(req,res)=>success(res,await reviseSmartMaterialView(materialScope(req),String(req.params.id),body(smartViewRevisionSchema,req)))));
  router.post("/material-management/views/:id/archive",asyncRoute(async(req,res)=>success(res,await reviseSmartMaterialView(materialScope(req),String(req.params.id),body(smartViewRevisionSchema,req),"archived"))));
  router.post("/material-management/views/:id/copy",asyncRoute(async(req,res)=>success(res,await copySmartMaterialView(materialScope(req),String(req.params.id),body(smartViewCopySchema,req)),201)));
  router.post("/material-management/cards/:id/archive-preview",asyncRoute(async(req,res)=>success(res,await previewCardArchive(materialScope(req),String(req.params.id),body(cardArchivePreviewSchema,req)),201)));
  router.post("/material-management/cards/:id/archive",asyncRoute(async(req,res)=>success(res,await confirmCardArchive(materialScope(req),String(req.params.id),body(cardArchiveConfirmSchema,req)))));
  router.post("/material-management/cards/:id/restore",asyncRoute(async(req,res)=>success(res,await restoreArchivedCard(materialScope(req),String(req.params.id),body(cardRestoreManagedSchema,req)))));
  router.get("/books/:bookId/cards/:cardId/associations",asyncRoute(async(req,res)=>success(res,await getAssociationWorkspace(String(req.params.bookId),String(req.params.cardId)))));
  router.get("/books/:bookId/cards/:cardId/association-candidates",asyncRoute(async(req,res)=>success(res,await searchAssociationCandidates(String(req.params.bookId),String(req.params.cardId),associationSearchSchema.parse(req.query)))));
  router.post("/books/:bookId/cards/:cardId/associations",asyncRoute(async(req,res)=>success(res,await addExistingAssociation(String(req.params.bookId),String(req.params.cardId),body(associationAddSchema,req)),201)));
  router.post("/books/:bookId/cards/:cardId/associations/create",asyncRoute(async(req,res)=>success(res,await createAndAddAssociation(String(req.params.bookId),String(req.params.cardId),body(associationCreateAndAddSchema,req)),201)));
  router.post("/books/:bookId/cards/:cardId/associations/reorder",asyncRoute(async(req,res)=>success(res,await reorderAssociations(String(req.params.bookId),String(req.params.cardId),body(associationReorderSchema,req)))));
  router.post("/books/:bookId/associations/:mountId/remove",asyncRoute(async(req,res)=>success(res,await removeAssociation(String(req.params.bookId),String(req.params.mountId),body(associationRemoveSchema,req)))));
  router.post("/books/:bookId/associations/:mountId/restore",asyncRoute(async(req,res)=>success(res,await removeAssociation(String(req.params.bookId),String(req.params.mountId),body(associationRemoveSchema,req),true))));
  router.post("/books/:bookId/associations/:mountId/refresh-source",asyncRoute(async(req,res)=>success(res,await refreshAssociationSource(String(req.params.bookId),String(req.params.mountId),body(associationRemoveSchema,req)))));
  router.patch("/books/:bookId/associations/:mountId/local-values",asyncRoute(async(req,res)=>success(res,await saveAssociationLocalValues(String(req.params.bookId),String(req.params.mountId),body(associationLocalValuesSchema,req)))));
  router.post("/books/:bookId/associations/:mountId/local-fields",asyncRoute(async(req,res)=>success(res,await addAssociationLocalField(String(req.params.bookId),String(req.params.mountId),body(associationLocalFieldSchema,req)),201)));
  router.get("/books/:bookId/associations/:mountId/history",asyncRoute(async(req,res)=>success(res,await listAssociationHistory(String(req.params.bookId),String(req.params.mountId)))));
  router.put("/books/:id/view-config/:key",asyncRoute(async(req,res)=>success(res,await saveBookViewConfig(String(req.params.id),bookViewKeySchema.parse(req.params.key),body(bookViewConfigSchema,req)))));
  router.post("/books/:id/change-previews",asyncRoute(async(req,res)=>success(res,await previewBookChangeSet(String(req.params.id),body(bookChangePreviewSchema,req)),201)));
  router.post("/book-change-sets/:id/apply",asyncRoute(async(req,res)=>success(res,await applyBookChangeSet(String(req.params.id)))));
  router.get("/research/documents",asyncRoute(async(_req,res)=>success(res,await listResearchDocuments())));
  router.post("/research/documents",asyncRoute(async(req,res)=>success(res,await createResearchDocument(body(researchDocumentInputSchema,req)),201)));
  router.post("/research/documents/:id/versions",asyncRoute(async(req,res)=>success(res,await addResearchDocumentVersion(String(req.params.id),body(researchDocumentVersionSchema,req)),201)));
  router.get("/research/documents/:id/versions",asyncRoute(async(req,res)=>success(res,await listResearchDocumentVersions(String(req.params.id)))));
  router.get("/research/records",asyncRoute(async(req,res)=>success(res,await listResearchRecords({type:typeof req.query.type==="string"?researchRecordTypeSchema.parse(req.query.type):undefined,archived:req.query.archived==="true",favorite:req.query.favorite==="true",search:typeof req.query.search==="string"?req.query.search:undefined}))));
  router.get("/research/records/:id",asyncRoute(async(req,res)=>success(res,await getResearchRecord(String(req.params.id)))));
  router.patch("/research/records/:id",asyncRoute(async(req,res)=>success(res,await updateResearchRecord(String(req.params.id),body(researchRecordMetadataSchema,req)))));
  router.get("/research/market/sources",asyncRoute(async(_req,res)=>success(res,listMarketSources())));
  router.post("/research/market/scans",asyncRoute(async(req,res)=>success(res,await startMarketScan(body(marketScanInputSchema,req)),202)));
  router.get("/research/market/scans/:id",asyncRoute(async(req,res)=>success(res,await getMarketScan(String(req.params.id),typeof req.query.versionId==="string"?req.query.versionId:undefined))));
  router.post("/research/market/scans/:id/retry",asyncRoute(async(req,res)=>success(res,await retryMarketScan(String(req.params.id)),202)));
  router.post("/research/runs/:id/cancel",asyncRoute(async(req,res)=>{await requestMarketScanCancellation(String(req.params.id));success(res,{cancelRequested:true});}));
  router.post("/research/market/analyses",asyncRoute(async(req,res)=>{if(!dependencies.ai)throw new NewDesignError("尚未配置新设计 AI 网关，不能开始市场分析。",503);success(res,await startMarketAnalysis(dependencies.ai,body(marketAnalysisInputSchema,req)),202);}));
  router.post("/research/market/analyses/:id/retry",asyncRoute(async(req,res)=>{if(!dependencies.ai)throw new NewDesignError("尚未配置新设计 AI 网关，不能开始市场分析。",503);success(res,await retryMarketAnalysis(dependencies.ai,String(req.params.id)),202);}));
  router.post("/research/market/signals/:id/adopt",asyncRoute(async(req,res)=>success(res,await adoptMarketSignal(String(req.params.id)),201)));
  router.get("/research/book-analysis/plan",asyncRoute(async(req,res)=>success(res,(await buildBookAnalysisPlan(bookAnalysisPurposeSchema.parse(req.query.purpose),bookAnalysisPresetSchema.parse(req.query.preset))).plan)));
  router.post("/research/book-analyses",asyncRoute(async(req,res)=>{if(!dependencies.ai)throw new NewDesignError("尚未配置新设计 AI 网关，不能开始拆书。",503);success(res,await startBookAnalysis(dependencies.ai,body(bookAnalysisInputSchema,req)),202);}));
  router.post("/research/book-analyses/:id/retry",asyncRoute(async(req,res)=>{if(!dependencies.ai)throw new NewDesignError("尚未配置新设计 AI 网关，不能重试拆书。",503);success(res,await retryBookAnalysis(dependencies.ai,String(req.params.id)),202);}));
  router.post("/research/book-analyses/:id/candidates/apply",asyncRoute(async(req,res)=>success(res,await applyCandidateDecisions(String(req.params.id),body(candidateDecisionsSchema,req).decisions))));
  router.put("/research/book-analyses/:id/candidates/:candidateId",asyncRoute(async(req,res)=>success(res,await updateResearchCandidate(String(req.params.id),String(req.params.candidateId),body(researchCandidateUpdateSchema,req)))));
  router.get("/research/reference-packs",asyncRoute(async(_req,res)=>success(res,await listReferencePacks())));
  router.get("/research/reference-packs/:id",asyncRoute(async(req,res)=>success(res,await getReferencePack(String(req.params.id)))));
  router.post("/research/reference-packs/publish",asyncRoute(async(req,res)=>success(res,await publishReferencePack(body(referencePackPublishSchema,req)),201)));
  router.post("/research/reuse-preview",asyncRoute(async(req,res)=>success(res,await previewResearchReuse(body(researchReusePreviewSchema,req)))));
  router.get("/books/:id/research-references",asyncRoute(async(req,res)=>success(res,await listBookResearchReferences(String(req.params.id)))));
  router.get("/books/:id/chapter-documents",asyncRoute(async(req,res)=>success(res,await listChapterDocuments(String(req.params.id)))));
  router.post("/books/:id/chapter-documents",asyncRoute(async(req,res)=>success(res,await createChapterDocument({bookId:String(req.params.id),...body(chapterDocumentInputSchema,req)}),201)));
  router.get("/chapter-documents/:id",asyncRoute(async(req,res)=>success(res,await getChapterDocument(String(req.params.id)))));
  router.post("/chapter-documents/:id/versions",asyncRoute(async(req,res)=>success(res,await addChapterBodyVersion(String(req.params.id),body(chapterBodyVersionInputSchema,req)),201)));
  router.post("/chapter-documents/:id/adopt",asyncRoute(async(req,res)=>success(res,await adoptChapterBodyVersion(String(req.params.id),body(chapterBodyAdoptionSchema,req)))));
  router.post("/chapter-body-versions/:id/archive",asyncRoute(async(req,res)=>success(res,await archiveChapterBodyVersion(String(req.params.id),body(chapterBodyArchiveSchema,req)))));
  router.post("/chapter-body-versions/:id/anchors",asyncRoute(async(req,res)=>success(res,await createChapterTextAnchor({bodyVersionId:String(req.params.id),...body(chapterTextAnchorInputSchema,req)}),201)));
  router.get("/books/:id/facts",asyncRoute(async(req,res)=>success(res,await listCanonicalFacts(String(req.params.id),typeof req.query.status==="string"?canonicalFactStatusSchema.parse(req.query.status):undefined))));
  router.post("/books/:id/facts",asyncRoute(async(req,res)=>success(res,await proposeCanonicalFact({bookId:String(req.params.id),...body(canonicalFactInputSchema,req)}),201)));
  router.get("/facts/:id",asyncRoute(async(req,res)=>success(res,await getCanonicalFact(String(req.params.id)))));
  router.post("/facts/:id/review",asyncRoute(async(req,res)=>success(res,await reviewCanonicalFact(String(req.params.id),body(canonicalFactReviewSchema,req)))));
  router.get("/books/:id/fact-conflicts",asyncRoute(async(req,res)=>success(res,await listFactConflicts(String(req.params.id)))));
  router.post("/fact-conflicts/:id/review",asyncRoute(async(req,res)=>success(res,await resolveFactConflict(String(req.params.id),body(canonicalFactConflictReviewSchema,req)))));
  router.get("/spaces/:id/state-capabilities",asyncRoute(async(req,res)=>success(res,await getStateCapabilities(String(req.params.id)))));
  router.put("/spaces/:id/state-capabilities/types",asyncRoute(async(req,res)=>success(res,await saveStateTypeCapability(String(req.params.id),body(stateTypeCapabilitySchema,req)))));
  router.put("/spaces/:id/state-capabilities/relations",asyncRoute(async(req,res)=>success(res,await saveStateRelationCapability(String(req.params.id),body(stateRelationCapabilitySchema,req)))));
  router.get("/books/:id/initial-states",asyncRoute(async(req,res)=>success(res,await listInitialStates(String(req.params.id)))));
  router.post("/books/:id/initial-states",asyncRoute(async(req,res)=>success(res,await saveInitialState({bookId:String(req.params.id),...body(initialStateInputSchema,req)}),201)));
  router.get("/initial-states/:id",asyncRoute(async(req,res)=>success(res,await getInitialState(String(req.params.id)))));
  router.get("/chapter-documents/:id/state-change-proposals",asyncRoute(async(req,res)=>success(res,await listStateChangeProposals(String(req.params.id)))));
  router.post("/books/:id/state-change-proposals",asyncRoute(async(req,res)=>success(res,await proposeStateChange({bookId:String(req.params.id),...body(stateChangeProposalInputSchema,req)}),201)));
  router.put("/state-change-proposals/:id",asyncRoute(async(req,res)=>success(res,await editStateChangeProposal(String(req.params.id),body(stateChangeProposalEditSchema,req)))));
  router.post("/books/:id/chapter-settlements",asyncRoute(async(req,res)=>success(res,await commitChapterSettlement({bookId:String(req.params.id),...body(chapterSettlementInputSchema,req)}),201)));
  router.get("/chapter-documents/:id/settlements",asyncRoute(async(req,res)=>success(res,await listChapterSettlements(String(req.params.id)))));
  router.get("/chapter-settlements/:id",asyncRoute(async(req,res)=>success(res,await getSettlement(String(req.params.id)))));
  router.post("/chapter-settlements/:id/revert",asyncRoute(async(req,res)=>success(res,await revertChapterSettlement(String(req.params.id),body(settlementRevertSchema,req)))));
  router.get("/books/:id/current-state",asyncRoute(async(req,res)=>success(res,await listCurrentState(String(req.params.id)))));
  router.post("/books/:id/current-state/rebuild",asyncRoute(async(req,res)=>success(res,await rebuildStateProjections(String(req.params.id)))));
  router.get("/books/:id/state-milestones",asyncRoute(async(req,res)=>success(res,await listStateMilestones(String(req.params.id)))));
  router.post("/books/:id/state-milestones",asyncRoute(async(req,res)=>success(res,await createStateMilestone({bookId:String(req.params.id),...body(stateMilestoneInputSchema,req)}),201)));
  router.post("/state-value-mappings/publish",asyncRoute(async(req,res)=>success(res,await publishStateValueMapping(body(stateValueMappingSchema,req)),201)));
  router.get("/state-value-mappings/:id",asyncRoute(async(req,res)=>success(res,await getStateValueMapping(String(req.params.id)))));
  router.get("/books/:id/knowledge-proposals",asyncRoute(async(req,res)=>success(res,await listKnowledgeStateProposals(String(req.params.id),typeof req.query.status==="string"?knowledgeStateStatusSchema.parse(req.query.status):undefined))));
  router.post("/books/:id/knowledge-proposals",asyncRoute(async(req,res)=>success(res,await proposeKnowledgeState({bookId:String(req.params.id),...body(knowledgeStateProposalInputSchema,req)}),201)));
  router.get("/knowledge-proposals/:id",asyncRoute(async(req,res)=>success(res,await getKnowledgeStateProposal(String(req.params.id)))));
  router.put("/knowledge-proposals/:id",asyncRoute(async(req,res)=>success(res,await editKnowledgeStateProposal(String(req.params.id),body(knowledgeStateProposalEditSchema,req)))));
  router.post("/knowledge-proposals/:id/review",asyncRoute(async(req,res)=>success(res,await reviewKnowledgeStateProposal(String(req.params.id),body(knowledgeStateReviewSchema,req)))));
  router.get("/books/:id/current-knowledge",asyncRoute(async(req,res)=>success(res,await listCurrentKnowledgeState(String(req.params.id),typeof req.query.holderKind==="string"?knowledgeHolderKindSchema.parse(req.query.holderKind):undefined,typeof req.query.holderKey==="string"?req.query.holderKey:undefined))));
  router.get("/books/:id/knowledge-at",asyncRoute(async(req,res)=>success(res,await listKnowledgeStateAt(String(req.params.id),knowledgeStateAtQuerySchema.parse(req.query)))));
  router.post("/books/:id/current-knowledge/rebuild",asyncRoute(async(req,res)=>success(res,await rebuildKnowledgeState(String(req.params.id)))));
  router.get("/books/:id/story-time-proposals",asyncRoute(async(req,res)=>success(res,await listStoryTimeProposals(String(req.params.id),typeof req.query.status==="string"?storyProposalStatusSchema.parse(req.query.status):undefined))));
  router.post("/books/:id/story-time-proposals",asyncRoute(async(req,res)=>success(res,await proposeStoryTime({bookId:String(req.params.id),...body(storyTimeProposalInputSchema,req)}),201)));
  router.get("/story-time-proposals/:id",asyncRoute(async(req,res)=>success(res,await getStoryTimeProposal(String(req.params.id)))));
  router.put("/story-time-proposals/:id",asyncRoute(async(req,res)=>success(res,await editStoryTimeProposal(String(req.params.id),body(storyTimeProposalEditSchema,req)))));
  router.post("/story-time-proposals/:id/review",asyncRoute(async(req,res)=>success(res,await reviewStoryTimeProposal(String(req.params.id),body(storyProposalReviewSchema,req)))));
  router.get("/books/:id/story-timings",asyncRoute(async(req,res)=>success(res,Object.keys(req.query).length?await listStoryTimingsInRange(String(req.params.id),storyTimingRangeQuerySchema.parse(req.query)):await listCurrentStoryTimings(String(req.params.id)))));
  router.put("/books/:id/story-occurrences",asyncRoute(async(req,res)=>success(res,await saveStoryNarrativeOccurrence({bookId:String(req.params.id),...body(storyNarrativeOccurrenceSchema,req)}),201)));
  router.get("/books/:id/story-occurrences/by-chapter/:chapterCardId",asyncRoute(async(req,res)=>success(res,await listStoryOccurrencesByChapter(String(req.params.id),String(req.params.chapterCardId)))));
  router.get("/books/:id/story-relations/proposals",asyncRoute(async(req,res)=>success(res,await listStoryRelationProposals(String(req.params.id),typeof req.query.status==="string"?storyProposalStatusSchema.parse(req.query.status):undefined))));
  router.post("/books/:id/story-relations/proposals",asyncRoute(async(req,res)=>success(res,await proposeStoryRelation({bookId:String(req.params.id),...body(storyRelationProposalInputSchema,req)}),201)));
  router.get("/story-relation-proposals/:id",asyncRoute(async(req,res)=>success(res,await getStoryRelationProposal(String(req.params.id)))));
  router.put("/story-relation-proposals/:id",asyncRoute(async(req,res)=>success(res,await editStoryRelationProposal(String(req.params.id),body(storyRelationProposalEditSchema,req)))));
  router.post("/story-relation-proposals/:id/review",asyncRoute(async(req,res)=>success(res,await reviewStoryRelationProposal(String(req.params.id),body(storyProposalReviewSchema,req)))));
  router.get("/books/:id/story-relations",asyncRoute(async(req,res)=>success(res,await listStoryEventRelations(String(req.params.id),typeof req.query.family==="string"?storyRelationFamilySchema.parse(req.query.family):undefined))));
  router.get("/books/:id/story-events/:eventId/concurrent",asyncRoute(async(req,res)=>success(res,await listConcurrentEvents(String(req.params.id),String(req.params.eventId)))));
  router.get("/books/:id/story-events/:eventId/temporal",asyncRoute(async(req,res)=>success(res,await listTemporalNeighbors(String(req.params.id),String(req.params.eventId)))));
  router.get("/books/:id/story-events/:eventId/causal",asyncRoute(async(req,res)=>{const query=causalGraphQuerySchema.parse(req.query);success(res,await listCausalGraph(String(req.params.id),String(req.params.eventId),query.direction,query.maxDepth));}));
  router.post("/books/:id/planning-objects",asyncRoute(async(req,res)=>success(res,await createPlanningObject({bookId:String(req.params.id),...body(planningObjectInputSchema,req)}),201)));
  router.get("/books/:id/planning-tree",asyncRoute(async(req,res)=>success(res,await getAdoptedPlanningTree(String(req.params.id)))));
  router.get("/books/:id/stale-planning-versions",asyncRoute(async(req,res)=>success(res,await listStalePlanningVersions(String(req.params.id)))));
  router.get("/books/:id/planning-impacts",asyncRoute(async(req,res)=>success(res,await listPlanningImpacts(String(req.params.id),typeof req.query.status==="string"?planningImpactStatusSchema.parse(req.query.status):undefined))));
  router.get("/planning-objects/:id",asyncRoute(async(req,res)=>success(res,await getPlanningObject(String(req.params.id)))));
  router.post("/planning-objects/:id/versions",asyncRoute(async(req,res)=>success(res,await addPlanningVersion(String(req.params.id),body(planningVersionInputSchema,req)),201)));
  router.post("/planning-objects/:id/reject",asyncRoute(async(req,res)=>success(res,await rejectPlanningVersion(String(req.params.id),body(planningVersionRejectSchema,req)))));
  router.post("/planning-objects/:id/adopt",asyncRoute(async(req,res)=>success(res,await adoptPlanningVersion(String(req.params.id),body(planningVersionAdoptSchema,req)))));
  router.get("/planning-objects/:id/adoptions",asyncRoute(async(req,res)=>success(res,await listPlanningAdoptions(String(req.params.id)))));
  router.get("/planning-versions/:id/context",asyncRoute(async(req,res)=>success(res,await getPlanningVersionContext(String(req.params.id)))));
  router.post("/prompt-recipes",asyncRoute(async(req,res)=>success(res,await createPromptRecipe(body(promptRecipeCreateSchema,req)),201)));
  router.get("/prompt-recipes/:id",asyncRoute(async(req,res)=>success(res,await getPromptRecipe(String(req.params.id)))));
  router.post("/prompt-recipes/:id/versions",asyncRoute(async(req,res)=>success(res,await addPromptRecipeVersion(String(req.params.id),body(promptRecipeVersionSchema,req)),201)));
  router.post("/prompt-recipes/:id/publish",asyncRoute(async(req,res)=>success(res,await publishPromptRecipeVersion(String(req.params.id),body(contractPublishSchema,req)))));
  router.post("/prompt-recipes/:id/reject",asyncRoute(async(req,res)=>success(res,await rejectPromptRecipeVersion(String(req.params.id),body(contractRejectSchema,req)))));
  router.get("/prompt-recipe-versions/:id/dependencies",asyncRoute(async(req,res)=>success(res,await listPromptRecipeDependencies(String(req.params.id)))));
  router.get("/task-contracts/by-key/:taskKey",asyncRoute(async(req,res)=>success(res,await getPublishedTaskContract(String(req.params.taskKey)))));
  router.post("/task-contracts",asyncRoute(async(req,res)=>success(res,await createTaskContract(body(taskContractCreateSchema,req)),201)));
  router.get("/task-contracts/:id",asyncRoute(async(req,res)=>success(res,await getTaskContract(String(req.params.id)))));
  router.post("/task-contracts/:id/versions",asyncRoute(async(req,res)=>success(res,await addTaskContractVersion(String(req.params.id),body(taskContractVersionSchema,req)),201)));
  router.post("/task-contracts/:id/publish",asyncRoute(async(req,res)=>success(res,await publishTaskContractVersion(String(req.params.id),body(contractPublishSchema,req)))));
  router.post("/task-contracts/:id/reject",asyncRoute(async(req,res)=>success(res,await rejectTaskContractVersion(String(req.params.id),body(contractRejectSchema,req)))));
  router.post("/context-manifests",asyncRoute(async(req,res)=>success(res,await createContextManifest(body(contextManifestCreateSchema,req)),201)));
  router.get("/context-manifests/:id",asyncRoute(async(req,res)=>success(res,await getContextManifest(String(req.params.id)))));
  router.put("/model-credential-refs",asyncRoute(async(req,res)=>success(res,await saveModelCredentialRef(body(modelCredentialRefSchema,req)))));
  router.get("/model-credential-refs/:id",asyncRoute(async(req,res)=>success(res,await getModelCredentialRef(String(req.params.id)))));
  router.post("/model-routes",asyncRoute(async(req,res)=>success(res,await createModelRouteConfig(body(modelRouteCreateSchema,req)),201)));
  router.get("/model-routes/:id",asyncRoute(async(req,res)=>success(res,await getModelRouteConfig(String(req.params.id)))));
  router.post("/model-routes/:id/versions",asyncRoute(async(req,res)=>success(res,await addModelRouteVersion(String(req.params.id),body(modelRouteVersionSchema,req)),201)));
  router.post("/model-routes/:id/publish",asyncRoute(async(req,res)=>success(res,await publishModelRouteVersion(String(req.params.id),body(contractPublishSchema,req)))));
  router.post("/model-routes/resolve",asyncRoute(async(req,res)=>success(res,await resolveModelRoute(body(modelRouteResolveSchema,req)))));
  router.post("/model-route-snapshots",asyncRoute(async(req,res)=>success(res,await createModelRouteSnapshot(body(modelRouteResolveSchema,req)),201)));
  router.get("/model-route-snapshots/:id",asyncRoute(async(req,res)=>success(res,await getModelRouteSnapshot(String(req.params.id)))));
  router.get("/ai-runtime/tasks",asyncRoute(async(req,res)=>success(res,await listAiTasks(aiTaskListQuerySchema.parse(req.query)))));
  router.get("/ai-runtime/tasks/recoverable",asyncRoute(async(req,res)=>success(res,await listRecoverableAiTasks({bookId:typeof req.query.bookId==="string"?String(req.query.bookId):undefined,limit:typeof req.query.limit==="string"?Number(req.query.limit):undefined}))));
  router.get("/ai-runtime/tasks/failed-attempts",asyncRoute(async(req,res)=>success(res,await listFailedAiAttempts({bookId:typeof req.query.bookId==="string"?String(req.query.bookId):undefined,category:typeof req.query.category==="string"?aiFailureCategorySchema.parse(req.query.category):undefined,limit:typeof req.query.limit==="string"?Number(req.query.limit):undefined}))));
  router.get("/ai-runtime/tasks/pending-approvals",asyncRoute(async(req,res)=>success(res,await listPendingAiApprovals({bookId:typeof req.query.bookId==="string"?String(req.query.bookId):undefined,limit:typeof req.query.limit==="string"?Number(req.query.limit):undefined}))));
  router.get("/ai-runtime/tasks/usage-summary",asyncRoute(async(req,res)=>success(res,await summarizeAiUsage({bookId:typeof req.query.bookId==="string"?String(req.query.bookId):undefined,taskId:typeof req.query.taskId==="string"?String(req.query.taskId):undefined}))));
  router.get("/ai-runtime/tasks/:id",asyncRoute(async(req,res)=>success(res,await getAiTask(String(req.params.id)))));
  router.post("/ai-runtime/commands/tasks",asyncRoute(async(req,res)=>success(res,await createAiTask(body(aiTaskCreateSchema,req)),201)));
  router.post("/ai-runtime/commands/attempts/start",asyncRoute(async(req,res)=>success(res,await startAiTaskAttempt(body(aiAttemptStartSchema,req)),201)));
  router.post("/ai-runtime/commands/steps/heartbeat",asyncRoute(async(req,res)=>success(res,await heartbeatAiTaskStep(body(aiStepHeartbeatSchema,req)))));
  router.post("/ai-runtime/commands/attempts/succeed",asyncRoute(async(req,res)=>success(res,await succeedAiTaskAttempt(body(aiAttemptSuccessSchema,req)))));
  router.post("/ai-runtime/commands/attempts/fail",asyncRoute(async(req,res)=>success(res,await failAiTaskAttempt(body(aiAttemptFailureSchema,req)))));
  router.post("/ai-runtime/commands/steps/recover",asyncRoute(async(req,res)=>success(res,await recoverExpiredAiTaskStep(body(aiStepRecoverySchema,req)),201)));
  router.post("/ai-runtime/commands/approvals",asyncRoute(async(req,res)=>success(res,await requestAiApproval(body(aiApprovalRequestSchema,req)),201)));
  router.post("/ai-runtime/commands/approvals/:id/decisions",asyncRoute(async(req,res)=>success(res,await decideAiApproval({requestId:String(req.params.id),...body(aiApprovalDecisionSchema,req)}),201)));
  router.post("/ai-runtime/commands/usage",asyncRoute(async(req,res)=>success(res,await recordAiAttemptUsage(body(aiAttemptUsageSchema,req)),201)));
  router.get("/quality/reports",asyncRoute(async(req,res)=>success(res,await listQualityAuditReports(qualityReportListQuerySchema.parse(req.query)))));
  router.get("/quality/reports/:id",asyncRoute(async(req,res)=>success(res,await getQualityAuditReport(String(req.params.id)))));
  router.get("/quality/issues",asyncRoute(async(req,res)=>success(res,await listQualityIssues(qualityIssueListQuerySchema.parse(req.query)))));
  router.get("/quality/issues/:id",asyncRoute(async(req,res)=>success(res,await getQualityIssue(String(req.params.id)))));
  router.get("/quality/issues/:id/rechecks",asyncRoute(async(req,res)=>success(res,await listQualityRechecks(String(req.params.id)))));
  router.get("/quality/fix-candidates/:id",asyncRoute(async(req,res)=>success(res,await getQualityFixCandidate(String(req.params.id)))));
  router.post("/quality/commands/reports",asyncRoute(async(req,res)=>success(res,await createQualityAuditReport(body(qualityAuditReportCreateSchema,req)),201)));
  router.post("/quality/commands/issues/:id/versions",asyncRoute(async(req,res)=>success(res,await reviseQualityIssue(String(req.params.id),body(qualityIssueRevisionSchema,req)),201)));
  router.post("/quality/commands/issues/:id/transitions",asyncRoute(async(req,res)=>success(res,await transitionQualityIssue(String(req.params.id),body(qualityIssueTransitionSchema,req)))));
  router.post("/quality/commands/fix-candidates/:id/versions",asyncRoute(async(req,res)=>success(res,await reviseQualityFixCandidate(String(req.params.id),body(qualityFixRevisionSchema,req)),201)));
  router.post("/quality/commands/fix-candidates/:id/decision",asyncRoute(async(req,res)=>success(res,await decideQualityFixCandidate(String(req.params.id),body(qualityFixDecisionSchema,req)))));
  router.post("/quality/commands/fix-candidates/:id/adoption",asyncRoute(async(req,res)=>success(res,await recordQualityFixAdoption(String(req.params.id),body(qualityFixAdoptionSchema,req)),201)));
  router.post("/quality/commands/rechecks",asyncRoute(async(req,res)=>success(res,await recordQualityRecheck(body(qualityRecheckSchema,req)),201)));
  router.post("/dependencies/resources",asyncRoute(async(req,res)=>success(res,await registerDependencyResource(body(dependencyResourceRegisterSchema,req)),201)));
  router.post("/dependencies/edges",asyncRoute(async(req,res)=>success(res,await createDependencyEdge(body(dependencyEdgeCreateSchema,req)),201)));
  router.post("/dependencies/edges/:id/end",asyncRoute(async(req,res)=>success(res,await endDependencyEdge(String(req.params.id),body(dependencyEdgeEndSchema,req).reason))));
  router.post("/dependencies/previews",asyncRoute(async(req,res)=>success(res,await previewDependencyChange(body(dependencyPreviewSchema,req)),201)));
  router.post("/dependencies/invalidations",asyncRoute(async(req,res)=>success(res,await recordDependencyInvalidation(body(dependencyInvalidationSchema,req)),201)));
  router.get("/dependencies/invalidations/:id",asyncRoute(async(req,res)=>success(res,await getDependencyInvalidation(String(req.params.id),typeof req.query.bookId==="string"?String(req.query.bookId):undefined))));
  router.get("/books/:id/dependencies/resources/:resourceId",asyncRoute(async(req,res)=>success(res,await listResourceDependencies({bookId:String(req.params.id),resourceId:String(req.params.resourceId),...dependencyGraphQuerySchema.parse(req.query)}))));
  router.get("/books/:id/dependencies/states",asyncRoute(async(req,res)=>success(res,await listCurrentDependencyStates({bookId:String(req.params.id),...dependencyStateQuerySchema.parse(req.query)}))));
  router.get("/books/:id/dependencies/recomputes",asyncRoute(async(req,res)=>success(res,await listDependencyRecomputeRequests({bookId:String(req.params.id),...dependencyRecomputeQuerySchema.parse(req.query)}))));
  router.post("/dependencies/recomputes/:id/start",asyncRoute(async(req,res)=>success(res,await startDependencyRecompute(String(req.params.id)))));
  router.post("/dependencies/recomputes/:id/complete",asyncRoute(async(req,res)=>success(res,await completeDependencyRecompute({requestId:String(req.params.id),...body(dependencyRecomputeCompletionSchema,req)}),201)));
  router.post("/dependencies/accept-stale",asyncRoute(async(req,res)=>success(res,await acceptStaleDependency(body(dependencyStaleAcceptanceSchema,req)),201)));
  router.get("/books/:id/dependencies/history",asyncRoute(async(req,res)=>success(res,await listDependencyHistory({bookId:String(req.params.id),...dependencyHistoryQuerySchema.parse(req.query)}))));
  router.get("/books/:id/dependencies/receipts",asyncRoute(async(req,res)=>success(res,await listDependencyReceipts({bookId:String(req.params.id),...dependencyHistoryQuerySchema.parse(req.query)}))));
  router.get("/books/:id/dependencies/conflicts",asyncRoute(async(req,res)=>success(res,await listDependencyConflicts({bookId:String(req.params.id),...dependencyConflictQuerySchema.parse(req.query)}))));
  router.post("/dependencies/conflicts/:id/resolve",asyncRoute(async(req,res)=>success(res,await resolveDependencyConflict(String(req.params.id),body(dependencyConflictResolutionSchema,req)))));
  router.get("/books/:id/dependencies/summary",asyncRoute(async(req,res)=>success(res,await getDependencyBookSummary(String(req.params.id)))));
  router.post("/assets/content-objects",asyncRoute(async(req,res)=>success(res,await registerAssetContent(body(assetContentRegisterSchema,req)),201)));
  router.post("/assets/content-integrity-checks",asyncRoute(async(req,res)=>success(res,await recordAssetIntegrityCheck(body(assetIntegrityCheckSchema,req)),201)));
  router.post("/assets",asyncRoute(async(req,res)=>success(res,await createAsset(body(assetCreateSchema,req)),201)));
  router.get("/assets/:id",asyncRoute(async(req,res)=>success(res,await getAsset(String(req.params.id)))));
  router.get("/assets/:id/versions",asyncRoute(async(req,res)=>success(res,await listAssetVersions(String(req.params.id)))));
  router.get("/assets/:id/lineage",asyncRoute(async(req,res)=>success(res,await getAssetLineage(String(req.params.id)))));
  router.post("/assets/:id/versions",asyncRoute(async(req,res)=>success(res,await addAssetVersion(String(req.params.id),body(assetVersionCreateSchema,req)),201)));
  router.post("/assets/:id/change-preview",asyncRoute(async(req,res)=>success(res,await previewAssetAdoption(String(req.params.id),body(assetPreviewSchema,req)),201)));
  router.post("/assets/:id/adopt",asyncRoute(async(req,res)=>success(res,await adoptAssetVersion(String(req.params.id),body(assetAdoptSchema,req)))));
  router.post("/assets/:id/archive",asyncRoute(async(req,res)=>success(res,await archiveAsset(String(req.params.id),body(assetArchiveSchema,req)))));
  router.get("/books/:id/assets",asyncRoute(async(req,res)=>success(res,await listAssets({bookId:String(req.params.id),...assetListQuerySchema.parse(req.query)}))));
  router.post("/assets/mounts",asyncRoute(async(req,res)=>success(res,await createAssetMount(body(assetMountCreateSchema,req)),201)));
  router.post("/assets/mounts/:id/end",asyncRoute(async(req,res)=>success(res,await endAssetMount(String(req.params.id),body(assetMountEndSchema,req).reason))));
  router.get("/books/:id/assets/mounts",asyncRoute(async(req,res)=>success(res,await listAssetMounts({bookId:String(req.params.id),...assetMountListQuerySchema.parse(req.query)}))));
  router.post("/assets/derivations",asyncRoute(async(req,res)=>success(res,await createAssetDerivation(body(assetDerivationCreateSchema,req)),201)));
  router.post("/assets/derivations/:id/start",asyncRoute(async(req,res)=>success(res,await startAssetDerivation(String(req.params.id),body(assetDerivationStartSchema,req)))));
  router.post("/assets/derivations/:id/complete",asyncRoute(async(req,res)=>success(res,await completeAssetDerivation(String(req.params.id),body(assetDerivationCompleteSchema,req)),201)));
  router.get("/books/:id/assets/derivations",asyncRoute(async(req,res)=>success(res,await listAssetDerivations({bookId:String(req.params.id),...assetDerivationListQuerySchema.parse(req.query)}))));
  router.get("/books/:id/assets/summary",asyncRoute(async(req,res)=>success(res,await getAssetBookSummary(String(req.params.id)))));
  router.get("/books/:id/graph/health",asyncRoute(async(req,res)=>success(res,await getGraphProjectionHealth(String(req.params.id)))));
  router.get("/books/:id/graph/state",asyncRoute(async(req,res)=>success(res,await getGraphProjectionState(String(req.params.id)))));
  router.get("/books/:id/graph/requests",asyncRoute(async(req,res)=>success(res,await listGraphProjectionRequests({bookId:String(req.params.id),...graphProjectionRequestQuerySchema.parse(req.query)}))));
  router.post("/graph/requests/:id/process",asyncRoute(async(req,res)=>success(res,await processGraphProjectionRequest(String(req.params.id)))));
  router.get("/graph/requests/:id/batch",asyncRoute(async(req,res)=>success(res,await getGraphProjectionBatch(String(req.params.id)))));
  router.get("/graph/requests/:id/batches",asyncRoute(async(req,res)=>success(res,await listGraphProjectionBatches(String(req.params.id),graphProjectionListQuerySchema.parse(req.query).limit))));
  router.post("/books/:id/graph/rebuild",asyncRoute(async(req,res)=>success(res,await rebuildGraphProjection(String(req.params.id),body(graphProjectionRebuildSchema,req)),201)));
  router.get("/books/:id/graph/generations",asyncRoute(async(req,res)=>success(res,await listGraphProjectionGenerations(String(req.params.id),graphProjectionListQuerySchema.parse(req.query).limit))));
  router.get("/books/:id/graph/failures",asyncRoute(async(req,res)=>success(res,await listGraphProjectionFailures(String(req.params.id),graphProjectionListQuerySchema.parse(req.query).limit))));
  router.get("/books/:id/graph/mappings",asyncRoute(async(req,res)=>success(res,await listGraphProjectionMappings({bookId:String(req.params.id),...graphProjectionMappingQuerySchema.parse(req.query)}))));
  router.post("/books/:id/graph/traverse",asyncRoute(async(req,res)=>success(res,await traverseGraph({bookId:String(req.params.id),...body(graphTraversalSchema,req)}))));
  router.post("/embeddings/profiles",asyncRoute(async(req,res)=>success(res,await createEmbeddingProfile(body(embeddingProfileCreateSchema,req)),201)));
  router.get("/embeddings/profiles/:id",asyncRoute(async(req,res)=>success(res,await getEmbeddingProfile(String(req.params.id)))));
  router.post("/embeddings/profiles/:id/versions",asyncRoute(async(req,res)=>success(res,await addEmbeddingProfileVersion(String(req.params.id),body(embeddingProfileVersionSchema,req)),201)));
  router.post("/embeddings/profiles/:id/archive",asyncRoute(async(req,res)=>success(res,await archiveEmbeddingProfile(String(req.params.id),body(embeddingProfileArchiveSchema,req).expectedRevision))));
  router.post("/embeddings/sources",asyncRoute(async(req,res)=>success(res,await createEmbeddingSourceSnapshot(body(embeddingSourceSnapshotSchema,req)),201)));
  router.post("/embeddings/sources/:id/archive",asyncRoute(async(req,res)=>success(res,await archiveEmbeddingSourceSnapshot(String(req.params.id),body(embeddingSourceArchiveSchema,req)))));
  router.post("/embeddings/chunks/complete",asyncRoute(async(req,res)=>success(res,await completeChunking(body(chunkingCompletionSchema,req)),201)));
  router.post("/embeddings/requests",asyncRoute(async(req,res)=>success(res,await createEmbeddingRequest(body(embeddingRequestCreateSchema,req)),201)));
  router.get("/embeddings/requests/:id",asyncRoute(async(req,res)=>success(res,await getEmbeddingRequest(String(req.params.id)))));
  router.get("/books/:id/embeddings/requests",asyncRoute(async(req,res)=>success(res,await listEmbeddingRequests({bookId:String(req.params.id),...embeddingRequestListQuerySchema.parse(req.query)}))));
  router.post("/embeddings/attempts/start",asyncRoute(async(req,res)=>success(res,await startEmbeddingAttempt(body(embeddingAttemptStartSchema,req).requestId),201)));
  router.post("/embeddings/attempts/complete",asyncRoute(async(req,res)=>success(res,await completeEmbeddingAttempt(body(embeddingAttemptCompletionVerifiedSchema,req)),201)));
  router.post("/books/:id/embeddings/generations",asyncRoute(async(req,res)=>success(res,await buildEmbeddingGeneration({...body(embeddingGenerationCreateSchema,req),bookId:String(req.params.id)}),201)));
  router.post("/embeddings/generations/:id/activate",asyncRoute(async(req,res)=>success(res,await activateEmbeddingGeneration(String(req.params.id)))));
  router.get("/books/:id/embeddings/coverage",asyncRoute(async(req,res)=>success(res,await getEmbeddingCoverage(String(req.params.id),embeddingCoverageQuerySchema.parse(req.query).profileId))));
  router.get("/books/:id/embeddings/generations",asyncRoute(async(req,res)=>success(res,await listEmbeddingGenerations(String(req.params.id),embeddingListQuerySchema.parse(req.query).limit))));
  router.get("/books/:id/embeddings/stale-reasons",asyncRoute(async(req,res)=>success(res,await listEmbeddingStaleReasons({bookId:String(req.params.id),...embeddingStaleListQuerySchema.parse(req.query)}))));
  router.post("/books/:id/semantic-retrieval",asyncRoute(async(req,res)=>success(res,await retrieveSemantic({bookId:String(req.params.id),...body(semanticRetrievalSchema,req)}),201)));
  router.get("/semantic-retrieval/runs/:id",asyncRoute(async(req,res)=>success(res,await getSemanticRetrievalRun(String(req.params.id)))));
  router.get("/books/:id/semantic-retrieval/runs",asyncRoute(async(req,res)=>success(res,await listSemanticRetrievalRuns(String(req.params.id),embeddingListQuerySchema.parse(req.query).limit))));
  router.get("/books/:id/runtime/health",asyncRoute(async(req,res)=>success(res,await getBackgroundRuntimeHealth(String(req.params.id)))));
  router.get("/books/:id/runtime/jobs",asyncRoute(async(req,res)=>success(res,await listBackgroundJobs({bookId:String(req.params.id),...backgroundJobListQuerySchema.parse(req.query)}))));
  router.get("/books/:id/runtime/jobs/:jobId",asyncRoute(async(req,res)=>success(res,await getBackgroundJob(String(req.params.jobId),String(req.params.id)))));
  router.get("/books/:id/runtime/outbox",asyncRoute(async(req,res)=>success(res,await listOutboxEvents({bookId:String(req.params.id),...outboxEventListQuerySchema.parse(req.query)}))));
  router.get("/runtime/consumers",asyncRoute(async(_req,res)=>success(res,await listOutboxConsumers())));
  router.get("/runtime/private/status",asyncRoute(async(_req,res)=>success(res,await getPrivateRuntimeManager().status())));
  router.get("/runtime/private/doctor",asyncRoute(async(_req,res)=>success(res,await getPrivateRuntimeDiagnostics())));
  router.post("/runtime/consumers/:key/state",asyncRoute(async(req,res)=>success(res,await setOutboxConsumerState({consumerKey:String(req.params.key),...body(outboxConsumerStateSchema,req)}))));
  router.get("/books/:id/runtime/state",asyncRoute(async(req,res)=>success(res,await getBackgroundBookPause(String(req.params.id)))));
  router.post("/books/:id/runtime/state",asyncRoute(async(req,res)=>success(res,await setBackgroundBookPause({bookId:String(req.params.id),...body(backgroundBookPauseSchema,req)}))));
  router.post("/books/:bookId/runtime/jobs/:id/cancel",asyncRoute(async(req,res)=>success(res,await cancelBackgroundJobForBook(String(req.params.bookId),String(req.params.id),body(backgroundJobCancelSchema,req).reason))));
  router.post("/books/:bookId/runtime/jobs/:id/retry",asyncRoute(async(req,res)=>success(res,await retryBackgroundJobForBook(String(req.params.bookId),String(req.params.id)))));
  router.post("/books/:bookId/runtime/jobs/:id/replay",asyncRoute(async(req,res)=>success(res,await replayBackgroundJobForBook(String(req.params.bookId),{sourceJobId:String(req.params.id),...body(backgroundJobReplaySchema,req)}),201)));
  router.get("/transfers/runtime",asyncRoute(async(_req,res)=>success(res,await getTransferAvailability())));
  router.get("/transfers/profiles",asyncRoute(async(_req,res)=>success(res,await listTransferProfiles())));
  router.get("/transfers/operations",asyncRoute(async(req,res)=>success(res,await listTransferOperations(transferOperationListSchema.parse(req.query)))));
  router.get("/transfers/operations/:id",asyncRoute(async(req,res)=>success(res,await getTransferOperation(String(req.params.id)))));
  router.post("/transfers/exports",asyncRoute(async(req,res)=>success(res,await requestTransferExport(body(transferExportRequestSchema,req)),202)));
  router.post("/transfers/imports/dry-run",asyncRoute(async(req,res)=>success(res,await requestImportDryRun(dependencies.transferIngress,body(transferImportDryRunSchema,req)),202)));
  router.post("/transfers/imports/:id/confirm",asyncRoute(async(req,res)=>success(res,await confirmTransferImport(String(req.params.id),body(transferImportConfirmSchema,req)),202)));
  router.post("/transfers/operations/:id/cancel",asyncRoute(async(req,res)=>success(res,await cancelTransferOperation(String(req.params.id),body(transferCancelSchema,req)))));
  router.post("/transfers/conflicts/:id/resolve",asyncRoute(async(req,res)=>success(res,await resolveTransferConflict(String(req.params.id),body(transferConflictResolveSchema,req)))));
  router.get("/transfers/artifacts/:id/download",(req,res,next)=>{void resolveTransferArtifactDownload(String(req.params.id)).then(file=>{res.type(file.mediaType);res.download(file.path,file.displayFilename,error=>{if(error)next(error);});},next);});
  router.post("/books/:id/sync-preview", asyncRoute(async (req, res) => {
    const input = body(syncPreviewSchema, req);
    success(res, await previewBookSync(String(req.params.id), input.targetVersionId));
  }));
  router.post("/book-syncs/:id/apply", asyncRoute(async (req, res) => success(res, await applyBookSync(String(req.params.id)))));

  router.get("/book-creation/inspirations", asyncRoute(async (_req, res) => success(res, await listInspirationCandidates())));
  router.get("/resources/strategies", asyncRoute(async (req, res) => success(res, await listStrategyResources({
    typeKey: typeof req.query.typeKey === "string" ? req.query.typeKey : undefined,
    archived: req.query.archived === "true",
    search: typeof req.query.search === "string" ? req.query.search : undefined,
  }))));
  router.post("/resources/strategies/:id/install", asyncRoute(async (req, res) => {
    const input = body(resourceInstallSchema, req);
    success(res, await installStrategyResource(input.bookId, String(req.params.id)), 201);
  }));
  router.post("/book-creation/sessions", asyncRoute(async (req, res) => success(res, await createBookCreationSession(body(bookCreationSessionInputSchema, req)), 201)));
  router.get("/book-creation/sessions/:id", asyncRoute(async (req, res) => success(res, await getBookCreationSession(String(req.params.id)))));
  router.post("/book-creation/sessions/:id/directions", asyncRoute(async (req, res) => {
    const sessionId = String(req.params.id);
    const batchId = await beginSessionGeneration(sessionId, "directions");
    try {
      if (!dependencies.ai) throw new Error("AI 服务尚未连接，请检查模型设置后重试。");
      const context = await getSessionAiContext(sessionId);
      const candidates = await dependencies.ai.generateDirections({
        method: context.session.method,
        bookName: context.session.bookName,
        sourceReference: context.session.sourceReference,
        sourceText: context.sourceText,
      });
      success(res, await saveDirectionCandidates(sessionId, batchId, candidates));
    } catch (error) {
      await failSessionGeneration(sessionId, batchId, "generate_directions", error);
      throw new NewDesignError(error instanceof Error ? error.message : "创作方向生成失败。", 502);
    }
  }));
  router.post("/book-creation/sessions/:id/select-direction", asyncRoute(async (req, res) => {
    const input = body(selectDirectionSchema, req);
    success(res, await selectBookDirection(String(req.params.id), input.directionId));
  }));
  router.post("/book-creation/sessions/:id/initial-content", asyncRoute(async (req, res) => {
    const sessionId = String(req.params.id);
    const batchId = await beginSessionGeneration(sessionId, "initial_content");
    try {
      if (!dependencies.ai) throw new Error("AI 服务尚未连接，请检查模型设置后重试。");
      const context = await getSessionAiContext(sessionId);
      const direction = context.session.directionCandidates.find((item) => item.id === context.session.selectedDirectionId);
      if (!direction) throw new NewDesignError("请先确认一个创作方向。", 422);
      const cards = await dependencies.ai.generateInitialContent({ direction, sourceText: context.sourceText, schemaTypes: context.schemaTypes });
      success(res, await saveInitialCards(sessionId, batchId, cards));
    } catch (error) {
      await failSessionGeneration(sessionId, batchId, "generate_initial_content", error);
      if (error instanceof NewDesignError) throw error;
      throw new NewDesignError(error instanceof Error ? error.message : "初始资料生成失败。", 502);
    }
  }));
  router.post("/book-creation/sessions/:id/complete", asyncRoute(async (req, res) => {
    success(res, await completeBookCreation(String(req.params.id), body(completeBookCreationSchema, req)));
  }));

  router.post("/books/:id/ai-assists", asyncRoute(async (req, res) => {
    const input = body(formAssistSchema, req);
    const context = await getCardAssistContext(String(req.params.id), input.cardId);
    if (context.card.revision !== input.baseRevision) throw new NewDesignError("资料已被修改，请刷新后重试。", 409);
    const batchId = await beginFormAssist({ bookId: String(req.params.id), cardId: input.cardId, formKey: input.formKey, instruction: input.instruction, baseRevision: input.baseRevision });
    try {
      if (!dependencies.ai) throw new Error("AI 服务尚未连接，请检查模型设置后重试。");
      const output = await dependencies.ai.assistForm({ bookName: context.bookName, formName: input.formName, cardTitle: context.card.title, currentValues: context.card.values, fields: context.fields, instruction: input.instruction });
      const allowed = new Set(context.fields.map((field) => field.key));
      const suggestions = Object.fromEntries(Object.entries(output).filter(([key]) => allowed.has(key)));
      success(res, await saveFormAssist(batchId, suggestions), 201);
    } catch (error) {
      await failFormAssist(batchId, error);
      throw new NewDesignError(error instanceof Error ? error.message : "AI 表单建议生成失败。", 502);
    }
  }));
  router.post("/ai-assists/:id/apply", asyncRoute(async (req, res) => {
    const input = body(applyFormAssistSchema, req);
    success(res, await applyFormAssist(String(req.params.id), input.fieldKeys, input.expectedRevision));
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      const envelope: ApiEnvelope<null> = { success: false, error: "提交内容不完整或格式不正确。", issues: zodIssues(error) };
      res.status(422).json(envelope);
      return;
    }
    if (error instanceof NewDesignError) {
      const envelope: ApiEnvelope<null> = { success: false, error: error.message, issues: error.issues };
      res.status(error.status).json(envelope);
      return;
    }
    const publicError=scrub(error instanceof Error?error.message:String(error));
    console.error("[new-design] request failed",publicError);
    const envelope: ApiEnvelope<null> = {
      success: false,
      error: publicError ? `新设计服务暂时不可用：${publicError}` : "新设计服务暂时不可用。",
    };
    res.status(500).json(envelope);
  });

  return router;
}

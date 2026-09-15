export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "boolean",
  "select",
  "multi_select",
  "date",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const CARD_TYPE_CAPABILITIES = [
  "body_text",
  "timeline",
  "state_change",
  "relation_subject",
  "lifecycle",
  "creative_goal",
  "canonical_fact",
] as const;

export type CardTypeCapability = (typeof CARD_TYPE_CAPABILITIES)[number];

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  key: string;
  name: string;
  description: string;
  type: FieldType;
  required: boolean;
  defaultValue: unknown;
  options: FieldOption[];
  group: string;
  order: number;
}

export interface CardTypeVersion {
  id: string;
  version: number;
  fields: FieldDefinition[];
  createdAt: string;
}

export interface CardTypeSummary {
  id: string;
  spaceId: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  sortOrder: number;
  categoryId: string | null;
  categoryKey: string | null;
  semanticCapabilities: CardTypeCapability[];
  status: "draft" | "published" | "archived";
  revision: number;
  currentVersion: number | null;
  currentVersionId: string | null;
  draftFields: FieldDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface CardTypeCategory {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  status: "active" | "archived";
  isSystem: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardSummary {
  id: string;
  cardTypeId: string;
  cardTypeName: string;
  title: string;
  status: "active" | "archived";
  revision: number;
  typeVersionId: string;
  typeVersion: number;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export const STRATEGY_RESOURCE_TYPE_KEYS = [
  "genre_strategy",
  "progression_mode",
  "writing_config",
  "quality_rule",
] as const;

export type StrategyResourceTypeKey = (typeof STRATEGY_RESOURCE_TYPE_KEYS)[number];

export const PROMPT_COMPONENT_RESOURCE_SPACE_ID = "63000000-0000-4000-8000-000000000001";

export interface StrategyResourceSummary extends CardSummary {
  typeKey: StrategyResourceTypeKey;
}

export interface ResourceAdoption {
  id: string;
  resourceCardId: string;
  resourceVersionId: string;
  bookId: string;
  targetCardId: string;
  action: "install_snapshot";
  snapshot: { typeKey: StrategyResourceTypeKey; title: string; values: Record<string, unknown> };
  createdAt: string;
}

export interface CardVersion {
  id: string;
  revision: number;
  typeVersionId: string;
  typeVersion: number;
  title: string;
  values: Record<string, unknown>;
  source: "create" | "edit" | "archive" | "restore";
  createdAt: string;
}

export type DefinitionScope = "system" | "template" | "book";

export interface DictionaryItem {
  id: string;
  key: string;
  label: string;
  value: Record<string, unknown>;
  sortOrder: number;
  status: "active" | "archived";
}

export interface DictionarySummary {
  id: string;
  key: string;
  name: string;
  description: string;
  scope: DefinitionScope;
  ownerSpaceId: string | null;
  status: "draft" | "published" | "archived";
  revision: number;
  items: DictionaryItem[];
  createdAt: string;
  updatedAt: string;
}

export interface RelationPropertyDefinition {
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
}

export interface RelationTypeSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  direction: "directed" | "undirected";
  sourceTypeKeys: string[];
  targetTypeKeys: string[];
  sourceMax: number | null;
  targetMax: number | null;
  scope: DefinitionScope;
  ownerSpaceId: string | null;
  propertiesSchema: RelationPropertyDefinition[];
  status: "draft" | "published" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface FormLocalFieldDefinition {
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
}

export interface CardGroupFormSlot {
  key: string;
  name: string;
  kind: "primary_card" | "card_reference";
  relationTypeKey?: string;
  allowedTypeKeys: string[];
  min: number;
  max: number;
  localFields: FormLocalFieldDefinition[];
}

export interface CardGroupFormSection {
  key: string;
  name: string;
  order: number;
  slots: CardGroupFormSlot[];
}

export interface CardGroupFormGroup {
  key: string;
  name: string;
  order: number;
  sections: CardGroupFormSection[];
}

export interface CardGroupFormDefinition {
  primaryTypeKey: string;
  groups: CardGroupFormGroup[];
}

export interface CardGroupFormVersion {
  id: string;
  version: number;
  definition: CardGroupFormDefinition;
  createdAt: string;
}

export interface CardGroupFormSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  revision: number;
  currentVersion: number | null;
  currentVersionId: string | null;
  draftDefinition: CardGroupFormDefinition;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CardMount {
  id: string;
  slotKey: string;
  cardId: string;
  cardTitle: string;
  cardTypeKey: string;
  relationId: string | null;
  sortOrder: number;
  localValues: Record<string, unknown>;
  revision: number;
}

export interface CardGroupFormInstance {
  id: string;
  spaceId: string;
  formVersionId: string;
  formVersion: number;
  primaryCardId: string;
  title: string;
  revision: number;
  mounts: CardMount[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateGroupVersion {
  id: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TemplateGroupSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  revision: number;
  currentVersion: number | null;
  currentVersionId: string | null;
  draftConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BookSummary {
  id: string;
  spaceId: string;
  key: string;
  name: string;
  description: string;
  status: "active" | "archived";
  templateId: string;
  templateName: string;
  templateVersionId: string;
  templateVersion: number;
  revision: number;
  cardCount: number;
  formCount: number;
  createdAt: string;
  updatedAt: string;
}

export const BOOK_VIEW_KEYS = ["chapters", "clues", "characters", "events", "world", "resources"] as const;
export type BookViewKey = (typeof BOOK_VIEW_KEYS)[number];

export interface BookViewCard extends CardSummary {
  typeKey: string;
  typeFields: FieldDefinition[];
}

export interface StoryTimePosition {
  id: string;
  cardId: string;
  startOrder: number | null;
  endOrder: number | null;
  startLabel: string;
  endLabel: string;
  uncertainty: string;
  revision: number;
  updatedAt: string;
}

export interface NarrativePlacement {
  id: string;
  subjectCardId: string;
  chapterCardId: string;
  sceneCardId: string | null;
  role: "appears" | "plant" | "reinforce" | "misdirect" | "reveal" | "recover";
  note: string;
  revision: number;
  updatedAt: string;
}

export interface TextAnchor {
  id: string;
  subjectCardId: string;
  chapterCardId: string;
  sceneCardId: string | null;
  role: "plant" | "reveal" | "evidence" | "mention";
  anchorLabel: string;
  revision: number;
  updatedAt: string;
}

export interface CharacterRelation {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  sourceLabel: string;
  inverseLabel: string;
  note: string;
  revision: number;
  updatedAt: string;
}

export interface BookViewConfig {
  id: string;
  key: BookViewKey;
  config: Record<string, unknown>;
  revision: number;
}

export interface BookViewWorkspace {
  bookId: string;
  spaceId: string;
  cards: BookViewCard[];
  storyTimePositions: StoryTimePosition[];
  narrativePlacements: NarrativePlacement[];
  textAnchors: TextAnchor[];
  characterRelations: CharacterRelation[];
  viewConfigs: BookViewConfig[];
}

export type BookChangeOperationKey = "story_time" | "narrative_placement" | "character_relation" | "clue_lifecycle";

export interface BookChangeImpact {
  label: string;
  before: string;
  after: string;
  unchanged?: string;
}

export interface BookChangeSet {
  id: string;
  bookId: string;
  operationKey: BookChangeOperationKey;
  input: Record<string, unknown>;
  impacts: BookChangeImpact[];
  status: "previewed" | "applied" | "dismissed";
  createdAt: string;
  appliedAt: string | null;
}

export type ResearchRecordType = "market_scan" | "market_analysis" | "book_analysis" | "diagnosis";
export type ResearchRunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export interface ResearchDocumentVersion {
  id: string;
  documentId: string;
  version: number;
  content: string;
  contentHash: string;
  characterCount: number;
  createdAt: string;
}

export interface ResearchDocument {
  id: string;
  title: string;
  sourceKind: "paste" | "file" | "public_url" | "book_export";
  sourceUrl: string;
  status: "active" | "archived";
  revision: number;
  currentVersion: ResearchDocumentVersion;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRecordVersion {
  id: string;
  recordId: string;
  version: number;
  parentVersionId: string | null;
  sourceScope: Record<string, unknown>;
  templateKey: string;
  templateVersion: number;
  runStatus: ResearchRunStatus;
  progress: number;
  budgetTokens: number | null;
  usedTokens: number;
  promptSnapshot: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
  inputSnapshot: Record<string, unknown>;
  structuredResult: Record<string, unknown>;
  report: string;
  lastError: string;
  cancelRequested: boolean;
  runHash: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ResearchRecordSummary {
  id: string;
  type: ResearchRecordType;
  title: string;
  sourceDocumentVersionId: string | null;
  tags: string[];
  favorite: boolean;
  notes: string;
  status: "active" | "archived";
  revision: number;
  currentVersion: ResearchRecordVersion;
  versionCount: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEvidence {
  id: string;
  researchVersionId: string;
  sourceDocumentVersionId: string | null;
  fieldPath: string;
  excerpt: string;
  startOffset: number | null;
  endOffset: number | null;
  certainty: "explicit" | "inferred" | "low_confidence";
  note: string;
}

export interface ResearchCandidate {
  id: string;
  batchId: string;
  researchVersionId: string;
  targetTypeKey: string;
  title: string;
  values: Record<string, unknown>;
  relationCandidates: unknown[];
  evidenceIds: string[];
  mergeKey: string;
  confidence: number | null;
  status: "candidate" | "reference_only" | "ignored" | "adopted";
  revision: number;
}

export interface ResearchRecordDetail extends ResearchRecordSummary {
  versions: ResearchRecordVersion[];
  evidence: ResearchEvidence[];
  candidates: ResearchCandidate[];
}

export const MARKET_PLATFORMS = ["fanqie","qidian","jinjiang"] as const;
export type MarketPlatform = (typeof MARKET_PLATFORMS)[number];
export interface MarketSourceDefinition {platform:MarketPlatform;platformLabel:string;listKey:string;listLabel:string;channel:"general"|"male"|"female";sourceUrl:string;}
export interface MarketRankingItem {id:string;snapshotId:string;platform:MarketPlatform;listKey:string;listLabel:string;evidenceTier:"primary"|"supporting";rank:number;title:string;author:string;category:string;tags:string[];synopsis:string;heatLabel:string;serialStatus:string;sourceUrl:string;}
export interface MarketSourceSnapshot {id:string;researchVersionId:string;platform:MarketPlatform;listKey:string;listLabel:string;sourceUrl:string;status:"succeeded"|"failed"|"stale";error:string;capturedAt:string;items:MarketRankingItem[];}
export interface MarketScanDetail {record:ResearchRecordDetail;version:ResearchRecordVersion;isCurrent:boolean;snapshots:MarketSourceSnapshot[];}
export interface MarketSignalDraft {title:string;signalType:"genre"|"protagonist"|"advantage"|"opening"|"relationship"|"title"|"payoff"|"crowding"|"differentiation";summary:string;heat:"low"|"medium"|"high";crowding:"low"|"medium"|"high";trend:"rising"|"stable"|"falling"|"uncertain";platforms:MarketPlatform[];audience:string;differentiation:string;sourceRefs:string;observedAt:string;effectiveUntil:string;}
export interface MarketAnalysisResult {genre:string[];protagonistIdentities:string[];coreAdvantages:string[];openingPatterns:string[];relationshipHooks:string[];titlePatterns:string[];readerPayoffs:string[];crowdedTropes:string[];differentiationOpportunities:string[];evidenceBoundary:string;signals:MarketSignalDraft[];}
export const RESEARCH_RESOURCE_SPACE_ID="70000000-0000-4000-8000-000000000001";

export type BookAnalysisPurpose="reference_learning"|"continuation"|"diagnosis";
export type BookAnalysisPreset="quick"|"standard"|"full";
export interface BookAnalysisPlanTarget {typeKey:string;typeName:string;allowedFields:string[];maxCandidates:number;mergePolicy:"new_or_merge"|"reference_only";}
export interface BookAnalysisPlan {purpose:BookAnalysisPurpose;preset:BookAnalysisPreset;dimensions:string[];targetForms:Array<{key:string;name:string}>;targets:BookAnalysisPlanTarget[];evidenceRequired:boolean;candidateLimit:number;}
export interface BookAnalysisDimension {key:string;title:string;summary:string;strengths:string[];risks:string[];opportunities:string[];}
export interface BookAnalysisEvidenceDraft {fieldPath:string;excerpt:string;startOffset:number|null;endOffset:number|null;certainty:"explicit"|"inferred"|"low_confidence";note:string;}
export interface BookAnalysisCandidateDraft {targetTypeKey:string;title:string;values:Record<string,unknown>;evidenceIndexes:number[];confidence:number|null;}
export interface BookAnalysisResult {overview:string;dimensions:BookAnalysisDimension[];evidence:BookAnalysisEvidenceDraft[];candidates:BookAnalysisCandidateDraft[];copyrightBoundary:string;}

export interface ResearchReferencePackItem {researchVersionId:string;recordId:string;recordTitle:string;recordType:ResearchRecordType;recordVersion:number;purpose:string;weight:number;sortOrder:number;note:string;}
export interface ResearchReferencePackVersion {id:string;packId:string;version:number;note:string;items:ResearchReferencePackItem[];createdAt:string;}
export interface ResearchReferencePack {id:string;name:string;description:string;status:"draft"|"published"|"archived";revision:number;currentVersionId:string|null;currentVersion:number|null;versionCount:number;versions:ResearchReferencePackVersion[];createdAt:string;updatedAt:string;}
export interface ResearchPrefillConflict {typeKey:string;title:string;fieldKey:string;existingValue:unknown;suggestedValue:unknown;reason:string;}
export interface ResearchPrefillCard extends InitialCardDraft {researchVersionId:string;evidenceIds:string[];}
export interface ResearchReusePreview {researchVersionIds:string[];packVersionIds:string[];compiledSnapshot:Record<string,unknown>;suggestedCards:ResearchPrefillCard[];conflicts:ResearchPrefillConflict[];}
export interface BookResearchReference {id:string;bookId:string;researchVersionId:string|null;packVersionId:string|null;purpose:string;compiledSnapshot:Record<string,unknown>;createdAt:string;}

export type ChapterBodySource="manual"|"ai_candidate"|"revision"|"import";
export type ChapterBodyCreatorKind="user"|"ai"|"system"|"import";
export interface ChapterBodyVersion {id:string;chapterDocumentId:string;version:number;parentVersionId:string|null;baseVersionId:string|null;source:ChapterBodySource;sourceRunId:string|null;createdByKind:ChapterBodyCreatorKind;createdBy:string;content:string;contentHash:string;archivedAt:string|null;isAdopted:boolean;createdAt:string;}
export interface ChapterBodyAdoption {id:string;chapterDocumentId:string;fromVersionId:string|null;toVersionId:string;action:"adopt"|"rollback"|"readopt";documentRevision:number;idempotencyKey:string;actor:string;createdAt:string;}
export interface ChapterTextAnchor {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;subjectCardId:string|null;role:string;label:string;startOffset:number;endOffset:number;excerpt:string;fragmentHash:string;status:"active"|"archived";revision:number;isStale:boolean;createdAt:string;updatedAt:string;}
export interface ChapterDocumentSummary {id:string;bookId:string;chapterCardId:string;logicalOrder:number;title:string;status:"active"|"archived";adoptedVersionId:string|null;revision:number;createdAt:string;updatedAt:string;}
export interface ChapterDocumentDetail extends ChapterDocumentSummary {versions:ChapterBodyVersion[];adoptions:ChapterBodyAdoption[];anchors:ChapterTextAnchor[];}

export type CanonicalFactStatus="proposed"|"confirmed"|"rejected"|"superseded"|"stale";
export type CanonicalFactValueKind="text"|"number"|"boolean"|"json"|"card_reference";
export type CanonicalFactSourceMethod="manual"|"ai_extract"|"import"|"system";
export interface CanonicalFactEvidence {id:string;factId:string;chapterTextAnchorId:string|null;cardVersionId:string|null;researchEvidenceId:string|null;extractionMethod:CanonicalFactSourceMethod;note:string;staleAt:string|null;staleReason:string;createdAt:string;}
export interface CanonicalFactReviewAction {id:string;factId:string;action:"propose"|"confirm"|"reject"|"supersede"|"mark_stale";fromStatus:CanonicalFactStatus|null;toStatus:CanonicalFactStatus;idempotencyKey:string|null;actor:string;note:string;createdAt:string;}
export interface CanonicalFact {id:string;bookId:string;subjectCardId:string;predicate:string;valueKind:CanonicalFactValueKind;value:unknown;valueHash:string;objectCardId:string|null;validStoryStart:number|null;validStoryEnd:number|null;status:CanonicalFactStatus;confidence:number|null;sourceMethod:CanonicalFactSourceMethod;supersedesFactId:string|null;supersededByFactId:string|null;revision:number;createdBy:string;createdAt:string;updatedAt:string;evidence:CanonicalFactEvidence[];reviewActions:CanonicalFactReviewAction[];}
export interface CanonicalFactConflict {id:string;bookId:string;factAId:string;factBId:string;predicate:string;reason:string;status:"open"|"resolved"|"dismissed";resolutionFactId:string|null;revision:number;createdAt:string;resolvedAt:string|null;}

export type SettlementCapability="disabled"|"optional"|"required";
export type SettlementPolicy="none"|"tracked"|"derived"|"lifecycle_only";
export type StateSubjectKind="card"|"relation";
export interface StateTypeCapability {spaceId:string;typeKey:string;settlementCapability:SettlementCapability;stateMode:"none"|"field_state"|"lifecycle";defaultFieldPolicy:SettlementPolicy;revision:number;fieldPolicies:Array<{fieldKey:string;settlementPolicy:SettlementPolicy;stateMode:"absolute"|"delta"|"derived"|"lifecycle";revision:number}>;}
export interface StateRelationCapability {spaceId:string;relationKey:string;settlementCapability:SettlementCapability;stateMode:"none"|"relation_state"|"lifecycle";revision:number;dimensions:Array<{dimensionKey:string;label:string;direction:"forward"|"inverse"|"bidirectional";settlementPolicy:Exclude<SettlementPolicy,"none">;stateMode:"absolute"|"delta"|"derived"|"lifecycle";revision:number}>;}
export interface EntityInitialStateVersion {id:string;initialStateId:string;version:number;value:unknown;valueHash:string;sourceFactId:string|null;actor:string;note:string;createdAt:string;}
export interface EntityInitialState {id:string;bookId:string;subjectKind:StateSubjectKind;subjectId:string;stateKey:string;currentVersionId:string;revision:number;currentValue:unknown;versions:EntityInitialStateVersion[];createdAt:string;updatedAt:string;}
export interface StateChangeProposal {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;textAnchorId:string|null;causeEventCardId:string|null;subjectKind:StateSubjectKind;subjectId:string;stateKey:string;beforeValue:unknown;afterValue:unknown;delta:unknown;reason:string;effectiveStoryOrder:number|null;source:"ai"|"manual"|"import"|"system";status:"proposed"|"confirmed"|"rejected"|"invalidated";confirmedStateChangeId:string|null;revision:number;createdAt:string;updatedAt:string;}
export interface StateChange {id:string;sequence:number;bookId:string;settlementId:string;proposalId:string;chapterDocumentId:string;bodyVersionId:string;textAnchorId:string|null;causeEventCardId:string|null;subjectKind:StateSubjectKind;subjectId:string;stateKey:string;beforeValue:unknown;afterValue:unknown;delta:unknown;reason:string;effectiveStoryOrder:number|null;status:"active"|"reverted"|"invalidated";createdAt:string;}
export interface ChapterSettlement {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;status:"committed"|"reverted"|"superseded";revision:number;idempotencyKey:string;revertIdempotencyKey:string|null;actor:string;note:string;changes:StateChange[];committedAt:string;revertedAt:string|null;}
export interface CurrentStateProjection {bookId:string;subjectKind:StateSubjectKind;subjectId:string;stateKey:string;value:unknown;sourceInitialVersionId:string|null;sourceStateChangeId:string|null;projectionRevision:number;isStale:boolean;rebuiltAt:string;}
export interface StateMilestoneSnapshot {id:string;bookId:string;kind:"initial"|"volume_end"|"major_revision"|"body_switch"|"manual";label:string;chapterDocumentId:string|null;bodyVersionId:string|null;sourceSettlementId:string|null;projectionRevision:number;snapshot:Record<string,unknown>;status:"active"|"stale";createdAt:string;}
export interface StateValueMapping {id:string;spaceId:string;typeKey:string;fieldKey:string;currentVersionId:string;revision:number;currentVersion:number;ranges:Array<{min:number|null;max:number|null;label:string;value:string}>;promptComponentVersionId:string|null;note:string;createdAt:string;updatedAt:string;}

export type KnowledgeHolderKind="character"|"reader";
export type KnowledgeStance="knows"|"believes"|"suspects"|"misunderstands"|"unknown";
export type KnowledgeAcquisitionMethod="witnessed"|"told"|"inferred"|"read"|"narration"|"assumed"|"forgotten"|"manual";
export interface EpistemicClaim {id:string;bookId:string;subjectCardId:string|null;predicate:string;valueKind:CanonicalFactValueKind;value:unknown;objectCardId:string|null;valueHash:string;truthFactId:string|null;createdBy:string;createdAt:string;}
export interface KnowledgeStateProposalVersion {id:string;proposalId:string;version:number;stance:KnowledgeStance;confidence:number|null;acquisitionMethod:KnowledgeAcquisitionMethod;sourceCharacterCardId:string|null;sourceEventCardId:string|null;chapterDocumentId:string|null;bodyVersionId:string|null;textAnchorId:string|null;effectiveStoryOrder:number|null;effectiveNarrativeOrder:number|null;reason:string;editor:string;createdAt:string;}
export interface KnowledgeStateReviewAction {id:string;proposalId:string;proposalVersionId:string;action:"propose"|"edit"|"confirm"|"reject"|"invalidate";actor:string;note:string;idempotencyKey:string|null;createdAt:string;}
export interface KnowledgeStateProposal {id:string;bookId:string;claim:EpistemicClaim;holderKind:KnowledgeHolderKind;holderKey:string;holderCardId:string|null;currentVersionId:string;source:"ai"|"manual"|"import"|"system";status:"proposed"|"confirmed"|"rejected"|"invalidated";confirmedChangeId:string|null;revision:number;currentVersion:KnowledgeStateProposalVersion;versions:KnowledgeStateProposalVersion[];reviewActions:KnowledgeStateReviewAction[];createdAt:string;updatedAt:string;}
export interface KnowledgeStateChange {id:string;sequence:number;bookId:string;proposalId:string;proposalVersionId:string;claim:EpistemicClaim;holderKind:KnowledgeHolderKind;holderKey:string;holderCardId:string|null;stance:KnowledgeStance;confidence:number|null;effectiveStoryOrder:number|null;effectiveNarrativeOrder:number|null;status:"active"|"reverted"|"invalidated";confirmedBy:string;createdAt:string;}
export interface CurrentKnowledgeState {bookId:string;holderKind:KnowledgeHolderKind;holderKey:string;holderCardId:string|null;claim:EpistemicClaim;sourceChangeId:string;stance:KnowledgeStance;confidence:number|null;effectiveStoryOrder:number|null;effectiveNarrativeOrder:number|null;projectionRevision:number;rebuiltAt:string;}

export type StoryTimeProposalSource="ai"|"manual"|"import"|"system";
export type StoryEvidenceKind="manual"|"body"|"fact"|"plan_version"|"state_proposal"|"migration";
export type StoryEventLifecycle="planned"|"occurred"|"cancelled"|"invalidated";
export type StoryTimeMode="absolute"|"custom_calendar"|"relative"|"partial"|"unknown";
export type StoryTimeCertainty="known"|"partial"|"unknown";
export interface StoryTimeValue {lifecycle:StoryEventLifecycle;timeMode:StoryTimeMode;startCertainty:StoryTimeCertainty;endCertainty:StoryTimeCertainty;startInstant:string|null;endInstant:string|null;timezoneName:string|null;calendarKey:string|null;startLabel:string|null;endLabel:string|null;normalizedStart:number|null;normalizedEnd:number|null;durationValue:number|null;durationUnit:string|null;relativeToEventCardId:string|null;relativeRelation:"before"|"after"|"simultaneous"|null;relativeOffset:number|null;evidenceKind:StoryEvidenceKind;chapterDocumentId:string|null;bodyVersionId:string|null;textAnchorId:string|null;factId:string|null;planVersionId:string|null;stateProposalId:string|null;replacesTimingId:string|null;reason:string;}
export interface StoryTimeProposalVersion extends StoryTimeValue {id:string;proposalId:string;version:number;editor:string;createdAt:string;}
export interface StoryTimeReviewAction {id:string;proposalId:string;proposalVersionId:string;action:"propose"|"edit"|"confirm"|"reject"|"mark_stale"|"invalidate";actor:string;note:string;idempotencyKey:string|null;createdAt:string;}
export interface StoryTimeProposal {id:string;bookId:string;eventCardId:string;proposalSource:StoryTimeProposalSource;status:"proposed"|"confirmed"|"rejected"|"stale"|"invalidated";currentVersionId:string;confirmedTimingId:string|null;revision:number;currentVersion:StoryTimeProposalVersion;versions:StoryTimeProposalVersion[];reviewActions:StoryTimeReviewAction[];createdAt:string;updatedAt:string;}
export interface StoryEventTiming extends StoryTimeValue {id:string;sequence:number;bookId:string;eventCardId:string;proposalId:string|null;proposalVersionId:string|null;status:"active"|"superseded"|"stale"|"invalidated";confirmedBy:string;confirmedAt:string;}
export interface StoryNarrativeOccurrence {id:string;bookId:string;eventCardId:string;chapterCardId:string;sceneCardId:string|null;chapterDocumentId:string|null;bodyVersionId:string|null;textAnchorId:string|null;sourceTimeProposalVersionId:string|null;role:"mention"|"scene"|"reveal"|"retell"|"flashback"|"flashforward";narrativeOrder:number|null;sourceKind:"manual"|"body"|"system";note:string;status:"active"|"stale"|"archived";revision:number;createdAt:string;updatedAt:string;}
export type StoryRelationFamily="temporal"|"causal";
export type StoryRelationType="before"|"after"|"simultaneous"|"overlaps"|"contains"|"causes"|"enables"|"blocks"|"depends_on";
export interface StoryRelationValue {relationFamily:StoryRelationFamily;relationType:StoryRelationType;sourceEventCardId:string;targetEventCardId:string;evidenceKind:Exclude<StoryEvidenceKind,"migration">;chapterDocumentId:string|null;bodyVersionId:string|null;textAnchorId:string|null;factId:string|null;planVersionId:string|null;stateProposalId:string|null;confidence:number|null;reason:string;}
export interface StoryRelationProposalVersion extends StoryRelationValue {id:string;proposalId:string;version:number;editor:string;createdAt:string;}
export interface StoryRelationReviewAction {id:string;proposalId:string;proposalVersionId:string;action:"propose"|"edit"|"confirm"|"reject"|"mark_stale"|"invalidate";actor:string;note:string;idempotencyKey:string|null;createdAt:string;}
export interface StoryRelationProposal {id:string;bookId:string;proposalSource:StoryTimeProposalSource;status:"proposed"|"confirmed"|"rejected"|"stale"|"invalidated";currentVersionId:string;confirmedRelationId:string|null;revision:number;currentVersion:StoryRelationProposalVersion;versions:StoryRelationProposalVersion[];reviewActions:StoryRelationReviewAction[];createdAt:string;updatedAt:string;}
export interface StoryEventRelation {id:string;sequence:number;bookId:string;proposalId:string;proposalVersionId:string;relationFamily:StoryRelationFamily;relationType:Exclude<StoryRelationType,"after">;sourceEventCardId:string;targetEventCardId:string;confidence:number|null;status:"active"|"stale"|"invalidated";confirmedBy:string;reason:string;createdAt:string;}

export const BOOK_CREATION_METHODS = [
  "blank",
  "template",
  "idea",
  "inspiration",
  "market",
  "reference",
  "continuation",
] as const;

export type BookCreationMethod = (typeof BOOK_CREATION_METHODS)[number];

export interface InspirationCandidate {
  id: string;
  title: string;
  premise: string;
  audience: string;
  tone: string[];
  sortOrder: number;
}

export interface BookDirectionCandidate {
  id: string;
  title: string;
  premise: string;
  protagonist: string;
  centralConflict: string;
  readerPromise: string;
  styleKeywords: string[];
}

export interface InitialCardDraft {
  typeKey: string;
  title: string;
  values: Record<string, unknown>;
}

export type BookCreationStatus =
  | "draft"
  | "generating"
  | "waiting_direction"
  | "review"
  | "creating"
  | "completed"
  | "failed";

export interface BookCreationSession {
  id: string;
  method: BookCreationMethod;
  status: BookCreationStatus;
  stage: string;
  progress: number;
  templateVersionId: string;
  bookName: string;
  description: string;
  sourceReference: string;
  inputPayload: Record<string, unknown>;
  researchVersionIds: string[];
  researchPackVersionIds: string[];
  researchPreview: ResearchReusePreview | null;
  directionCandidates: BookDirectionCandidate[];
  selectedDirectionId: string | null;
  initialCards: InitialCardDraft[];
  lastFailedStage: string | null;
  errorMessage: string | null;
  bookId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiAssistBatch {
  id: string;
  bookId: string;
  cardId: string;
  formKey: string;
  status: "running" | "review" | "applied" | "failed" | "discarded";
  stage: string;
  progress: number;
  instruction: string;
  suggestions: Record<string, unknown>;
  baseRevision: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSyncPreview {
  id?: string;
  bookId: string;
  fromTemplateVersionId: string;
  toTemplateVersionId: string;
  additions: Array<{ typeKey: string; fields: FieldDefinition[] }>;
  conflicts: Array<{ typeKey: string; fieldKey: string; reason: string }>;
  status: "previewed" | "applied" | "dismissed";
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  issues?: Record<string, string>;
}

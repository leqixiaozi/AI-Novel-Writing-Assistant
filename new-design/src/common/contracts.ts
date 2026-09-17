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
  id?: string;
  value: string;
  label: string;
}

export interface FieldVisibilityRule {
  fieldKey: string;
  operator: "equals" | "not_equals" | "is_empty" | "is_not_empty" | "includes";
  value?: unknown;
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
  visibleWhen?: FieldVisibilityRule;
  aiSuggestible?: boolean;
  stateSettlement?: "none" | "tracked" | "lifecycle";
  hidden?: boolean;
  standardFieldId?: string | null;
  optionSource?: FieldOptionSource;
}

export type TreeScope = "system" | "template" | "book";
export type TreeKind = "dictionary" | "tag";
export type TreeSelectionMode = "single" | "multiple" | "cascade_single" | "cascade_multiple";
export type TreeDepthMode = "whole_tree" | "branch" | "direct_children" | "descendants" | "relative_depth";

export interface TreeSelectionRule {
  mode: TreeSelectionMode;
  rootNodeId: string | null;
  depthMode: TreeDepthMode;
  relativeDepth: number | null;
  leafOnly: boolean;
  allowParentSelection: boolean;
  showFullPath: boolean;
  allowInlineCreate: boolean;
  aiSuggestible: boolean;
  minSelections: number;
  maxSelections: number | null;
}

export type FieldOptionSource =
  | { kind: "inline" }
  | { kind: "dictionary_tree"; dictionaryId: string; rule: TreeSelectionRule; settleOnChapter: boolean };

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

export type FormResolutionKind = "installed_form" | "type_schema" | "system_default" | "generic" | "legacy";

export type FieldOrigin = "core" | "template" | "book_extension" | "local_supplement";
export type FieldScope = "book_type" | "card" | "card_mount";

export interface ScopedFieldVersion {
  id: string;
  version: number;
  field: FieldDefinition;
  createdBy: string;
  createdAt: string;
}

export interface ScopedFieldDefinition {
  id: string;
  spaceId: string;
  cardTypeId: string | null;
  cardId: string | null;
  cardMountId: string | null;
  fieldKey: string;
  origin: FieldOrigin;
  scope: FieldScope;
  status: "active" | "archived";
  revision: number;
  sourceTemplateVersionId: string | null;
  sourceTypeVersionId: string | null;
  sourceFormVersionId: string | null;
  currentVersion: ScopedFieldVersion;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScopedFieldBundle {
  definitions: ScopedFieldDefinition[];
  values: Record<string, unknown>;
}

export interface FieldExtensionPreview {
  scope: FieldScope;
  affectedCardCount: number;
  requiredNeedsDefault: boolean;
  canApply: boolean;
  messages: string[];
  expectedTypeRevision: number;
}

export interface AddInformationFieldInput {
  name: string;
  description: string;
  type: FieldType;
  options: Array<{ id?: string; label: string }>;
  required: boolean;
  group: string;
  defaultValue?: unknown;
  aiSuggestible: boolean;
  stateSettlement: "none" | "tracked" | "lifecycle";
  visibleWhen?: FieldVisibilityRule;
}

export interface FieldAdoptionReceipt {
  id: string;
  fieldDefinitionId: string;
  action: "create" | "revise" | "archive" | "template_addition";
  idempotencyKey: string;
  fromVersionId: string | null;
  toVersionId: string | null;
  createdAt: string;
}

export interface FieldSourceSummary {
  originLabel: "核心信息" | "模板信息" | "本书新增" | "仅此处补充";
  scopeLabel: "本书所有同类资料" | "当前资料" | "当前关联";
  sourceDetail: string;
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
  localValues: Record<string, unknown>;
  source: "create" | "edit" | "archive" | "restore";
  formVersionId: string | null;
  formVersion: number | null;
  formResolutionKind: FormResolutionKind;
  createdAt: string;
}

export type DefinitionScope = "system" | "template" | "book";

export interface DictionaryItem {
  id: string;
  key: string;
  label: string;
  description: string;
  parentId: string | null;
  value: Record<string, unknown>;
  sortOrder: number;
  status: "active" | "archived";
  revision: number;
  currentVersionId: string | null;
  path: Array<{ id: string; label: string }>;
  childCount: number;
  referenceCount: number;
}

export interface DictionarySummary {
  id: string;
  key: string;
  name: string;
  description: string;
  scope: DefinitionScope;
  ownerSpaceId: string | null;
  sourceDictionaryId: string | null;
  readOnly: boolean;
  status: "draft" | "published" | "archived";
  revision: number;
  items: DictionaryItem[];
  createdAt: string;
  updatedAt: string;
}

export interface TreeImpactPreview {
  treeKind: TreeKind;
  nodeId: string;
  action: "move" | "archive";
  descendantCount: number;
  directReferenceCount: number;
  affectedFieldCount: number;
  affectedCardCount: number;
  canApply: boolean;
  messages: string[];
}

export interface TagDimension {
  id: string;
  key: string;
  name: string;
  description: string;
  scope: TreeScope;
  ownerSpaceId: string | null;
  sourceDimensionId: string | null;
  status: "active" | "archived";
  revision: number;
  readOnly: boolean;
  nodes: MaterialTag[];
  createdAt: string;
  updatedAt: string;
}

export interface CardTypeTagBinding {
  id: string;
  cardTypeId: string;
  dimensionId: string;
  dimensionName: string;
  rule: TreeSelectionRule;
  required: boolean;
  displayArea: "main" | "sidebar" | "metadata";
  includeInFilters: boolean;
  includeInAiContext: boolean;
  revision: number;
}

export interface StandardFieldSemantic {
  id: string;
  name: string;
  description: string;
  dataType: FieldType;
  recommendedDictionaryId: string | null;
  applicableTypeKeys: string[];
  allowedSelectionModes: TreeSelectionMode[];
  settlementSuggestion: "none" | "tracked" | "lifecycle";
  status: "active" | "archived";
  revision: number;
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

/** Historical slots may contain only the four core attributes. New strict writes
 * validate full FieldDefinition; optional extensions preserve their actual contract
 * without pretending that old incomplete fields have already become formal specs. */
export interface FormLocalFieldDefinition extends
  Pick<FieldDefinition, "key" | "name" | "type" | "required">,
  Partial<Omit<FieldDefinition, "key" | "name" | "type" | "required">> {}

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

export interface AssociationSlotSpec extends CardGroupFormSlot {
  storage: "form_context";
  sectionName: string;
  relationName: string | null;
  relationDirection: "directed" | "undirected" | null;
}

export interface AssociationItem {
  id: string;
  slotKey: string;
  source: CardSummary;
  attachedSourceVersionId: string;
  attachedSourceRevision: number;
  sourceUpdated: boolean;
  sourceArchived: boolean;
  sortOrder: number;
  localValues: Record<string, unknown>;
  localFields: ScopedFieldDefinition[];
  revision: number;
  referenceCount: number;
}

export interface AssociationWorkspace {
  formId: string;
  formVersionId: string;
  formVersion: number;
  instanceId: string | null;
  instanceRevision: number | null;
  primaryCardId: string;
  slots: AssociationSlotSpec[];
  items: AssociationItem[];
}

export interface AssociationCandidate {
  id: string;
  typeKey: string;
  typeName: string;
  title: string;
  summary: string;
  revision: number;
  currentVersionId: string;
  referenceCount: number;
}

export interface AssociationMountVersion {
  id: string;
  revision: number;
  sourceVersionId: string;
  sourceRevision: number;
  sortOrder: number;
  localValues: Record<string, unknown>;
  status: "active" | "ended";
  createdBy: string;
  createdAt: string;
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

export const BOOK_VIEW_KEYS = ["chapters", "characters", "relations", "events", "clues", "props", "states", "rules", "comparison", "quality", "world", "resources"] as const;
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

export interface BookInsightChapter {
  chapterDocumentId:string;chapterCardId:string;title:string;logicalOrder:number;documentRevision:number;
  adoptedBodyVersionId:string|null;adoptedBodyVersion:number|null;candidateCount:number;stableCheckpointId:string|null;
  stableState:"stable"|"pending"|"stale";openIssueCount:number;pendingProposalCount:number;updatedAt:string;
}
export interface BookInsightFact {
  id:string;subjectCardId:string;subjectTitle:string;subjectTypeKey:string;predicate:string;value:unknown;
  status:"proposed"|"confirmed"|"rejected"|"superseded"|"stale";confidence:number|null;sourceMethod:string;updatedAt:string;
}
export interface BookInsightStateChange {
  id:string;subjectKind:"card"|"relation";subjectId:string;subjectTitle:string;subjectTypeKey:string|null;
  stateKey:string;beforeValue:unknown|null;afterValue:unknown;deltaValue:unknown|null;reason:string;
  chapterDocumentId:string;chapterTitle:string;bodyVersionId:string;anchorId:string|null;anchorLabel:string;
  effectiveStoryOrder:number|null;status:"active"|"reverted"|"invalidated";createdAt:string;
}
export interface BookInsightQualityItem {
  issueId:string;reportId:string;chapterDocumentId:string|null;chapterTitle:string;bodyVersionId:string|null;
  reportStale:boolean;reportStaleReason:string;categoryKey:string;qualityKind:"objective"|"subjective";
  severity:QualitySeverity;confidence:number|null;title:string;description:string;suggestedAction:string;
  status:QualityIssueStatus;isQualityDebt:boolean;revision:number;evidenceCount:number;fixCandidateCount:number;updatedAt:string;
}
export interface BookMultiviewStableReadContract {
  bookId:string;unresolvedClues:Array<{cardId:string;title:string;plantChapterId:string|null;revealChapterId:string|null}>;
  objectiveIssues:Array<{issueId:string;title:string;severity:QualitySeverity;chapterDocumentId:string|null}>;
  pendingOrStaleChapters:Array<{chapterDocumentId:string;title:string;state:"pending"|"stale"}>;
  unconfirmedFacts:Array<{factId:string;subjectTitle:string;predicate:string;status:string}>;
  failedTasks:Array<{taskId:string;taskKey:string;sourceRoute:string;updatedAt:string}>;
  stableExportRange:{throughChapterOrder:number;chapterDocumentId:string|null;checkpointId:string|null};generatedAt:string;
}
export interface BookMultiviewWorkspace {
  bookId:string;chapters:BookInsightChapter[];facts:BookInsightFact[];stateChanges:BookInsightStateChange[];
  qualityItems:BookInsightQualityItem[];stableRead:BookMultiviewStableReadContract;
}

export type CompletionCheckSeverity="blocker"|"warning"|"info";
export interface CompletionCheckResult {id:string;snapshotId:string;severity:CompletionCheckSeverity;ruleKey:string;title:string;detail:string;sourceKind:string;sourceId:string|null;sourceRoute:string;ordinal:number;createdAt:string;}
export interface CompletionSnapshotChapter {position:number;chapterDocumentId:string;bodyVersionId:string|null;stableCheckpointId:string|null;chapterOrder:number;title:string;state:"stable"|"pending"|"stale";bodyHash:string|null;updatedAtSnapshot:string;}
export interface BookCompletionSnapshot {id:string;bookId:string;ruleSetKey:string;ruleSetVersion:number;sourceHash:string;blockerCount:number;warningCount:number;infoCount:number;stableThroughOrder:number;chapterCount:number;createdBy:string;createdAt:string;results:CompletionCheckResult[];chapters:CompletionSnapshotChapter[];isCurrent:boolean;}
export interface BookLifecycleEvent {id:string;bookId:string;eventKind:"completion_checked"|"completed"|"reopened";snapshotId:string|null;actor:string;reason:string;createdAt:string;}
export type PublicationExportMode="formal"|"review_draft";
export type PublicationExportFormat="markdown"|"plain_text"|"docx";
export type PublicationExportRangeKind="book"|"volume"|"chapters";
export interface PublicationExportManifestChapter {position:number;chapterDocumentId:string;bodyVersionId:string;stableCheckpointId:string|null;volumeTitle:string;volumeOrder:number|null;chapterTitle:string;chapterOrder:number;bodyVersion:number;bodyHash:string;characterCount:number;updatedAtSnapshot:string;}
export interface PublicationExportManifest {id:string;bookId:string;completionSnapshotId:string|null;exportMode:PublicationExportMode;format:PublicationExportFormat;rangeKind:PublicationExportRangeKind;rangeRef:Record<string,unknown>;includeVersionManifest:boolean;ruleSetKey:string;ruleSetVersion:number;sourceHash:string;contentHash:string;chapterCount:number;characterCount:number;warningCount:number;createdBy:string;createdAt:string;chapters:PublicationExportManifestChapter[];}
export interface PublicationExportArtifact {id:string;requestId:string;manifestId:string;format:PublicationExportFormat;displayFilename:string;mediaType:string;checksum:string;byteSize:number;createdAt:string;downloadUrl:string;}
export interface PublicationExportRecord {requestId:string;manifest:PublicationExportManifest;jobId:string|null;jobStatus:BackgroundJobStatus|null;attemptCount:number;lastErrorSummary:string;artifact:PublicationExportArtifact|null;requestedBy:string;createdAt:string;}
export interface BookCompletionWorkspace {bookId:string;latestSnapshot:BookCompletionSnapshot|null;lifecycle:BookLifecycleEvent[];latestLifecycle:BookLifecycleEvent|null;exports:PublicationExportRecord[];volumes:Array<{id:string;title:string;sortOrder:number;chapterIds:string[]}>;}
export interface ReleaseGateAssessment {id:string;gateKey:string;outcome:"unexecuted"|"passed"|"failed"|"blocked";evidence:string;evidenceRef:string;assessedBy:string;assessedAt:string;}
export interface ReleaseGateItem {gateKey:string;category:"database"|"extensions"|"novel_flow"|"recovery"|"export"|"interface"|"isolation"|"packaging";title:string;acceptance:string;sortOrder:number;latest:ReleaseGateAssessment|null;}

export type MaterialFilterField = "content_type" | "tag" | "card_status" | "canonical_status" | "candidate_status" | "chapter" | "volume" | "story_time" | "relation_exists" | "association_exists" | "source" | "updated_at";
export type MaterialFilterOperator = "equals" | "not_equals" | "in" | "not_in" | "contains" | "exists" | "not_exists" | "gte" | "lte" | "between";
export interface MaterialFilterCondition { kind:"condition";field:MaterialFilterField;operator:MaterialFilterOperator;value?:string|string[]|number|boolean|null; }
export interface MaterialFilterGroup { kind:"group";operator:"and"|"or";items:MaterialFilterNode[]; }
export type MaterialFilterNode = MaterialFilterCondition | MaterialFilterGroup;
export type MaterialSortField = "title" | "content_type" | "updated_at" | "created_at" | "story_time";
export interface MaterialSortRule { field:MaterialSortField;direction:"asc"|"desc"; }

export interface MaterialTag {
  id:string;spaceId:string;key:string;name:string;aliases:string[];color:string|null;metadata:Record<string,unknown>;
  dimensionId:string|null;parentId:string|null;sortOrder:number;path:Array<{id:string;name:string}>;childCount:number;
  status:"active"|"archived";revision:number;currentVersionId:string;visibility:"space"|"private";memberCount:number;updatedAt:string;
}

export interface MaterialGroup {
  id:string;spaceId:string;bookId:string|null;key:string;name:string;parentId:string|null;sortOrder:number;
  status:"active"|"archived";revision:number;currentVersionId:string;visibility:"space"|"private";memberCount:number;updatedAt:string;
}

export interface SmartMaterialView {
  id:string;spaceId:string;bookId:string|null;key:string;baseViewKey:BookViewKey|null;name:string;description:string;
  filter:MaterialFilterNode;sort:MaterialSortRule[];grouping:{field?:string};displayColumns:string[];layout:{mode:"list"|"table";[key:string]:unknown};
  status:"active"|"archived";revision:number;version:number;currentVersionId:string;visibility:"space"|"private";updatedAt:string;
}

export interface MaterialMembershipSummary { cardId:string;tagIds:string[];groupIds:string[]; }
export interface MaterialManagementWorkspace {
  spaceId:string;bookId:string|null;tags:MaterialTag[];groups:MaterialGroup[];views:SmartMaterialView[];memberships:MaterialMembershipSummary[];
}

export interface MaterialQueryCard extends CardSummary {
  typeKey:string;tagIds:string[];groupIds:string[];storyTimeStart:number|null;
}
export interface MaterialQueryPage { items:MaterialQueryCard[];nextCursor:string|null;totalCapped:number; }

export interface CardArchiveImpactItem { key:string;label:string;count:number;level:"blocking"|"risk"|"recompute"|"information";samples:Array<{id:string;label:string}>; }
export interface CardArchivePreview {
  id:string;spaceId:string;bookId:string|null;cardId:string;expectedRevision:number;snapshotHash:string;confirmationToken:string;decision:"ready"|"risk_confirmation"|"blocked";
  expiresAt:string;impacts:CardArchiveImpactItem[];blockingCount:number;riskCount:number;recomputeCount:number;
}
export interface CardArchiveReceipt { id:string;card:CardSummary;riskAccepted:boolean;createdAt:string; }

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
export interface BookResearchAdoptionItem {id:string;sourceCandidateId:string;targetTypeKey:string;title:string;values:Record<string,unknown>;evidenceIds:string[];decision:"pending"|"adopt"|"reject";targetCardId:string|null;revision:number;sortOrder:number;}
export interface BookResearchAdoptionBatch {id:string;bookId:string;sourceKind:"research_version"|"reference_pack_version";sourceId:string;sourceLabel:string;sourceSnapshot:Record<string,unknown>;sourceUpdateAvailable:boolean;status:"draft"|"adopted"|"cancelled";revision:number;items:BookResearchAdoptionItem[];createdBy:string;createdAt:string;updatedAt:string;}

export type ChapterBodySource="manual"|"ai_candidate"|"revision"|"import";
export type ChapterBodyCreatorKind="user"|"ai"|"system"|"import";
export type ChapterWritingOperation="manual_draft"|"copy"|"continue"|"rewrite"|"expand"|"shorten"|"dialogue"|"conflict"|"fix"|"regenerate";
export interface ChapterBodyVersion {id:string;chapterDocumentId:string;version:number;parentVersionId:string|null;baseVersionId:string|null;source:ChapterBodySource;sourceRunId:string|null;operationKind:ChapterWritingOperation;planningObjectId:string|null;planningVersionId:string|null;contextManifestId:string|null;taskContractVersionId:string|null;promptRecipeVersionId:string|null;modelRouteSnapshotId:string|null;aiTaskId:string|null;aiAttemptId:string|null;inputBodyVersionId:string|null;selectionStart:number|null;selectionEnd:number|null;createdByKind:ChapterBodyCreatorKind;createdBy:string;content:string;contentHash:string;archivedAt:string|null;isAdopted:boolean;createdAt:string;}
export interface ChapterBodyAdoption {id:string;chapterDocumentId:string;fromVersionId:string|null;toVersionId:string;action:"adopt"|"rollback"|"readopt";documentRevision:number;idempotencyKey:string;actor:string;createdAt:string;}
export interface ChapterTextAnchor {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;subjectCardId:string|null;role:string;label:string;startOffset:number;endOffset:number;excerpt:string;fragmentHash:string;status:"active"|"archived";revision:number;isStale:boolean;createdAt:string;updatedAt:string;}
export interface ChapterDocumentSummary {id:string;bookId:string;chapterCardId:string;logicalOrder:number;title:string;status:"active"|"archived";adoptedVersionId:string|null;revision:number;createdAt:string;updatedAt:string;}
export interface ChapterDocumentDetail extends ChapterDocumentSummary {versions:ChapterBodyVersion[];adoptions:ChapterBodyAdoption[];anchors:ChapterTextAnchor[];}
export type ChapterWritingRequestStatus="preparing"|"queued"|"running"|"succeeded"|"failed"|"cancelled"|"unavailable"|"stale";
export interface ChapterWritingRequest {id:string;bookId:string;chapterDocumentId:string;operationKind:Exclude<ChapterWritingOperation,"manual_draft"|"copy">;planningObjectId:string;planningVersionId:string;planningContentHash:string;contextManifestId:string;taskContractVersionId:string;promptRecipeVersionId:string;modelRouteSnapshotId:string;inputBodyVersionId:string|null;inputBodyHash:string|null;selectionStart:number|null;selectionEnd:number|null;instruction:string;expectedDocumentRevision:number;aiTaskId:string|null;resultBodyVersionId:string|null;status:ChapterWritingRequestStatus;errorSummary:string;createdBy:string;createdAt:string;updatedAt:string;idempotencyKey?:string;modelResultSaved?:boolean;ledgerPending?:boolean;leaseExpired?:boolean;controlled?:boolean;unclaimed?:boolean;}
export interface ChapterAdoptionPreparation {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;expectedDocumentRevision:number;planningObjectId:string;planningVersionId:string;planningContentHash:string;contextManifestId:string|null;dependencySnapshot:Record<string,unknown>;dependencyHash:string;status:"prepared"|"consumed"|"stale"|"cancelled";idempotencyKey:string;createdBy:string;createdAt:string;}
export interface ChapterWritingChapter {chapterCardId:string;planningObjectId:string;volumePlanningObjectId:string|null;volumeTitle:string;title:string;logicalOrder:number;hasAdoptedPlan:boolean;planningVersionId:string|null;planningVersionNumber:number|null;documentId:string|null;documentRevision:number|null;candidateCount:number;adoptedBodyVersionId:string|null;settlementSessionId:string|null;settlementBodyVersionId:string|null;pendingRequestCount:number;openIssueCount:number;state:"needs_plan"|"ready"|"writing"|"review"|"adopted"|"settlement_pending"|"stable"|"settlement_failed"|"impact_review_required"|"revision_running"|"revision_partial_failure"|"downstream_review";updatedAt:string;}
export interface ChapterWritingCapability {configured:boolean;taskKey:string|null;taskContractVersionId:string|null;message:string;}
export interface ChapterWritingWorkspace {bookId:string;chapters:ChapterWritingChapter[];aiCapability:ChapterWritingCapability;updatedAt:string;}
export type ChapterSettlementCategory="fact"|"knowledge"|"character_state"|"relationship"|"prop"|"event"|"foreshadow";
export type ChapterSettlementRisk="low"|"medium"|"high"|"critical";
export type ChapterSettlementDecision="pending"|"confirm"|"reject"|"defer";
export type ChapterAdoptionSessionStatus="reviewing"|"adopted_pending_proposals"|"pending_review"|"partially_confirmed"|"settling"|"stable"|"failed"|"impact_review_required"|"cancelled";
export interface SettlementPolicyVersion {id:string;bookId:string;version:number;autoConfirmLowRisk:boolean;allowedAutoCategories:ChapterSettlementCategory[];majorFactCategories:string[];confidenceFloor:number;createdBy:string;note:string;createdAt:string;}
export interface ChapterSettlementItem {id:string;sessionId:string;category:ChapterSettlementCategory;majorCategory:string|null;title:string;canonicalFactId:string|null;knowledgeProposalId:string|null;stateProposalId:string|null;evidenceAnchorId:string;riskLevel:ChapterSettlementRisk;confidence:number|null;confidenceNote:string;planAlignment:"matches"|"deviates"|"missing"|"not_applicable";planExpectation:string;beforeValue:unknown;changeValue:unknown;afterValue:unknown;sourceKind:"manual"|"ai";sourceTaskId:string|null;sourceAttemptId:string|null;decision:ChapterSettlementDecision;decisionSource:"user"|"policy"|null;decisionNote:string;revision:number;evidence:{label:string;excerpt:string;startOffset:number;endOffset:number};subjectId:string;subjectKind:"card"|"relation";subjectLabel:string;stateKey:string;createdAt:string;updatedAt:string;}
export interface ChapterAdoptionSession {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;preparationId:string;priorBodyVersionId:string|null;adoptionId:string|null;settlementId:string|null;policyVersionId:string;planningObjectId:string;planningVersionId:string;contextManifestId:string|null;dependencyHash:string;adoptionKind:"first_adoption"|"body_switch";status:ChapterAdoptionSessionStatus;revision:number;idempotencyKey:string;createdBy:string;errorSummary:string;createdAt:string;updatedAt:string;}
export interface ChapterSettlementWorkspace {session:ChapterAdoptionSession;policy:SettlementPolicyVersion;candidate:ChapterBodyVersion;priorBody:ChapterBodyVersion|null;items:ChapterSettlementItem[];counts:{pending:number;confirm:number;reject:number;defer:number;majorPending:number};subjects:Array<{id:string;subjectKind:"card"|"relation";title:string;typeKey:string}>;aiCapability:ChapterWritingCapability;expectedChanges:string[];updatedAt:string;}
export interface ChapterSettlementDraft {category:ChapterSettlementCategory;majorCategory?:string|null;title:string;subjectKind?:"card"|"relation";subjectId?:string;subjectCardId?:string;stateKey:string;beforeValue:unknown;changeValue?:unknown;afterValue:unknown;valueKind?:CanonicalFactValueKind;objectCardId?:string|null;holderKind?:KnowledgeHolderKind;holderKey?:string;holderCardId?:string|null;stance?:KnowledgeStance;acquisitionMethod?:KnowledgeAcquisitionMethod;riskLevel:ChapterSettlementRisk;confidence?:number|null;confidenceNote?:string;planAlignment?:"matches"|"deviates"|"missing"|"not_applicable";planExpectation?:string;evidenceStart:number;evidenceEnd:number;evidenceLabel:string;reason:string;}
export interface ChapterProposalExtractionRequest {id:string;sessionId:string;bookId:string;bodyVersionId:string;taskContractVersionId:string;promptRecipeVersionId:string;contextManifestId:string;modelRouteSnapshotId:string;aiTaskId:string|null;status:ChapterWritingRequestStatus;idempotencyKey:string;errorSummary:string;createdBy:string;createdAt:string;updatedAt:string;}
export interface ChapterStableCheckpoint {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;sessionId:string;settlementId:string;previousCheckpointId:string|null;chapterOrder:number;summary:Record<string,unknown>;dependencyHash:string;status:"stable"|"stale"|"superseded";createdAt:string;}
export interface NextChapterStableContext {bookId:string;chapterCardId:string;previousCheckpoint:ChapterStableCheckpoint|null;adoptedPlan:AdoptedChapterPlanContract;confirmedFacts:Array<{id:string;subjectCardId:string;predicate:string;value:unknown}>;recentStateChanges:Array<{id:string;subjectId:string;stateKey:string;afterValue:unknown}>;knowledgeChanges:Array<{id:string;holderKey:string;stance:KnowledgeStance;claimId:string}>;sourceVersions:{bodyVersionId:string|null;settlementId:string|null;planningVersionId:string};generatedAt:string;}
export interface ChapterBodySwitchImpactContract {sessionId:string;chapterDocumentId:string;oldBody:ChapterBodyVersion|null;newBody:ChapterBodyVersion;oldSettlementId:string|null;oldCheckpoint:ChapterStableCheckpoint|null;downstreamDependencies:Array<{resourceKind:string;stableKey:string;currentVersionId:string;invalidatedAt:string|null}>;executionAllowed:false;generatedAt:string;}
export type ChapterRevisionImpactCategory="fact"|"knowledge"|"character_state"|"relationship"|"prop"|"event"|"foreshadow"|"later_body"|"planning"|"context"|"quality"|"ai_run"|"graph_index"|"semantic_index"|"other";
export type ChapterRevisionAction="auto_recompute"|"review_manually"|"mark_stale"|"keep_manual_correction"|"defer";
export interface ChapterRevisionImpact {id:string;previewId:string;sequence:number;category:ChapterRevisionImpactCategory;targetKind:string;targetId:string;targetVersionId:string|null;targetChapterDocumentId:string|null;targetChapterOrder:number|null;sourceMode:"exclusive"|"shared"|"manual_correction"|"manual_locked"|"derived_cache"|"downstream_body";riskLevel:ChapterSettlementRisk;reasonChain:string[];recommendedAction:ChapterRevisionAction;allowedActions:ChapterRevisionAction[];activeSourceCount:number;manualProtected:boolean;detail:Record<string,unknown>;}
export interface ChapterRevisionPreview {id:string;bookId:string;sessionId:string;chapterDocumentId:string;oldBodyVersionId:string;newBodyVersionId:string;oldSettlementId:string;oldCheckpointId:string;restartCheckpointId:string|null;expectedDocumentRevision:number;bodyDiffSummary:{oldCharacters:number;newCharacters:number;changedCharacters:number;commonPrefix:number;commonSuffix:number};impactSummary:Record<string,number>;snapshotHash:string;status:"ready"|"consumed"|"expired"|"cancelled";revision:number;createdBy:string;createdAt:string;updatedAt:string;}
export interface ChapterRevisionPlanItem {id:string;impactId:string;selectedAction:ChapterRevisionAction;decisionSource:"default"|"user";note:string;revision:number;}
export interface ChapterRevisionPlan {id:string;previewId:string;bookId:string;expectedPreviewRevision:number;expectedDocumentRevision:number;reason:string;status:"draft"|"confirmed"|"executing"|"completed"|"partially_failed"|"failed"|"cancelled";summary:Record<string,number>;revision:number;createdBy:string;confirmedBy:string|null;confirmedAt:string|null;items:ChapterRevisionPlanItem[];}
export interface ChapterRevisionExecution {id:string;planId:string;previewId:string;bookId:string;chapterDocumentId:string;oldBodyVersionId:string;newBodyVersionId:string;oldCheckpointId:string;restartCheckpointId:string|null;adoptionId:string;invalidationEventId:string|null;status:"queued"|"running"|"awaiting_review"|"partially_failed"|"stable"|"failed"|"cancelled"|"dead_letter";currentStep:number;totalSteps:number;revision:number;errorSummary:string;createdAt:string;updatedAt:string;completedAt:string|null;steps:Array<{id:string;sequence:number;chapterDocumentId:string|null;chapterOrder:number|null;stepKind:"invalidate_source"|"recompute_chapter"|"review_body"|"rebuild_graph"|"rebuild_semantic";selectedAction:ChapterRevisionAction;status:"blocked"|"queued"|"running"|"candidate_ready"|"review_required"|"succeeded"|"failed"|"cancelled"|"dead_letter"|"skipped";backgroundJobId:string|null;errorSummary:string;}>;}
export interface ChapterRevisionWorkspace {preview:ChapterRevisionPreview;oldBody:ChapterBodyVersion;newBody:ChapterBodyVersion;impacts:ChapterRevisionImpact[];plan:ChapterRevisionPlan|null;execution:ChapterRevisionExecution|null;confirmation:{pointerMoves:boolean;invalidateCount:number;preserveCount:number;reviewCount:number;recomputeCount:number;highRiskUnresolved:number};updatedAt:string;}
export interface ChapterRevisionStableReadContract {bookId:string;chapterDocumentId:string|null;currentImpacts:Array<{id:string;revision:number;executionId:string;changedChapterDocumentId:string;targetChapterDocumentId:string;targetBodyVersionId:string|null;status:string;reason:string;sourceRoute:string;manualProtected:boolean;updatedAt:string}>;executions:Array<{id:string;chapterDocumentId:string;oldBodyVersionId:string;newBodyVersionId:string;status:string;currentStep:number;totalSteps:number;updatedAt:string}>;safeCheckpoint:ChapterStableCheckpoint|null;generatedAt:string;}

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

export type PlanningLevel="story"|"volume"|"chapter"|"scene";
export type PlanningVersionSource="manual"|"ai"|"import"|"system"|"body_revision";
export type PlanningVersionStatus="draft"|"proposed"|"adopted"|"superseded"|"rejected";
export type PlanningExecutionMode="manual"|"ai_assisted"|"automatic";
export type PlanningReferenceRole="viewpoint"|"location"|"participant"|"event"|"foreshadow"|"item"|"organization";
export type ForeshadowPlanAction="plant"|"reinforce"|"recover"|"misdirect"|"reveal";
export interface PlanningReference {id:string;planningVersionId:string;role:PlanningReferenceRole;cardId:string;cardVersionId:string;cardTypeKey:string;cardTypeName:string;title:string;action:ForeshadowPlanAction|null;note:string;sortOrder:number;}
export interface PlanningVersion {id:string;objectId:string;bookId:string;version:number;baseVersionId:string|null;basedOnParentVersionId:string|null;source:PlanningVersionSource;status:PlanningVersionStatus;executionMode:PlanningExecutionMode;content:Record<string,unknown>;contentHash:string;sourceBodyVersionId:string|null;references:PlanningReference[];createdBy:string;staleAt:string|null;staleReason:string;createdAt:string;}
export interface PlanningAdoption {id:string;objectId:string;bookId:string;fromVersionId:string|null;toVersionId:string;action:"adopt"|"rollback"|"readopt";objectRevision:number;source:"user"|"system"|"import";actor:string;contentHash:string;idempotencyKey:string;createdAt:string;}
export interface PlanningVersionAction {id:string;objectId:string;versionId:string;action:"create"|"edit"|"reject"|"mark_stale"|"archive"|"restore";actor:string;note:string;createdAt:string;}
export interface PlanningObject {id:string;bookId:string;level:PlanningLevel;parentObjectId:string|null;cardId:string|null;title:string;sortOrder:number;status:"active"|"archived";currentVersionId:string;adoptedVersionId:string|null;revision:number;currentVersion:PlanningVersion;adoptedVersion:PlanningVersion|null;versions:PlanningVersion[];adoptions:PlanningAdoption[];actions:PlanningVersionAction[];createdAt:string;updatedAt:string;}
export interface PlanningTreeNode {object:PlanningObject;children:PlanningTreeNode[];}
export interface PlanningVersionContext {version:PlanningVersion;object:PlanningObject;ancestors:Array<{object:PlanningObject;version:PlanningVersion}>;children:Array<{object:PlanningObject;version:PlanningVersion}>;}
export interface PlanningImpact {id:string;bookId:string;adoptionId:string;sourceObjectId:string;sourceFromVersionId:string;sourceToVersionId:string;targetKind:"plan_version"|"chapter_body"|"story_time"|"story_relation"|"context"|"generation_task"|"analysis";targetId:string;status:"pending_review"|"resolved"|"dismissed";reason:string;createdAt:string;resolvedAt:string|null;}
export interface PlanningMaterialOption {cardId:string;cardVersionId:string;typeKey:string;typeName:string;title:string;updatedAt:string;}
export interface PlanningAiCapability {configured:boolean;taskKey:string|null;taskContractVersionId:string|null;message:string;}
export interface PlanningAiCandidateRun {id:string;bookId:string;planningObjectId:string;planningVersionId:string;status:"completed";instruction:string;createdAt:string;completedAt:string;object:PlanningObject;}
export interface PlanningCenterWorkspace {bookId:string;objects:PlanningObject[];materials:PlanningMaterialOption[];settlementSummary:{stable:number;pending:number;failed:number;impactReview:number;revisionRunning:number;revisionFailed:number;downstreamReview:number};aiCapability:PlanningAiCapability;updatedAt:string;}
export interface BookOverviewMetric {key:string;label:string;value:number|null;unit:string;state:"ready"|"attention"|"unknown";detail:string;sourceLabel:string;sourceRoute:string;updatedAt:string|null;}
export interface BookMaterialReadiness {typeKey:string;typeName:string;categoryName:string;activeCount:number;requiredFieldCount:number;filledRequiredFieldCount:number;state:"ready"|"needs_input"|"unavailable";sourceRoute:string;updatedAt:string|null;}
export interface BookOverviewRecentTask {id:string;taskKey:string;status:string;sourceRoute:string;updatedAt:string;}
export interface BookOverview {bookId:string;direction:{planningObjectId:string;planningVersionId:string;title:string;summary:string;updatedAt:string}|null;materials:BookMaterialReadiness[];metrics:BookOverviewMetric[];recentTasks:BookOverviewRecentTask[];context:{state:"ready"|"attention"|"unknown";adoptedRuleCount:number;latestPreviewStatus:string|null;detail:string;sourceRoute:string;updatedAt:string|null};updatedAt:string;}
export interface AdoptedChapterPlanContract {bookId:string;planningObjectId:string;planningObjectRevision:number;chapterCardId:string;chapterCardVersionId:string;planningVersionId:string;planningVersionNumber:number;planningContentHash:string;executionMode:PlanningExecutionMode;content:Record<string,unknown>;references:PlanningReference[];basedOnVolumePlanVersionId:string;updatedAt:string;}

export type ContractVersionStatus="draft"|"proposed"|"published"|"superseded"|"rejected";
export interface PromptRecipeComponentBinding {id:string;slotId:string;componentCardId:string;componentVersionId:string;sortOrder:number;required:boolean;componentType:string;componentKey:string;}
export interface PromptRecipeSlot {id:string;recipeVersionId:string;slotKey:string;sortOrder:number;required:boolean;allowedContentTypes:string[];variableContract:Record<string,unknown>;components:PromptRecipeComponentBinding[];}
export interface PromptRecipeVersion {id:string;recipeId:string;version:number;baseVersionId:string|null;source:"manual"|"ai"|"import"|"system";status:ContractVersionStatus;variablesSchema:Record<string,unknown>;contentHash:string;createdBy:string;slots:PromptRecipeSlot[];createdAt:string;}
export interface PromptRecipe {id:string;recipeKey:string;name:string;description:string;status:"active"|"archived";currentVersionId:string;publishedVersionId:string|null;revision:number;currentVersion:PromptRecipeVersion;publishedVersion:PromptRecipeVersion|null;versions:PromptRecipeVersion[];createdAt:string;updatedAt:string;}
export interface TaskContractVersion {id:string;contractId:string;version:number;baseVersionId:string|null;source:"manual"|"ai"|"import"|"system";status:ContractVersionStatus;taskGroup:string;inputSchema:Record<string,unknown>;inputSchemaVersion:string;outputSchema:Record<string,unknown>;outputSchemaVersion:string;contextPolicyVersion:string;promptRecipeVersionId:string;requiredCapabilities:string[];budgetPolicy:Record<string,unknown>;timeoutMs:number;retryPolicy:Record<string,unknown>;confirmationPolicy:"none"|"before_execute"|"before_adopt"|"always";contentHash:string;createdBy:string;createdAt:string;}
export interface TaskContract {id:string;taskKey:string;name:string;description:string;status:"active"|"archived";currentVersionId:string;publishedVersionId:string|null;revision:number;currentVersion:TaskContractVersion;publishedVersion:TaskContractVersion|null;versions:TaskContractVersion[];createdAt:string;updatedAt:string;}
export type ContextSourceType="card_version"|"card_relation"|"body_version"|"text_anchor"|"planning_version"|"canonical_fact"|"knowledge_state_change"|"state_change"|"story_time"|"story_event_relation"|"research_document_version"|"research_version"|"research_pack_version"|"prompt_component"|"retrieval_chunk"|"asset_version";
export type ContextScopeKind="system"|"public"|"task_group"|"task_node"|"book"|"volume"|"chapter"|"scene"|"one_time";
export type ContextInheritanceMode="inherit"|"override"|"exclude";
export type ContextActivationField="task_key"|"task_group"|"content_type"|"tag"|"material_status"|"canonical_status"|"volume"|"chapter"|"scene"|"story_range"|"relation_exists"|"association_exists"|"source_type"|"stale"|"manual_switch";
export type ContextActivationOperator="equals"|"not_equals"|"in"|"not_in"|"contains"|"exists"|"not_exists"|"gte"|"lte"|"between"|"enabled";
export interface ContextActivationCondition {kind:"condition";field:ContextActivationField;operator:ContextActivationOperator;value?:string|string[]|number|boolean|null;}
export interface ContextActivationGroup {kind:"group";operator:"and"|"or";items:ContextActivationRule[];}
export type ContextActivationRule=ContextActivationCondition|ContextActivationGroup;
export type ContextSelectorKind="explicit_source"|"card_type"|"tag"|"smart_view"|"relation"|"story_range"|"research_pack"|"prompt_component"|"retrieval_trace";
export interface ContextSourceSelector {id?:string;sortOrder:number;selectorKind:ContextSelectorKind;sourceType:ContextSourceType;stableObjectId:string|null;exactVersionId:string|null;config:Record<string,unknown>;}
export interface ContextBindingVersion {id:string;bindingId:string;version:number;baseVersionId:string|null;inheritanceMode:ContextInheritanceMode;activationRule:ContextActivationRule;slotKey:string;priority:number;contentRole:"required"|"reference";tokenBudget:number;trimStrategy:"none"|"lowest_priority"|"largest_first";dedupeStrategy:"exact_version"|"stable_source";status:"draft"|"adopted"|"superseded"|"archived";contentHash:string;selectors:ContextSourceSelector[];createdBy:string;createdAt:string;}
export interface ContextBinding {id:string;spaceId:string|null;bookId:string|null;bindingKey:string;scopeKind:ContextScopeKind;scopeRef:string|null;name:string;description:string;status:"active"|"archived";revision:number;currentVersionId:string;adoptedVersionId:string|null;currentVersion:ContextBindingVersion;adoptedVersion:ContextBindingVersion|null;versions:ContextBindingVersion[];createdBy:string;updatedBy:string;createdAt:string;updatedAt:string;}
export interface ResolvedContextBinding {bindingId:string;bindingKey:string;name:string;scopeKind:ContextScopeKind;scopeRef:string|null;layerRank:number;layerLabel:string;inheritanceMode:ContextInheritanceMode;version:ContextBindingVersion;active:boolean;activationReason:string;}
export interface ContextResolution {bookId:string;taskKey:string;taskGroup:string;taskNodeKey:string;layers:ResolvedContextBinding[];effective:ResolvedContextBinding[];excluded:ResolvedContextBinding[];}
export interface ContextPreviewDecision {id:string;bindingVersionId:string|null;slotKey:string;sourceType:ContextSourceType;stableObjectId:string;exactVersionId:string;sourceRevision:number;sourceHash:string;sourceLabel:string;contentRole:"required"|"reference";priority:number;tokenEstimate:number;decision:"included"|"excluded"|"deduped"|"trimmed";reasonCode:"rule_match"|"manual_include"|"rule_inactive"|"scope_excluded"|"duplicate"|"binding_budget"|"total_budget"|"required_over_budget"|"source_unavailable"|"source_stale";reasonDetail:string;layerRank:number;layerLabel:string;retrievalRunId:string|null;retrievalRank:number|null;sortOrder:number;}
export interface ContextPreview {id:string;bookId:string;taskContractVersionId:string;promptRecipeVersionId:string;volumeId:string|null;chapterId:string|null;sceneId:string|null;taskNodeKey:string;taskGroup:string;status:"complete"|"invalid"|"stale"|"timed_out";totalBudget:number;requiredTokens:number;referenceTokens:number;includedTokens:number;remainingTokens:number;candidateCount:number;includedCount:number;decisionSummary:Record<string,number|string[]>;sourceSetHash:string;timeoutMs:number;staleAt:string|null;staleReason:string;bindings:ResolvedContextBinding[];decisions:ContextPreviewDecision[];createdBy:string;createdAt:string;}
export interface ContextSnapshotSummary {id:string;bookId:string;taskContractVersionId:string;promptRecipeVersionId:string;modelRouteSnapshotId:string;nodeKey:string|null;status:"finalized";manifestHash:string;sourceSetHash:string;includedCount:number;excludedCount:number;totalTokens:number;finalizedAt:string;createdBy:string;}
export interface ContextRetrievalTrace {retrievalRunId:string;generationId:string;profileVersionId:string;returnedSourceCount:number;traceHash:string;}
export interface ContextManifestEntry {id:string;slotId:string;sourceType:ContextSourceType;stableObjectId:string;exactVersionId:string|null;sourceSpaceId:string|null;contentHash:string;inclusionReason:string;priority:number;tokenEstimate:number;transformStatus:"full"|"truncated"|"summarized";sortOrder:number;bindingVersionId?:string|null;previewDecisionId?:string|null;sourceRevision?:number|null;contentRole?:"required"|"reference"|null;layerLabel?:string;}
export interface ContextManifestExclusion {id:string;slotId:string;sourceType:string;stableObjectId:string|null;exactVersionId:string|null;reasonCode:"invalid_reference"|"wrong_book"|"wrong_version"|"slot_type_mismatch"|"lower_priority"|"token_budget"|"duplicate"|"stale"|"unavailable";reasonDetail:string;priority:number|null;tokenEstimate:number|null;sortOrder:number;}
export interface ContextManifestSlot {id:string;slotKey:string;sortOrder:number;required:boolean;tokenBudget:number|null;entries:ContextManifestEntry[];exclusions:ContextManifestExclusion[];}
export interface ContextManifest {id:string;bookId:string;taskContractVersionId:string;promptRecipeVersionId:string;nodeKey:string|null;status:"complete"|"invalid"|"finalized";manifestHash:string;createdBy:string;slots:ContextManifestSlot[];createdAt:string;previewId?:string|null;volumeId?:string|null;chapterId?:string|null;sceneId?:string|null;taskGroup?:string|null;modelRouteSnapshotId?:string|null;sourceSetHash?:string|null;decisionSummary?:Record<string,unknown>;finalizedAt?:string|null;retrievalTraces?:ContextRetrievalTrace[];}
export type ModelRouteScope="system_default"|"task_group"|"task"|"node"|"book"|"one_time";
export type TechnicalFallbackCategory="timeout"|"rate_limit"|"authentication"|"provider_unavailable"|"transport"|"context_limit";
export interface ModelRouteFallback {provider:string;model:string;parameters:Record<string,unknown>;technicalFailureCategories:TechnicalFallbackCategory[];hasCredential:boolean;sortOrder:number;}
export interface ModelRouteVersion {id:string;configId:string;version:number;baseVersionId:string|null;source:"manual"|"import"|"system";status:"draft"|"published"|"superseded"|"rejected";provider:string|null;model:string|null;parameters:Record<string,unknown>|null;requiredCapabilities:string[]|null;hasCredential:boolean;budgetPolicy:Record<string,unknown>|null;timeoutMs:number|null;retryPolicy:Record<string,unknown>|null;fallbackMode:"inherit"|"replace";contentHash:string;createdBy:string;fallbacks:ModelRouteFallback[];createdAt:string;}
export interface ModelRouteConfig {id:string;scope:ModelRouteScope;taskGroup:string|null;taskKey:string|null;nodeKey:string|null;bookId:string|null;overrideKey:string|null;name:string;status:"active"|"archived";currentVersionId:string;publishedVersionId:string|null;revision:number;currentVersion:ModelRouteVersion;publishedVersion:ModelRouteVersion|null;versions:ModelRouteVersion[];createdAt:string;updatedAt:string;}
export interface ModelCredentialRef {id:string;credentialKey:string;provider:string;status:"active"|"disabled";hasLocator:true;createdAt:string;updatedAt:string;}
export interface ResolvedModelRoute {provider:string;model:string;parameters:Record<string,unknown>;requiredCapabilities:string[];hasCredential:boolean;budgetPolicy:Record<string,unknown>;timeoutMs:number;retryPolicy:Record<string,unknown>;fallbacks:ModelRouteFallback[];sourceLayers:Array<{scope:ModelRouteScope;configId:string;versionId:string}>;policyVersion:string;}
export interface ModelRouteSnapshot extends ResolvedModelRoute {id:string;bookId:string;taskContractVersionId:string;nodeKey:string|null;snapshotHash:string;createdAt:string;}
export interface AiRunPromptSection {id:string;slotKey:string;sectionKind:"instruction"|"formal_data"|"reference"|"output_contract";label:string;sourceRefs:Array<Record<string,unknown>>;tokenEstimate:number;sortOrder:number;contentHash:string;}
export interface AiRunPreview {id:string;spaceId:string;bookId:string;taskKey:string;taskGroup:string;taskNodeKey:string;sourceRoute:string;sourceKind:string;sourceId:string|null;taskContractVersionId:string;promptRecipeVersionId:string;contextPreviewId:string;contextManifestId:string;modelRouteSnapshotId:string;inputSnapshot:Record<string,unknown>;/** Read-only schema from this exact frozen contract version; absent means execution is blocked. */inputSchema?:Record<string,unknown>;inputHash:string;safeCheckpoint:Record<string,unknown>;budgetSnapshot:Record<string,unknown>;promptPlan:Record<string,unknown>;routePlan:Record<string,unknown>;blockers:string[];previewHash:string;status:"ready"|"blocked"|"stale"|"submitted";revision:number;sections:AiRunPromptSection[];aiTaskId:string|null;createdBy:string;createdAt:string;updatedAt:string;}
export interface AiRunStableReadContract {bookId:string;connectedEntryPoints:Array<{key:string;label:string;sourceRoute:string}>;unconnectedEntryPoints:Array<{key:string;label:string;reason:string}>;recentRuns:AiRunPreview[];generatedAt:string;}

export type AiTaskStatus="queued"|"running"|"waiting_approval"|"retry_scheduled"|"paused"|"succeeded"|"failed"|"cancelled";
export type AiAttemptStatus="queued"|"running"|"succeeded"|"failed"|"cancelled"|"discarded";
export type AiFailureCategory="timeout"|"rate_limit"|"authentication"|"provider_unavailable"|"transport"|"context_limit"|"structure_parse"|"content_unsatisfactory"|"cancelled"|"safety"|"data_integrity"|"unknown";
export interface AiTaskStateEvent {id:string;taskId:string;stepId:string|null;attemptId:string|null;entityKind:"task"|"step"|"attempt";fromStatus:string|null;toStatus:string;checkpointKey:string|null;reasonCode:string;reasonDetail:string;actorKind:"user"|"worker"|"system"|"policy";actor:string;entityRevision:number|null;createdAt:string;}
export interface AiTaskAttempt {id:string;taskId:string;stepId:string;attemptNumber:number;triggerKind:"initial"|"technical_retry"|"manual_retry"|"recovery";status:AiAttemptStatus;taskContractVersionId:string;promptRecipeVersionId:string;contextManifestId:string;modelRouteSnapshotId:string;inputHash:string;outputSchemaVersion:string;checkpointKey:string|null;hasProviderRequestId:boolean;resultKind:string|null;resultStableId:string|null;resultVersionId:string|null;resultHash:string|null;errorCategory:AiFailureCategory|null;retryEligibility:"technical"|"manual"|"none"|null;errorSummary:string;startedAt:string|null;endedAt:string|null;createdAt:string;}
export interface AiTaskStep {id:string;taskId:string;stepKey:string;sortOrder:number;status:AiTaskStatus;checkpointKey:string|null;currentAttemptId:string|null;maxAttempts:number;retryCount:number;nextRetryAt:string|null;leaseOwner:string|null;leaseExpiresAt:string|null;heartbeatAt:string|null;revision:number;attempts:AiTaskAttempt[];createdAt:string;updatedAt:string;completedAt:string|null;}
export interface AiApprovalRequest {id:string;taskId:string;stepId:string|null;attemptId:string|null;requestVersion:number;scopeKind:"task"|"step"|"attempt"|"result_candidate";scopeId:string;reasonCode:string;reasonDetail:string;requestHash:string;requestedByKind:"worker"|"system"|"policy"|"user";requestedBy:string;decision:AiApprovalDecision|null;createdAt:string;}
export interface AiApprovalDecision {id:string;requestId:string;taskId:string;decision:"approved"|"rejected"|"changes_requested"|"expired";decidedByKind:"user"|"system"|"policy";decidedBy:string;policyVersion:string|null;reason:string;createdAt:string;}
export interface AiAttemptUsage {id:string;taskId:string;stepId:string;attemptId:string;provider:string;model:string;inputTokens:number|null;outputTokens:number|null;cachedInputTokens:number|null;durationMs:number|null;estimatedCost:number|null;currency:string|null;fallbackCount:number;budgetDecision:"unknown"|"within_budget"|"exceeded";createdAt:string;}
export interface AiTaskSummary {id:string;spaceId:string;bookId:string|null;taskKey:string;taskContractVersionId:string;sourceRoute:string;sourceKind:string;sourceId:string|null;priority:number;status:AiTaskStatus;currentStepKey:string|null;currentCheckpoint:string|null;revision:number;createdBy:string;createdAt:string;updatedAt:string;completedAt:string|null;}
export interface AiTaskDetail extends AiTaskSummary {steps:AiTaskStep[];events:AiTaskStateEvent[];approvals:AiApprovalRequest[];usage:AiAttemptUsage[];}
export interface AiAttemptLease {task:AiTaskSummary;step:AiTaskStep;attempt:AiTaskAttempt;leaseToken:string;}
export interface AiTaskPage {items:AiTaskSummary[];nextCursor:string|null;}
export interface AiUsageSummary {taskCount:number;attemptCount:number;totalAttemptCount:number;unrecordedAttemptCount:number;unknownCostAttemptCount:number;inputTokens:number|null;outputTokens:number|null;cachedInputTokens:number|null;durationMs:number|null;estimatedCost:number|null;currency:string|null;fallbackCount:number;unknownUsageCount:number;}

export type QualityIssueStatus="open"|"acknowledged"|"deferred"|"dismissed"|"fix_proposed"|"fixed"|"verified"|"stale"|"superseded";
export type QualitySeverity="info"|"low"|"medium"|"high"|"critical";
export type QualityPolicyMode="completion_first"|"quality_first";
export type QualityPolicyDecision="continue"|"record_quality_debt"|"pause_for_manual"|"replan_required"|"no_usable_body"|"runtime_safety_failure";
export type QualityEvidenceKind="text_anchor"|"canonical_fact"|"state_change"|"story_time"|"story_relation"|"planning_version"|"rule"|"observation"|"card_field"|"relation_field";
export interface QualityIssueEvidence {materialKind?:"card"|"relation"|null;materialId?:string|null;cardVersionId?:string|null;relationVersionId?:string|null;fieldKey?:string|null;fieldSpecVersionId?:string|null;fieldSpecHash?:string|null;observedValueHash?:string|null;}
export interface QualityIssueEvidence {id:string;issueVersionId:string;evidenceKind:QualityEvidenceKind;textAnchorId:string|null;factId:string|null;stateChangeId:string|null;storyTimingId:string|null;storyRelationId:string|null;planningVersionId:string|null;ruleKey:string|null;ruleVersion:string|null;note:string;isUnverifiedObservation:boolean;createdAt:string;}
export interface QualityIssueVersion {id:string;issueId:string;version:number;baseVersionId:string|null;categoryKey:string;severity:QualitySeverity;confidence:number|null;title:string;description:string;detectionSource:"ai"|"rule"|"manual"|"import"|"system";impactScope:Record<string,unknown>;suggestedAction:string;targetValue:unknown|null;observedValue:unknown|null;scaleVersion:string|null;interpretation:string;createdBy:string;evidence:QualityIssueEvidence[];createdAt:string;}
export interface QualityIssueEvent {id:string;issueId:string;issueVersionId:string|null;fromStatus:QualityIssueStatus|null;toStatus:QualityIssueStatus;action:string;actorKind:"user"|"ai"|"system"|"policy";actor:string;reason:string;issueRevision:number;createdAt:string;}
export interface QualityFixCandidateVersion {id:string;candidateId:string;version:number;baseVersionId:string|null;targetChapterDocumentId:string|null;targetBodyVersionId:string|null;targetAnchorId:string|null;targetCardId?:string|null;targetCardVersionId?:string|null;targetFieldKey?:string|null;targetFieldSpecVersionId?:string|null;targetFieldSpecHash?:string|null;targetBeforeHash?:string|null;patch:Record<string,unknown>;contentHash:string;source:"ai"|"user";createdBy:string;createdAt:string;}
export interface QualityFixCandidateEvent {id:string;candidateId:string;candidateVersionId:string|null;fromStatus:string|null;toStatus:string;action:"propose"|"revise"|"accept"|"reject"|"apply"|"mark_stale"|"supersede";actor:string;reason:string;candidateRevision:number;createdAt:string;}
export interface QualityFixAdoption {id:string;candidateId:string;candidateVersionId:string;chapterBodyAdoptionId:string|null;adoptedBodyVersionId:string|null;adoptedCardVersionId?:string|null;authorWriteRequestKey?:string|null;idempotencyKey:string;actor:string;createdAt:string;}
export interface QualityFixCandidate {id:string;bookId:string;issueId:string;status:"proposed"|"accepted"|"rejected"|"applied"|"superseded"|"stale";currentVersionId:string;acceptedVersionId:string|null;revision:number;versions:QualityFixCandidateVersion[];events:QualityFixCandidateEvent[];adoption:QualityFixAdoption|null;createdAt:string;updatedAt:string;}
export interface QualityIssue {id:string;bookId:string;reportId:string;stableKey:string;currentVersionId:string;currentStatus:QualityIssueStatus;isQualityDebt:boolean;revision:number;currentVersion:QualityIssueVersion;versions:QualityIssueVersion[];events:QualityIssueEvent[];fixCandidates:QualityFixCandidate[];createdAt:string;updatedAt:string;}
export interface QualityMaterialVersion {kind:"card"|"relation";id:string;versionId:string;snapshotHash:string;}
export interface QualityRecheck {id:string;bookId:string;issueId:string;fixCandidateId:string|null;sourceReportId:string;recheckReportId:string;checkedBodyVersionId:string|null;checkedMaterialVersions?:QualityMaterialVersion[];outcome:"supports_verified"|"still_present"|"inconclusive";evidenceSummary:string;status:"active"|"stale";idempotencyKey:string;actor:string;createdAt:string;staleAt:string|null;staleReason:string;}
export interface QualityAuditReportSummary {id:string;bookId:string;scopeKind:"book"|"chapter"|"body"|"planning"|"fact"|"composite";scopeId:string|null;taskId:string;stepId:string;attemptId:string;taskContractVersionId:string;promptRecipeVersionId:string;contextManifestId:string;modelRouteSnapshotId:string;ruleSetKey:string;ruleSetVersion:string;inputHash:string;policyMode:QualityPolicyMode;policyDecision:QualityPolicyDecision;executionEffect:"continue"|"quality_debt"|"pause_for_manual"|"global_stop";summary:string;createdBy:string;createdAt:string;staleAt:string|null;staleReason:string;}
export interface QualityAuditReport extends QualityAuditReportSummary {bodyVersions:Array<{chapterDocumentId:string;bodyVersionId:string}>;planningVersions:Array<{planningObjectId:string;planningVersionId:string}>;materialVersions?:QualityMaterialVersion[];factIds:string[];issues:QualityIssue[];rechecks:QualityRecheck[];}
export interface QualityAuditPage {items:QualityAuditReportSummary[];nextCursor:string|null;}

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

export type BookCreationReviewSource = "template" | "ai" | "research" | "resource" | "manual";

export interface BookCreationReviewCard extends InitialCardDraft {
  id: string;
  sourceKind: BookCreationReviewSource;
  sourceId: string | null;
  sourceVersionId: string | null;
  originalTitle: string;
  originalValues: Record<string, unknown>;
  aiFieldBatchIds?: Record<string,string>;
}

export interface BookCreationReviewType {
  key: string;
  name: string;
  description: string;
  fields: FieldDefinition[];
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
  reviewCards: BookCreationReviewCard[];
  reviewTypes: BookCreationReviewType[];
  formalReview?: import("./bookCreationProduction").BookCreationFormalReview | null;
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
  treeAdditions?: {
    dictionaries:Array<{sourceId:string;key:string;name:string;description:string;items:Array<{sourceId:string;parentSourceId:string|null;key:string;label:string;description:string;value:Record<string,unknown>;sortOrder:number}>}>;
    tagDimensions:Array<{sourceId:string;key:string;name:string;description:string;nodes:Array<{sourceId:string;parentSourceId:string|null;key:string;name:string;description:string;aliases:string[];color:string|null;metadata:Record<string,unknown>;sortOrder:number}>}>;
    tagBindings:Array<{sourceTypeId:string;sourceDimensionId:string;config:Record<string,unknown>}>;
  };
  conflicts: Array<{ typeKey: string; fieldKey: string; reason: string }>;
  status: "previewed" | "applied" | "dismissed";
}

export type DependencyResourceKind =
  | "card_type_version" | "template_group_version" | "card_version" | "card_relation" | "card_mount"
  | "tag_version" | "tag_membership" | "material_group_version" | "group_membership" | "smart_view_version"
  | "research_document_version" | "research_record_version" | "research_reference_pack_version"
  | "chapter_body_version" | "chapter_text_anchor" | "canonical_fact" | "chapter_settlement"
  | "state_change" | "knowledge_state_change" | "story_event_timing" | "story_event_relation"
  | "planning_version" | "prompt_recipe_version" | "task_contract_version" | "context_binding_version" | "context_preview" | "context_manifest" | "semantic_retrieval_run"
  | "model_route_snapshot" | "ai_task_attempt" | "quality_audit_report" | "asset_version"
  | "embedding_source_snapshot" | "embedding_chunk" | "embedding_result" | "embedding_index_generation";
export type DependencyKind = "generated_from" | "planned_from" | "validated_against" | "evidenced_by" | "context_included" | "configured_by" | "settled_from" | "audited_from" | "derived_from";
export type DependencyStrength = "hard" | "soft";
export type DependencyResourceState = "fresh" | "stale" | "invalid" | "needs_review" | "recompute_pending" | "recomputing" | "recomputed" | "accepted_stale";

export interface DependencyResource {id:string;resourceKind:DependencyResourceKind;spaceId:string|null;bookId:string|null;stableObjectId:string;exactVersionId:string;contentHash:string;registeredAt:string;}
export interface DependencyEdge {id:string;spaceId:string;bookId:string;source:DependencyResource;derived:DependencyResource;dependencyKind:DependencyKind;dependencyStrength:DependencyStrength;originKind:"adoption"|"confirmation"|"settlement"|"contract_publication"|"context_build"|"ai_result"|"audit"|"manual"|"import"|"system";originId:string|null;idempotencyKey:string|null;status:"active"|"ended";createdAt:string;endedAt:string|null;endReason:string;}
export interface DependencyConflict {id:string;bookId:string;conflictKind:"cycle"|"cross_book"|"invalid_reference";sourceResourceId:string|null;derivedResourceId:string|null;dependencyKind:string|null;detectedPath:string[];status:"needs_review"|"resolved"|"dismissed";detail:string;idempotencyKey:string;createdAt:string;resolvedAt:string|null;resolutionNote:string;}
export interface DependencyImpact {id:string;eventId:string;resourceId:string;depth:number;propagationPath:string[];dependencyStrength:DependencyStrength;impactState:"stale"|"invalid"|"needs_review";createdAt:string;}
export interface DependencyChangePreview {id:string;bookId:string;bookChangeSetId:string|null;oldResourceId:string;newResourceId:string|null;reason:string;impacts:DependencyImpact[];snapshotHash:string;idempotencyKey:string;createdBy:string;createdAt:string;}
export interface DependencyInvalidationEvent {id:string;spaceId:string;bookId:string;oldResourceId:string;newResourceId:string|null;changePreviewId:string|null;bookChangeSetId:string|null;reason:string;triggerSource:"body_adoption"|"planning_adoption"|"fact_review"|"settlement"|"knowledge_review"|"story_time_review"|"story_relation_review"|"contract_publication"|"quality_stale"|"manual"|"system";requestedState:"stale"|"invalid"|"needs_review";triggerId:string|null;idempotencyKey:string;createdAt:string;impacts:DependencyImpact[];}
export interface DependencyStaleReason {id:string;bookId:string;resourceId:string;eventId:string;impactId:string;state:"stale"|"invalid"|"needs_review";reason:string;createdAt:string;resolvedAt:string|null;resolutionKind:"recomputed"|"accepted_stale"|"superseded"|null;resolutionReceiptId:string|null;}
export interface DependencyResourceStatus {resourceId:string;bookId:string;state:DependencyResourceState;revision:number;lastEventId:string|null;updatedAt:string;reasons:DependencyStaleReason[];}
export interface DependencyRecomputeRequest {id:string;bookId:string;targetResourceId:string;invalidationEventId:string;requiredUpstreamVersions:Array<{resourceId:string;kind:DependencyResourceKind;stableObjectId:string;exactVersionId:string;contentHash:string}>;priority:number;status:"pending"|"recomputing"|"completed"|"failed"|"superseded"|"cancelled";reason:string;strategyKey:string;taskContractVersionId:string|null;idempotencyKey:string;createdAt:string;startedAt:string|null;completedAt:string|null;}
export interface DependencyRecomputeReceipt {id:string;requestId:string;bookId:string;inputDependencySnapshot:DependencyRecomputeRequest["requiredUpstreamVersions"];inputSnapshotHash:string;outputResourceId:string|null;outputVersionId:string|null;outputHash:string|null;outcome:"applied"|"rejected_stale"|"failed";detail:string;idempotencyKey:string;createdAt:string;}
export interface DependencyStaleAcceptance {id:string;bookId:string;resourceId:string;invalidationEventId:string;riskSummary:string;reason:string;actor:string;idempotencyKey:string;createdAt:string;}
export interface DependencyBookSummary {bookId:string;activeEdges:number;staleResources:number;pendingRecomputes:number;openConflicts:number;invalidations:number;}
export interface DependencyPage<T> {items:T[];nextCursor:string|null;}

export type AssetKind="attachment"|"cover"|"illustration"|"audio"|"video"|"document"|"dataset"|"font"|"other";
export type AssetMountOwnerKind="book"|"card_version"|"chapter_body_version"|"research_record_version"|"prompt_recipe_version"|"ai_task_attempt"|"quality_issue_evidence";
export interface AssetContentObject {id:string;checksumAlgorithm:"sha256";checksum:string;byteSize:number;mimeType:string;storageKind:"managed_file"|"external_object";storageProvider:string;storageLocator:string;integrityState:"pending"|"verified"|"missing"|"corrupt";lastVerifiedAt:string|null;createdBy:string;createdAt:string;}
export interface AssetContentIntegrityCheck {id:string;contentObjectId:string;expectedChecksum:string;observedChecksum:string|null;expectedByteSize:number;observedByteSize:number|null;outcome:"verified"|"missing"|"corrupt";detail:string;checkedBy:string;checkedAt:string;}
export interface AssetVersion {id:string;assetId:string;bookId:string;version:number;contentObject:AssetContentObject;baseVersionId:string|null;derivedFromVersionId:string|null;sourceKind:"upload"|"import"|"ai_generated"|"derived"|"external_reference"|"migration";sourceResourceId:string|null;displayFilename:string;title:string;metadata:Record<string,unknown>;rebuildable:boolean;createdBy:string;createdAt:string;}
export interface AssetAdoption {id:string;assetId:string;bookId:string;fromVersionId:string|null;toVersionId:string;action:"adopt"|"rollback"|"readopt";assetRevision:number;dependencyPreviewId:string|null;idempotencyKey:string;actor:string;createdAt:string;}
export interface AssetEvent {id:string;assetId:string;bookId:string;assetVersionId:string|null;action:"create"|"add_version"|"adopt"|"rollback"|"readopt"|"archive";fromStatus:string|null;toStatus:string|null;assetRevision:number;dependencyPreviewId:string|null;idempotencyKey:string|null;actor:string;detail:string;createdAt:string;}
export interface AssetMount {id:string;bookId:string;assetId:string;assetVersionId:string;ownerKind:AssetMountOwnerKind;ownerStableId:string;ownerExactVersionId:string;role:string;label:string;status:"active"|"ended";idempotencyKey:string;createdBy:string;createdAt:string;endedAt:string|null;endReason:string;}
export interface AssetDerivationEvent {id:string;derivationId:string;fromStatus:string|null;toStatus:AssetDerivation["status"];action:"request"|"start"|"complete"|"fail"|"reject_stale"|"mark_stale"|"queue_rebuild"|"archive";actor:string;detail:string;derivationRevision:number;createdAt:string;}
export interface AssetDerivationResult {id:string;derivationId:string;bookId:string;sourceAssetVersionId:string;expectedSourceChecksum:string;observedCurrentSourceVersionId:string|null;outputContentObjectId:string|null;outputAssetVersionId:string|null;outputChecksum:string|null;outcome:"applied"|"rejected_stale"|"failed";detail:string;idempotencyKey:string;createdAt:string;}
export interface AssetDerivation {id:string;bookId:string;sourceAssetVersionId:string;outputAssetId:string;derivativeKind:"thumbnail"|"ocr_text"|"transcode"|"frame_extract"|"parsed_text"|"cover_variant"|"other";recipeKey:string;recipeVersion:string;toolKey:string;toolVersion:string;parameters:Record<string,unknown>;parametersHash:string;expectedSourceChecksum:string;expectedOutputAssetRevision:number;expectedOutputCurrentVersionId:string|null;status:"pending"|"processing"|"succeeded"|"failed"|"stale"|"rebuild_pending"|"archived";revision:number;idempotencyKey:string;createdBy:string;createdAt:string;updatedAt:string;events:AssetDerivationEvent[];results:AssetDerivationResult[];}
export interface Asset {id:string;spaceId:string;bookId:string;assetKey:string;assetKind:AssetKind;title:string;status:"active"|"archived";currentVersionId:string|null;revision:number;createdBy:string;createdAt:string;updatedAt:string;archivedAt:string|null;}
export interface AssetDetail extends Asset {versions:AssetVersion[];adoptions:AssetAdoption[];events:AssetEvent[];mounts:AssetMount[];derivations:AssetDerivation[];}
export interface AssetBookSummary {bookId:string;activeAssets:number;contentObjects:number;activeMounts:number;pendingDerivations:number;staleDerivedAssets:number;missingOrCorruptObjects:number;totalBytes:number;}

export type GraphProjectionSourceKind="book"|"card_version"|"chapter_body_version"|"canonical_fact"|"knowledge_state_change"|"state_change"|"state_projection"|"story_event_timing"|"story_event_timing_link"|"story_event_relation"|"planning_version"|"research_record_version"|"asset_version"|"card_relation"|"planning_parent"|"research_reference"|"research_reference_pack_item"|"asset_mount";
export interface GraphProjectionAvailability {available:boolean;code:"ready"|"age_extension_missing"|"age_load_failed"|"graph_missing"|"configuration_missing";detail:string;graphName:string|null;extensionVersion:string|null;}
export interface GraphProjectionConfig {graphName:string;mappingVersion:number;maxDepth:number;maxResults:number;statementTimeoutMs:number;status:"active"|"disabled";}
export interface GraphProjectionGeneration {id:string;bookId:string;generation:number;mappingVersion:number;status:"building"|"ready"|"active"|"failed"|"superseded";sourceWatermark:Record<string,unknown>;vertexCount:number;edgeCount:number;projectionChecksum:string|null;errorCode:string;errorDetail:string;retryable:boolean;startedAt:string;completedAt:string|null;activatedAt:string|null;}
export interface GraphProjectionBookState {bookId:string;activeGenerationId:string|null;status:"idle"|"building"|"active"|"degraded"|"unavailable";lastRequestAt:string|null;lastSuccessAt:string|null;lastErrorCode:string;lastErrorDetail:string;revision:number;updatedAt:string;activeGeneration:GraphProjectionGeneration|null;}
export interface GraphProjectionRequest {id:string;bookId:string;generationId:string|null;requestKind:"incremental_upsert"|"tombstone"|"full_rebuild";dependencyResourceId:string|null;sourceKind:string|null;sourceId:string|null;sourceVersionId:string|null;sourceRevision:number|null;sourceHash:string|null;reason:string;status:"pending"|"processing"|"succeeded"|"failed"|"superseded";attemptCount:number;idempotencyKey:string;lastErrorCode:string;lastErrorDetail:string;retryable:boolean;createdAt:string;startedAt:string|null;completedAt:string|null;}
export interface GraphProjectionBatch {id:string;requestId:string;bookId:string;generationId:string;mode:"incremental"|"full_rebuild";status:"running"|"succeeded"|"failed";sourceWatermark:Record<string,unknown>;processedCount:number;vertexCount:number;edgeCount:number;checksum:string|null;startedAt:string;completedAt:string|null;}
export interface GraphProjectionFailure {id:string;requestId:string;batchId:string|null;bookId:string;generationId:string|null;stage:string;errorCode:string;errorDetail:string;retryable:boolean;createdAt:string;}
export interface GraphProjectionSourceMapping {id:string;bookId:string;generationId:string;elementKind:"vertex"|"edge";graphLabel:string;graphElementKey:string;sourceKind:string;sourceId:string;sourceVersionId:string;sourceRevision:number;sourceHash:string;projectionHash:string;status:"active"|"tombstoned";projectedAt:string;tombstonedAt:string|null;}
export type GraphTraversalKind="neighbors"|"shortest_path"|"character_network"|"event_causal_chain"|"clue_links"|"item_links"|"location_links";
export interface GraphSourceRef {sourceKind:string;sourceId:string;sourceVersionId:string;sourceRevision:number;sourceHash:string;title:string;}
export interface GraphTraversalEdge extends GraphSourceRef {relationKind:string;}
export interface GraphTraversalPath {nodes:GraphSourceRef[];edges:GraphTraversalEdge[];hops:number;}
export interface GraphTraversalResult {bookId:string;generationId:string;queryKind:GraphTraversalKind;paths:GraphTraversalPath[];truncated:boolean;}
export interface GraphProjectionHealth {availability:GraphProjectionAvailability;config:GraphProjectionConfig|null;state:GraphProjectionBookState;pendingRequests:number;failedRequests:number;activeMappings:number;}

export type EmbeddingSourceKind="card_version"|"chapter_body_version"|"canonical_fact"|"knowledge_state_change"|"state_change"|"story_event_timing"|"story_event_relation"|"planning_version"|"research_document_version"|"research_record_version"|"research_reference_pack_version"|"prompt_component"|"ai_task_attempt"|"quality_issue_evidence"|"asset_parsed_text";
export type EmbeddingDistanceMetric="cosine"|"l2"|"inner_product";
export interface EmbeddingProfileVersion {id:string;profileId:string;version:number;providerKey:string;modelKey:string;dimensions:number;connectionVersionId?:string|null;distanceMetric:EmbeddingDistanceMetric;normalize:boolean;chunkerKey:string;chunkerVersion:string;maxChunkChars:number;overlapChars:number;allowedSourceKinds:EmbeddingSourceKind[];contentHash:string;createdBy:string;createdAt:string;}
export interface EmbeddingProfile {id:string;profileKey:string;name:string;purpose:"semantic_retrieval"|"similarity"|"clustering";status:"active"|"archived";currentVersionId:string|null;revision:number;currentVersion:EmbeddingProfileVersion|null;createdBy:string;createdAt:string;updatedAt:string;}
export interface EmbeddingSourceSnapshot {id:string;spaceId:string;bookId:string;profileVersionId:string;dependencySourceResourceId:string;sourceKind:EmbeddingSourceKind;sourceStableId:string;sourceVersionId:string;sourceRevision:number;sourceHash:string;title:string;contentText:string;chunkRecipeHash:string;status:"current"|"stale"|"archived";createdBy:string;createdAt:string;staleAt:string|null;}
export interface EmbeddingChunk {id:string;bookId:string;sourceSnapshotId:string;profileVersionId:string;ordinal:number;anchorKind:"whole"|"character_range"|"json_pointer"|"text_anchor"|"section";anchor:Record<string,unknown>;chunkText:string;tokenEstimate:number;contentHash:string;chunkerVersion:string;status:"current"|"stale"|"archived";createdAt:string;staleAt:string|null;}
export interface EmbeddingRequest {id:string;bookId:string;chunkId:string;profileVersionId:string;expectedSourceHash:string;expectedChunkHash:string;status:"pending"|"running"|"retry_scheduled"|"succeeded"|"failed"|"stale"|"cancelled";attemptCount:number;idempotencyKey:string;nextRetryAt:string|null;lastErrorCode:string;lastErrorDetail:string;retryable:boolean;createdAt:string;updatedAt:string;}
export interface EmbeddingAttempt {id:string;requestId:string;attemptNumber:number;status:"running"|"succeeded"|"failed"|"discarded";providerRequestRef:string|null;errorCode:string;errorDetail:string;retryable:boolean;startedAt:string;endedAt:string|null;}
export interface EmbeddingResult {id:string;requestId:string;attemptId:string;chunkId:string;profileVersionId:string;observedSourceHash:string;observedChunkHash:string;outcome:"applied"|"rejected_stale"|"failed";vectorHash:string|null;detail:string;createdAt:string;}
export interface EmbeddingRequestDetail extends EmbeddingRequest {attempts:EmbeddingAttempt[];results:EmbeddingResult[];}
export interface EmbeddingIndexGeneration {id:string;bookId:string;profileVersionId:string;generation:number;status:"building"|"verifying"|"ready"|"active"|"retired"|"failed"|"stale";indexName:string;expectedVectorCount:number;indexedVectorCount:number;coverage:number;checksum:string|null;errorCode:string;errorDetail:string;retryable:boolean;createdBy:string;createdAt:string;verifiedAt:string|null;activatedAt:string|null;retiredAt:string|null;}
export interface EmbeddingCoverage {bookId:string;profileId:string;currentSources:number;currentChunks:number;embeddedChunks:number;missingChunks:number;staleArtifacts:number;failedRequests:number;activeGeneration:EmbeddingIndexGeneration|null;}
export interface EmbeddingStaleReason {id:string;bookId:string;targetKind:"source_snapshot"|"chunk"|"embedding_result"|"index_generation";targetId:string;invalidationEventId:string|null;reasonCode:"source_changed"|"source_archived"|"profile_superseded"|"chunker_changed"|"late_receipt"|"dependency_invalidated"|"manual";detail:string;status:"open"|"resolved"|"accepted";createdAt:string;resolvedAt:string|null;}
export interface SemanticRetrievalResult {rank:number;chunkId:string;sourceKind:EmbeddingSourceKind;sourceStableId:string;sourceVersionId:string;sourceRevision:number;sourceHash:string;vectorScore:number;ftsScore:number;trigramScore:number;finalScore:number;inclusionReason:string;}
export interface SemanticRetrievalRun {id:string;bookId:string;callerKind:"user"|"ai_task"|"system"|"debug";callerId:string;profileVersionId:string;generationId:string;queryHash:string;querySummary:string;queryRef:string;filterSnapshot:Record<string,unknown>;sourceKinds:EmbeddingSourceKind[];topK:number;candidateLimit:number;similarityThreshold:number|null;timeoutMs:number;status:"running"|"succeeded"|"failed"|"timed_out";elapsedMs:number|null;resultCount:number;failureCode:string;createdAt:string;completedAt:string|null;results:SemanticRetrievalResult[];}

export type OutboxTopic="dependency.recompute.requested"|"asset.derivation.requested"|"graph.projection.requested"|"embedding.chunking.requested"|"embedding.generation.requested"|"embedding.index.requested"|"ai.task.requested"|"backup.requested"|"publication.export.requested";
export type BackgroundHandlerKey="dependency.recompute"|"asset.derive"|"graph.project"|"embedding.chunk"|"embedding.generate"|"embedding.index"|"ai.task"|"backup.run"|"publication.export";
export type SpecializedRequestKind="dependency_recompute_request"|"asset_derivation"|"graph_projection_request"|"embedding_chunking_request"|"embedding_request"|"embedding_index_generation"|"ai_task"|"backup_request"|"publication_export_request";
export type BackgroundJobStatus="queued"|"leased"|"running"|"succeeded"|"failed"|"retry_scheduled"|"cancel_requested"|"cancelled"|"dead_letter"|"archived";
export type BackgroundFailureKind="technical"|"business_rejected"|"rejected_stale"|"cancelled";
export interface OutboxEvent {id:string;spaceId:string|null;bookId:string|null;topic:OutboxTopic;eventVersion:number;aggregateKind:string;aggregateId:string;aggregateSequence:number;orderingKey:string;producerKind:"domain_store"|"migration_bridge"|"system"|"operator";producerIdempotencyKey:string;payload:Record<string,unknown>;payloadHash:string;correlationId:string|null;causationId:string|null;traceId:string;occurredAt:string;recordedAt:string;}
export interface OutboxConsumer {consumerKey:string;handlerKey:BackgroundHandlerKey;status:"active"|"paused"|"disabled";maxConcurrency:number;revision:number;pauseReason:string;createdAt:string;updatedAt:string;}
export interface BackgroundJob {id:string;outboxEventId:string;spaceId:string|null;bookId:string|null;handlerKey:BackgroundHandlerKey;jobKind:string;specializedRequestKind:SpecializedRequestKind;specializedRequestId:string;executionGeneration:number;orderingKey:string;aggregateSequence:number;status:BackgroundJobStatus;priority:number;maxAttempts:number;attemptCount:number;nextRunAt:string;leaseOwner:string|null;leaseUntil:string|null;heartbeatAt:string|null;fencingToken:number;currentAttemptId:string|null;checkpointKey:string|null;lastErrorKind:BackgroundFailureKind|null;lastErrorCode:string;lastErrorSummary:string;revision:number;createdAt:string;updatedAt:string;completedAt:string|null;archivedAt:string|null;}
export interface BackgroundJobAttempt {id:string;jobId:string;attemptNumber:number;fencingToken:number;owner:string;consumerKey:string;triggerKind:"initial"|"technical_retry"|"manual_retry"|"worker_release"|"lease_recovery"|"dead_letter_replay";status:"leased"|"running"|"succeeded"|"failed"|"cancelled"|"released"|"lease_expired"|"rejected_stale";startedAt:string|null;heartbeatAt:string|null;endedAt:string|null;errorKind:BackgroundFailureKind|null;errorCode:string;errorSummary:string;retryable:boolean;createdAt:string;}
export interface BackgroundJobLease {job:BackgroundJob;attempt:BackgroundJobAttempt;leaseToken:string;}
export interface BackgroundJobCheckpoint {id:string;jobId:string;attemptId:string;fencingToken:number;checkpointKey:string;checkpointData:Record<string,unknown>;checkpointHash:string;createdAt:string;}
export interface BackgroundJobResult {id:string;jobId:string;attemptId:string;fencingToken:number;outcome:"applied"|"business_rejected"|"rejected_stale"|"cancelled";specializedResultKind:string|null;specializedResultId:string|null;resultHash:string|null;resultMetadata:Record<string,unknown>;idempotencyKey:string;createdAt:string;}
export interface OutboxInboxReceipt {id:string;consumerKey:string;eventId:string;jobId:string;attemptId:string;outcome:"succeeded"|"business_rejected"|"rejected_stale"|"cancelled";resultId:string|null;eventPayloadHash:string;receivedAt:string;}
export interface BackgroundJobDetail extends BackgroundJob {event:OutboxEvent;attempts:BackgroundJobAttempt[];checkpoints:BackgroundJobCheckpoint[];results:BackgroundJobResult[];receipts:OutboxInboxReceipt[];}
export interface BackgroundJobReplay {id:string;sourceJobId:string;replayJobId:string;sourceStatus:"failed"|"dead_letter"|"cancelled";reason:string;requestedBy:string;idempotencyKey:string;createdAt:string;}
export interface BackgroundBookRuntimeState {bookId:string;status:"active"|"paused";reason:string;revision:number;updatedBy:string;updatedAt:string|null;}
export interface BackgroundRuntimeHealth {queued:number;running:number;retryScheduled:number;failed:number;deadLetter:number;cancelRequested:number;oldestQueuedAt:string|null;oldestDelayMs:number|null;pausedConsumers:number;pausedBooks:number;byHandler:Array<{handlerKey:BackgroundHandlerKey;queued:number;running:number;failed:number;deadLetter:number}>;byTopic:Array<{topic:OutboxTopic;events:number;latestAt:string|null}>;}

export type TransferOperationKind="full_backup"|"full_restore"|"book_export"|"book_import"|"template_export"|"template_import"|"resource_export"|"resource_import";
export type TransferExecutionMode="execute"|"dry_run"|"apply";
export type TransferProfileKey="full_system"|"compact_continue"|"full_audit"|"template_bundle"|"resource_bundle";
export type TransferOperationStatus="queued"|"running"|"verifying"|"ready"|"failed"|"cancelled"|"imported"|"restored"|"archived";
export interface TransferRuntimeAvailability {available:boolean;code:"ready"|"package_runtime_unavailable"|"database_tools_unavailable"|"restore_switch_unavailable";detail:string;packageRuntimeVersion:string|null;databaseToolsAvailable:boolean;restoreSwitchAvailable:boolean;}
export interface TransferExportProfile {profileKey:TransferProfileKey;packageKind:"full_system"|"book"|"template"|"resource";description:string;includedDomains:string[];excludedDomains:string[];includeVersionHistory:boolean;includeRuntimeEvidence:boolean;status:"active"|"disabled";}
export interface TransferOperation {id:string;spaceId:string;bookId:string|null;operationKind:TransferOperationKind;executionMode:TransferExecutionMode;profileKey:TransferProfileKey;sourceOperationId:string|null;sourceArtifactId:string|null;targetStagingKey:string;status:TransferOperationStatus;currentStepKey:string;progressCompleted:number;progressTotal:number|null;readyManifestId:string|null;compatibilityPolicy:"strict"|"explicit_upgrade";maxEntryCount:number;maxSingleFileBytes:number;maxTotalBytes:number;maxCompressionRatio:number;maintenanceModeRequired:boolean;requestedBy:string;revision:number;lastErrorCode:string;lastErrorSummary:string;createdAt:string;startedAt:string|null;completedAt:string|null;archivedAt:string|null;}
export interface TransferManifest {id:string;operationId:string;manifestKind:"full_backup"|"book_package"|"template_package"|"resource_package";formatVersion:number;applicationVersion:string;minimumApplicationVersion:string;maximumApplicationVersion:string;schemaVersion:string;schemaMigrations:Array<{id:string;hash:string}>;migrationHash:string;postgresVersion:string;ageVersion:string|null;pgvectorVersion:string|null;requiredCapabilities:string[];cardSchemaVersions:unknown[];formSchemaVersions:unknown[];templateSchemaVersions:unknown[];promptSchemaVersions:unknown[];encoding:"UTF8";platformConstraints:Record<string,unknown>;consistencySnapshot:string;consistencyWatermark:Record<string,unknown>;contentScope:Record<string,unknown>;excludedDerivedDomains:string[];secretReconfigurationRefs:string[];manifestHash:string;createdBy:string;createdAt:string;}
export interface TransferArtifact {id:string;operationId:string;manifestId:string|null;artifactKind:"database_dump"|"managed_asset"|"package"|"manifest"|"validation_report";mediaType:string;storageLocator:string;displayFilename:string;checksum:string|null;byteSize:number|null;entryCount:number|null;compressedBytes:number|null;uncompressedBytes:number|null;status:"pending"|"ready"|"failed"|"quarantined";errorCode:string;createdAt:string;readyAt:string|null;}
export interface TransferArchiveEntry {id:string;artifactId:string;archivePath:string;entryKind:"file"|"directory";checksum:string|null;compressedBytes:number;uncompressedBytes:number;compressionRatio:number;createdAt:string;}
export interface TransferCompatibilitySnapshot {id:string;operationId:string;sourceFormatVersion:number;sourceApplicationVersion:string;currentApplicationVersion:string;sourceSchemaVersion:string;currentSchemaVersion:string;sourceMigrationHash:string;currentMigrationHash:string;extensionVersions:Record<string,unknown>;requiredCapabilities:string[];missingCapabilities:string[];unknownRequiredCapabilities:string[];outcome:"compatible"|"upgrade_required"|"incompatible"|"unavailable";detail:string;checkedAt:string;}
export interface TransferStep {id:string;operationId:string;stepKey:string;sortOrder:number;status:"queued"|"running"|"succeeded"|"failed"|"cancelled"|"skipped";progressCompleted:number;progressTotal:number|null;checkpointKey:string;errorCode:string;errorSummary:string;revision:number;createdAt:string;startedAt:string|null;completedAt:string|null;}
export interface TransferCheckpoint {id:string;operationId:string;stepId:string;checkpointKey:string;checkpointData:Record<string,unknown>;checkpointHash:string;createdAt:string;}
export interface TransferValidationResult {id:string;operationId:string;stage:"preflight"|"archive_scan"|"checksum"|"compatibility"|"database_integrity"|"asset_integrity"|"staging_integrity"|"publish_gate"|"restore_drill";ruleKey:string;outcome:"passed"|"warning"|"failed"|"unavailable";subjectKind:string;subjectRef:string;detail:string;createdAt:string;}
export interface TransferConflict {id:string;operationId:string;conflictKind:"portable_key_exists"|"version_exists"|"missing_dependency"|"schema_incompatible"|"unknown_required_capability"|"target_exists";entityKind:string;portableKey:string;sourceVersion:string;targetVersion:string;status:"pending"|"resolved"|"blocking";resolution:"new_local_version"|"remap"|"skip"|"abort"|null;resolutionNote:string;revision:number;createdAt:string;resolvedAt:string|null;}
export interface TransferIdMapping {id:string;operationId:string;entityKind:string;portableKey:string;sourceInternalId:string|null;targetInternalId:string;mappingAction:"created"|"reused"|"new_local_version"|"remapped";targetVersion:string;createdAt:string;}
export interface TransferStagingScope {id:string;operationId:string;stagingKind:"database"|"directory"|"book_space"|"template_space"|"resource_space";stagingKey:string;status:"allocated"|"validating"|"ready_to_publish"|"published"|"abandoned";targetSpaceId:string|null;targetBookId:string|null;revision:number;createdAt:string;publishedAt:string|null;abandonedAt:string|null;}
export interface TransferImportSource {id:string;operationId:string;sourceArtifactId:string;sourceManifestId:string;sourceInstallationHash:string;sourceOperationKey:string;importedBy:string;createdAt:string;}
export interface TransferRestoreDrill {id:string;backupOperationId:string;drillOperationId:string;outcome:"passed"|"failed"|"cancelled"|"unavailable";validationSummary:Record<string,unknown>;startedAt:string;completedAt:string;}
export interface TransferOperationEvent {id:string;operationId:string;fromStatus:TransferOperationStatus|null;toStatus:TransferOperationStatus;action:"request"|"start"|"verify"|"ready"|"fail"|"cancel"|"import"|"restore"|"archive";actor:string;detail:string;operationRevision:number;createdAt:string;}
export interface TransferOperationDetail extends TransferOperation {profile:TransferExportProfile;manifest:TransferManifest|null;artifacts:TransferArtifact[];archiveEntries:TransferArchiveEntry[];compatibility:TransferCompatibilitySnapshot[];steps:TransferStep[];checkpoints:TransferCheckpoint[];validations:TransferValidationResult[];conflicts:TransferConflict[];idMappings:TransferIdMapping[];staging:TransferStagingScope|null;importSource:TransferImportSource|null;restoreDrill:TransferRestoreDrill|null;events:TransferOperationEvent[];}

export type PrivateRuntimePhase="unavailable"|"stopped"|"starting"|"ready"|"stopping"|"upgrading"|"restoring"|"degraded"|"failed";
export interface PrivateRuntimeVersions {application:string;node:string;postgresql:string;age:string;pgvector:string;pgTrgm:string;}
export interface PrivateRuntimeStatus {phase:PrivateRuntimePhase;packageAvailable:boolean;packageIntegrity:"unknown"|"verified"|"failed";runtimeId:string|null;manifestSha256:string|null;installationId:string|null;dataGeneration:string|null;databaseReady:boolean;host:"127.0.0.1";port:number|null;versions:PrivateRuntimeVersions|null;migrationsExpected:number;migrationsApplied:number|null;workerRuntime:"not_started"|"starting"|"ready"|"draining"|"stopped"|"failed";lastCleanShutdown:boolean|null;lastErrorCode:string;lastErrorSummary:string;logLocator:"logs/postgres.log";updatedAt:string|null;}
export interface PrivateRuntimeDiagnosticCheck {key:string;status:"passed"|"warning"|"failed"|"unavailable";summary:string;action:string;}
export interface PrivateRuntimeDiagnostics {status:PrivateRuntimeStatus;checks:PrivateRuntimeDiagnosticCheck[];checkedAt:string;releaseGateDebts:string[];}
export interface RuntimePackageFile {path:string;component:"postgresql"|"age"|"pgvector"|"pg_trgm"|"archive"|"application"|"license";licenseId:"PostgreSQL"|"Apache-2.0"|"PostgreSQL-pgvector"|"BSD-2-Clause"|"MIT";byteSize:number;sha256:string;}
export interface RuntimePackageManifest {formatVersion:1;runtimeId:string;specId:string;platform:"win32";architecture:"x64";components:{application:{version:string;nodeVersion:string};postgresql:{version:string;major:number;distribution:string;distributionIntegrity:string};age:{version:string;postgresMajor:number;sourceRef:string};pgvector:{version:string;postgresMajor:number;sourceRef:string};pgTrgm:{version:string;postgresMajor:number;sourceRef:string};archive:{version:string;sourceRef:string}};migrationRange:{first:string;last:string;count:number};files:RuntimePackageFile[];createdAt:string;manifestSha256:string;}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  issues?: Record<string, string>;
}

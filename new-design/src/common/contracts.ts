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

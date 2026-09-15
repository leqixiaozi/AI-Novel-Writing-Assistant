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
  semanticCapabilities: CardTypeCapability[];
  status: "draft" | "published" | "archived";
  revision: number;
  currentVersion: number | null;
  currentVersionId: string | null;
  draftFields: FieldDefinition[];
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

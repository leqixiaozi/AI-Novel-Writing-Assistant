import { z } from "zod";
import { BOOK_CREATION_METHODS, BOOK_VIEW_KEYS, CARD_TYPE_CAPABILITIES, FIELD_TYPES, type FieldDefinition } from "../../common/contracts";

const optionSchema = z.object({
  value: z.string().trim().min(1, "选项值不能为空。"),
  label: z.string().trim().min(1, "选项名称不能为空。"),
});

export const fieldDefinitionSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/, "字段标识需以小写字母开头，只能包含小写字母、数字和下划线。"),
  name: z.string().trim().min(1, "字段名称不能为空。").max(80),
  description: z.string().trim().max(300).default(""),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional().nullable(),
  options: z.array(optionSchema).default([]),
  group: z.string().trim().max(80).default("基本信息"),
  order: z.number().int().min(0).max(10_000),
}).superRefine((field, context) => {
  const needsOptions = field.type === "select" || field.type === "multi_select";
  if (needsOptions && field.options.length === 0) {
    context.addIssue({ code: "custom", path: ["options"], message: "选择类型至少需要一个选项。" });
  }
  const optionValues = new Set<string>();
  for (const option of field.options) {
    if (optionValues.has(option.value)) {
      context.addIssue({ code: "custom", path: ["options"], message: `选项值“${option.value}”重复。` });
    }
    optionValues.add(option.value);
  }
});

export const fieldsSchema = z.array(fieldDefinitionSchema).max(100).superRefine((fields, context) => {
  const keys = new Set<string>();
  for (const [index, field] of fields.entries()) {
    if (keys.has(field.key)) {
      context.addIssue({ code: "custom", path: [index, "key"], message: `字段标识“${field.key}”重复。` });
    }
    keys.add(field.key);
  }
});

export const createCardTypeSchema = z.object({
  spaceId: z.string().uuid().optional(),
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/, "类型标识需以小写字母开头。"),
  name: z.string().trim().min(1, "类型名称不能为空。").max(80),
  description: z.string().trim().max(500).default(""),
  categoryId: z.string().uuid().nullable().optional(),
  semanticCapabilities: z.array(z.enum(CARD_TYPE_CAPABILITIES)).default([]),
  fields: fieldsSchema.default([]),
});

export const updateCardTypeSchema = z.object({
  name: z.string().trim().min(1, "类型名称不能为空。").max(80),
  description: z.string().trim().max(500).default(""),
  categoryId: z.string().uuid().nullable().optional(),
  semanticCapabilities: z.array(z.enum(CARD_TYPE_CAPABILITIES)).default([]),
  fields: fieldsSchema,
  revision: z.number().int().positive(),
});

export const revisionSchema = z.object({ revision: z.number().int().positive() });

export const cardTypeCategoryInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/, "分类标识需以小写字母开头。"),
  name: z.string().trim().min(1).max(80),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(1000),
  revision: z.number().int().positive().optional(),
});

export const createCardSchema = z.object({
  spaceId: z.string().uuid().optional(),
  cardTypeId: z.string().uuid("元卡片类型无效。"),
  title: z.string().trim().min(1, "卡片标题不能为空。").max(160),
  values: z.record(z.string(), z.unknown()).default({}),
});

export const updateCardSchema = z.object({
  title: z.string().trim().min(1, "卡片标题不能为空。").max(160),
  values: z.record(z.string(), z.unknown()).default({}),
  revision: z.number().int().positive(),
});

export const dictionaryInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/, "字典标识需以小写字母开头。"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  scope: z.enum(["system", "template", "book"]).default("system"),
  ownerSpaceId: z.string().uuid().nullable().optional(),
  revision: z.number().int().positive().optional(),
  items: z.array(z.object({
    id: z.string().uuid().optional(),
    key: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,62}$/, "字典项标识无效。"),
    label: z.string().trim().min(1).max(80),
    value: z.record(z.string(), z.unknown()).default({}),
    sortOrder: z.number().int().min(0).default(1000),
    status: z.enum(["active", "archived"]).default("active"),
  })).max(200).default([]),
});

const relationPropertySchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/),
  name: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
});

export const relationTypeInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/, "关系标识需以小写字母开头。"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  direction: z.enum(["directed", "undirected"]).default("directed"),
  sourceTypeKeys: z.array(z.string().trim().min(1)).min(1),
  targetTypeKeys: z.array(z.string().trim().min(1)).min(1),
  sourceMax: z.number().int().positive().nullable().default(null),
  targetMax: z.number().int().positive().nullable().default(null),
  scope: z.enum(["system", "template", "book"]).default("system"),
  ownerSpaceId: z.string().uuid().nullable().optional(),
  propertiesSchema: z.array(relationPropertySchema).max(50).default([]),
  revision: z.number().int().positive().optional(),
});

const localFieldSchema = relationPropertySchema;
const formSlotSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["primary_card", "card_reference"]),
  relationTypeKey: z.string().trim().min(1).optional(),
  allowedTypeKeys: z.array(z.string().trim().min(1)).min(1),
  min: z.number().int().min(0),
  max: z.number().int().positive(),
  localFields: z.array(localFieldSchema).max(30).default([]),
}).superRefine((slot, context) => {
  if (slot.max < slot.min) context.addIssue({ code: "custom", path: ["max"], message: "最大数量不能小于最小数量。" });
  if (slot.kind === "card_reference" && !slot.relationTypeKey) context.addIssue({ code: "custom", path: ["relationTypeKey"], message: "引用槽必须选择关系类型。" });
});

export const cardGroupFormDefinitionSchema = z.object({
  primaryTypeKey: z.string().trim().min(1),
  groups: z.array(z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/),
    name: z.string().trim().min(1).max(80),
    order: z.number().int().min(0),
    sections: z.array(z.object({
      key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/),
      name: z.string().trim().min(1).max(80),
      order: z.number().int().min(0),
      slots: z.array(formSlotSchema).min(1),
    })).min(1),
  })).min(1),
});

export const cardGroupFormInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  definition: cardGroupFormDefinitionSchema,
  revision: z.number().int().positive().optional(),
});

export const formInstanceInputSchema = z.object({
  spaceId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  primaryCardId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  revision: z.number().int().positive().optional(),
  mounts: z.array(z.object({
    id: z.string().uuid().optional(),
    slotKey: z.string().trim().min(1),
    cardId: z.string().uuid(),
    sortOrder: z.number().int().min(0),
    localValues: z.record(z.string(), z.unknown()).default({}),
  })).max(200),
});

export const templateInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(800).default(""),
  draftConfig: z.record(z.string(), z.unknown()).default({ includeSystemCatalog: true }),
  revision: z.number().int().positive().optional(),
});

export const bookInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(800).default(""),
  templateVersionId: z.string().uuid(),
});

export const storyTimePositionSchema = z.object({
  cardId: z.string().uuid(),
  startOrder: z.number().nullable(),
  endOrder: z.number().nullable(),
  startLabel: z.string().trim().max(120).default(""),
  endLabel: z.string().trim().max(120).default(""),
  uncertainty: z.string().trim().max(300).default(""),
  revision: z.number().int().positive().optional(),
}).superRefine((value,context)=>{if(value.startOrder!==null&&value.endOrder!==null&&value.endOrder<value.startOrder)context.addIssue({code:"custom",path:["endOrder"],message:"故事结束时间不能早于开始时间。"});});

export const narrativePlacementSchema = z.object({
  subjectCardId: z.string().uuid(),
  chapterCardId: z.string().uuid(),
  sceneCardId: z.string().uuid().nullable().optional(),
  role: z.enum(["appears","plant","reinforce","misdirect","reveal","recover"]),
  note: z.string().trim().max(500).default(""),
  revision: z.number().int().positive().optional(),
});

export const characterRelationSchema = z.object({
  sourceCardId: z.string().uuid(),
  targetCardId: z.string().uuid(),
  sourceLabel: z.string().trim().min(1,"请填写正向关系称谓。").max(80),
  inverseLabel: z.string().trim().min(1,"请填写反向关系称谓。").max(80),
  note: z.string().trim().max(500).default(""),
  revision: z.number().int().positive().optional(),
});

export const clueLifecycleSchema = z.object({
  clueCardId: z.string().uuid(),
  plantChapterId: z.string().uuid(),
  revealChapterId: z.string().uuid(),
  plantAnchor: z.string().trim().max(160).default(""),
  revealAnchor: z.string().trim().max(160).default(""),
  plantPlacementRevision: z.number().int().positive().optional(),
  revealPlacementRevision: z.number().int().positive().optional(),
  plantAnchorRevision: z.number().int().positive().optional(),
  revealAnchorRevision: z.number().int().positive().optional(),
});

export const bookChangePreviewSchema=z.discriminatedUnion("operationKey",[
  z.object({operationKey:z.literal("story_time"),input:storyTimePositionSchema}),
  z.object({operationKey:z.literal("narrative_placement"),input:narrativePlacementSchema}),
  z.object({operationKey:z.literal("character_relation"),input:characterRelationSchema}),
  z.object({operationKey:z.literal("clue_lifecycle"),input:clueLifecycleSchema}),
]);

export const researchDocumentInputSchema=z.object({
  title:z.string().trim().min(1,"请填写资料名称。").max(160),
  content:z.string().trim().min(20,"参考文本至少需要 20 个字符。").max(2_000_000),
  sourceKind:z.enum(["paste","file","public_url","book_export"]).default("paste"),
  sourceUrl:z.string().trim().max(1000).default(""),
});
export const researchDocumentVersionSchema=z.object({content:z.string().trim().min(20,"参考文本至少需要 20 个字符。").max(2_000_000),revision:z.number().int().positive()});
export const researchRecordTypeSchema=z.enum(["market_scan","market_analysis","book_analysis","diagnosis"]);
export const researchRecordMetadataSchema=z.object({title:z.string().trim().min(1).max(160),tags:z.array(z.string().trim().min(1).max(40)).max(20),favorite:z.boolean(),notes:z.string().trim().max(3000),revision:z.number().int().positive(),status:z.enum(["active","archived"]).optional()});
export const marketScanInputSchema=z.object({sourceKeys:z.array(z.string().trim().min(1).max(80)).min(1).max(8)});
export const marketAnalysisInputSchema=z.object({scanRecordId:z.string().uuid(),scanVersionId:z.string().uuid().optional(),itemIds:z.array(z.string().uuid()).min(1).max(80),focus:z.string().trim().max(500).default(""),budgetTokens:z.number().int().min(1000).max(12000).default(5000)});

export const bookViewKeySchema = z.enum(BOOK_VIEW_KEYS);
export const bookViewConfigSchema = z.object({
  config:z.object({
    layout:z.unknown().optional(),filter:z.unknown().optional(),groupBy:z.unknown().optional(),sort:z.unknown().optional(),
    display:z.unknown().optional(),expanded:z.unknown().optional(),defaultRange:z.unknown().optional(),
  }).strict(),
  revision:z.number().int().positive(),
});

export const bookCreationSessionInputSchema = z.object({
  method: z.enum(BOOK_CREATION_METHODS),
  templateVersionId: z.string().uuid(),
  bookName: z.string().trim().max(100).default(""),
  description: z.string().trim().max(800).default(""),
  sourceReference: z.string().trim().max(500).default(""),
  inputPayload: z.record(z.string(), z.unknown()).default({}),
}).superRefine((input, context) => {
  if ((input.method === "blank" || input.method === "template") && !input.bookName) {
    context.addIssue({ code: "custom", path: ["bookName"], message: "请填写书名。" });
  }
  if (!["blank", "template"].includes(input.method)) {
    const hasSource = input.description || input.sourceReference || Object.values(input.inputPayload).some((value) => typeof value === "string" && value.trim());
    if (!hasSource) context.addIssue({ code: "custom", path: ["inputPayload"], message: "请填写创作来源或选择一个灵感。" });
  }
});

export const selectDirectionSchema = z.object({ directionId: z.string().trim().min(1).max(80) });
export const completeBookCreationSchema = z.object({ keepCurrentResult: z.boolean().default(false) });
export const resourceInstallSchema = z.object({ bookId: z.string().uuid() });
export const formAssistSchema = z.object({
  cardId: z.string().uuid(),
  formKey: z.string().trim().min(1).max(80),
  formName: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(2, "请告诉 AI 希望补充或调整什么。").max(1000),
  baseRevision: z.number().int().positive(),
});
export const applyFormAssistSchema = z.object({
  fieldKeys: z.array(z.string().trim().min(1)).min(1).max(100),
  expectedRevision: z.number().int().positive(),
});

export const syncPreviewSchema = z.object({ targetVersionId: z.string().uuid() });

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function validateValue(field: FieldDefinition, value: unknown): string | null {
  if (isBlank(value)) return field.required ? `${field.name}为必填项。` : null;
  switch (field.type) {
    case "short_text":
    case "long_text":
    case "date":
      return typeof value === "string" ? null : `${field.name}需要填写文本。`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${field.name}需要填写有效数字。`;
    case "boolean":
      return typeof value === "boolean" ? null : `${field.name}需要选择是或否。`;
    case "select":
      return typeof value === "string" && field.options.some((option) => option.value === value)
        ? null
        : `${field.name}的选项无效。`;
    case "multi_select":
      return Array.isArray(value) && value.every((item) => typeof item === "string" && field.options.some((option) => option.value === item))
        ? null
        : `${field.name}包含无效选项。`;
  }
}

export function validateCardValues(
  fields: FieldDefinition[],
  incomingValues: Record<string, unknown>,
): { values: Record<string, unknown>; issues: Record<string, string> } {
  const definitions = new Map(fields.map((field) => [field.key, field]));
  const issues: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(incomingValues)) {
    if (!definitions.has(key)) issues[key] = `字段“${key}”不在当前元卡片定义中。`;
  }

  for (const field of fields) {
    const supplied = Object.prototype.hasOwnProperty.call(incomingValues, field.key);
    const value = supplied ? incomingValues[field.key] : field.defaultValue;
    const error = validateValue(field, value);
    if (error) issues[field.key] = error;
    if (!isBlank(value)) values[field.key] = value;
  }

  return { values, issues };
}

export function validatePublishedEvolution(previous: FieldDefinition[], next: FieldDefinition[]): Record<string, string> {
  const issues: Record<string, string> = {};
  const nextByKey = new Map(next.map((field) => [field.key, field]));
  for (const oldField of previous) {
    const candidate = nextByKey.get(oldField.key);
    if (!candidate) {
      issues.fields = `已发布字段“${oldField.name}”不能删除。`;
      continue;
    }
    if (JSON.stringify(candidate) !== JSON.stringify(oldField)) {
      issues[oldField.key] = `已发布字段“${oldField.name}”不能修改；请新增字段。`;
    }
  }
  const previousKeys = new Set(previous.map((field) => field.key));
  for (const field of next) {
    if (!previousKeys.has(field.key) && field.required) {
      issues[field.key] = `新增字段“${field.name}”必须为非必填，确保旧卡片仍可使用。`;
    }
  }
  return issues;
}

export function validateBookTypeEvolution(previous: FieldDefinition[], next: FieldDefinition[]): Record<string, string> {
  const issues: Record<string, string> = {};
  const nextByKey = new Map(next.map((field) => [field.key, field]));
  for (const oldField of previous) {
    const candidate = nextByKey.get(oldField.key);
    if (!candidate) {
      issues.fields = `书内稳定字段“${oldField.name}”不能删除。`;
      continue;
    }
    if (candidate.type !== oldField.type) {
      issues[oldField.key] = `书内字段“${oldField.name}”不能改变数据类型。`;
    }
    if (!oldField.required && candidate.required) {
      issues[oldField.key] = `书内已有卡片时，字段“${oldField.name}”不能改为必填。`;
    }
  }
  return issues;
}

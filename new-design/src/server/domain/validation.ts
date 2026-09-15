import { z } from "zod";
import { createHash } from "node:crypto";
import { BOOK_CREATION_METHODS, BOOK_VIEW_KEYS, CARD_TYPE_CAPABILITIES, FIELD_TYPES, type ContextActivationRule, type FieldDefinition, type MaterialFilterNode } from "../../common/contracts";

const materialKeySchema=z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/,"稳定标识需以小写字母开头，只能包含小写字母、数字、横线或下划线。");
const materialActorSchema=z.string().trim().min(1).max(120).optional();
const materialVisibilitySchema=z.enum(["space","private"]).optional();
const idempotencySchema=z.string().trim().min(8).max(160);
const materialFilterFields=["content_type","tag","card_status","canonical_status","candidate_status","chapter","volume","story_time","relation_exists","association_exists","source","updated_at"] as const;
const materialFilterOperators=["equals","not_equals","in","not_in","contains","exists","not_exists","gte","lte","between"] as const;
const materialOperatorMatrix:Record<(typeof materialFilterFields)[number],Set<(typeof materialFilterOperators)[number]>>={
  content_type:new Set(["equals","not_equals","in","not_in"]),tag:new Set(["equals","in","exists","not_exists"]),card_status:new Set(["equals","in"]),
  canonical_status:new Set(["equals","in"]),candidate_status:new Set(["equals","in"]),chapter:new Set(["equals","in"]),volume:new Set(["equals","in"]),
  story_time:new Set(["gte","lte","between","exists","not_exists"]),relation_exists:new Set(["exists","not_exists"]),association_exists:new Set(["exists","not_exists"]),
  source:new Set(["equals","in"]),updated_at:new Set(["gte","lte","between"]),
};
const materialFilterConditionSchema=z.object({kind:z.literal("condition"),field:z.enum(materialFilterFields),operator:z.enum(materialFilterOperators),value:z.union([z.string().max(300),z.number(),z.boolean(),z.array(z.union([z.string().max(300),z.number()])).max(50),z.null()]).optional()}).superRefine((value,context)=>{if(!materialOperatorMatrix[value.field].has(value.operator))context.addIssue({code:"custom",path:["operator"],message:"该筛选条件不支持此运算方式。"});if(!["exists","not_exists"].includes(value.operator)&&value.value===undefined)context.addIssue({code:"custom",path:["value"],message:"筛选条件缺少值。"});if(value.operator==="between"&&(!Array.isArray(value.value)||value.value.length!==2))context.addIssue({code:"custom",path:["value"],message:"范围筛选必须包含起点和终点。"});});
const materialFilterNodeSchema:z.ZodType<MaterialFilterNode>=z.lazy(()=>z.union([materialFilterConditionSchema,z.object({kind:z.literal("group"),operator:z.enum(["and","or"]),items:z.array(materialFilterNodeSchema).max(20)})])) as z.ZodType<MaterialFilterNode>;
function inspectMaterialFilter(node:MaterialFilterNode,depth=1):{depth:number;conditions:number}{if(node.kind==="condition")return{depth,conditions:1};return node.items.reduce((summary,item)=>{const child=inspectMaterialFilter(item,depth+1);return{depth:Math.max(summary.depth,child.depth),conditions:summary.conditions+child.conditions};},{depth,conditions:0});}
const boundedMaterialFilterSchema=materialFilterNodeSchema.superRefine((node,context)=>{const size=inspectMaterialFilter(node);if(size.depth>4)context.addIssue({code:"custom",message:"筛选组合最多嵌套 4 层。"});if(size.conditions>40)context.addIssue({code:"custom",message:"筛选条件最多 40 条。"});});
const materialSortSchema=z.array(z.object({field:z.enum(["title","content_type","updated_at","created_at","story_time"]),direction:z.enum(["asc","desc"])})).min(1).max(3);
const materialDisplayColumns=["title","content_type","status","tags","groups","source","story_time","created_at","updated_at"] as const;
const smartViewPayloadSchema=z.object({name:z.string().trim().min(1).max(100),description:z.string().trim().max(500).default(""),filter:boundedMaterialFilterSchema,sort:materialSortSchema,grouping:z.object({field:z.enum(["content_type","tag","group","status","source"]).optional()}).default({}),displayColumns:z.array(z.enum(materialDisplayColumns)).min(1).max(9),layout:z.object({mode:z.enum(["list","table"])}).passthrough(),visibility:materialVisibilitySchema,actor:materialActorSchema,idempotencyKey:idempotencySchema});

export const materialTagCreateSchema=z.object({key:materialKeySchema,name:z.string().trim().min(1).max(80),aliases:z.array(z.string().trim().min(1).max(80)).max(30).default([]),color:z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),metadata:z.record(z.string(),z.unknown()).default({}),visibility:materialVisibilitySchema,actor:materialActorSchema,idempotencyKey:idempotencySchema});
export const materialTagRevisionSchema=materialTagCreateSchema.omit({key:true}).extend({expectedRevision:z.number().int().positive()});
export const materialMembershipSchema=z.object({cardIds:z.array(z.string().uuid()).min(1).max(200),action:z.enum(["add","remove"]),actor:materialActorSchema,idempotencyKey:idempotencySchema});
export const materialGroupCreateSchema=z.object({key:materialKeySchema,name:z.string().trim().min(1).max(100),parentId:z.string().uuid().nullable().optional(),sortOrder:z.number().int().min(0).max(100000).default(1000),visibility:materialVisibilitySchema,actor:materialActorSchema,idempotencyKey:idempotencySchema});
export const materialGroupRevisionSchema=materialGroupCreateSchema.omit({key:true}).extend({expectedRevision:z.number().int().positive()});
export const materialGroupArchiveSchema=z.object({expectedRevision:z.number().int().positive(),childMode:z.enum(["promote","archive_tree"]),actor:materialActorSchema,idempotencyKey:idempotencySchema});
export const smartViewCreateSchema=smartViewPayloadSchema.extend({key:materialKeySchema,baseViewKey:z.enum(BOOK_VIEW_KEYS).nullable().optional()});
export const smartViewRevisionSchema=smartViewPayloadSchema.extend({expectedRevision:z.number().int().positive()});
export const smartViewCopySchema=z.object({key:materialKeySchema,name:z.string().trim().min(1).max(100),actor:materialActorSchema,idempotencyKey:idempotencySchema});
export const materialQuerySchema=z.object({viewId:z.string().uuid().optional(),filter:boundedMaterialFilterSchema.optional(),sort:materialSortSchema.optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).refine(value=>!(value.viewId&&(value.filter||value.sort)),"按视图查询时不能同时提交临时筛选或排序。");
export const cardArchivePreviewSchema=z.object({expectedRevision:z.number().int().positive(),actor:materialActorSchema});
export const cardArchiveConfirmSchema=z.object({previewId:z.string().uuid(),confirmationToken:z.string().uuid(),snapshotHash:z.string().length(64),expectedRevision:z.number().int().positive(),acceptRisk:z.boolean().default(false),actor:materialActorSchema,idempotencyKey:idempotencySchema});
export const cardRestoreManagedSchema=z.object({expectedRevision:z.number().int().positive(),actor:materialActorSchema,idempotencyKey:idempotencySchema});

const optionSchema = z.object({
  id: z.string().uuid().optional(),
  value: z.string().trim().min(1, "选项值不能为空。"),
  label: z.string().trim().min(1, "选项名称不能为空。"),
});

const visibilityRuleSchema = z.object({
  fieldKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/),
  operator: z.enum(["equals", "not_equals", "is_empty", "is_not_empty", "includes"]),
  value: z.unknown().optional(),
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
  visibleWhen: visibilityRuleSchema.optional(),
  aiSuggestible: z.boolean().optional(),
  stateSettlement: z.enum(["none", "tracked", "lifecycle"]).optional(),
  hidden: z.boolean().optional(),
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
  formVersionId: z.string().uuid().nullable().optional(),
  formResolutionKind: z.enum(["installed_form", "type_schema", "system_default", "generic", "legacy"]).optional(),
});

export const updateCardSchema = z.object({
  title: z.string().trim().min(1, "卡片标题不能为空。").max(160),
  values: z.record(z.string(), z.unknown()).default({}),
  revision: z.number().int().positive(),
  formVersionId: z.string().uuid().nullable().optional(),
  formResolutionKind: z.enum(["installed_form", "type_schema", "system_default", "generic", "legacy"]).optional(),
  localValues: z.record(z.string(), z.unknown()).optional(),
});

export const addInformationFieldSchema = z.object({
  name: z.string().trim().min(1, "字段名称不能为空。").max(80),
  description: z.string().trim().max(300).default(""),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.object({ id: z.string().uuid().optional(), label: z.string().trim().min(1).max(80) })).max(50).default([]),
  required: z.boolean().default(false),
  group: z.string().trim().min(1).max(80).default("补充信息"),
  defaultValue: z.unknown().optional().nullable(),
  aiSuggestible: z.boolean().default(false),
  stateSettlement: z.enum(["none", "tracked", "lifecycle"]).default("none"),
  visibleWhen: visibilityRuleSchema.optional(),
}).superRefine((field, context) => {
  const needsOptions = field.type === "select" || field.type === "multi_select";
  if (needsOptions && field.options.length === 0) context.addIssue({ code:"custom", path:["options"], message:"单选或多选至少需要一个可选内容。" });
  if (!needsOptions && field.options.length > 0) context.addIssue({ code:"custom", path:["options"], message:"只有单选或多选字段可以设置可选内容。" });
  if (new Set(field.options.map((option)=>option.label)).size !== field.options.length) context.addIssue({ code:"custom", path:["options"], message:"可选内容不能重复。" });
});

export const fieldExtensionPreviewSchema = z.object({
  cardTypeId: z.string().uuid(),
  scope: z.enum(["book_type", "card", "card_mount"]),
  cardId: z.string().uuid().nullable().optional(),
  cardMountId: z.string().uuid().nullable().optional(),
  field: addInformationFieldSchema,
});

export const createBookFieldExtensionSchema = z.object({
  cardTypeId: z.string().uuid(),
  expectedTypeRevision: z.number().int().positive(),
  field: addInformationFieldSchema,
  backfillStrategy: z.enum(["none", "default"]),
  idempotencyKey: z.string().trim().min(8).max(160),
  createdBy: z.string().trim().max(160).default("user"),
});

export const createLocalFieldSchema = z.object({
  expectedCardRevision: z.number().int().positive(),
  field: addInformationFieldSchema,
  initialValue: z.unknown().optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(160),
  createdBy: z.string().trim().max(160).default("user"),
});

export const reviseLocalFieldSchema = z.object({
  expectedRevision: z.number().int().positive(),
  field: addInformationFieldSchema,
  idempotencyKey: z.string().trim().min(8).max(160),
  createdBy: z.string().trim().max(160).default("user"),
});

export const archiveScopedFieldSchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedTypeRevision: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  createdBy: z.string().trim().max(160).default("user"),
});

export const associationSearchSchema=z.object({slotKey:z.string().trim().min(1).max(80),query:z.string().trim().max(120).default(""),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(50).default(20)});
export const associationAddSchema=z.object({slotKey:z.string().trim().min(1).max(80),cardId:z.string().uuid(),expectedInstanceRevision:z.number().int().positive().nullable(),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default("user")});
export const associationCreateAndAddSchema=z.object({slotKey:z.string().trim().min(1).max(80),cardTypeId:z.string().uuid(),title:z.string().trim().min(1).max(160),values:z.record(z.string(),z.unknown()),expectedInstanceRevision:z.number().int().positive().nullable(),formVersionId:z.string().uuid().nullable().optional(),formResolutionKind:z.enum(["installed_form","type_schema","system_default","generic","legacy"]).default("installed_form"),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default("user")});
export const associationRemoveSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default("user")});
export const associationReorderSchema=z.object({items:z.array(z.object({mountId:z.string().uuid(),expectedRevision:z.number().int().positive()})).min(1).max(200),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default("user")});
export const associationLocalValuesSchema=z.object({expectedRevision:z.number().int().positive(),values:z.record(z.string(),z.unknown()),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default("user")});
export const associationLocalFieldSchema=z.object({expectedRevision:z.number().int().positive(),field:addInformationFieldSchema,initialValue:z.unknown().optional().nullable(),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default("user")});

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
export const bookAnalysisPurposeSchema=z.enum(["reference_learning","continuation","diagnosis"]);
export const bookAnalysisPresetSchema=z.enum(["quick","standard","full"]);
export const bookAnalysisInputSchema=z.object({documentVersionId:z.string().uuid(),purpose:bookAnalysisPurposeSchema,preset:bookAnalysisPresetSchema,rangeMode:z.enum(["full","range"]),startOffset:z.number().int().nonnegative().optional(),endOffset:z.number().int().positive().optional(),focus:z.string().trim().max(1000).default(""),budgetTokens:z.number().int().min(1000).max(12000)}).superRefine((value,ctx)=>{if(value.rangeMode==="range"&&(value.startOffset===undefined||value.endOffset===undefined||value.endOffset<=value.startOffset))ctx.addIssue({code:"custom",path:["endOffset"],message:"局部分析需要有效的起止位置。"});});
export const candidateDecisionsSchema=z.object({decisions:z.array(z.object({candidateId:z.string().uuid(),action:z.enum(["create_card","merge_card","save_resource","reference_only","ignore"]),targetSpaceId:z.string().uuid().optional(),targetCardId:z.string().uuid().optional(),expectedRevision:z.number().int().positive().optional()})).min(1).max(30)});
export const researchCandidateUpdateSchema=z.object({title:z.string().trim().min(1).max(200),values:z.record(z.string(),z.unknown()),expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const referencePackPublishSchema=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(1).max(160),description:z.string().trim().max(1000).default(""),note:z.string().trim().max(500).default(""),revision:z.number().int().positive().optional(),items:z.array(z.object({researchVersionId:z.string().uuid(),purpose:z.string().trim().min(1).max(80).default("book_creation"),weight:z.number().positive().max(10).default(1),note:z.string().trim().max(500).default("")})).min(1).max(50)});
export const researchReusePreviewSchema=z.object({templateVersionId:z.string().uuid(),researchVersionIds:z.array(z.string().uuid()).max(50).default([]),packVersionIds:z.array(z.string().uuid()).max(20).default([]),includeTemplateSeed:z.boolean().default(false)}).refine((value)=>value.researchVersionIds.length+value.packVersionIds.length>0,{message:"请至少选择一条研究记录或一个参考包。"});
export const bookResearchAdoptionPreviewSchema=z.object({bookId:z.string().uuid(),sourceKind:z.enum(["research_version","reference_pack_version"]),sourceId:z.string().uuid(),candidateIds:z.array(z.string().uuid()).max(500).optional(),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")});
export const bookResearchAdoptionItemSchema=z.object({bookId:z.string().uuid(),title:z.string().trim().min(1).max(200),values:z.record(z.string(),z.unknown()),decision:z.enum(["pending","adopt","reject"]),expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user")});
export const bookResearchAdoptionCommitSchema=z.object({bookId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,actor:z.string().trim().max(160).default("user")});
export const chapterDocumentInputSchema=z.object({chapterCardId:z.string().uuid(),logicalOrder:z.number().int().positive(),title:z.string().trim().min(1).max(200)});
export const chapterBodyVersionInputSchema=z.object({content:z.string().min(1),source:z.enum(["manual","ai_candidate","revision","import"]),parentVersionId:z.string().uuid().nullable().optional(),baseVersionId:z.string().uuid().nullable().optional(),sourceRunId:z.string().uuid().nullable().optional(),createdByKind:z.enum(["user","ai","system","import"]),createdBy:z.string().trim().max(160).default("")});
export const chapterBodyAdoptionSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user")});
export const chapterCandidateSaveSchema=z.object({content:z.string().min(1),operationKind:z.enum(["manual_draft","copy"]),baseVersionId:z.string().uuid().nullable().optional(),expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")});
export const chapterWritingRequestSchema=z.object({operationKind:z.enum(["continue","rewrite","expand","shorten","dialogue","conflict","fix","regenerate"]),baseBodyVersionId:z.string().uuid().nullable().optional(),selectionStart:z.number().int().min(0).nullable().optional(),selectionEnd:z.number().int().positive().nullable().optional(),instruction:z.string().trim().max(4000).default(""),expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")}).superRefine((value,ctx)=>{if((value.selectionStart===null||value.selectionStart===undefined)!==(value.selectionEnd===null||value.selectionEnd===undefined))ctx.addIssue({code:"custom",path:["selectionEnd"],message:"选区起止位置必须同时提供。"});});
export const chapterWritingResultSchema=z.object({attemptId:z.string().uuid(),content:z.string().min(1),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("ai")});
export const chapterAdoptionPreparationSchema=z.object({bodyVersionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")});
const chapterSettlementCategorySchema=z.enum(["fact","knowledge","character_state","relationship","prop","event","foreshadow"]);
const chapterSettlementDraftSchema=z.object({category:chapterSettlementCategorySchema,majorCategory:z.string().trim().max(120).nullable().optional(),title:z.string().trim().min(1).max(240),subjectKind:z.enum(["card","relation"]).optional(),subjectId:z.string().uuid().optional(),subjectCardId:z.string().uuid().optional(),stateKey:z.string().trim().min(1).max(160),beforeValue:z.unknown(),changeValue:z.unknown().optional(),afterValue:z.unknown(),valueKind:z.enum(["text","number","boolean","json","card_reference"]).optional(),objectCardId:z.string().uuid().nullable().optional(),holderKind:z.enum(["character","reader"]).optional(),holderKey:z.string().trim().max(160).optional(),holderCardId:z.string().uuid().nullable().optional(),stance:z.enum(["knows","believes","suspects","misunderstands","unknown"]).optional(),acquisitionMethod:z.enum(["witnessed","told","inferred","read","narration","assumed","forgotten","manual"]).optional(),riskLevel:z.enum(["low","medium","high","critical"]),confidence:z.number().min(0).max(1).nullable().optional(),confidenceNote:z.string().trim().max(1000).optional(),planAlignment:z.enum(["matches","deviates","missing","not_applicable"]).optional(),planExpectation:z.string().trim().max(2000).optional(),evidenceStart:z.number().int().min(0),evidenceEnd:z.number().int().positive(),evidenceLabel:z.string().trim().min(1).max(240),reason:z.string().trim().min(1).max(3000)}).superRefine((value,ctx)=>{if(!value.subjectId&&!value.subjectCardId)ctx.addIssue({code:"custom",path:["subjectId"],message:"请选择变化对象。"});if(value.evidenceEnd<=value.evidenceStart)ctx.addIssue({code:"custom",path:["evidenceEnd"],message:"证据结束位置必须大于开始位置。"});if(value.category==="relationship"&&value.subjectKind!=="relation")ctx.addIssue({code:"custom",path:["subjectKind"],message:"关系变化必须关联一条正式关系。"});if(["fact","knowledge"].includes(value.category)&&value.subjectKind==="relation")ctx.addIssue({code:"custom",path:["subjectKind"],message:"事实与角色所知必须关联资料对象。"});if(value.category==="knowledge"&&value.holderKind==="character"&&!value.holderCardId)ctx.addIssue({code:"custom",path:["holderCardId"],message:"人物知识变化必须指定知识持有者。"});});
export const chapterAdoptionSessionStartSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,actor:z.string().trim().max(160).default("user")});
export const chapterSettlementItemCreateSchema=chapterSettlementDraftSchema.extend({actor:z.string().trim().max(160).default("user")});
export const chapterSettlementItemUpdateSchema=z.object({expectedRevision:z.number().int().positive(),draft:chapterSettlementDraftSchema,actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(2000).default("")});
export const chapterSettlementDecisionsSchema=z.object({expectedRevision:z.number().int().positive(),decisions:z.array(z.object({itemId:z.string().uuid(),decision:z.enum(["confirm","reject","defer"]),expectedRevision:z.number().int().positive(),note:z.string().trim().max(2000).default("")})).min(1).max(500),actor:z.string().trim().max(160).default("user")});
export const chapterSettlementCommitSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(2000).default("")});
export const chapterProposalExtractionRequestSchema=z.object({idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")});
export const chapterProposalExtractionResultSchema=z.object({attemptId:z.string().uuid(),items:z.array(chapterSettlementDraftSchema).max(1000),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("ai")});
const chapterRevisionActionSchema=z.enum(["auto_recompute","review_manually","mark_stale","keep_manual_correction","defer"]);
export const chapterRevisionPreviewSchema=z.object({expectedDocumentRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")});
export const chapterRevisionPlanSchema=z.object({expectedPreviewRevision:z.number().int().positive(),expectedDocumentRevision:z.number().int().positive(),reason:z.string().trim().min(1).max(2000),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user"),items:z.array(z.object({impactId:z.string().uuid(),selectedAction:chapterRevisionActionSchema,note:z.string().trim().max(2000).default("")})).max(5000)});
export const chapterRevisionExecuteSchema=z.object({expectedPlanRevision:z.number().int().positive(),expectedPreviewRevision:z.number().int().positive(),expectedDocumentRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,actor:z.string().trim().max(160).default("user"),confirmed:z.literal(true)});
export const chapterRevisionReviewResolutionSchema=z.object({expectedRevision:z.number().int().positive(),resolution:z.enum(["resolved","retained","cancelled"]),note:z.string().trim().min(1).max(2000),actor:z.string().trim().max(160).default("user")});
export const chapterBodyArchiveSchema=z.object({expectedRevision:z.number().int().positive()});
export const chapterTextAnchorInputSchema=z.object({startOffset:z.number().int().nonnegative(),endOffset:z.number().int().positive(),excerpt:z.string().optional(),label:z.string().trim().min(1).max(200),role:z.string().trim().min(1).max(80).default("reference"),subjectCardId:z.string().uuid().nullable().optional()}).refine((value)=>value.endOffset>value.startOffset,{path:["endOffset"],message:"锚点结束位置必须晚于开始位置。"});
const canonicalFactSourceMethodSchema=z.enum(["manual","ai_extract","import","system"]);
export const canonicalFactStatusSchema=z.enum(["proposed","confirmed","rejected","superseded","stale"]);
const canonicalFactEvidenceInputSchema=z.object({chapterTextAnchorId:z.string().uuid().nullable().optional(),cardVersionId:z.string().uuid().nullable().optional(),researchEvidenceId:z.string().uuid().nullable().optional(),extractionMethod:canonicalFactSourceMethodSchema,note:z.string().trim().max(500).default("")}).refine((value)=>[value.chapterTextAnchorId,value.cardVersionId,value.researchEvidenceId].filter(Boolean).length===1,{message:"每条证据必须且只能选择一种来源。"});
export const canonicalFactInputSchema=z.object({subjectCardId:z.string().uuid(),predicate:z.string().trim().min(1).max(160),valueKind:z.enum(["text","number","boolean","json","card_reference"]),value:z.unknown(),objectCardId:z.string().uuid().nullable().optional(),validStoryStart:z.number().nullable().optional(),validStoryEnd:z.number().nullable().optional(),confidence:z.number().min(0).max(1).nullable().optional(),sourceMethod:canonicalFactSourceMethodSchema,supersedesFactId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default(""),evidence:z.array(canonicalFactEvidenceInputSchema).min(1).max(50)}).refine((value)=>value.value!==undefined,{path:["value"],message:"请提供事实值。"}).refine((value)=>value.validStoryStart===null||value.validStoryStart===undefined||value.validStoryEnd===null||value.validStoryEnd===undefined||value.validStoryEnd>=value.validStoryStart,{path:["validStoryEnd"],message:"事实结束时间不能早于开始时间。"});
export const canonicalFactReviewSchema=z.object({action:z.enum(["confirm","reject"]),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const canonicalFactConflictReviewSchema=z.object({action:z.enum(["resolve","dismiss"]),expectedRevision:z.number().int().positive(),resolutionFactId:z.string().uuid().nullable().optional()}).superRefine((value,ctx)=>{if(value.action==="resolve"&&!value.resolutionFactId)ctx.addIssue({code:"custom",path:["resolutionFactId"],message:"解决冲突时必须选择已确认事实。"});});
const stateSubjectKindSchema=z.enum(["card","relation"]),settlementCapabilitySchema=z.enum(["disabled","optional","required"]),settlementPolicySchema=z.enum(["none","tracked","derived","lifecycle_only"]),stateValueModeSchema=z.enum(["absolute","delta","derived","lifecycle"]);
export const stateTypeCapabilitySchema=z.object({typeKey:z.string().trim().min(1).max(100),settlementCapability:settlementCapabilitySchema,stateMode:z.enum(["none","field_state","lifecycle"]),defaultFieldPolicy:settlementPolicySchema,expectedRevision:z.number().int().positive().optional(),fieldPolicies:z.array(z.object({fieldKey:z.string().trim().min(1).max(100),settlementPolicy:settlementPolicySchema,stateMode:stateValueModeSchema,revision:z.number().int().positive().default(1)})).max(100).default([])});
export const stateRelationCapabilitySchema=z.object({relationKey:z.string().trim().min(1).max(100),settlementCapability:settlementCapabilitySchema,stateMode:z.enum(["none","relation_state","lifecycle"]),expectedRevision:z.number().int().positive().optional(),dimensions:z.array(z.object({dimensionKey:z.string().trim().min(1).max(100),label:z.string().trim().min(1).max(160),direction:z.enum(["forward","inverse","bidirectional"]),settlementPolicy:z.enum(["tracked","derived","lifecycle_only"]),stateMode:stateValueModeSchema,revision:z.number().int().positive().default(1)})).max(50).default([])});
export const initialStateInputSchema=z.object({subjectKind:stateSubjectKindSchema,subjectId:z.string().uuid(),stateKey:z.string().trim().min(1).max(100),value:z.unknown(),sourceFactId:z.string().uuid().nullable().optional(),expectedRevision:z.number().int().positive().optional(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")}).refine((value)=>value.value!==undefined,{path:["value"],message:"请提供初始状态值。"});
export const stateChangeProposalInputSchema=z.object({chapterDocumentId:z.string().uuid(),bodyVersionId:z.string().uuid(),textAnchorId:z.string().uuid().nullable().optional(),causeEventCardId:z.string().uuid().nullable().optional(),subjectKind:stateSubjectKindSchema,subjectId:z.string().uuid(),stateKey:z.string().trim().min(1).max(100),beforeValue:z.unknown(),afterValue:z.unknown(),delta:z.unknown().optional(),reason:z.string().trim().min(1).max(1000),effectiveStoryOrder:z.number().nullable().optional(),source:z.enum(["ai","manual","import","system"])}).refine((value)=>Object.prototype.hasOwnProperty.call(value,"beforeValue"),{path:["beforeValue"],message:"请提供变化前的状态。"}).refine((value)=>Object.prototype.hasOwnProperty.call(value,"afterValue"),{path:["afterValue"],message:"请提供变化后的状态。"});
export const stateChangeProposalEditSchema=z.object({beforeValue:z.unknown(),afterValue:z.unknown(),delta:z.unknown().optional(),reason:z.string().trim().min(1).max(1000),effectiveStoryOrder:z.number().nullable().optional(),expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user")}).refine((value)=>Object.prototype.hasOwnProperty.call(value,"beforeValue"),{path:["beforeValue"],message:"请提供变化前的状态。"}).refine((value)=>Object.prototype.hasOwnProperty.call(value,"afterValue"),{path:["afterValue"],message:"请提供变化后的状态。"});
export const chapterSettlementInputSchema=z.object({chapterDocumentId:z.string().uuid(),bodyVersionId:z.string().uuid(),proposalIds:z.array(z.string().uuid()).min(1).max(200),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(1000).default(""),milestone:z.object({kind:z.enum(["volume_end","major_revision","manual"]),label:z.string().trim().min(1).max(200)}).optional()});
export const settlementRevertSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(1000).default("")});
export const stateMilestoneInputSchema=z.object({kind:z.enum(["initial","volume_end","major_revision","body_switch","manual"]),label:z.string().trim().min(1).max(200),chapterDocumentId:z.string().uuid().nullable().optional(),bodyVersionId:z.string().uuid().nullable().optional(),sourceSettlementId:z.string().uuid().nullable().optional()});
export const stateValueMappingSchema=z.object({spaceId:z.string().uuid(),typeKey:z.string().trim().min(1).max(100),fieldKey:z.string().trim().min(1).max(100),expectedRevision:z.number().int().positive().optional(),ranges:z.array(z.object({min:z.number().nullable(),max:z.number().nullable(),label:z.string().trim().min(1).max(100),value:z.string().trim().min(1).max(200)})).min(1).max(100),promptComponentVersionId:z.string().uuid().nullable().optional(),note:z.string().trim().max(500).default("")});

export const knowledgeHolderKindSchema=z.enum(["character","reader"]);
const knowledgeStanceSchema=z.enum(["knows","believes","suspects","misunderstands","unknown"]),knowledgeAcquisitionMethodSchema=z.enum(["witnessed","told","inferred","read","narration","assumed","forgotten","manual"]);
const knowledgeVersionFields={stance:knowledgeStanceSchema,confidence:z.number().min(0).max(1).nullable().optional(),acquisitionMethod:knowledgeAcquisitionMethodSchema,sourceCharacterCardId:z.string().uuid().nullable().optional(),sourceEventCardId:z.string().uuid().nullable().optional(),chapterDocumentId:z.string().uuid().nullable().optional(),bodyVersionId:z.string().uuid().nullable().optional(),textAnchorId:z.string().uuid().nullable().optional(),effectiveStoryOrder:z.number().nullable().optional(),effectiveNarrativeOrder:z.number().nullable().optional(),reason:z.string().trim().min(1).max(1000),editor:z.string().trim().max(160).default("system")};
const epistemicClaimInputSchema=z.object({subjectCardId:z.string().uuid().nullable().optional(),predicate:z.string().trim().min(1).max(160),valueKind:z.enum(["text","number","boolean","json","card_reference"]),value:z.unknown(),objectCardId:z.string().uuid().nullable().optional(),truthFactId:z.string().uuid().nullable().optional()}).refine((value)=>Object.prototype.hasOwnProperty.call(value,"value"),{path:["value"],message:"请提供认知命题值。"});
export const knowledgeStateProposalInputSchema=z.object({holderKind:knowledgeHolderKindSchema,holderKey:z.string().trim().min(1).max(160).optional(),holderCardId:z.string().uuid().nullable().optional(),claim:epistemicClaimInputSchema,source:z.enum(["ai","manual","import","system"]),...knowledgeVersionFields}).superRefine((value,ctx)=>{if(value.holderKind==="character"&&!value.holderCardId)ctx.addIssue({code:"custom",path:["holderCardId"],message:"人物知情必须指定人物。"});if(value.holderKind==="reader"&&value.holderCardId)ctx.addIssue({code:"custom",path:["holderCardId"],message:"读者知情不能绑定人物卡片。"});if(value.source==="ai"&&(!value.bodyVersionId||!value.textAnchorId))ctx.addIssue({code:"custom",path:["textAnchorId"],message:"AI 认知提案必须绑定正文版本和精确锚点。"});});
export const knowledgeStateProposalEditSchema=z.object({...knowledgeVersionFields,expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const knowledgeStateReviewSchema=z.object({action:z.enum(["confirm","reject"]),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const knowledgeStateStatusSchema=z.enum(["proposed","confirmed","rejected","invalidated"]);
export const knowledgeStateAtQuerySchema=z.object({holderKind:knowledgeHolderKindSchema,holderKey:z.string().trim().min(1).max(160),narrativeOrder:z.coerce.number()});

const storyEvidenceFields={evidenceKind:z.enum(["manual","body","fact","plan_version","state_proposal"]),chapterDocumentId:z.string().uuid().nullable().optional(),bodyVersionId:z.string().uuid().nullable().optional(),textAnchorId:z.string().uuid().nullable().optional(),factId:z.string().uuid().nullable().optional(),planVersionId:z.string().uuid().nullable().optional(),stateProposalId:z.string().uuid().nullable().optional()};
const nullableInstant=z.string().refine((value)=>!Number.isNaN(Date.parse(value)),"请输入有效时间。").nullable().optional();
const storyTimeVersionFields={lifecycle:z.enum(["planned","occurred","cancelled","invalidated"]),timeMode:z.enum(["absolute","custom_calendar","relative","partial","unknown"]),startCertainty:z.enum(["known","partial","unknown"]),endCertainty:z.enum(["known","partial","unknown"]),startInstant:nullableInstant,endInstant:nullableInstant,timezoneName:z.string().trim().max(100).nullable().optional(),calendarKey:z.string().trim().max(100).nullable().optional(),startLabel:z.string().trim().max(160).nullable().optional(),endLabel:z.string().trim().max(160).nullable().optional(),normalizedStart:z.number().nullable().optional(),normalizedEnd:z.number().nullable().optional(),durationValue:z.number().positive().nullable().optional(),durationUnit:z.string().trim().max(60).nullable().optional(),relativeToEventCardId:z.string().uuid().nullable().optional(),relativeRelation:z.enum(["before","after","simultaneous"]).nullable().optional(),relativeOffset:z.number().nullable().optional(),replacesTimingId:z.string().uuid().nullable().optional(),reason:z.string().trim().min(1).max(1000),editor:z.string().trim().max(160).default("system"),...storyEvidenceFields};
function validateStoryTimeSchema(value:Record<string,unknown>,ctx:z.RefinementCtx){const start=value.normalizedStart as number|null|undefined,end=value.normalizedEnd as number|null|undefined;if(start!==null&&start!==undefined&&end!==null&&end!==undefined&&end<start)ctx.addIssue({code:"custom",path:["normalizedEnd"],message:"故事结束时间不能早于开始时间。"});if(value.startInstant&&value.endInstant&&Date.parse(String(value.endInstant))<Date.parse(String(value.startInstant)))ctx.addIssue({code:"custom",path:["endInstant"],message:"故事结束时刻不能早于开始时刻。"});if(value.timeMode==="absolute"&&!value.startInstant)ctx.addIssue({code:"custom",path:["startInstant"],message:"绝对时间必须填写开始时刻。"});if(value.timeMode==="custom_calendar"&&(!value.calendarKey||!value.startLabel))ctx.addIssue({code:"custom",path:["calendarKey"],message:"自定义历法必须填写历法口径和开始标签。"});if(value.timeMode==="relative"&&(!value.relativeToEventCardId||!value.relativeRelation))ctx.addIssue({code:"custom",path:["relativeToEventCardId"],message:"相对时间必须选择参照事件和关系。"});if(value.timeMode==="unknown"&&(value.startInstant||value.endInstant||start!==null&&start!==undefined||end!==null&&end!==undefined||value.relativeToEventCardId))ctx.addIssue({code:"custom",path:["timeMode"],message:"未知时间不能携带确定坐标。"});if(value.evidenceKind==="body"&&(!value.chapterDocumentId||!value.bodyVersionId||!value.textAnchorId))ctx.addIssue({code:"custom",path:["textAnchorId"],message:"正文来源必须绑定正文版本和精确锚点。"});if(value.evidenceKind==="fact"&&!value.factId)ctx.addIssue({code:"custom",path:["factId"],message:"事实来源必须选择已确认事实。"});if(value.evidenceKind==="plan_version"&&!value.planVersionId)ctx.addIssue({code:"custom",path:["planVersionId"],message:"计划来源必须记录计划版本。"});if(value.evidenceKind==="state_proposal"&&!value.stateProposalId)ctx.addIssue({code:"custom",path:["stateProposalId"],message:"状态来源必须记录状态提案。"});}
export const storyTimeProposalInputSchema=z.object({eventCardId:z.string().uuid(),proposalSource:z.enum(["ai","manual","import","system"]),...storyTimeVersionFields}).superRefine(validateStoryTimeSchema);
export const storyTimeProposalEditSchema=z.object({...storyTimeVersionFields,expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")}).superRefine(validateStoryTimeSchema);
export const storyProposalReviewSchema=z.object({action:z.enum(["confirm","reject"]),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const storyProposalStatusSchema=z.enum(["proposed","confirmed","rejected","stale","invalidated"]);
export const storyTimingRangeQuerySchema=z.object({normalizedStart:z.coerce.number().optional(),normalizedEnd:z.coerce.number().optional(),startInstant:z.string().refine((value)=>!Number.isNaN(Date.parse(value)),"请输入有效开始时间。").optional(),endInstant:z.string().refine((value)=>!Number.isNaN(Date.parse(value)),"请输入有效结束时间。").optional()}).refine((value)=>Boolean(value.startInstant||value.endInstant)!==(value.normalizedStart!==undefined||value.normalizedEnd!==undefined),{message:"故事时间范围必须且只能使用一种时间口径。"});
export const storyNarrativeOccurrenceSchema=z.object({id:z.string().uuid().optional(),eventCardId:z.string().uuid(),chapterCardId:z.string().uuid(),sceneCardId:z.string().uuid().nullable().optional(),chapterDocumentId:z.string().uuid().nullable().optional(),bodyVersionId:z.string().uuid().nullable().optional(),textAnchorId:z.string().uuid().nullable().optional(),role:z.enum(["mention","scene","reveal","retell","flashback","flashforward"]),narrativeOrder:z.number().nullable().optional(),sourceKind:z.enum(["manual","body","system"]),note:z.string().trim().max(500).default(""),expectedRevision:z.number().int().positive().optional()});
export const storyRelationFamilySchema=z.enum(["temporal","causal"]);
const storyRelationVersionFields={relationFamily:storyRelationFamilySchema,relationType:z.enum(["before","after","simultaneous","overlaps","contains","causes","enables","blocks","depends_on"]),sourceEventCardId:z.string().uuid(),targetEventCardId:z.string().uuid(),confidence:z.number().min(0).max(1).nullable().optional(),reason:z.string().trim().min(1).max(1000),editor:z.string().trim().max(160).default("system"),...storyEvidenceFields};
function validateStoryRelationSchema(value:Record<string,unknown>,ctx:z.RefinementCtx){if(value.sourceEventCardId===value.targetEventCardId)ctx.addIssue({code:"custom",path:["targetEventCardId"],message:"事件不能与自己建立关系。"});const temporal=["before","after","simultaneous","overlaps","contains"].includes(String(value.relationType));if((value.relationFamily==="temporal")!==temporal)ctx.addIssue({code:"custom",path:["relationType"],message:"关系类型与时间／因果分类不一致。"});if(value.evidenceKind==="body"&&(!value.chapterDocumentId||!value.bodyVersionId||!value.textAnchorId))ctx.addIssue({code:"custom",path:["textAnchorId"],message:"正文来源必须绑定正文版本和精确锚点。"});if(value.evidenceKind==="fact"&&!value.factId)ctx.addIssue({code:"custom",path:["factId"],message:"事实来源必须选择已确认事实。"});if(value.evidenceKind==="plan_version"&&!value.planVersionId)ctx.addIssue({code:"custom",path:["planVersionId"],message:"计划来源必须记录计划版本。"});if(value.evidenceKind==="state_proposal"&&!value.stateProposalId)ctx.addIssue({code:"custom",path:["stateProposalId"],message:"状态来源必须记录状态提案。"});}
export const storyRelationProposalInputSchema=z.object({proposalSource:z.enum(["ai","manual","import","system"]),...storyRelationVersionFields}).superRefine(validateStoryRelationSchema);
export const storyRelationProposalEditSchema=z.object({...storyRelationVersionFields,expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")}).superRefine(validateStoryRelationSchema);
export const causalGraphQuerySchema=z.object({direction:z.enum(["upstream","downstream"]),maxDepth:z.coerce.number().int().min(1).max(50).default(10)});

const planningReferenceSchema=z.object({role:z.enum(["viewpoint","location","participant","event","foreshadow","item","organization"]),cardId:z.string().uuid(),cardVersionId:z.string().uuid(),action:z.enum(["plant","reinforce","recover","misdirect","reveal"]).nullable().optional(),note:z.string().trim().max(1000).default(""),sortOrder:z.number().int().min(0)}).superRefine((value,ctx)=>{if(value.role==="foreshadow"&&!value.action)ctx.addIssue({code:"custom",path:["action"],message:"伏笔安排必须选择埋设、推进、回收、误导或揭示。"});if(value.role!=="foreshadow"&&value.action)ctx.addIssue({code:"custom",path:["action"],message:"只有伏笔安排可以填写动作。"});});
const planningContentSchema=z.object({goal:z.string().trim().max(5000).optional(),storyTime:z.string().trim().max(500).optional(),mustHappen:z.array(z.string().trim().min(1).max(1000)).max(100).optional(),mustPreserve:z.array(z.string().trim().min(1).max(1000)).max(100).optional(),forbiddenBoundaries:z.array(z.string().trim().min(1).max(1000)).max(100).optional(),expectedChanges:z.array(z.string().trim().min(1).max(1000)).max(100).optional(),characterArc:z.string().trim().max(5000).optional(),notes:z.string().trim().max(5000).optional()}).catchall(z.unknown());
const planningVersionFields={content:planningContentSchema,source:z.enum(["manual","ai","import","system","body_revision"]),executionMode:z.enum(["manual","ai_assisted","automatic"]).default("manual"),references:z.array(planningReferenceSchema).max(100).default([]),baseVersionId:z.string().uuid().nullable().optional(),basedOnParentVersionId:z.string().uuid().nullable().optional(),sourceBodyVersionId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default(""),idempotencyKey:z.string().trim().min(8).max(160)};
function validatePlanningVersionSource(value:Record<string,unknown>,ctx:z.RefinementCtx){if(value.source==="body_revision"&&!value.sourceBodyVersionId)ctx.addIssue({code:"custom",path:["sourceBodyVersionId"],message:"正文反向修正规划必须记录正文版本。"});if(value.source!=="body_revision"&&value.sourceBodyVersionId)ctx.addIssue({code:"custom",path:["sourceBodyVersionId"],message:"只有正文反向修正可以记录正文版本。"});}
export const planningObjectInputSchema=z.object({level:z.enum(["story","volume","chapter","scene"]),parentObjectId:z.string().uuid().nullable().optional(),cardId:z.string().uuid().nullable().optional(),title:z.string().trim().min(1).max(240),sortOrder:z.number().int().min(0),...planningVersionFields}).superRefine((value,ctx)=>{validatePlanningVersionSource(value,ctx);if(value.level==="story"&&(value.parentObjectId||value.cardId))ctx.addIssue({code:"custom",path:["level"],message:"故事总计划不绑定父级或资料。"});if(value.level!=="story"&&(!value.parentObjectId||!value.cardId))ctx.addIssue({code:"custom",path:["parentObjectId"],message:"卷、章、场景计划必须绑定父级和同类型资料。"});});
export const planningVersionInputSchema=z.object({...planningVersionFields,expectedRevision:z.number().int().positive()}).superRefine(validatePlanningVersionSource);
export const planningVersionRejectSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const planningVersionAdoptSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),source:z.enum(["user","system","import"]).default("user"),actor:z.string().trim().max(160).default("user")});
export const planningObjectArchiveSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const planningImpactStatusSchema=z.enum(["pending_review","resolved","dismissed"]);

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
  researchVersionIds:z.array(z.string().uuid()).max(50).default([]),
  researchPackVersionIds:z.array(z.string().uuid()).max(20).default([]),
}).superRefine((input, context) => {
  if ((input.method === "blank" || input.method === "template") && !input.bookName) {
    context.addIssue({ code: "custom", path: ["bookName"], message: "请填写书名。" });
  }
  if (!["blank", "template"].includes(input.method)) {
    const hasSource = input.description || input.sourceReference || input.researchVersionIds.length > 0 || input.researchPackVersionIds.length > 0 || Object.values(input.inputPayload).some((value) => typeof value === "string" && value.trim());
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

const contractSourceSchema=z.enum(["manual","ai","import","system"]);
const promptRecipeSlotSchema=z.object({slotKey:z.string().trim().min(1).max(100),sortOrder:z.number().int().min(0),required:z.boolean(),allowedContentTypes:z.array(z.string().trim().min(1).max(100)).min(1).max(50),variableContract:z.record(z.string(),z.unknown()),components:z.array(z.object({componentCardId:z.string().uuid(),componentVersionId:z.string().uuid(),sortOrder:z.number().int().min(0),required:z.boolean()})).max(100)});
const recipeVersionFields={source:contractSourceSchema,variablesSchema:z.record(z.string(),z.unknown()),slots:z.array(promptRecipeSlotSchema).min(1).max(100),baseVersionId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default("")};
function validateUniqueRecipeSlots(value:{slots:Array<{slotKey:string;sortOrder:number;components:Array<{sortOrder:number}>}>},ctx:z.RefinementCtx){if(new Set(value.slots.map((item)=>item.slotKey)).size!==value.slots.length)ctx.addIssue({code:"custom",path:["slots"],message:"槽位 key 不能重复。"});if(new Set(value.slots.map((item)=>item.sortOrder)).size!==value.slots.length)ctx.addIssue({code:"custom",path:["slots"],message:"槽位顺序不能重复。"});for(const [index,slot] of value.slots.entries())if(new Set(slot.components.map((item)=>item.sortOrder)).size!==slot.components.length)ctx.addIssue({code:"custom",path:["slots",index,"components"],message:"组件顺序不能重复。"});}
export const promptRecipeCreateSchema=z.object({recipeKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),name:z.string().trim().min(1).max(160),description:z.string().trim().max(1000).default(""),...recipeVersionFields}).superRefine(validateUniqueRecipeSlots);
export const promptRecipeVersionSchema=z.object({...recipeVersionFields,expectedRevision:z.number().int().positive()}).superRefine(validateUniqueRecipeSlots);
export const contractPublishSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user")});
export const contractRejectSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive()});
const taskVersionFields={source:contractSourceSchema,taskGroup:z.string().trim().min(1).max(100),inputSchema:z.record(z.string(),z.unknown()),inputSchemaVersion:z.string().trim().min(1).max(80),outputSchema:z.record(z.string(),z.unknown()),outputSchemaVersion:z.string().trim().min(1).max(80),contextPolicyVersion:z.string().trim().min(1).max(80),promptRecipeVersionId:z.string().uuid(),requiredCapabilities:z.array(z.string().trim().min(1).max(100)).max(50),budgetPolicy:z.record(z.string(),z.unknown()),timeoutMs:z.number().int().positive().max(3_600_000),retryPolicy:z.record(z.string(),z.unknown()),confirmationPolicy:z.enum(["none","before_execute","before_adopt","always"]),baseVersionId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default("")};
export const taskContractCreateSchema=z.object({taskKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),name:z.string().trim().min(1).max(160),description:z.string().trim().max(1000).default(""),...taskVersionFields});
export const taskContractVersionSchema=z.object({...taskVersionFields,expectedRevision:z.number().int().positive()});

const contextSourceSchema=z.enum(["card_version","card_relation","body_version","text_anchor","planning_version","canonical_fact","state_change","story_time","research_version","prompt_component"]);
const contextExclusionReasonSchema=z.enum(["invalid_reference","wrong_book","wrong_version","slot_type_mismatch","lower_priority","token_budget","duplicate","stale","unavailable"]);
export const contextManifestCreateSchema=z.object({bookId:z.string().uuid(),taskContractVersionId:z.string().uuid(),nodeKey:z.string().trim().max(120).nullable().optional(),createdBy:z.string().trim().max(160).default(""),slots:z.array(z.object({slotKey:z.string().trim().min(1).max(100),tokenBudget:z.number().int().min(0).nullable().optional(),entries:z.array(z.object({sourceType:contextSourceSchema,stableObjectId:z.string().uuid(),exactVersionId:z.string().uuid().nullable(),inclusionReason:z.string().trim().min(1).max(1000),priority:z.number().int(),tokenEstimate:z.number().int().min(0),transformStatus:z.enum(["full","truncated","summarized"]),sortOrder:z.number().int().min(0)})).max(500),exclusions:z.array(z.object({sourceType:z.string().trim().min(1).max(100),stableObjectId:z.string().uuid().nullable(),exactVersionId:z.string().uuid().nullable(),reasonCode:contextExclusionReasonSchema,reasonDetail:z.string().trim().min(1).max(1000),priority:z.number().int().nullable(),tokenEstimate:z.number().int().min(0).nullable(),sortOrder:z.number().int().min(0)})).max(500)})).min(1).max(100)});

const contextActivationFields=["task_key","task_group","content_type","tag","material_status","canonical_status","volume","chapter","scene","story_range","relation_exists","association_exists","source_type","stale","manual_switch"] as const;
const contextActivationOperators=["equals","not_equals","in","not_in","contains","exists","not_exists","gte","lte","between","enabled"] as const;
const contextActivationConditionSchema=z.object({kind:z.literal("condition"),field:z.enum(contextActivationFields),operator:z.enum(contextActivationOperators),value:z.union([z.string().max(300),z.number(),z.boolean(),z.array(z.union([z.string().max(300),z.number()])).max(50),z.null()]).optional()}).strict();
const contextActivationRuleSchema:z.ZodType<ContextActivationRule>=z.lazy(()=>z.union([contextActivationConditionSchema,z.object({kind:z.literal("group"),operator:z.enum(["and","or"]),items:z.array(contextActivationRuleSchema).max(20)}).strict()])) as z.ZodType<ContextActivationRule>;
function inspectContextRule(node:ContextActivationRule,depth=1):{depth:number;conditions:number}{if(node.kind==="condition")return{depth,conditions:1};return node.items.reduce((summary,item)=>{const child=inspectContextRule(item,depth+1);return{depth:Math.max(summary.depth,child.depth),conditions:summary.conditions+child.conditions};},{depth,conditions:0});}
export const contextActivationRuleValidationSchema=contextActivationRuleSchema.superRefine((rule,ctx)=>{const stats=inspectContextRule(rule);if(stats.depth>4)ctx.addIssue({code:"custom",message:"激活条件最多嵌套 4 层。"});if(stats.conditions>40)ctx.addIssue({code:"custom",message:"激活条件最多 40 条。"});});

const contextSourceTypeSchema=z.enum(["card_version","body_version","canonical_fact","knowledge_state_change","state_change","story_time","story_event_relation","research_document_version","planning_version","research_version","research_pack_version","prompt_component","retrieval_chunk"]);
const explicitContextSourceTypeSchema=z.enum(["card_version","body_version","canonical_fact","knowledge_state_change","state_change","story_time","story_event_relation","research_document_version","planning_version","research_version","research_pack_version"]);
const contextSelectorSchema=z.discriminatedUnion("selectorKind",[
  z.object({selectorKind:z.literal("explicit_source"),sourceType:explicitContextSourceTypeSchema,stableObjectId:z.string().uuid(),exactVersionId:z.string().uuid(),sortOrder:z.number().int().min(0),config:z.object({}).strict().default({})}),
  z.object({selectorKind:z.literal("prompt_component"),sourceType:z.literal("prompt_component"),stableObjectId:z.string().uuid(),exactVersionId:z.string().uuid(),sortOrder:z.number().int().min(0),config:z.object({}).strict().default({})}),
  z.object({selectorKind:z.literal("card_type"),sourceType:z.literal("card_version"),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({typeKey:z.string().trim().min(1).max(100)}).strict()}),
  z.object({selectorKind:z.literal("tag"),sourceType:z.literal("card_version"),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({tagId:z.string().uuid()}).strict()}),
  z.object({selectorKind:z.literal("smart_view"),sourceType:z.literal("card_version"),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({smartViewId:z.string().uuid(),limit:z.number().int().min(1).max(200).default(100)}).strict()}),
  z.object({selectorKind:z.literal("relation"),sourceType:z.literal("card_version"),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({relationTypeId:z.string().uuid(),anchorCardId:z.string().uuid().optional()}).strict()}),
  z.object({selectorKind:z.literal("story_range"),sourceType:z.enum(["card_version","story_time"]),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({start:z.number(),end:z.number()}).strict().refine(value=>value.end>=value.start,"故事时间终点不能早于起点。")}),
  z.object({selectorKind:z.literal("research_pack"),sourceType:z.enum(["research_version","research_pack_version"]),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({packVersionId:z.string().uuid()}).strict()}),
  z.object({selectorKind:z.literal("retrieval_trace"),sourceType:z.literal("retrieval_chunk"),stableObjectId:z.string().uuid().nullable().default(null),exactVersionId:z.string().uuid().nullable().default(null),sortOrder:z.number().int().min(0),config:z.object({retrievalRunId:z.string().uuid(),limit:z.number().int().min(1).max(100).default(20)}).strict()}),
]);
const contextVersionFields={inheritanceMode:z.enum(["inherit","override","exclude"]),activationRule:contextActivationRuleValidationSchema,slotKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),priority:z.number().int().min(-10000).max(10000),contentRole:z.enum(["required","reference"]),tokenBudget:z.number().int().min(0).max(1_000_000),trimStrategy:z.enum(["none","lowest_priority","largest_first"]),dedupeStrategy:z.enum(["exact_version","stable_source"]),selectors:z.array(contextSelectorSchema).max(100),createdBy:z.string().trim().max(160).default("")};
const contextVersionContract=z.object(contextVersionFields).superRefine((value,ctx)=>{if(value.contentRole==="required"&&value.trimStrategy!=="none")ctx.addIssue({code:"custom",path:["trimStrategy"],message:"必须事实不能配置自动裁剪。"});if(value.inheritanceMode!=="exclude"&&!value.selectors.length)ctx.addIssue({code:"custom",path:["selectors"],message:"继承或覆盖规则至少需要一个参考资料选择器。"});if(new Set(value.selectors.map(item=>item.sortOrder)).size!==value.selectors.length)ctx.addIssue({code:"custom",path:["selectors"],message:"参考资料顺序不能重复。"});});
const contextScopeFields={scopeKind:z.enum(["system","public","task_group","task_node","book","volume","chapter","scene","one_time"]),scopeRef:z.string().trim().min(1).max(160).nullable().optional(),bookId:z.string().uuid().nullable().optional(),spaceId:z.string().uuid().nullable().optional()};
function validateContextScope(value:{scopeKind:string;scopeRef?:string|null;bookId?:string|null;spaceId?:string|null},ctx:z.RefinementCtx){const needsBook=["book","volume","chapter","scene","one_time"].includes(value.scopeKind),needsRef=!['system','public','book'].includes(value.scopeKind);if(needsBook!==Boolean(value.bookId))ctx.addIssue({code:"custom",path:["bookId"],message:needsBook?"该作用范围必须选择书籍。":"系统或任务默认规则不能绑定书籍。"});if(needsRef!==Boolean(value.scopeRef))ctx.addIssue({code:"custom",path:["scopeRef"],message:needsRef?"该作用范围必须指定对象。":"此作用范围不需要对象标识。"});if(value.scopeKind==="public"&&!value.spaceId)ctx.addIssue({code:"custom",path:["spaceId"],message:"公共规则必须选择公共资源空间。"});if(value.scopeKind!=="public"&&value.spaceId)ctx.addIssue({code:"custom",path:["spaceId"],message:"只有公共规则可以直接指定公共资源空间。"});}
export const contextBindingCreateSchema=z.object({bindingKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),name:z.string().trim().min(1).max(160),description:z.string().trim().max(1000).default(""),...contextScopeFields,...contextVersionFields,idempotencyKey:idempotencySchema}).superRefine((value,ctx)=>{validateContextScope(value,ctx);contextVersionContract.safeParse(value).error?.issues.forEach(issue=>ctx.addIssue({code:"custom",path:issue.path,message:issue.message}));});
export const contextBindingVersionSchema=contextVersionContract.and(z.object({bookId:z.string().uuid().nullable().optional(),expectedRevision:z.number().int().positive(),baseVersionId:z.string().uuid().nullable().optional(),idempotencyKey:idempotencySchema}));
export const contextBindingAdoptSchema=z.object({bookId:z.string().uuid().nullable().optional(),versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,actor:z.string().trim().max(160).default("")});
export const contextBindingArchiveSchema=z.object({bookId:z.string().uuid().nullable().optional(),expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,actor:z.string().trim().max(160).default(""),reason:z.string().trim().min(1).max(500)});
export const contextBindingListSchema=z.object({bookId:z.string().uuid().optional(),includeGlobal:z.coerce.boolean().default(true),includeArchived:z.coerce.boolean().default(false),limit:z.coerce.number().int().min(1).max(100).default(50)});
export const contextResolutionSchema=z.object({bookId:z.string().uuid(),taskKey:z.string().trim().min(1).max(100),taskGroup:z.string().trim().min(1).max(100),taskNodeKey:z.string().trim().min(1).max(160),volumeId:z.string().uuid().nullable().optional(),chapterId:z.string().uuid().nullable().optional(),sceneId:z.string().uuid().nullable().optional(),manualSwitches:z.record(z.string(),z.boolean()).default({})});
export const contextPreviewCreateSchema=contextResolutionSchema.extend({taskContractVersionId:z.string().uuid(),totalBudget:z.number().int().min(1).max(1_000_000),timeoutMs:z.number().int().min(100).max(10_000).default(3000),oneTimeOverrides:z.object({excludeSourceKeys:z.array(z.string().max(240)).max(200).default([]),manualSwitches:z.record(z.string(),z.boolean()).default({})}).strict().default({excludeSourceKeys:[],manualSwitches:{}}),createdBy:z.string().trim().max(160).default("")});
export const contextPreviewListSchema=z.object({status:z.enum(["complete","invalid","stale","timed_out"]).optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const contextSnapshotListSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(30)});
export const contextManifestFinalizeSchema=z.object({previewId:z.string().uuid(),modelRouteSnapshotId:z.string().uuid(),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("")});

export const modelCredentialRefSchema=z.object({credentialKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),provider:z.string().trim().min(1).max(100),secretLocator:z.string().trim().regex(/^(secret|env|keychain):\/\/[A-Za-z0-9_.:/-]+$/),status:z.enum(["active","disabled"]).default("active")});
const technicalFailureSchema=z.enum(["timeout","rate_limit","authentication","provider_unavailable","transport","context_limit"]);
const routeFallbackSchema=z.object({provider:z.string().trim().min(1).max(100),model:z.string().trim().min(1).max(160),parameters:z.record(z.string(),z.unknown()).default({}),credentialRefId:z.string().uuid().nullable().optional(),technicalFailureCategories:z.array(technicalFailureSchema).min(1).max(6),sortOrder:z.number().int().min(0)});
const routeVersionFields={source:z.enum(["manual","import","system"]),provider:z.string().trim().min(1).max(100).nullable().optional(),model:z.string().trim().min(1).max(160).nullable().optional(),parameters:z.record(z.string(),z.unknown()).nullable().optional(),requiredCapabilities:z.array(z.string().trim().min(1).max(100)).max(50).nullable().optional(),credentialRefId:z.string().uuid().nullable().optional(),budgetPolicy:z.record(z.string(),z.unknown()).nullable().optional(),timeoutMs:z.number().int().positive().max(3_600_000).nullable().optional(),retryPolicy:z.record(z.string(),z.unknown()).nullable().optional(),fallbackMode:z.enum(["inherit","replace"]),fallbacks:z.array(routeFallbackSchema).max(20),baseVersionId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default("")};
export const modelRouteCreateSchema=z.object({scope:z.enum(["system_default","task_group","task","node","book","one_time"]),taskGroup:z.string().trim().min(1).max(100).nullable().optional(),taskKey:z.string().trim().min(1).max(120).nullable().optional(),nodeKey:z.string().trim().min(1).max(120).nullable().optional(),bookId:z.string().uuid().nullable().optional(),overrideKey:z.string().trim().min(1).max(120).nullable().optional(),name:z.string().trim().min(1).max(160),...routeVersionFields});
export const modelRouteVersionSchema=z.object({...routeVersionFields,expectedRevision:z.number().int().positive()});
export const modelRouteResolveSchema=z.object({bookId:z.string().uuid(),taskContractVersionId:z.string().uuid(),nodeKey:z.string().trim().max(120).nullable().optional(),oneTimeOverrideKey:z.string().trim().max(120).nullable().optional()});
export const aiRunPreviewCreateSchema=z.object({bookId:z.string().uuid(),taskContractVersionId:z.string().uuid(),taskNodeKey:z.string().trim().min(1).max(120),sourceRoute:z.string().trim().startsWith("/").max(1000),sourceKind:z.string().trim().min(1).max(120),sourceId:z.string().uuid().nullable().optional(),volumeId:z.string().uuid().nullable().optional(),chapterId:z.string().uuid().nullable().optional(),sceneId:z.string().uuid().nullable().optional(),inputSnapshot:z.record(z.string(),z.unknown()),safeCheckpoint:z.record(z.string(),z.unknown()).default({}),totalBudget:z.number().int().min(1).max(1_000_000),timeoutMs:z.number().int().min(100).max(10_000).default(5000),oneTimeOverrideKey:z.string().trim().max(120).nullable().optional(),excludeSourceKeys:z.array(z.string().trim().min(1).max(300)).max(500).default([]),manualSwitches:z.record(z.string(),z.boolean()).default({}),idempotencyKey:idempotencySchema,createdBy:z.string().trim().max(160).default("user")});
export const aiRunPreviewSubmitSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:idempotencySchema,submittedBy:z.string().trim().max(160).default("user")});

export const aiTaskStatusSchema=z.enum(["queued","running","waiting_approval","retry_scheduled","paused","succeeded","failed","cancelled"]);
export const aiFailureCategorySchema=z.enum(["timeout","rate_limit","authentication","provider_unavailable","transport","context_limit","structure_parse","content_unsatisfactory","cancelled","safety","data_integrity","unknown"]);
export const aiTaskCreateSchema=z.object({spaceId:z.string().uuid(),bookId:z.string().uuid().nullable().optional(),taskKey:z.string().trim().min(1).max(100),taskContractVersionId:z.string().uuid(),sourceRoute:z.string().trim().startsWith("/").max(500),sourceKind:z.string().trim().min(1).max(100),sourceId:z.string().uuid().nullable().optional(),requestIdempotencyKey:z.string().trim().min(8).max(160),priority:z.number().int().min(-100).max(100).default(0),createdBy:z.string().trim().max(160).default(""),steps:z.array(z.object({stepKey:z.string().trim().min(1).max(100),sortOrder:z.number().int().min(0),maxAttempts:z.number().int().min(1).max(20)})).min(1).max(100)});
export const aiAttemptStartSchema=z.object({taskId:z.string().uuid(),stepId:z.string().uuid(),expectedStepRevision:z.number().int().positive(),triggerKind:z.enum(["initial","technical_retry","manual_retry"]),owner:z.string().trim().min(1).max(160),actorKind:z.enum(["user","worker","system"]),leaseMs:z.number().int().min(1000).max(3_600_000),taskContractVersionId:z.string().uuid(),promptRecipeVersionId:z.string().uuid(),contextManifestId:z.string().uuid(),modelRouteSnapshotId:z.string().uuid(),inputHash:z.string().regex(/^[a-f0-9]{64}$/),outputSchemaVersion:z.string().trim().min(1).max(80),checkpointKey:z.string().trim().max(160).nullable().optional()});
export const aiStepHeartbeatSchema=z.object({taskId:z.string().uuid(),stepId:z.string().uuid(),attemptId:z.string().uuid(),leaseToken:z.string().uuid(),owner:z.string().trim().min(1).max(160),expectedStepRevision:z.number().int().positive(),leaseMs:z.number().int().min(1000).max(3_600_000),checkpointKey:z.string().trim().max(160).nullable().optional()});
export const aiAttemptSuccessSchema=z.object({taskId:z.string().uuid(),stepId:z.string().uuid(),attemptId:z.string().uuid(),leaseToken:z.string().uuid(),expectedStepRevision:z.number().int().positive(),resultKind:z.string().trim().min(1).max(100),resultStableId:z.string().uuid(),resultVersionId:z.string().uuid().nullable().optional(),resultHash:z.string().regex(/^[a-f0-9]{64}$/),providerRequestId:z.string().trim().max(500).optional(),checkpointKey:z.string().trim().max(160).nullable().optional(),requiresApproval:z.boolean().default(false),actor:z.string().trim().max(160).default("")});
export const aiAttemptFailureSchema=z.object({taskId:z.string().uuid(),stepId:z.string().uuid(),attemptId:z.string().uuid(),leaseToken:z.string().uuid(),expectedStepRevision:z.number().int().positive(),errorCategory:aiFailureCategorySchema,errorSummary:z.string().trim().max(5000),providerRequestId:z.string().trim().max(500).optional(),backoffMs:z.number().int().min(0).max(86_400_000).optional(),actor:z.string().trim().max(160).default("")});
export const aiStepRecoverySchema=z.object({taskId:z.string().uuid(),stepId:z.string().uuid(),owner:z.string().trim().min(1).max(160),leaseMs:z.number().int().min(1000).max(3_600_000),actor:z.string().trim().max(160).default("")});
export const aiApprovalRequestSchema=z.object({taskId:z.string().uuid(),stepId:z.string().uuid().nullable().optional(),attemptId:z.string().uuid().nullable().optional(),scopeKind:z.enum(["task","step","attempt","result_candidate"]),scopeId:z.string().uuid(),reasonCode:z.string().trim().min(1).max(100),reasonDetail:z.string().trim().min(1).max(1000),requestedByKind:z.enum(["worker","system","policy","user"]),requestedBy:z.string().trim().max(160).default("")});
export const aiApprovalDecisionSchema=z.object({decision:z.enum(["approved","rejected","changes_requested","expired"]),decidedByKind:z.enum(["user","system","policy"]),decidedBy:z.string().trim().min(1).max(160),policyVersion:z.string().trim().max(100).nullable().optional(),reason:z.string().trim().max(1000).default("")});
export const aiAttemptUsageSchema=z.object({attemptId:z.string().uuid(),inputTokens:z.number().int().min(0).nullable().optional(),outputTokens:z.number().int().min(0).nullable().optional(),cachedInputTokens:z.number().int().min(0).nullable().optional(),durationMs:z.number().int().min(0).nullable().optional(),estimatedCost:z.number().min(0).nullable().optional(),currency:z.string().trim().min(1).max(12).nullable().optional(),fallbackCount:z.number().int().min(0).max(100).default(0)}).superRefine((value,ctx)=>{if((value.estimatedCost===null||value.estimatedCost===undefined)!==(value.currency===null||value.currency===undefined))ctx.addIssue({code:"custom",path:["currency"],message:"估算费用和币种必须同时提供或同时未知。"});});
export const aiTaskListQuerySchema=z.object({bookId:z.string().uuid().optional(),spaceId:z.string().uuid().optional(),status:aiTaskStatusSchema.optional(),sourceRoute:z.string().trim().max(500).optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(20)});

export const qualityIssueStatusSchema=z.enum(["open","acknowledged","dismissed","fix_proposed","fixed","verified","stale","superseded"]);
export const qualitySeveritySchema=z.enum(["info","low","medium","high","critical"]);
const qualityEvidenceSchema=z.object({evidenceKind:z.enum(["text_anchor","canonical_fact","state_change","story_time","story_relation","planning_version","rule","observation"]),textAnchorId:z.string().uuid().nullable().optional(),factId:z.string().uuid().nullable().optional(),stateChangeId:z.string().uuid().nullable().optional(),storyTimingId:z.string().uuid().nullable().optional(),storyRelationId:z.string().uuid().nullable().optional(),planningVersionId:z.string().uuid().nullable().optional(),ruleKey:z.string().trim().min(1).max(100).nullable().optional(),ruleVersion:z.string().trim().min(1).max(100).nullable().optional(),note:z.string().trim().min(1).max(2000),isUnverifiedObservation:z.boolean().default(false)}).superRefine((value,ctx)=>{const map={text_anchor:value.textAnchorId,canonical_fact:value.factId,state_change:value.stateChangeId,story_time:value.storyTimingId,story_relation:value.storyRelationId,planning_version:value.planningVersionId} as const;if(value.evidenceKind in map&&!map[value.evidenceKind as keyof typeof map])ctx.addIssue({code:"custom",path:["evidenceKind"],message:"证据类型必须携带对应的精确引用。"});if(value.evidenceKind==="rule"&&(!value.ruleKey||!value.ruleVersion))ctx.addIssue({code:"custom",path:["ruleKey"],message:"规则证据必须携带规则 key 和版本。"});if(value.evidenceKind==="observation"&&!value.isUnverifiedObservation)ctx.addIssue({code:"custom",path:["isUnverifiedObservation"],message:"无正本证据的观察必须显式标记为未验证。"});});
const qualityFixInputSchema=z.object({targetChapterDocumentId:z.string().uuid(),targetBodyVersionId:z.string().uuid(),targetAnchorId:z.string().uuid().nullable().optional(),patch:z.record(z.string(),z.unknown()),source:z.enum(["ai","user"]),createdBy:z.string().trim().max(160).default("")});
const qualityIssueVersionFields={categoryKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),severity:qualitySeveritySchema,confidence:z.number().min(0).max(1).nullable().optional(),title:z.string().trim().min(1).max(300),description:z.string().trim().min(1).max(5000),detectionSource:z.enum(["ai","rule","manual","import","system"]),impactScope:z.record(z.string(),z.unknown()).default({}),suggestedAction:z.string().trim().max(3000).default(""),targetValue:z.unknown().nullable().optional(),observedValue:z.unknown().nullable().optional(),scaleVersion:z.string().trim().max(100).nullable().optional(),interpretation:z.string().trim().max(3000).default(""),createdBy:z.string().trim().max(160).default(""),evidence:z.array(qualityEvidenceSchema).min(1).max(100)};
export const qualityAuditReportCreateSchema=z.object({id:z.string().uuid(),bookId:z.string().uuid(),scopeKind:z.enum(["book","chapter","body","planning","fact","composite"]),scopeId:z.string().uuid().nullable().optional(),taskId:z.string().uuid(),stepId:z.string().uuid(),attemptId:z.string().uuid(),taskContractVersionId:z.string().uuid(),promptRecipeVersionId:z.string().uuid(),contextManifestId:z.string().uuid(),modelRouteSnapshotId:z.string().uuid(),ruleSetKey:z.string().trim().min(1).max(100),ruleSetVersion:z.string().trim().min(1).max(100),inputHash:z.string().regex(/^[a-f0-9]{64}$/),policyMode:z.enum(["completion_first","quality_first"]),policyDecision:z.enum(["continue","record_quality_debt","pause_for_manual","replan_required","no_usable_body","runtime_safety_failure"]),summary:z.string().trim().max(5000).default(""),idempotencyKey:z.string().trim().min(8).max(160),createdBy:z.string().trim().max(160).default(""),bodyVersions:z.array(z.object({chapterDocumentId:z.string().uuid(),bodyVersionId:z.string().uuid()})).max(500),planningVersions:z.array(z.object({planningObjectId:z.string().uuid(),planningVersionId:z.string().uuid()})).max(500),factIds:z.array(z.string().uuid()).max(500),issues:z.array(z.object({stableKey:z.string().trim().min(1).max(160),isQualityDebt:z.boolean().default(false),fixCandidate:qualityFixInputSchema.nullable().optional(),...qualityIssueVersionFields})).max(1000)}).superRefine((value,ctx)=>{if(!value.bodyVersions.length&&!value.planningVersions.length&&!value.factIds.length)ctx.addIssue({code:"custom",path:["bodyVersions"],message:"至少绑定一个确切正文、规划或事实版本。"});if(!["book","composite"].includes(value.scopeKind)&&!value.scopeId)ctx.addIssue({code:"custom",path:["scopeId"],message:"该审计范围必须指定稳定对象。"});if(value.policyMode==="completion_first"&&value.policyDecision==="pause_for_manual")ctx.addIssue({code:"custom",path:["policyDecision"],message:"completion-first 不允许因局部质量问题暂停全书。"});if(new Set(value.issues.map(item=>item.stableKey)).size!==value.issues.length)ctx.addIssue({code:"custom",path:["issues"],message:"同一报告内的问题稳定 key 不能重复。"});});
export const qualityIssueRevisionSchema=z.object({...qualityIssueVersionFields,expectedRevision:z.number().int().positive()});
export const qualityIssueTransitionSchema=z.object({toStatus:z.enum(["open","acknowledged","dismissed","fix_proposed","stale","superseded"]),expectedRevision:z.number().int().positive(),actorKind:z.enum(["user","system","policy"]),actor:z.string().trim().max(160).default(""),reason:z.string().trim().min(1).max(2000)});
export const qualityFixRevisionSchema=qualityFixInputSchema.extend({expectedRevision:z.number().int().positive()});
export const qualityFixDecisionSchema=z.object({decision:z.enum(["accept","reject"]),expectedRevision:z.number().int().positive(),actor:z.string().trim().min(1).max(160),reason:z.string().trim().min(1).max(2000)});
export const qualityFixAdoptionSchema=z.object({candidateVersionId:z.string().uuid(),chapterBodyAdoptionId:z.string().uuid(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().min(1).max(160)});
export const qualityRecheckSchema=z.object({issueId:z.string().uuid(),fixCandidateId:z.string().uuid().nullable().optional(),recheckReportId:z.string().uuid(),checkedBodyVersionId:z.string().uuid(),outcome:z.enum(["supports_verified","still_present","inconclusive"]),evidenceSummary:z.string().trim().min(1).max(3000),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("")});
export const qualityReportListQuerySchema=z.object({bookId:z.string().uuid(),chapterDocumentId:z.string().uuid().optional(),categoryKey:z.string().trim().max(100).optional(),severity:qualitySeveritySchema.optional(),status:qualityIssueStatusSchema.optional(),staleOnly:z.coerce.boolean().default(false),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(20)});
export const qualityIssueListQuerySchema=z.object({bookId:z.string().uuid(),bodyVersionId:z.string().uuid().optional(),chapterDocumentId:z.string().uuid().optional(),categoryKey:z.string().trim().max(100).optional(),severity:qualitySeveritySchema.optional(),status:qualityIssueStatusSchema.optional(),qualityDebtOnly:z.coerce.boolean().default(false),limit:z.coerce.number().int().min(1).max(100).default(50)});

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

export function validateFieldValue(field: FieldDefinition, value: unknown): string | null {
  return validateValue(field, value);
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

export const dependencyResourceKindSchema=z.enum(["card_type_version","template_group_version","card_version","card_relation","card_mount","tag_version","tag_membership","material_group_version","group_membership","smart_view_version","research_document_version","research_record_version","research_reference_pack_version","chapter_body_version","chapter_text_anchor","canonical_fact","chapter_settlement","state_change","knowledge_state_change","story_event_timing","story_event_relation","planning_version","prompt_recipe_version","task_contract_version","context_binding_version","context_preview","context_manifest","semantic_retrieval_run","model_route_snapshot","ai_task_attempt","quality_audit_report","asset_version","embedding_source_snapshot","embedding_chunk","embedding_result","embedding_index_generation"]);
export const dependencyKindSchema=z.enum(["generated_from","planned_from","validated_against","evidenced_by","context_included","configured_by","settled_from","audited_from","derived_from"]);
export const dependencyStateSchema=z.enum(["fresh","stale","invalid","needs_review","recompute_pending","recomputing","recomputed","accepted_stale"]);
export const dependencyResourceRegisterSchema=z.object({resourceKind:dependencyResourceKindSchema,stableObjectId:z.string().uuid(),exactVersionId:z.string().uuid()});
export const dependencyEdgeCreateSchema=z.object({bookId:z.string().uuid(),sourceResourceId:z.string().uuid(),derivedResourceId:z.string().uuid(),dependencyKind:dependencyKindSchema,dependencyStrength:z.enum(["hard","soft"]),originKind:z.enum(["adoption","confirmation","settlement","contract_publication","context_build","ai_result","audit","manual","import","system"]),originId:z.string().uuid().nullable().optional(),idempotencyKey:z.string().trim().min(8).max(200)});
export const dependencyEdgeEndSchema=z.object({reason:z.string().trim().min(1).max(2000)});
export const dependencyPreviewSchema=z.object({bookId:z.string().uuid(),oldResourceId:z.string().uuid(),newResourceId:z.string().uuid().nullable().optional(),bookChangeSetId:z.string().uuid().nullable().optional(),reason:z.string().trim().min(1).max(2000),idempotencyKey:z.string().trim().min(8).max(200),createdBy:z.string().trim().max(160).default("")});
export const dependencyInvalidationSchema=z.object({id:z.string().uuid().optional(),bookId:z.string().uuid(),oldResourceId:z.string().uuid(),newResourceId:z.string().uuid().nullable().optional(),changePreviewId:z.string().uuid().nullable().optional(),bookChangeSetId:z.string().uuid().nullable().optional(),reason:z.string().trim().min(1).max(2000),triggerSource:z.enum(["manual","system"]),requestedState:z.enum(["stale","invalid","needs_review"]),triggerId:z.string().uuid().nullable().optional(),idempotencyKey:z.string().trim().min(8).max(200)});
export const dependencyGraphQuerySchema=z.object({direction:z.enum(["upstream","downstream"]),includeEnded:z.enum(["true","false"]).optional().transform(value=>value==="true"),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const dependencyStateQuerySchema=z.object({state:dependencyStateSchema.optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const dependencyRecomputeQuerySchema=z.object({status:z.enum(["pending","recomputing","completed","failed","superseded","cancelled"]).optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const dependencyHistoryQuerySchema=z.object({resourceId:z.string().uuid().optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const dependencyConflictQuerySchema=z.object({status:z.enum(["needs_review","resolved","dismissed"]).optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const dependencyConflictResolutionSchema=z.object({status:z.enum(["resolved","dismissed"]),resolutionNote:z.string().trim().min(1).max(2000)});
const dependencyRequirementSchema=z.object({resourceId:z.string().uuid(),kind:dependencyResourceKindSchema,stableObjectId:z.string().uuid(),exactVersionId:z.string().uuid(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)});
export const dependencyRecomputeCompletionSchema=z.object({inputDependencySnapshot:z.array(dependencyRequirementSchema).max(2000),outputResourceId:z.string().uuid().nullable().optional(),outputVersionId:z.string().uuid().nullable().optional(),outputHash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),outcome:z.enum(["applied","failed"]),detail:z.string().trim().max(5000).default(""),idempotencyKey:z.string().trim().min(8).max(200)}).superRefine((value,ctx)=>{if(value.outcome==="applied"&&(!value.outputResourceId||!value.outputVersionId||!value.outputHash))ctx.addIssue({code:"custom",path:["outputResourceId"],message:"成功回执必须携带已注册的输出资源、版本和哈希。"});});
export const dependencyStaleAcceptanceSchema=z.object({bookId:z.string().uuid(),resourceId:z.string().uuid(),invalidationEventId:z.string().uuid(),riskSummary:z.string().trim().min(1).max(3000),reason:z.string().trim().min(1).max(2000),actor:z.string().trim().min(1).max(160),idempotencyKey:z.string().trim().min(8).max(200)});

const sha256Schema=z.string().regex(/^[a-f0-9]{64}$/);
const assetKindSchema=z.enum(["attachment","cover","illustration","audio","video","document","dataset","font","other"]);
export const assetMountOwnerKindSchema=z.enum(["book","card_version","chapter_body_version","research_record_version","prompt_recipe_version","ai_task_attempt","quality_issue_evidence"]);
export const assetContentRegisterSchema=z.object({checksum:sha256Schema,byteSize:z.number().int().min(0),mimeType:z.string().trim().regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/),storageKind:z.enum(["managed_file","external_object"]),storageProvider:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/),storageLocator:z.string().trim().min(1).max(1000),createdBy:z.string().trim().max(160).default("")}).superRefine((value,ctx)=>{if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,999}$/.test(value.storageLocator)||/(^[\\/]|^[A-Za-z]:|(^|\/)\.\.(\/|$)|\\|:\/\/|\/\/)/.test(value.storageLocator))ctx.addIssue({code:"custom",path:["storageLocator"],message:"locator 只能使用受控 ASCII 相对路径或稳定对象键。"});if((value.storageKind==="managed_file")!==(value.storageProvider==="local"))ctx.addIssue({code:"custom",path:["storageProvider"],message:"应用管理文件必须使用 local，外部对象必须使用明确的非 local provider。"});});
export const assetIntegrityCheckSchema=z.object({contentObjectId:z.string().uuid(),observedChecksum:sha256Schema.nullable().optional(),observedByteSize:z.number().int().min(0).nullable().optional(),outcome:z.enum(["verified","missing","corrupt"]),detail:z.string().trim().max(3000).default(""),checkedBy:z.string().trim().min(1).max(160)});
const assetVersionFields={contentObjectId:z.string().uuid(),displayFilename:z.string().trim().min(1).max(500).refine(value=>!/[\\/]/.test(value),"展示文件名不能包含路径。"),title:z.string().trim().max(300).default(""),metadata:z.record(z.string(),z.unknown()).default({}),sourceKind:z.enum(["upload","import","ai_generated","external_reference","migration"]),sourceResourceId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default("")};
export const assetCreateSchema=z.object({bookId:z.string().uuid(),assetKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,119}$/),assetKind:assetKindSchema,title:z.string().trim().min(1).max(300),contentObjectId:z.string().uuid(),displayFilename:z.string().trim().min(1).max(500).refine(value=>!/[\\/]/.test(value),"展示文件名不能包含路径。"),versionTitle:z.string().trim().max(300).default(""),metadata:z.record(z.string(),z.unknown()).default({}),sourceKind:z.enum(["upload","import","ai_generated","external_reference","migration"]),sourceResourceId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default(""),idempotencyKey:z.string().trim().min(8).max(200)});
export const assetVersionCreateSchema=z.object({...assetVersionFields,expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(200)});
export const assetPreviewSchema=z.object({toVersionId:z.string().uuid().nullable().optional(),archive:z.boolean().default(false),idempotencyKey:z.string().trim().min(8).max(200),createdBy:z.string().trim().max(160).default("")}).superRefine((value,ctx)=>{if(!value.archive&&!value.toVersionId)ctx.addIssue({code:"custom",path:["toVersionId"],message:"采用预览必须指定目标版本。"});});
export const assetAdoptSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),dependencyPreviewId:z.string().uuid().nullable().optional(),idempotencyKey:z.string().trim().min(8).max(200),actor:z.string().trim().min(1).max(160)});
export const assetArchiveSchema=z.object({expectedRevision:z.number().int().positive(),dependencyPreviewId:z.string().uuid(),idempotencyKey:z.string().trim().min(8).max(200),actor:z.string().trim().min(1).max(160),reason:z.string().trim().min(1).max(2000)});
export const assetMountCreateSchema=z.object({bookId:z.string().uuid(),assetId:z.string().uuid(),assetVersionId:z.string().uuid(),ownerKind:assetMountOwnerKindSchema,ownerStableId:z.string().uuid(),ownerExactVersionId:z.string().uuid(),role:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),label:z.string().trim().max(300).default(""),idempotencyKey:z.string().trim().min(8).max(200),createdBy:z.string().trim().max(160).default("")});
export const assetMountEndSchema=z.object({reason:z.string().trim().min(1).max(2000)});
export const assetDerivationCreateSchema=z.object({bookId:z.string().uuid(),sourceAssetVersionId:z.string().uuid(),outputAssetId:z.string().uuid(),derivativeKind:z.enum(["thumbnail","ocr_text","transcode","frame_extract","parsed_text","cover_variant","other"]),recipeKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,119}$/),recipeVersion:z.string().trim().min(1).max(120),toolKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,119}$/),toolVersion:z.string().trim().min(1).max(120),parameters:z.record(z.string(),z.unknown()).default({}),idempotencyKey:z.string().trim().min(8).max(200),createdBy:z.string().trim().max(160).default("")});
export const assetDerivationStartSchema=z.object({expectedRevision:z.number().int().positive(),actor:z.string().trim().min(1).max(160)});
export const assetDerivationCompleteSchema=z.object({expectedRevision:z.number().int().positive(),outcome:z.enum(["applied","failed"]),outputContentObjectId:z.string().uuid().nullable().optional(),outputChecksum:sha256Schema.nullable().optional(),displayFilename:z.string().trim().min(1).max(500).nullable().optional(),title:z.string().trim().max(300).default(""),metadata:z.record(z.string(),z.unknown()).default({}),detail:z.string().trim().max(5000).default(""),idempotencyKey:z.string().trim().min(8).max(200),actor:z.string().trim().min(1).max(160)}).superRefine((value,ctx)=>{if(value.outcome==="applied"&&(!value.outputContentObjectId||!value.outputChecksum||!value.displayFilename))ctx.addIssue({code:"custom",path:["outputContentObjectId"],message:"成功派生回执必须携带内容对象、校验和和展示文件名。"});if(value.displayFilename&&/[\\/]/.test(value.displayFilename))ctx.addIssue({code:"custom",path:["displayFilename"],message:"展示文件名不能包含路径。"});});
export const assetListQuerySchema=z.object({status:z.enum(["active","archived"]).optional(),assetKind:assetKindSchema.optional(),staleOnly:z.enum(["true","false"]).optional().transform(value=>value==="true"),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const assetMountListQuerySchema=z.object({ownerKind:assetMountOwnerKindSchema.optional(),ownerStableId:z.string().uuid().optional(),assetId:z.string().uuid().optional(),includeEnded:z.enum(["true","false"]).optional().transform(value=>value==="true"),limit:z.coerce.number().int().min(1).max(200).default(100)});
export const assetDerivationListQuerySchema=z.object({status:z.enum(["pending","processing","succeeded","failed","stale","rebuild_pending","archived"]).optional(),assetId:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(200).default(100)});

export const graphProjectionRequestQuerySchema=z.object({status:z.enum(["pending","processing","succeeded","failed","superseded"]).optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const graphProjectionListQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(200).default(50)});
export const graphProjectionMappingQuerySchema=z.object({generationId:z.string().uuid().optional(),sourceKind:z.string().trim().min(1).max(120).optional(),sourceId:z.string().uuid().optional(),includeTombstoned:z.enum(["true","false"]).optional().transform(value=>value==="true"),limit:z.coerce.number().int().min(1).max(500).default(100)});
export const graphProjectionRebuildSchema=z.object({idempotencyKey:z.string().trim().min(8).max(200),actor:z.string().trim().max(160).default("")});
export const graphTraversalSchema=z.object({queryKind:z.enum(["neighbors","shortest_path","character_network","event_causal_chain","clue_links","item_links","location_links"]),sourceKind:z.string().trim().min(1).max(120),sourceId:z.string().uuid(),targetSourceKind:z.string().trim().min(1).max(120).nullable().optional(),targetSourceId:z.string().uuid().nullable().optional(),depth:z.number().int().min(1).max(6).default(3),limit:z.number().int().min(1).max(200).default(50)}).superRefine((value,ctx)=>{if(value.queryKind==="shortest_path"&&(!value.targetSourceKind||!value.targetSourceId))ctx.addIssue({code:"custom",path:["targetSourceId"],message:"最短路径查询必须指定目标来源。"});});

export const embeddingSourceKindSchema=z.enum(["card_version","chapter_body_version","canonical_fact","knowledge_state_change","state_change","story_event_timing","story_event_relation","planning_version","research_document_version","research_record_version","research_reference_pack_version","prompt_component","ai_task_attempt","quality_issue_evidence","asset_parsed_text"]);
const embeddingMetricSchema=z.enum(["cosine","l2","inner_product"]);
export const embeddingProfileCreateSchema=z.object({profileKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/),name:z.string().trim().min(1).max(200),purpose:z.enum(["semantic_retrieval","similarity","clustering"]),providerKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/),modelKey:z.string().trim().min(1).max(160),dimensions:z.number().int().min(1).max(2000),distanceMetric:embeddingMetricSchema,normalize:z.boolean().default(false),chunkerKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/),chunkerVersion:z.string().trim().min(1).max(80),maxChunkChars:z.number().int().min(128).max(50000),overlapChars:z.number().int().min(0),allowedSourceKinds:z.array(embeddingSourceKindSchema).min(1),createdBy:z.string().trim().max(160).default("")}).refine(value=>value.overlapChars<value.maxChunkChars,{path:["overlapChars"],message:"重叠长度必须小于分块长度。"});
export const embeddingProfileVersionSchema=embeddingProfileCreateSchema.omit({profileKey:true,name:true,purpose:true}).extend({expectedRevision:z.number().int().positive()});
export const embeddingProfileArchiveSchema=z.object({expectedRevision:z.number().int().positive()});
export const embeddingSourceSnapshotSchema=z.object({bookId:z.string().uuid(),profileVersionId:z.string().uuid(),dependencySourceResourceId:z.string().uuid(),sourceKind:embeddingSourceKindSchema,sourceStableId:z.string().uuid(),sourceVersionId:z.string().uuid(),sourceRevision:z.number().int().positive(),sourceHash:sha256Schema,title:z.string().trim().max(500).default(""),contentText:z.string().min(1).max(10000000),createdBy:z.string().trim().max(160).default("")});
export const chunkingCompletionSchema=z.object({sourceSnapshotId:z.string().uuid(),expectedSourceHash:sha256Schema,idempotencyKey:z.string().trim().min(8).max(200),chunks:z.array(z.object({ordinal:z.number().int().min(0),anchorKind:z.enum(["whole","character_range","json_pointer","text_anchor","section"]),anchor:z.record(z.string(),z.unknown()).default({}),chunkText:z.string().min(1).max(50000),tokenEstimate:z.number().int().min(0).default(0)})).min(1).max(100000)});
export const embeddingRequestCreateSchema=z.object({chunkId:z.string().uuid(),idempotencyKey:z.string().trim().min(8).max(200)});
export const embeddingAttemptStartSchema=z.object({requestId:z.string().uuid()});
export const embeddingAttemptCompletionSchema=z.object({requestId:z.string().uuid(),attemptId:z.string().uuid(),outcome:z.enum(["applied","failed"]),observedSourceHash:sha256Schema,observedChunkHash:sha256Schema,vector:z.array(z.number().finite()).min(1).max(2000).optional(),vectorHash:sha256Schema.optional(),providerRequestRef:z.string().trim().max(500).optional(),errorCode:z.string().trim().max(120).default(""),detail:z.string().trim().max(5000).default(""),retryable:z.boolean().default(false)}).superRefine((value,ctx)=>{if(value.outcome==="applied"&&(!value.vector||!value.vectorHash))ctx.addIssue({code:"custom",path:["vector"],message:"成功回执必须携带向量和向量哈希。"});});
export const embeddingAttemptCompletionVerifiedSchema=embeddingAttemptCompletionSchema.superRefine((value,ctx)=>{if(value.outcome==="applied"&&value.vector&&value.vectorHash&&createHash("sha256").update(JSON.stringify(value.vector),"utf8").digest("hex")!==value.vectorHash)ctx.addIssue({code:"custom",path:["vectorHash"],message:"向量哈希与回执内容不一致。"});});
export const embeddingGenerationCreateSchema=z.object({bookId:z.string().uuid(),profileVersionId:z.string().uuid(),idempotencyKey:z.string().trim().min(8).max(200),createdBy:z.string().trim().max(160).default("")});
export const semanticRetrievalSchema=z.object({profileId:z.string().uuid(),callerKind:z.enum(["user","ai_task","system","debug"]),callerId:z.string().trim().max(500).default(""),queryVector:z.array(z.number().finite()).min(1).max(2000),queryText:z.string().max(4000).optional(),querySummary:z.string().trim().max(500).default(""),queryRef:z.string().trim().max(500).default(""),sourceKinds:z.array(embeddingSourceKindSchema).min(1).max(15),topK:z.number().int().min(1).max(100).default(20),candidateLimit:z.number().int().min(1).max(1000).default(200),similarityThreshold:z.number().min(0).max(1).nullable().optional(),timeoutMs:z.number().int().min(100).max(5000).default(3000),vectorWeight:z.number().min(0).max(1).default(.7),ftsWeight:z.number().min(0).max(1).default(.2),trigramWeight:z.number().min(0).max(1).default(.1),filters:z.object({sourceStableIds:z.array(z.string().uuid()).max(500).optional(),sourceRevisionMin:z.number().int().positive().optional()}).default({})}).superRefine((value,ctx)=>{if(value.candidateLimit<value.topK)ctx.addIssue({code:"custom",path:["candidateLimit"],message:"候选数不能小于返回数。"});if(Math.abs(value.vectorWeight+value.ftsWeight+value.trigramWeight-1)>.00001)ctx.addIssue({code:"custom",path:["vectorWeight"],message:"混合检索权重之和必须为 1。"});});
export const embeddingListQuerySchema=z.object({status:z.string().trim().max(40).optional(),limit:z.coerce.number().int().min(1).max(200).default(50)});
export const embeddingCoverageQuerySchema=z.object({profileId:z.string().uuid()});
export const embeddingRequestListQuerySchema=z.object({status:z.enum(["pending","running","retry_scheduled","succeeded","failed","stale","cancelled"]).optional(),limit:z.coerce.number().int().min(1).max(200).default(50)});
export const embeddingStaleListQuerySchema=z.object({status:z.enum(["open","resolved","accepted"]).optional(),limit:z.coerce.number().int().min(1).max(200).default(50)});
export const embeddingSourceArchiveSchema=z.object({reason:z.string().trim().min(1).max(2000),actor:z.string().trim().max(160).default("")});

export const outboxTopicSchema=z.enum(["dependency.recompute.requested","asset.derivation.requested","graph.projection.requested","embedding.chunking.requested","embedding.generation.requested","embedding.index.requested","ai.task.requested","backup.requested"]);
export const backgroundHandlerKeySchema=z.enum(["dependency.recompute","asset.derive","graph.project","embedding.chunk","embedding.generate","embedding.index","ai.task","backup.run"]);
export const backgroundJobStatusSchema=z.enum(["queued","leased","running","succeeded","failed","retry_scheduled","cancel_requested","cancelled","dead_letter","archived"]);
export const backgroundJobListQuerySchema=z.object({status:backgroundJobStatusSchema.optional(),handlerKey:backgroundHandlerKeySchema.optional(),limit:z.coerce.number().int().min(1).max(200).default(50)});
export const outboxEventListQuerySchema=z.object({topic:outboxTopicSchema.optional(),limit:z.coerce.number().int().min(1).max(200).default(50)});
export const backgroundJobCancelSchema=z.object({reason:z.string().trim().min(1).max(2000)});
export const backgroundJobReplaySchema=z.object({reason:z.string().trim().min(1).max(2000),requestedBy:z.string().trim().min(1).max(160),idempotencyKey:z.string().trim().min(8).max(240)});
export const outboxConsumerStateSchema=z.object({status:z.enum(["active","paused"]),reason:z.string().trim().max(1000).default(""),expectedRevision:z.number().int().positive()});
export const backgroundBookPauseSchema=z.object({status:z.enum(["active","paused"]),reason:z.string().trim().max(1000).default(""),actor:z.string().trim().min(1).max(160),expectedRevision:z.number().int().nonnegative()});

const transferProfileSchema=z.enum(["full_system","compact_continue","full_audit","template_bundle","resource_bundle"]);
const transferExportKindSchema=z.enum(["full_backup","book_export","template_export","resource_export"]);
const transferImportKindSchema=z.enum(["book_import","template_import","resource_import"]);
export const transferExportRequestSchema=z.object({operationKind:transferExportKindSchema,profileKey:transferProfileSchema,bookId:z.string().uuid().nullable().optional(),requestedBy:z.string().trim().min(1).max(160),idempotencyKey:z.string().trim().min(8).max(240)}).superRefine((value,ctx)=>{
  const valid=(value.operationKind==="full_backup"&&value.profileKey==="full_system"&&!value.bookId)||(value.operationKind==="book_export"&&["compact_continue","full_audit"].includes(value.profileKey)&&Boolean(value.bookId))||(value.operationKind==="template_export"&&value.profileKey==="template_bundle"&&!value.bookId)||(value.operationKind==="resource_export"&&value.profileKey==="resource_bundle"&&!value.bookId);
  if(!valid)ctx.addIssue({code:"custom",path:["profileKey"],message:"操作类型、导出配置与书籍范围不匹配。"});
});
export const transferImportDryRunSchema=z.object({operationKind:transferImportKindSchema,profileKey:transferProfileSchema,uploadTicketId:z.string().uuid(),requestedBy:z.string().trim().min(1).max(160),idempotencyKey:z.string().trim().min(8).max(240)}).superRefine((value,ctx)=>{
  const valid=(value.operationKind==="book_import"&&["compact_continue","full_audit"].includes(value.profileKey))||(value.operationKind==="template_import"&&value.profileKey==="template_bundle")||(value.operationKind==="resource_import"&&value.profileKey==="resource_bundle");
  if(!valid)ctx.addIssue({code:"custom",path:["profileKey"],message:"导入类型与包配置不匹配。"});
});
export const transferImportConfirmSchema=z.object({requestedBy:z.string().trim().min(1).max(160),idempotencyKey:z.string().trim().min(8).max(240),compatibilityPolicy:z.enum(["strict","explicit_upgrade"]).default("strict")});
export const transferOperationListSchema=z.object({bookId:z.string().uuid().optional(),status:z.enum(["queued","running","verifying","ready","failed","cancelled","imported","restored","archived"]).optional(),limit:z.coerce.number().int().min(1).max(200).default(50)});
export const transferCancelSchema=z.object({reason:z.string().trim().min(1).max(2000),actor:z.string().trim().min(1).max(160),expectedRevision:z.number().int().positive()});
export const transferConflictResolveSchema=z.object({resolution:z.enum(["new_local_version","remap","skip","abort"]),resolutionNote:z.string().trim().min(1).max(2000),expectedRevision:z.number().int().positive()});

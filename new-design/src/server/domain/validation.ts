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
export const bookAnalysisPurposeSchema=z.enum(["reference_learning","continuation","diagnosis"]);
export const bookAnalysisPresetSchema=z.enum(["quick","standard","full"]);
export const bookAnalysisInputSchema=z.object({documentVersionId:z.string().uuid(),purpose:bookAnalysisPurposeSchema,preset:bookAnalysisPresetSchema,rangeMode:z.enum(["full","range"]),startOffset:z.number().int().nonnegative().optional(),endOffset:z.number().int().positive().optional(),focus:z.string().trim().max(1000).default(""),budgetTokens:z.number().int().min(1000).max(12000)}).superRefine((value,ctx)=>{if(value.rangeMode==="range"&&(value.startOffset===undefined||value.endOffset===undefined||value.endOffset<=value.startOffset))ctx.addIssue({code:"custom",path:["endOffset"],message:"局部分析需要有效的起止位置。"});});
export const candidateDecisionsSchema=z.object({decisions:z.array(z.object({candidateId:z.string().uuid(),action:z.enum(["create_card","merge_card","save_resource","reference_only","ignore"]),targetSpaceId:z.string().uuid().optional(),targetCardId:z.string().uuid().optional(),expectedRevision:z.number().int().positive().optional()})).min(1).max(30)});
export const researchCandidateUpdateSchema=z.object({title:z.string().trim().min(1).max(200),values:z.record(z.string(),z.unknown()),expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const referencePackPublishSchema=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(1).max(160),description:z.string().trim().max(1000).default(""),note:z.string().trim().max(500).default(""),revision:z.number().int().positive().optional(),items:z.array(z.object({researchVersionId:z.string().uuid(),purpose:z.string().trim().min(1).max(80).default("book_creation"),weight:z.number().positive().max(10).default(1),note:z.string().trim().max(500).default("")})).min(1).max(50)});
export const researchReusePreviewSchema=z.object({templateVersionId:z.string().uuid(),researchVersionIds:z.array(z.string().uuid()).max(50).default([]),packVersionIds:z.array(z.string().uuid()).max(20).default([]),includeTemplateSeed:z.boolean().default(false)}).refine((value)=>value.researchVersionIds.length+value.packVersionIds.length>0,{message:"请至少选择一条研究记录或一个参考包。"});
export const chapterDocumentInputSchema=z.object({chapterCardId:z.string().uuid(),logicalOrder:z.number().int().positive(),title:z.string().trim().min(1).max(200)});
export const chapterBodyVersionInputSchema=z.object({content:z.string().min(1),source:z.enum(["manual","ai_candidate","revision","import"]),parentVersionId:z.string().uuid().nullable().optional(),baseVersionId:z.string().uuid().nullable().optional(),sourceRunId:z.string().uuid().nullable().optional(),createdByKind:z.enum(["user","ai","system","import"]),createdBy:z.string().trim().max(160).default("")});
export const chapterBodyAdoptionSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),actor:z.string().trim().max(160).default("user")});
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

const planningVersionFields={content:z.record(z.string(),z.unknown()),source:z.enum(["manual","ai","import","system","body_revision"]),baseVersionId:z.string().uuid().nullable().optional(),basedOnParentVersionId:z.string().uuid().nullable().optional(),sourceBodyVersionId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default("")};
function validatePlanningVersionSource(value:Record<string,unknown>,ctx:z.RefinementCtx){if(value.source==="body_revision"&&!value.sourceBodyVersionId)ctx.addIssue({code:"custom",path:["sourceBodyVersionId"],message:"正文反向修正规划必须记录正文版本。"});if(value.source!=="body_revision"&&value.sourceBodyVersionId)ctx.addIssue({code:"custom",path:["sourceBodyVersionId"],message:"只有正文反向修正可以记录正文版本。"});}
export const planningObjectInputSchema=z.object({level:z.enum(["story","volume","chapter","scene"]),parentObjectId:z.string().uuid().nullable().optional(),cardId:z.string().uuid().nullable().optional(),title:z.string().trim().min(1).max(240),sortOrder:z.number().int().min(0),...planningVersionFields}).superRefine((value,ctx)=>{validatePlanningVersionSource(value,ctx);if(value.level==="story"&&(value.parentObjectId||value.cardId))ctx.addIssue({code:"custom",path:["level"],message:"故事总计划不绑定父级或卡片。"});if(value.level!=="story"&&(!value.parentObjectId||!value.cardId))ctx.addIssue({code:"custom",path:["parentObjectId"],message:"卷、章、场景计划必须绑定父级和同类型卡片。"});});
export const planningVersionInputSchema=z.object({...planningVersionFields,expectedRevision:z.number().int().positive()}).superRefine(validatePlanningVersionSource);
export const planningVersionRejectSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),actor:z.string().trim().max(160).default("user"),note:z.string().trim().max(500).default("")});
export const planningVersionAdoptSchema=z.object({versionId:z.string().uuid(),expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160),source:z.enum(["user","system","import"]).default("user"),actor:z.string().trim().max(160).default("user")});
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

export const modelCredentialRefSchema=z.object({credentialKey:z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,99}$/),provider:z.string().trim().min(1).max(100),secretLocator:z.string().trim().regex(/^(secret|env|keychain):\/\/[A-Za-z0-9_.:/-]+$/),status:z.enum(["active","disabled"]).default("active")});
const technicalFailureSchema=z.enum(["timeout","rate_limit","authentication","provider_unavailable","transport","context_limit"]);
const routeFallbackSchema=z.object({provider:z.string().trim().min(1).max(100),model:z.string().trim().min(1).max(160),parameters:z.record(z.string(),z.unknown()).default({}),credentialRefId:z.string().uuid().nullable().optional(),technicalFailureCategories:z.array(technicalFailureSchema).min(1).max(6),sortOrder:z.number().int().min(0)});
const routeVersionFields={source:z.enum(["manual","import","system"]),provider:z.string().trim().min(1).max(100).nullable().optional(),model:z.string().trim().min(1).max(160).nullable().optional(),parameters:z.record(z.string(),z.unknown()).nullable().optional(),requiredCapabilities:z.array(z.string().trim().min(1).max(100)).max(50).nullable().optional(),credentialRefId:z.string().uuid().nullable().optional(),budgetPolicy:z.record(z.string(),z.unknown()).nullable().optional(),timeoutMs:z.number().int().positive().max(3_600_000).nullable().optional(),retryPolicy:z.record(z.string(),z.unknown()).nullable().optional(),fallbackMode:z.enum(["inherit","replace"]),fallbacks:z.array(routeFallbackSchema).max(20),baseVersionId:z.string().uuid().nullable().optional(),createdBy:z.string().trim().max(160).default("")};
export const modelRouteCreateSchema=z.object({scope:z.enum(["system_default","task_group","node","book","one_time"]),taskGroup:z.string().trim().min(1).max(100).nullable().optional(),nodeKey:z.string().trim().min(1).max(120).nullable().optional(),bookId:z.string().uuid().nullable().optional(),overrideKey:z.string().trim().min(1).max(120).nullable().optional(),name:z.string().trim().min(1).max(160),...routeVersionFields});
export const modelRouteVersionSchema=z.object({...routeVersionFields,expectedRevision:z.number().int().positive()});
export const modelRouteResolveSchema=z.object({bookId:z.string().uuid(),taskContractVersionId:z.string().uuid(),nodeKey:z.string().trim().max(120).nullable().optional(),oneTimeOverrideKey:z.string().trim().max(120).nullable().optional()});

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

export const dependencyResourceKindSchema=z.enum(["card_type_version","template_group_version","card_version","card_relation","research_document_version","research_record_version","research_reference_pack_version","chapter_body_version","chapter_text_anchor","canonical_fact","chapter_settlement","state_change","knowledge_state_change","story_event_timing","story_event_relation","planning_version","prompt_recipe_version","task_contract_version","context_manifest","model_route_snapshot","ai_task_attempt","quality_audit_report","asset_version"]);
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

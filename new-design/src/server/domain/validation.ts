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

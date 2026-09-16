import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PromptAsset } from "../../core/promptTypes";

const directionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  premise: z.string().min(10).max(1000),
  protagonist: z.string().min(4).max(500),
  centralConflict: z.string().min(4).max(500),
  readerPromise: z.string().min(4).max(500),
  styleKeywords: z.array(z.string().min(1).max(30)).min(2).max(8),
}).strict();

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

const directionsOutputSchema = z.object({ directions: z.array(directionSchema).length(3) }).strict();
const initialContentOutputSchema = z.object({
  cards: z.array(z.object({
    typeKey: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    values: z.record(z.string(), scalarSchema),
  }).strict()).min(4).max(24),
}).strict();
const formAssistOutputSchema = z.object({ suggestions: z.record(z.string(), scalarSchema) }).strict();
const marketSignalSchema=z.object({title:z.string().min(1).max(100),signalType:z.enum(["genre","protagonist","advantage","opening","relationship","title","payoff","crowding","differentiation"]),summary:z.string().min(4).max(1000),heat:z.enum(["low","medium","high"]),crowding:z.enum(["low","medium","high"]),trend:z.enum(["rising","stable","falling","uncertain"]),platforms:z.array(z.enum(["fanqie","qidian","jinjiang"])).min(1),audience:z.string().min(2).max(500),differentiation:z.string().min(2).max(800),sourceRefs:z.string().min(2).max(2000),observedAt:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),effectiveUntil:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict();
const marketAnalysisOutputSchema=z.object({genre:z.array(z.string()).max(12),protagonistIdentities:z.array(z.string()).max(12),coreAdvantages:z.array(z.string()).max(12),openingPatterns:z.array(z.string()).max(12),relationshipHooks:z.array(z.string()).max(12),titlePatterns:z.array(z.string()).max(12),readerPayoffs:z.array(z.string()).max(12),crowdedTropes:z.array(z.string()).max(12),differentiationOpportunities:z.array(z.string()).max(12),evidenceBoundary:z.string().min(4).max(1000),signals:z.array(marketSignalSchema).min(1).max(12)}).strict();
const planningCandidateOutputSchema=z.object({
  title:z.string().min(1).max(240),goal:z.string().min(10).max(5000),storyTime:z.string().max(500),
  mustHappen:z.array(z.string().min(1).max(1000)).min(1).max(30),mustPreserve:z.array(z.string().min(1).max(1000)).max(30),
  forbiddenBoundaries:z.array(z.string().min(1).max(1000)).max(30),expectedChanges:z.array(z.string().min(1).max(1000)).max(30),
  characterArc:z.string().max(5000),notes:z.string().max(5000),sourceCardIds:z.array(z.string().uuid()).max(30),
}).strict();

export interface DirectionPromptInput {
  method: string;
  bookName: string;
  sourceReference: string;
  sourceText: string;
}

export interface InitialContentPromptInput {
  direction: z.infer<typeof directionSchema>;
  sourceText: string;
  schemaJson: string;
}

export interface FormAssistPromptInput {
  bookName: string;
  formName: string;
  cardTitle: string;
  currentValuesJson: string;
  fieldsJson: string;
  instruction: string;
}
export interface MarketAnalysisPromptInput {itemsJson:string;focus:string;}
export interface PlanningCandidatePromptInput {bookName:string;bookDescription:string;targetJson:string;materialsJson:string;adoptedPlansJson:string;instruction:string;}

export const newDesignBookDirectionsPrompt: PromptAsset<DirectionPromptInput, z.infer<typeof directionsOutputSchema>> = {
  id: "new_design.book_creation.directions",
  version: "v1",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: { maxTokensBudget: 0 },
  outputSchema: directionsOutputSchema,
  repairPolicy: { maxAttempts: 1 },
  semanticRetryPolicy: { maxAttempts: 1 },
  render: (input) => [
    new SystemMessage([
      "你是面向零写作经验用户的新书创作导演。",
      "根据用户提供的来源，给出三个差异明确且能继续生产长篇小说的方向。",
      "不能机械套题材关键词，要保留用户来源中的核心体验、冲突或约束。",
      "拆书参考只提取可迁移的创作约束，不复刻原作角色、专有设定、情节表达或受版权保护内容。",
      "市场方向要转化为具体创作机会，不把热度描述当成故事本身。",
      "表达清楚具体，让新手能够直接选择。只输出严格 JSON。",
    ].join("\n")),
    new HumanMessage([
      `开书入口：${input.method}`,
      `暂定书名：${input.bookName || "未填写"}`,
      `来源标识：${input.sourceReference || "无"}`,
      `来源内容：\n${input.sourceText}`,
      "返回三个方向，每个方向包含 id、title、premise、protagonist、centralConflict、readerPromise、styleKeywords。",
    ].join("\n")),
  ],
};

export const newDesignInitialContentPrompt: PromptAsset<InitialContentPromptInput, z.infer<typeof initialContentOutputSchema>> = {
  id: "new_design.book_creation.initial_content",
  version: "v1",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: { maxTokensBudget: 0 },
  outputSchema: initialContentOutputSchema,
  repairPolicy: { maxAttempts: 1 },
  semanticRetryPolicy: { maxAttempts: 1 },
  render: (input) => [
    new SystemMessage([
      "你负责把用户确认的新书方向填写进给定的动态资料规格。",
      "只能使用规格中存在的 typeKey 和 field key，不得自行发明字段。",
      "生成可支持后续创作的最小资料闭环，优先作品约定、主题、世界规则、人物、势力、地点、冲突、剧情线和首批事件。",
      "选择字段必须使用规格提供的 value；不确定的字段留空，不要伪造结构。",
      "不同对象必须拆成独立资料项。只输出严格 JSON。",
    ].join("\n")),
    new HumanMessage([
      `确认方向：${JSON.stringify(input.direction)}`,
      `原始来源：${input.sourceText}`,
      `可用资料规格：${input.schemaJson}`,
      "返回 cards 数组，每项只包含 typeKey、title、values。",
    ].join("\n")),
  ],
};

export const newDesignFormAssistPrompt: PromptAsset<FormAssistPromptInput, z.infer<typeof formAssistOutputSchema>> = {
  id: "new_design.form.assist",
  version: "v1",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: { maxTokensBudget: 0 },
  outputSchema: formAssistOutputSchema,
  repairPolicy: { maxAttempts: 1 },
  render: (input) => [
    new SystemMessage([
      "你是小说表单中的局部创作助手。",
      "只针对用户要求提出字段补充或改写建议，不得覆盖未要求修改且已有内容的字段。",
      "只能返回字段规格中存在的 key，值必须符合字段类型和选项。",
      "建议将由用户逐项选择后才写入。只输出严格 JSON。",
    ].join("\n")),
    new HumanMessage([
      `书名：${input.bookName}`,
      `表单：${input.formName}`,
      `当前资料：${input.cardTitle}`,
      `字段规格：${input.fieldsJson}`,
      `当前内容：${input.currentValuesJson}`,
      `用户要求：${input.instruction}`,
      "返回 suggestions 对象，键为需要建议的 field key。",
    ].join("\n")),
  ],
};

export const newDesignPlanningCandidatePrompt:PromptAsset<PlanningCandidatePromptInput,z.infer<typeof planningCandidateOutputSchema>>={
  id:"new_design.planning.candidate",version:"v1",taskType:"planner",mode:"structured",language:"zh",contextPolicy:{maxTokensBudget:0},outputSchema:planningCandidateOutputSchema,repairPolicy:{maxAttempts:1},semanticRetryPolicy:{maxAttempts:1},
  render:(input)=>[new SystemMessage([
    "你是长篇小说的故事规划助手，服务对象可能没有专业写作经验。",
    "请根据本书资料、已经采用的上级规划和用户本次要求，生成一份具体、可继续生产的规划候选。",
    "目标是故事总览时，应明确核心目标、主要冲突、阶段推进、读者承诺和不可破坏的边界；目标是卷、章或场景时，必须服从已采用的上级规划。",
    "不得把候选描述成已经生效；不得改写或覆盖已采用事实。sourceCardIds 只能选择输入资料中真实存在的 cardId，且只选确实用于本候选的资料。",
    "mustHappen 写必须发生的推进，mustPreserve 写必须保持的一致性，forbiddenBoundaries 写绝不能越过的边界，expectedChanges 写本层规划预期造成的状态变化。",
    "不要空泛使用‘推进剧情’之类说法，每一项都应可被后续写作或审稿检查。只输出严格 JSON。",
  ].join("\n")),new HumanMessage([
    `书名：${input.bookName}`,`简介：${input.bookDescription||"未填写"}`,`本次规划目标：${input.targetJson}`,
    `已经采用的规划：${input.adoptedPlansJson}`,`可引用的本书资料：${input.materialsJson}`,`用户要求：${input.instruction||"基于现有资料补全一份可生产的规划候选。"}`
  ].join("\n\n"))],
};

export const newDesignMarketAnalysisPrompt:PromptAsset<MarketAnalysisPromptInput,z.infer<typeof marketAnalysisOutputSchema>>={
  id:"new_design.research.market_analysis",version:"v1",taskType:"planner",mode:"structured",language:"zh",contextPolicy:{maxTokensBudget:0},outputSchema:marketAnalysisOutputSchema,repairPolicy:{maxAttempts:1},semanticRetryPolicy:{maxAttempts:1},
  render:(input)=>[new SystemMessage([
    "你是小说市场研究员，只分析用户明确选择的公开榜单元数据。",
    "evidenceTier=primary 的新书榜、新晋作者榜是判断近期入场机会的主要证据；evidenceTier=supporting 的成熟榜单只能辅助验证持续需求和拥挤程度，不得混成同一种证据。",
    "不得把榜单名次当成销量，不得声称平台未公开的人群、收入或增长率；没有跨期样本时趋势必须为 uncertain。",
    "结论必须覆盖题材、主角身份、核心优势、开局方式、关系钩子、标题模式、读者满足、拥挤套路和差异化机会。",
    "每条 market signal 都要在 sourceRefs 写出所依据的平台、榜单和作品标题，并说明证据边界。",
    "这只是候选研究结果，不得创建书籍、角色、世界观或正式卡片。只输出严格 JSON。",
  ].join("\n")),new HumanMessage([`用户关注：${input.focus||"整体市场结构"}`,`所选公开元数据：${input.itemsJson}`,"请返回九类聚合结论、证据边界和 1—12 条可由用户确认保存的市场信号候选。"].join("\n"))],
};

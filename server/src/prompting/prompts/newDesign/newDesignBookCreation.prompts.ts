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

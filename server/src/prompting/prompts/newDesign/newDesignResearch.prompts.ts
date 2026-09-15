import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PromptAsset } from "../../core/promptTypes";

const scalar=z.union([z.string(),z.number(),z.boolean(),z.array(z.string()),z.null()]);
const dimensionKey=z.enum(["story_structure","characters","world","conflict","pacing","hooks_payoffs","writing_technique","quality_risks"]);
const bookAnalysisOutput=z.object({
  overview:z.string().min(20).max(500),
  dimensions:z.array(z.object({key:dimensionKey,title:z.string().min(1).max(60),summary:z.string().min(4).max(240),strengths:z.array(z.string().max(120)).max(2),risks:z.array(z.string().max(120)).max(2),opportunities:z.array(z.string().max(120)).max(2)}).strict()).length(8),
  evidence:z.array(z.object({fieldPath:z.string().min(1).max(160),excerpt:z.string().min(1).max(160),startOffset:z.number().int().nonnegative().nullable(),endOffset:z.number().int().positive().nullable(),certainty:z.enum(["explicit","inferred","low_confidence"]),note:z.string().max(160)}).strict()).min(1).max(24),
  candidates:z.array(z.object({targetTypeKey:z.string().min(1).max(80),title:z.string().min(1).max(160),values:z.record(z.string(),scalar),evidenceIndexes:z.array(z.number().int().nonnegative()).max(8),confidence:z.number().min(0).max(1).nullable()}).strict()).max(12),
  copyrightBoundary:z.string().min(10).max(400),
}).strict();

export interface BookAnalysisPromptInput {title:string;text:string;focus:string;planJson:string;schemaJson:string;}
export const newDesignBookAnalysisPrompt:PromptAsset<BookAnalysisPromptInput,z.infer<typeof bookAnalysisOutput>>={
  id:"new_design.research.book_analysis",version:"v1",taskType:"planner",mode:"structured",language:"zh",contextPolicy:{maxTokensBudget:0},outputSchema:bookAnalysisOutput,repairPolicy:{maxAttempts:1},semanticRetryPolicy:{maxAttempts:1},
  render:(input)=>[new SystemMessage([
    "你是长篇小说研究与诊断助手。只分析用户明确提供且有权使用的文本。",
    "必须完整返回故事结构、人物、世界、冲突、节奏、钩子与兑现、写作技法、质量风险八个维度，每个维度只出现一次。",
    "每个重要结论必须引用 evidence 数组中的短原文片段；explicit 表示原文直说，inferred 表示合理推断，low_confidence 表示证据不足。",
    "候选资料只能使用运行计划列出的 typeKey 和该类型允许的字段 key，不得发明字段。",
    "reference_learning 只抽象可迁移的模式、节奏、质量与题材机会，严禁复制原作角色、专有名词、独特设定和具体情节。",
    "continuation 可以提出原文本身已有的人物、世界、事件等候选，但仍需用户采用才成为正式事实。",
    "diagnosis 只给观察和修改建议，不生成任何候选资料。",
    "输出必须精炼以适应预算：overview 不超过 180 字；每个维度 summary 不超过 100 字，优势、风险、机会各最多 1 条；证据优先每维 1 条且总计不超过 12 条；候选不超过计划上限且快速分析最多 4 条。",
    "分析结果不是正式卡片，不得声称已写入书籍。只输出严格 JSON。",
  ].join("\n")),new HumanMessage([`资料：${input.title}`,`本次关注：${input.focus||"整体可生产性"}`,`分析计划：${input.planJson}`,`允许的发布规格：${input.schemaJson}`,`待分析文本：\n${input.text}`].join("\n\n"))],
};

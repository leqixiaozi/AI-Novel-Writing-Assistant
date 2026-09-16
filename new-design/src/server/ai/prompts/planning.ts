import { z } from "zod";
import type { PlanningLevel } from "../../../common/contracts";
import type { PromptAsset } from "./contracts";
import { shortText, text, textList, valuesInput } from "./fields";

const levels = ["story", "volume", "chapter", "scene"] as const satisfies readonly PlanningLevel[];
const level = z.enum(levels);
export const planningAsset: PromptAsset = {
  assetId: "new_design.planning.candidate", version: "v1", taskType: "planning_candidate", label: "准备故事规划",
  contextPolicy: "explicit_task_snapshot_only", temperature: 0.5, maxTokens: 7000,
  instruction: "为指定的全书、卷、章节或场景生成一个可编辑的正式规划候选内容，不直接创建或采用。尊重已采用的上级和相关规划，明确目标、故事发生时间（不同于叙述顺序）、必须发生的事、必须保持的事实、禁止边界、预期变化、人物弧和执行备注。颗粒度与 target.level 对齐，章节不能越权改写全书核心承诺。仅引用 materials 提供的 cardId 作为 sourceCardIds，不创造虚假引用。区分确定事实、创作建议和待确认问题；事实不足时 notes 明确待确认点，不假定图谱关系或状态结算已经发生。用户没有具体想法时可以做符合上下文的原创规划推荐，不生成无依据的市场统计。返回中文内容，稳定键遵循固定输出合同。",
  prepare(value) {
    const input = z.object({
      bookName: z.string().max(300), bookDescription: text,
      target: z.object({ level, title: z.string().max(300), currentContent: valuesInput.nullable(), parentContent: valuesInput.nullable() }).strict(),
      materials: z.array(z.object({ cardId: z.string().min(1), typeKey: z.string().min(1), typeName: z.string(), title: z.string(), values: valuesInput }).strict()).max(300),
      adoptedPlans: z.array(z.object({ level, title: z.string(), content: valuesInput }).strict()).max(300), instruction: text,
    }).strict().parse(value);
    const allowed = new Set(input.materials.map(item => item.cardId));
    const schema = z.object({
      title: shortText, goal: z.string().trim().min(1).max(10000), storyTime: z.string().max(4000), mustHappen: textList, mustPreserve: textList,
      forbiddenBoundaries: textList, expectedChanges: textList, characterArc: text, notes: text, sourceCardIds: z.array(z.string().min(1)).max(300),
    }).strict().superRefine((output, ctx) => {
      if (output.sourceCardIds.some(id => !allowed.has(id)) || new Set(output.sourceCardIds).size !== output.sourceCardIds.length) ctx.addIssue({ code: "custom", path: ["sourceCardIds"], message: "规划只能引用本次提供的资料，且不得重复引用。" });
    });
    return { input, schema };
  },
};

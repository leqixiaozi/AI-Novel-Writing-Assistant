import { z } from "zod";
import { MARKET_PLATFORMS } from "../../../common/contracts";
import type { PromptAsset } from "./contracts";
import { assertUniqueKeys, cardProposal, shortText, text, textList, typeInput } from "./fields";

const platform = z.enum(MARKET_PLATFORMS);
const signal = z.object({
  title: shortText, signalType: z.enum(["genre", "protagonist", "advantage", "opening", "relationship", "title", "payoff", "crowding", "differentiation"]),
  summary: text, heat: z.enum(["low", "medium", "high"]), crowding: z.enum(["low", "medium", "high"]), trend: z.enum(["rising", "stable", "falling", "uncertain"]),
  platforms: z.array(platform).max(3), audience: text, differentiation: text, sourceRefs: text, observedAt: z.string().max(100), effectiveUntil: z.string().max(100),
}).strict();
const marketResult = z.object({
  genre: textList, protagonistIdentities: textList, coreAdvantages: textList, openingPatterns: textList, relationshipHooks: textList,
  titlePatterns: textList, readerPayoffs: textList, crowdedTropes: textList, differentiationOpportunities: textList,
  evidenceBoundary: z.string().trim().min(1).max(10000), signals: z.array(signal).max(100),
}).strict();
const rankingItem = z.object({
  id: z.string().min(1), snapshotId: z.string().min(1), platform, listKey: z.string(), listLabel: z.string(), evidenceTier: z.enum(["primary", "supporting"]),
  rank: z.number().int().positive(), title: z.string(), author: z.string(), category: z.string(), tags: textList, synopsis: text,
  heatLabel: z.string(), serialStatus: z.string(), sourceUrl: z.string(),
}).strict();
const targetInput = z.object({
  typeKey: z.string().min(1), typeName: z.string(), allowedFields: z.array(z.string().min(1)).max(300),
  maxCandidates: z.number().int().min(0).max(300), mergePolicy: z.enum(["new_or_merge", "reference_only"]),
}).strict();
const planInput = z.object({
  purpose: z.enum(["reference_learning", "continuation", "diagnosis"]), preset: z.enum(["quick", "standard", "full"]),
  dimensions: z.array(z.string().min(1)).min(1).max(20), targetForms: z.array(z.object({ key: z.string(), name: z.string() }).strict()).max(300),
  targets: z.array(targetInput).max(100), evidenceRequired: z.boolean(), candidateLimit: z.number().int().min(0).max(300),
}).strict();
const evidence = z.object({
  fieldPath: z.string().max(500), excerpt: z.string().trim().min(1).max(2000), startOffset: z.number().int().nonnegative().nullable(),
  endOffset: z.number().int().nonnegative().nullable(), certainty: z.enum(["explicit", "inferred", "low_confidence"]), note: text,
}).strict();

export const researchAssets: PromptAsset[] = [
  {
    assetId: "new_design.research.market_analysis", version: "v1", taskType: "market_analysis", label: "分析题材趋势",
    contextPolicy: "explicit_task_snapshot_only", temperature: 0.3, maxTokens: 10000,
    instruction: "只根据提供的排行榜快照分析题材、主角身份、核心优势、开篇、关系钩子、标题、读者回报、拥挤套路和差异化机会。主证据与辅助证据分开说明，不把一个平台的小样本当全市场，不推断不存在的销量、收益或趋势。每个信号标明提供的来源引用和平台，热度及拥挤度是相对所选样本的分析，不是商业保证；时间趋势证据不足使用 uncertain，日期不明保留空文本并在 evidenceBoundary 说明。摘要和创作机会用中文，不复制受版权保护作品正文。输出结构化研究候选，不能声称候选已入库或用户已采用。",
    prepare(value) {
      const input = z.object({ items: z.array(rankingItem).min(1).max(1000), focus: text, budgetTokens: z.number().int().positive().max(1000000) }).strict().parse(value);
      const platforms = new Set(input.items.map(item => item.platform));
      return { input, schema: marketResult.superRefine((output, ctx) => {
        output.signals.forEach((item, index) => {
          if (item.platforms.some(name => !platforms.has(name))) ctx.addIssue({ code: "custom", path: ["signals", index, "platforms"], message: "信号引用了本次未采集的平台。" });
        });
      }) };
    },
  },
  {
    assetId: "new_design.research.book_analysis", version: "v1", taskType: "book_analysis", label: "拆书与稿件诊断",
    contextPolicy: "explicit_task_snapshot_only", temperature: 0.3, maxTokens: 12000,
    instruction: "按给定 purpose、分析维度和可用字段进行拆书、续写参考或稿件诊断。每个指定维度必须恰好输出一次，使用该维度的 key，标题与分析中文化。事实必须基于所选文本；推论标明 inferred 或 low_confidence，摘录短而精确，给出相对本次 text 的字符起止位置（结尾位置不含），无法定位填 null，不编造证据。候选只允许 plan.targets 与 schemaTypes 的交集类型及 allowedFields；遵守总数和各类型 maxCandidates。diagnosis 不输出资料候选。证据索引从0开始，仅指向本次 evidence。参考学习提炼可迁移的创作方法，避免直接复制原作独特设定、人物和长段正文；续写区分已有事实和建议。不可声称资料已采用、关系已建立或正文已保存。",
    prepare(value) {
      const input = z.object({ title: z.string().max(300), text: z.string().trim().min(1).max(400000), focus: text, plan: planInput, schemaTypes: z.array(typeInput).max(100), budgetTokens: z.number().int().positive().max(1000000) }).strict().parse(value);
      assertUniqueKeys(input.schemaTypes, "拆书内容类型规格");
      assertUniqueKeys(input.plan.targets.map(item => ({ key: item.typeKey })), "拆书目标");
      if (new Set(input.plan.dimensions).size !== input.plan.dimensions.length) throw new Error("拆书分析维度不能重复。");
      const allowedTypes = input.plan.targets.map(target => {
        const type = input.schemaTypes.find(item => item.key === target.typeKey);
        if (!type) throw new Error(`拆书目标“${target.typeName}”缺少内容类型规格。`);
        if (target.allowedFields.some(key => !type.fields.some(field => field.key === key))) throw new Error(`拆书目标“${target.typeName}”包含规格以外的字段。`);
        return { ...type, fields: type.fields.filter(field => target.allowedFields.includes(field.key)) };
      });
      const allowCandidates = input.plan.purpose !== "diagnosis" && input.plan.candidateLimit > 0;
      const candidates = allowCandidates ? z.array(cardProposal(allowedTypes, { evidence: true })).max(input.plan.candidateLimit) : z.array(z.never()).max(0);
      const schema = z.object({
        overview: text,
        dimensions: z.array(z.object({ key: z.enum(input.plan.dimensions as [string, ...string[]]), title: shortText, summary: text, strengths: textList, risks: textList, opportunities: textList }).strict()).length(input.plan.dimensions.length),
        evidence: z.array(evidence).max(300), candidates, copyrightBoundary: z.string().trim().min(1).max(10000),
      }).strict().superRefine((output, ctx) => {
        if (new Set(output.dimensions.map(item => item.key)).size !== input.plan.dimensions.length) ctx.addIssue({ code: "custom", path: ["dimensions"], message: "分析维度必须完整且不得重复。" });
        const counts = new Map<string, number>();
        output.candidates.forEach((unknownItem, index) => {
          const item = unknownItem as { targetTypeKey: string; evidenceIndexes: number[] };
          counts.set(item.targetTypeKey, (counts.get(item.targetTypeKey) ?? 0) + 1);
          if (item.evidenceIndexes.some(id => id >= output.evidence.length) || input.plan.evidenceRequired && !item.evidenceIndexes.length) ctx.addIssue({ code: "custom", path: ["candidates", index, "evidenceIndexes"], message: "候选缺少有效的本次证据引用。" });
        });
        for (const target of input.plan.targets) if ((counts.get(target.typeKey) ?? 0) > target.maxCandidates) ctx.addIssue({ code: "custom", path: ["candidates"], message: `“${target.typeName}”的候选数量超出本次上限。` });
        output.evidence.forEach((item, index) => {
          const exact = input.text.includes(item.excerpt);
          if (item.certainty === "explicit" && !exact) ctx.addIssue({ code: "custom", path: ["evidence", index, "excerpt"], message: "明确证据的摘录不在本次文本内。" });
          if ((item.startOffset === null) !== (item.endOffset === null) || item.startOffset !== null && item.endOffset !== null && (item.endOffset < item.startOffset || input.text.slice(item.startOffset, item.endOffset) !== item.excerpt)) ctx.addIssue({ code: "custom", path: ["evidence", index, "startOffset"], message: "证据位置与所选摘录不一致。" });
        });
      });
      return { input, schema };
    },
  },
];

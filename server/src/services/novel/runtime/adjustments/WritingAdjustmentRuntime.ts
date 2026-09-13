import { AsyncLocalStorage } from "node:async_hooks";
import { getRequirementsForRuntime } from "../../../../modules/novel/adjustments";
import type { ChapterRuntimeRequestInput } from "../chapterRuntimeSchema";

const requirementsContext = new AsyncLocalStorage<string>();

export function currentWritingAdjustmentText(): string | undefined {
  return requirementsContext.getStore() || undefined;
}

export function withWritingAdjustmentText<T>(text: string | undefined, run: () => T): T {
  return text ? requirementsContext.run(text, run) : run();
}

export async function resolveRuntimeWritingAdjustment(novelId: string, chapterId: string, options: ChapterRuntimeRequestInput) {
  if (!options.adjustment) return undefined;
  if (options.adjustment.outputMode !== "original") {
    throw new Error("章节自动执行需要使用原流程输出模式；候选试写请从章节编辑器发起。");
  }
  return (await getRequirementsForRuntime(novelId, chapterId, options.adjustment.requirementsId)).promptText;
}

import { AIMessageChunk, type BaseMessageChunk } from "@langchain/core/messages";
import type { StreamDoneHelpers, StreamDonePayload } from "../../../../llm/streaming";
import { adjustmentService, captureAdjustmentFence, runWithCapturedAdjustmentFence } from "../../../../modules/novel/adjustments";
import { chapterRuntimeRequestSchema, type ChapterRuntimeRequestInput } from "../chapterRuntimeSchema";
import { resolveRuntimeWritingAdjustment, withWritingAdjustmentText } from "./WritingAdjustmentRuntime";

interface ChapterStream { stream: AsyncIterable<BaseMessageChunk>; onDone: (content: string, helpers: StreamDoneHelpers) => Promise<void | StreamDonePayload> }
type Epochs = Record<string, number>;
async function* fencedStream(stream: AsyncIterable<BaseMessageChunk>, epochs: Epochs, text?: string) {
  const run = <T>(fn: () => T) => runWithCapturedAdjustmentFence(epochs, () => withWritingAdjustmentText(text, fn));
  const iterator = run(() => stream[Symbol.asyncIterator]());
  try {
    while (true) { const next = await run(() => iterator.next()); if (next.done) return; yield next.value; }
  } finally { if (iterator.return) await run(() => iterator.return!()); }
}
export async function adjustedChapterStream(novelId: string, chapterId: string, options: ChapterRuntimeRequestInput, create: () => Promise<ChapterStream>): Promise<ChapterStream> {
  if (options.adjustment && chapterRuntimeRequestSchema.parse(options).adjustment?.outputMode === "candidate") {
    const versions = await adjustmentService.generate(novelId, chapterId, { requirementsId: options.adjustment.requirementsId, operation: "write" });
    const content = versions[0]?.content;
    if (!content?.trim()) throw new Error("AI 未返回可用的章节候选。");
    return { stream: (async function* () { yield new AIMessageChunk(content); })(), onDone: async () => ({ fullContent: content }) };
  }
  const epochs = await captureAdjustmentFence(novelId, [chapterId]);
  const text = await resolveRuntimeWritingAdjustment(novelId, chapterId, options);
  const result = await runWithCapturedAdjustmentFence(epochs, () => withWritingAdjustmentText(text, create));
  return { stream: fencedStream(result.stream, epochs, text), onDone: (content, helpers) => runWithCapturedAdjustmentFence(epochs, () => withWritingAdjustmentText(text, () => result.onDone(content, helpers))) };
}
export async function fencedRepairStream<T extends { stream: AsyncIterable<BaseMessageChunk>; onDone: (content: string, helpers: StreamDoneHelpers) => Promise<void> }>(novelId: string, chapterId: string, create: () => Promise<T>) {
  const epochs = await captureAdjustmentFence(novelId, [chapterId]);
  const result = await runWithCapturedAdjustmentFence(epochs, create);
  return { stream: fencedStream(result.stream, epochs), onDone: (content: string, helpers: StreamDoneHelpers) => runWithCapturedAdjustmentFence(epochs, () => result.onDone(content, helpers)) };
}
export async function adjustedPipeline<T>(novelId: string, chapterId: string, options: ChapterRuntimeRequestInput, run: () => Promise<T>) {
  const epochs = await captureAdjustmentFence(novelId, [chapterId]);
  const text = await resolveRuntimeWritingAdjustment(novelId, chapterId, options);
  return runWithCapturedAdjustmentFence(epochs, () => withWritingAdjustmentText(text, run));
}

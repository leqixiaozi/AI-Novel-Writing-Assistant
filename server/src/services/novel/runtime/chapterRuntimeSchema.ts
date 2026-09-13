import { z } from "zod";
import { llmProviderSchema } from "../../../llm/providerSchema";

export const optionalWritingAdjustmentSchema = z.object({
  contractVersion: z.literal(2),
  requirementsId: z.string().trim().min(1),
  outputMode: z.enum(["candidate", "original"]),
}).strict();

const chapterRuntimeControlPolicySchema = z.object({
  kickoffMode: z.enum(["manual_start", "director_start", "takeover_start"]),
  advanceMode: z.enum(["manual", "stage_review", "auto_to_ready", "auto_to_execution", "full_book_autopilot"]),
  reviewCheckpoints: z.array(z.string()).default([]),
  autoExecutionRange: z.object({
    mode: z.enum(["book", "volume", "chapter_range"]),
    start: z.number().int().nullable().optional(),
    end: z.number().int().nullable().optional(),
    volumeOrder: z.number().int().nullable().optional(),
  }).nullable().optional(),
});

export const chapterRuntimeRequestSchema = z.object({
  adjustment: optionalWritingAdjustmentSchema.optional(),
  workflowTaskId: z.string().trim().optional(),
  provider: llmProviderSchema.optional(),
  model: z.string().trim().optional(),
  temperature: z.number().min(0).max(2).optional(),
  previousChaptersSummary: z.array(z.string()).optional(),
  taskStyleProfileId: z.string().trim().optional(),
  artifactSyncMode: z.enum(["adaptive", "deferred", "strict"]).optional(),
  controlPolicy: chapterRuntimeControlPolicySchema.optional(),
});

export type ChapterRuntimeRequestInput = z.infer<typeof chapterRuntimeRequestSchema>;

import { z } from "zod";

export const PROMPT_TASK_TYPES = ["directions", "initial_content", "form_assist", "market_analysis", "book_analysis", "planning_candidate", "chapter_settlement", "chapter_generation"] as const;
export type PromptTaskType = (typeof PROMPT_TASK_TYPES)[number];
export type PromptContextPolicy = "explicit_task_snapshot_only";

export interface PromptAssetMetadata {
  assetId: string;
  version: string;
  taskType: PromptTaskType;
  label: string;
  contextPolicy: PromptContextPolicy;
  temperature: number;
  maxTokens: number;
}

export interface PreparedPrompt extends PromptAssetMetadata {
  outputSchema: Record<string, unknown>;
  messages: Array<{ role: "system" | "user"; content: string }>;
  parseOutput(value: unknown): unknown;
}

export interface PromptAsset extends PromptAssetMetadata {
  instruction: string;
  prepare(input: unknown): { input: unknown; schema: z.ZodType; describeOutputError?(error:unknown,output:unknown):{summary:string;issues:Record<string,string>} };
}

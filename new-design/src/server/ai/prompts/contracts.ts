import { z } from "zod";

export const PROMPT_TASK_TYPES = ["directions", "initial_content", "form_assist", "market_analysis", "book_analysis", "planning_candidate", "chapter_settlement", "chapter_generation", "quality_audit", "world_consistency", "world_usage", "creative_extraction", "character_dialogue", "creative_hub", "public_character_dialogue", "image_prompt_preparation", "character_author", "public_title_factory", "story_workspace_batch", "visible_prepare", "visible_adjust", "character_resource_backfill", "character_experiences", "character_recent_body_experiences", "character_resource_focus", "character_resource_history_focus", "stable_resource_supplement", "stable_resource_correction"] as const;
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

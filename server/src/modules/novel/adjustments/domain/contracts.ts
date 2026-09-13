import { createHash } from "node:crypto";
import { z } from "zod";
import type { WritingControlDefinition, WritingControls, WritingSettingsPayload } from "@ai-novel/shared/types/writingAdjustments";
import { AppError } from "../../../../middleware/errorHandler";

export const DEFINITION_VERSION = "expression-v1";
export const EMPTY_SETTINGS: WritingSettingsPayload = { enabled: false, controls: {}, preserve: [] };
export const controlSchema = z.object({
  mode: z.enum(["set", "inherit", "disabled"]), value: z.number().min(0).max(100).optional(),
  subjectId: z.string().min(1).optional(), objectId: z.string().min(1).optional(), matter: z.string().max(1000).optional(),
  speakerId: z.string().min(1).optional(), listenerId: z.string().min(1).optional(), characterId: z.string().min(1).optional(),
}).superRefine((v, ctx) => { if (v.mode === "set" && v.value === undefined) ctx.addIssue({ code: "custom", message: "请选择档位。" }); });
export const controlsSchema = z.object({ pace: controlSchema.optional(), tension: controlSchema.optional(), suspicionTarget: controlSchema.optional(), dialogueDirectness: controlSchema.optional(), characterProminence: controlSchema.optional() }).strict();
export const scopeSchema = z.object({
  kind: z.enum(["novel", "chapter", "chapters", "scene", "selection"]),
  chapterId: z.string().min(1).optional(), chapterIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  sceneId: z.string().min(1).optional(), selection: z.object({ from: z.number().int().min(0), to: z.number().int().min(1), text: z.string().min(1) }).optional(),
}).superRefine((value, ctx) => {
  if (["chapter", "scene", "selection"].includes(value.kind) && !value.chapterId) ctx.addIssue({ code: "custom", path: ["chapterId"], message: "请选择章节。" });
  if (value.kind === "chapters" && (!value.chapterIds?.length || new Set(value.chapterIds).size !== value.chapterIds.length)) ctx.addIssue({ code: "custom", path: ["chapterIds"], message: "请选择不重复的章节范围。" });
  if (value.kind === "scene" && !value.sceneId) ctx.addIssue({ code: "custom", path: ["sceneId"], message: "请选择场景。" });
  if (value.kind === "selection" && (!value.selection || value.selection.to - value.selection.from !== value.selection.text.length)) ctx.addIssue({ code: "custom", path: ["selection"], message: "选区内容与位置不一致。" });
});
export const settingsSchema = z.object({ enabled: z.boolean(), controls: controlsSchema, preserve: z.array(z.string().trim().min(1).max(2000)).max(50) });
export const CONTROL_DEFINITIONS: WritingControlDefinition[] = [
  { key: "pace", label: "叙述节奏", description: "调整同一事件的展开与压缩，保留事件、顺序和结果。", bands: ["充分舒展", "舒展推进", "均衡推进", "紧凑推进", "高度紧凑"], objects: [] },
  { key: "tension", label: "紧张感表达", description: "强调既有处境的压力，客观危险与结果保持不变。", bands: ["平稳", "轻微不安", "明确压力", "强烈紧迫", "临界压迫"], objects: [] },
  { key: "suspicionTarget", label: "疑点强调度", description: "突出已有疑点，保留怀疑关系与人物行动。", bands: ["轻描", "略作提示", "清晰强调", "重点强调", "核心强调"], objects: ["subjectId", "objectId", "matter"] },
  { key: "dialogueDirectness", label: "对白直白度", description: "调整潜台词的显隐，保持信息与交流结果。", bands: ["高度含蓄", "多用暗示", "半明半暗", "大多直说", "明确直说"], objects: ["speakerId", "listenerId"] },
  { key: "characterProminence", label: "人物戏份", description: "调整既有内容中的关注分配，保持人物行动与结果。", bands: ["弱化关注", "少量关注", "均衡关注", "重点关注", "中心关注"], objects: ["characterId"] },
];
export function digest(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}
export function chapterRevision(row: { content: string | null; updatedAt: Date; expectation?: string | null; order?: number }): string {
  return digest([row.content, row.expectation, row.order, row.updatedAt.toISOString()]);
}
export function parseJson<T>(text: string | null | undefined, fallback: T): T { return text ? JSON.parse(text) as T : fallback; }
export function conflict(message: string, code = "REVISION_CONFLICT"): never { throw new AppError(message, 409, { errorCode: code }); }
export function mergeControls(layers: Array<{ source: string; controls: WritingControls }>) {
  const controls: WritingControls = {};
  const sources: Partial<Record<keyof WritingControls, string>> = {};
  for (const layer of layers) for (const key of Object.keys(layer.controls) as Array<keyof WritingControls>) {
    const value = layer.controls[key];
    if (value && value.mode !== "inherit") { controls[key] = value; sources[key] = layer.source; }
  }
  return { controls, sources };
}
export function validateControlObjects(controls: WritingControls, ids: Set<string>): void {
  for (const definition of CONTROL_DEFINITIONS) {
    const value = controls[definition.key];
    if (!value || value.mode !== "set") continue;
    for (const field of definition.objects) {
      const object = value[field as keyof typeof value];
      if (typeof object !== "string" || !object.trim()) throw new AppError(`${definition.label}需要选择${field === "matter" ? "疑点内容" : "相关人物"}。`, 400);
      if (field !== "matter" && !ids.has(object)) throw new AppError("调整中的人物不属于当前作品。", 400);
    }
  }
}

import { z } from "zod";
import type { ModelTaskKey, ManagedModelConnection, ManagedRouteSettings, ManagedRouteVersion } from "../../../common/modelRouting";
import { DEFAULT_MODEL_POLICY, MODEL_TASKS } from "../../../common/modelRouting";
import type { TechnicalFallbackCategory } from "../../../common/contracts";
import { NewDesignError } from "../../domain/errors";

export const taskSchema = z.enum(MODEL_TASKS.map(item => item.key) as [ModelTaskKey, ...ModelTaskKey[]]);
export const providerSchema = z.enum(["ollama", "openai-compatible"]);
const endpointSchema = z.string().trim().min(1).max(1000).superRefine((value, ctx) => {
  try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error(); }
  catch { ctx.addIssue({ code: "custom", message: "服务地址仅支持无凭据、查询参数或片段的 HTTP/HTTPS 地址。" }); }
});
export const connectionSchema = z.object({ provider: providerSchema, endpoint: endpointSchema, model: z.string().trim().min(1).max(300), credentialId: z.string().uuid().nullable() }).strict();
export const probeConnectionSchema = connectionSchema.extend({ model: z.string().trim().max(300) });
export const fallbackSchema = connectionSchema.extend({ failureCategories: z.array(z.enum(["timeout", "rate_limit", "authentication", "provider_unavailable", "transport", "context_limit"])).min(1).max(6) }).strict();
export const settingsSchema = z.object({
  primary: connectionSchema, fallbacks: z.array(fallbackSchema).max(4),
  policy: z.object({ maxOutputTokens: z.number().int().min(256).max(32768), maxTotalTokens: z.number().int().min(256).max(2000000), timeoutMs: z.number().int().min(1000).max(600000), maxRetries: z.number().int().min(0).max(3), retryDelayMs: z.number().int().min(0).max(10000) }).strict(),
}).strict().superRefine((input, ctx) => { if (input.policy.maxOutputTokens > input.policy.maxTotalTokens) ctx.addIssue({ code: "custom", path: ["policy", "maxOutputTokens"], message: "单次输出预算不能超过总预算。" }); });
export const saveSchema = settingsSchema.safeExtend({
  scope: z.enum(["system_default", "task"]), taskType: taskSchema.nullable(), expectedConfigId: z.string().uuid().nullable(), expectedRevision: z.number().int().positive().nullable(), idempotencyKey: z.string().trim().min(8).max(160), replaceUnsupported: z.boolean().default(false),
}).superRefine((input, ctx) => {
  if ((input.scope === "task") !== (input.taskType !== null)) ctx.addIssue({ code: "custom", path: ["taskType"], message: "任务路由必须选择任务，系统默认不指定任务。" });
  if ((input.expectedConfigId === null) !== (input.expectedRevision === null)) ctx.addIssue({ code: "custom", path: ["expectedRevision"], message: "路由身份与修订号必须同时提供。" });
});

export type DbRow = Record<string, any>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function unsupportedIssue(version: DbRow, fallbacks: DbRow[]): string | null {
  const parameters=record(version.parameters),endpoint=parameters.baseUrl;
  if ((version.scope === "system_default" || version.provider && endpoint !== undefined) && !String(endpoint ?? "").trim()) {
    const other=[] as string[];
    if (version.provider && !["ollama","openai-compatible"].includes(version.provider)) other.push("供应商");
    if (Object.hasOwn(parameters,"temperature")) other.push("温度参数");
    if (Object.keys(parameters).some(key=>!["baseUrl","temperature"].includes(key))) other.push("其他高级参数");
    if ((version.required_capabilities?.length ?? 0)>0) other.push("能力要求");
    return `此版本未填写服务地址${other.length?`，且包含暂不支持的${other.join('、')}`:''}；补全并核对前不能使用，原版本将保留。`;
  }
  if (version.provider && !["ollama", "openai-compatible"].includes(version.provider)) return "此版本使用未支持的供应商，替换前请明确确认，旧版本将保留。";
  if (Object.keys(record(version.parameters)).some(key => key !== "baseUrl") || Object.keys(record(version.budget_policy)).some(key => !["maxTokens", "maxOutputTokens"].includes(key)) || Object.keys(record(version.retry_policy)).some(key => !["maxRetries", "retryDelayMs"].includes(key)) || (version.required_capabilities?.length ?? 0) > 0) return "此版本包含高级参数，替换前请明确确认，旧版本将保留。";
  if (fallbacks.some(item => !["ollama", "openai-compatible"].includes(item.provider) || Object.keys(record(item.parameters)).some(key => key !== "baseUrl"))) return "备用模型包含未支持的供应商或高级参数，替换前请明确确认。";
  const budget=record(version.budget_policy),retry=record(version.retry_policy),policy=settingsSchema.shape.policy.shape;
  if (parameters.baseUrl!==undefined&&!endpointSchema.safeParse(parameters.baseUrl).success || version.model!==null&&version.model!==undefined&&!connectionSchema.shape.model.safeParse(version.model).success || version.timeout_ms!==null&&version.timeout_ms!==undefined&&!policy.timeoutMs.safeParse(Number(version.timeout_ms)).success || budget.maxOutputTokens!==undefined&&!policy.maxOutputTokens.safeParse(budget.maxOutputTokens).success || budget.maxTokens!==undefined&&!policy.maxTotalTokens.safeParse(budget.maxTokens).success || retry.maxRetries!==undefined&&!policy.maxRetries.safeParse(retry.maxRetries).success || retry.retryDelayMs!==undefined&&!policy.retryDelayMs.safeParse(retry.retryDelayMs).success || budget.maxOutputTokens!==undefined&&budget.maxTokens!==undefined&&Number(budget.maxOutputTokens)>Number(budget.maxTokens) || fallbacks.length>4 || fallbacks.some(item=>!connectionSchema.safeParse(connectionFromRow(item)).success)) return "此版本的服务地址、预算或重试范围不受支持，请明确确认替换，旧版本将保留。";
  return null;
}
export function connectionFromRow(row: DbRow): ManagedModelConnection {
  const rawEndpoint=record(row.parameters).baseUrl,checked=endpointSchema.safeParse(rawEndpoint);
  // Legacy malformed URLs may embed credentials; never echo them in public DTOs or snapshots.
  return { provider: row.provider, endpoint: checked.success ? checked.data : "", model: String(row.model ?? ""), credentialId: row.credential_ref_id ?? null };
}
export function settingsFromRows(version: DbRow, fallbacks: DbRow[]): ManagedRouteSettings {
  const budget = record(version.budget_policy), retry = record(version.retry_policy);
  return { primary: connectionFromRow(version), fallbacks: fallbacks.map(row => ({ ...connectionFromRow(row), failureCategories: row.technical_failure_categories as TechnicalFallbackCategory[] })), policy: { maxOutputTokens: Number(budget.maxOutputTokens ?? DEFAULT_MODEL_POLICY.maxOutputTokens), maxTotalTokens: Number(budget.maxTokens ?? DEFAULT_MODEL_POLICY.maxTotalTokens), timeoutMs: Number(version.timeout_ms ?? DEFAULT_MODEL_POLICY.timeoutMs), maxRetries: Number(retry.maxRetries ?? DEFAULT_MODEL_POLICY.maxRetries), retryDelayMs: Number(retry.retryDelayMs ?? DEFAULT_MODEL_POLICY.retryDelayMs) } };
}
export function versionFromRows(version: DbRow, fallbacks: DbRow[]): ManagedRouteVersion { return { ...settingsFromRows(version, fallbacks), id: String(version.id), version: Number(version.version) }; }
export function assertSupportedSettings(settings: ManagedRouteSettings): void {
  const result = settingsSchema.safeParse({ primary: settings.primary, policy: settings.policy, fallbacks: settings.fallbacks });
  if (!result.success) throw new NewDesignError("模型路由未完整配置，请打开模型设置核对供应商、服务地址、预算和重试策略。", 422);
}

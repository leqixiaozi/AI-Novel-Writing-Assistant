import { DEFAULT_MODEL_POLICY, sameManagedSettings, type ManagedRouteSettings, type ManagedRouteSummary, type ModelRouteCenterCatalog, type ModelTaskKey } from "../../common/modelRouting";
export type RouteSelection = "default" | ModelTaskKey;
export function selectedRoute(catalog: ModelRouteCenterCatalog, selection: RouteSelection): ManagedRouteSummary | null {
  return catalog.routes.find(route => selection === "default" ? route.scope === "system_default" : route.scope === "task" && route.taskType === selection) ?? null;
}
export function copySettings(value: ManagedRouteSettings): ManagedRouteSettings {
  return { primary: { ...value.primary }, fallbacks: value.fallbacks.map(item => ({ ...item, failureCategories: [...item.failureCategories] })), policy: { ...value.policy } };
}
export function initialSettings(catalog: ModelRouteCenterCatalog, selection: RouteSelection): ManagedRouteSettings {
  const target = selectedRoute(catalog, selection) ?? selectedRoute(catalog, "default");
  return target ? copySettings(target.published ?? target.current) : { primary: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "", credentialId: null }, fallbacks: [], policy: { ...DEFAULT_MODEL_POLICY } };
}
export function recoveryComparison(catalog: ModelRouteCenterCatalog, selection: RouteSelection, draft: ManagedRouteSettings, action: "save" | "inherit") {
  const route = selectedRoute(catalog, selection);
  if (action === "inherit") return { route, matches: !route, message: !route ? "此任务已采用默认模型路线。" : "此任务仍有独立设置，请核对差异后决定保留哪一份。" };
  const matches = Boolean(route?.published && sameManagedSettings(route.published, draft));
  return { route, matches, message: matches ? "服务器已生效的设置与本次编辑一致；原请求回执仍未确认。" : "服务器设置与本次编辑不同，当前编辑保留；请选择采用服务器设置，或按最新修订继续。" };
}
export function settingsDifferences(server: ManagedRouteSettings | null, draft: ManagedRouteSettings): string[] {
  if (!server) return ["尚无独立生效设置"];
  const result: string[] = [];
  if (server.primary.provider !== draft.primary.provider) result.push("模型服务");
  if (server.primary.endpoint.replace(/\/$/, "") !== draft.primary.endpoint.replace(/\/$/, "")) result.push("连接地址");
  if (server.primary.model !== draft.primary.model) result.push("创作模型");
  if (server.primary.credentialId !== draft.primary.credentialId) result.push("凭据引用");
  if (!sameManagedSettings({ ...server, primary: draft.primary, policy: draft.policy }, draft)) result.push("备用模型及顺序");
  for (const [key, label] of [["timeoutMs", "等待时间"], ["maxRetries", "重试次数"], ["retryDelayMs", "重试间隔"], ["maxOutputTokens", "单次输出上限"], ["maxTotalTokens", "总用量上限"]] as const) if (server.policy[key] !== draft.policy[key]) result.push(label);
  return result;
}

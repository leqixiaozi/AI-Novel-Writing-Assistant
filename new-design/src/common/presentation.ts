import type { CardTypeSummary, CardTypeVersion, FieldDefinition } from "./contracts";

// Presentation only: fixed runtime states never participate in AI routing or business dictionaries.
const runtimeLabels: Record<string, string> = {
  queued:"等待开始", running:"进行中", completed:"已完成", partial:"部分完成", failed:"需要处理", cancelled:"已取消",
  succeeded:"已完成", waiting_approval:"等待确认", retry_scheduled:"等待重试", paused:"已暂停",
  leased:"已领取", cancel_requested:"等待取消", dead_letter:"需要人工检查", archived:"已归档",
  passed:"通过", blocked:"阻塞", unexecuted:"未执行", warning:"需要关注", ok:"正常", error:"异常", unknown:"待确认",
  available:"可用", unavailable:"不可用", ready:"就绪", degraded:"部分受限", stopped:"未启动", starting:"启动中", stopping:"停止中",
  dependency_recompute_request:"资料依赖重算", asset_derivation:"参考材料解析", graph_projection_request:"关系索引更新",
  embedding_chunking_request:"参考文本分段", embedding_request:"参考向量生成", embedding_index_generation:"检索索引更新",
  ai_task:"AI 创作任务", backup_request:"数据备份", publication_export_request:"作品导出",
  "dependency.recompute":"资料依赖重算", "asset.derive":"参考材料解析", "graph.project":"关系索引更新",
  "embedding.chunk":"参考文本分段", "embedding.generate":"参考向量生成", "embedding.index":"检索索引更新",
  "ai.task":"AI 创作任务", "backup.run":"数据备份", "publication.export":"作品导出",
};

export function runtimeLabel(key: string | null | undefined, fallback = "待确认"): string {
  return key ? runtimeLabels[key] ?? fallback : fallback;
}

export function publicServiceError(message: string, status: number): string {
  if (status >= 500) return "服务暂时不可用，请稍后重试，或到“运行维护”查看状态。";
  return message || "请求未完成，请检查填写内容。";
}

export function publishedProposalFields(type: CardTypeSummary | null, versions: CardTypeVersion[]): FieldDefinition[] | null {
  if (!type || type.status !== "published" || !type.currentVersionId) return null;
  return versions.find(version => version.id === type.currentVersionId)?.fields ?? null;
}

export function unknownProposalFieldCount(fields: FieldDefinition[], values: Record<string, unknown>): number {
  const allowed = new Set(fields.map(field => field.key));
  return Object.keys(values).filter(key => !allowed.has(key)).length;
}

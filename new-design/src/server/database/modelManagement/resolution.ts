import { randomUUID } from "node:crypto";
import type { ManagedModelSnapshot, ManagedTaskRoute, ModelTaskKey } from "../../../common/modelRouting";
import { NewDesignError } from "../../domain/errors";
import { stableHash } from "../aiContracts";
import { assertSupportedSettings, connectionFromRow, settingsFromRows, settingsSchema, taskSchema, unsupportedIssue, type DbRow } from "./policy";
import { readFallbacks, withClient, type ManagedDatabaseContext } from "./repository";

export async function resolveManagedTaskRoute(taskType: ModelTaskKey, context?: ManagedDatabaseContext): Promise<ManagedTaskRoute> {
  taskSchema.parse(taskType);
  return withClient(context, async client => {
    const layers = (await client.query("SELECT version.*,config.scope,config.id AS source_config_id FROM new_design.model_route_configs config JOIN new_design.model_route_versions version ON version.id=config.published_version_id AND version.config_id=config.id WHERE config.status='active' AND version.status='published' AND (config.scope='system_default' OR (config.scope='task' AND config.task_key=$1 AND config.task_group IS NULL)) ORDER BY CASE WHEN config.scope='system_default' THEN 0 ELSE 1 END", [taskType])).rows;
    if (!layers.length || layers[0].scope !== "system_default") throw new NewDesignError("尚未启用默认创作模型。请打开模型设置，配置并保存默认模型后在来源页重试。", 422);
    let primary = connectionFromRow(layers[0]), policy = settingsFromRows(layers[0], []).policy;
    let fallbacks: ManagedTaskRoute["fallbacks"] = [];
    const sourceLayers: ManagedTaskRoute["sourceLayers"] = [];
    for (const layer of layers) {
      const rows = await readFallbacks(client, layer.id);
      if (unsupportedIssue(layer, rows)) throw new NewDesignError("生效模型版本包含不支持的供应商或高级参数。请打开模型设置核对并明确确认替换后重试。", 422);
      if (layer.provider) primary.provider = layer.provider;
      if (layer.model) primary.model = layer.model;
      if (layer.parameters?.baseUrl !== undefined) primary.endpoint = String(layer.parameters.baseUrl);
      if (layer.provider !== null || layer.credential_ref_id !== null) primary.credentialId = layer.credential_ref_id ?? null;
      const budget = layer.budget_policy ?? {}, retry = layer.retry_policy ?? {};
      policy = { maxOutputTokens: Number(budget.maxOutputTokens ?? policy.maxOutputTokens), maxTotalTokens: Number(budget.maxTokens ?? policy.maxTotalTokens), timeoutMs: Number(layer.timeout_ms ?? policy.timeoutMs), maxRetries: Number(retry.maxRetries ?? policy.maxRetries), retryDelayMs: Number(retry.retryDelayMs ?? policy.retryDelayMs) };
      const nextFallbacks = settingsFromRows(layer, rows).fallbacks;
      fallbacks = layer.fallback_mode === "replace" ? nextFallbacks : [...fallbacks, ...nextFallbacks];
      sourceLayers.push({ scope: layer.scope, configId: layer.source_config_id, versionId: layer.id });
    }
    const route: ManagedTaskRoute = { primary, policy, fallbacks, sourceLayers };
    assertSupportedSettings(route);
    return route;
  });
}

export async function captureManagedModelSnapshot(taskType: ModelTaskKey, route: ManagedTaskRoute, context?: ManagedDatabaseContext): Promise<ManagedModelSnapshot> {
  taskSchema.parse(taskType);
  const settings = settingsSchema.parse({ primary: route.primary, policy: route.policy, fallbacks: route.fallbacks });
  if (!route.sourceLayers.length || route.sourceLayers[0].scope !== "system_default" || route.sourceLayers.length > 2 || route.sourceLayers.some((layer, index) => index > 0 && layer.scope !== "task")) throw new NewDesignError("模型快照缺少真实默认版本或任务版本来源。", 422);
  return withClient(context, async client => {
    const layers: DbRow[] = [];
    for (const layer of route.sourceLayers) {
      const row = (await client.query("SELECT version.*,config.scope,config.task_key FROM new_design.model_route_versions version JOIN new_design.model_route_configs config ON config.id=version.config_id WHERE version.id=$1 AND config.id=$2 AND (version.status IN ('published','superseded') OR EXISTS(SELECT 1 FROM new_design.ai_contract_publications receipt WHERE receipt.entity_kind='model_route' AND receipt.entity_id=config.id AND receipt.to_version_id=version.id))", [layer.versionId, layer.configId])).rows[0];
      if (!row || row.scope !== layer.scope || row.scope === "task" && row.task_key !== taskType) throw new NewDesignError("模型快照引用的生效版本来源无效。请刷新模型设置后重试。", 422);
      layers.push(row);
    }
    // Reconstruct exact historical settings, not the currently enabled route, to handle legitimate publish races.
    let primary = connectionFromRow(layers[0]!), policy = settingsFromRows(layers[0]!, []).policy;
    let fallbacks: ManagedTaskRoute["fallbacks"] = [];
    for (const layer of layers) {
      const rows = await readFallbacks(client, layer.id);
      if (unsupportedIssue(layer, rows)) throw new NewDesignError("模型快照来源含不支持的高级配置。", 422);
      if (layer.provider) primary.provider = layer.provider;
      if (layer.model) primary.model = layer.model;
      if (layer.parameters?.baseUrl !== undefined) primary.endpoint = String(layer.parameters.baseUrl);
      if (layer.provider !== null || layer.credential_ref_id !== null) primary.credentialId = layer.credential_ref_id ?? null;
      const budget = layer.budget_policy ?? {}, retry = layer.retry_policy ?? {};
      policy = { maxOutputTokens: Number(budget.maxOutputTokens ?? policy.maxOutputTokens), maxTotalTokens: Number(budget.maxTokens ?? policy.maxTotalTokens), timeoutMs: Number(layer.timeout_ms ?? policy.timeoutMs), maxRetries: Number(retry.maxRetries ?? policy.maxRetries), retryDelayMs: Number(retry.retryDelayMs ?? policy.retryDelayMs) };
      const next = settingsFromRows(layer, rows).fallbacks;
      fallbacks = layer.fallback_mode === "replace" ? next : [...fallbacks, ...next];
    }
    if (stableHash({ primary, policy, fallbacks }) !== stableHash(settings)) throw new NewDesignError("模型快照内容与来源版本不一致，请重新准备本次任务。", 422);
    const id = randomUUID(), snapshotHash = stableHash({ taskType, ...settings, sourceLayers: route.sourceLayers });
    await client.query("INSERT INTO new_design.model_route_snapshots(id,book_id,task_contract_version_id,managed_task_key,node_key,provider,model,parameters,required_capabilities,credential_ref_id,budget_policy,timeout_ms,retry_policy,source_layers,policy_version,snapshot_hash) VALUES($1,NULL,NULL,$2,NULL,$3,$4,$5::jsonb,'{}',$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,'managed-model-v1',$11)", [id, taskType, primary.provider, primary.model, JSON.stringify({ baseUrl: primary.endpoint }), primary.credentialId, JSON.stringify({ maxTokens: policy.maxTotalTokens, maxOutputTokens: policy.maxOutputTokens }), policy.timeoutMs, JSON.stringify({ maxRetries: policy.maxRetries, retryDelayMs: policy.retryDelayMs }), JSON.stringify(route.sourceLayers), snapshotHash]);
    for (const [index, fallback] of fallbacks.entries()) await client.query("INSERT INTO new_design.model_route_snapshot_fallbacks(id,snapshot_id,sort_order,provider,model,parameters,credential_ref_id,technical_failure_categories) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)", [randomUUID(), id, index, fallback.provider, fallback.model, JSON.stringify({ baseUrl: fallback.endpoint }), fallback.credentialId, fallback.failureCategories]);
    return { id, snapshotHash, taskType, route: { ...settings, sourceLayers: route.sourceLayers.map(layer => ({ ...layer })) } };
  }, true);
}

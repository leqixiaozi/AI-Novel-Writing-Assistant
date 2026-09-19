import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ManagedCredentialChoice, ManagedRouteSummary, ModelRouteCenterCatalog, SaveManagedModelRouteInput, SaveManagedModelRouteResult } from "../../../common/modelRouting";
import { MODEL_TASKS } from "../../../common/modelRouting";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { stableHash } from "../aiContracts";
import { providerSchema, saveSchema, taskSchema, unsupportedIssue, versionFromRows, type DbRow } from "./policy";

/** Internal test isolation only: HTTP never accepts a schema or database context. */
export interface ManagedDatabaseContext { client?: PoolClient; schema?: string }
export async function withClient<T>(context: ManagedDatabaseContext | undefined, action: (client: PoolClient) => Promise<T>, transactional = false): Promise<T> {
  if (context?.schema && (!context.client || !/^model_route_test_[a-z0-9_]+$/.test(context.schema))) throw new NewDesignError("模型路由隔离数据库范围无效。", 422);
  if (context?.client) {
    const schema = context.schema;
    const client = schema ? new Proxy(context.client, { get(target, property) { if (property === "query") return (sql: string, params?: unknown[]) => target.query(sql.replaceAll("new_design.", `${schema}.`), params); const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } }) : context.client;
    return action(client);
  }
  const client = await (await getNewDesignPool()).connect();
  try { if (transactional) await client.query("BEGIN"); const result = await action(client); if (transactional) await client.query("COMMIT"); return result; }
  catch (error) { if (transactional) await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function readFallbacks(client: PoolClient, versionId: string): Promise<DbRow[]> { return (await client.query("SELECT * FROM new_design.model_route_fallbacks WHERE route_version_id=$1 ORDER BY sort_order,id", [versionId])).rows; }
export async function readSummary(client: PoolClient, config: DbRow): Promise<ManagedRouteSummary> {
  const current = assertFound((await client.query("SELECT * FROM new_design.model_route_versions WHERE id=$1 AND config_id=$2", [config.current_version_id, config.id])).rows[0], "路由当前版本不存在。"), currentFallbacks = await readFallbacks(client, current.id);
  const published = config.published_version_id ? assertFound((await client.query("SELECT * FROM new_design.model_route_versions WHERE id=$1 AND config_id=$2", [config.published_version_id, config.id])).rows[0], "路由生效版本不存在。") : null;
  const issue = unsupportedIssue({...current,scope:config.scope}, currentFallbacks);
  return { id: config.id, scope: config.scope, taskType: config.scope === "task" ? config.task_key : null, name: config.name, revision: Number(config.revision), current: versionFromRows(current, currentFallbacks), published: published ? versionFromRows(published, await readFallbacks(client, published.id)) : null, editable: !issue, configurationIssue: issue };
}
const credentialVariable = (row: DbRow): string | null => row.status === "active" && providerSchema.safeParse(row.provider).success && /^env:\/\/NEW_DESIGN_AI_[A-Z0-9_]+$/.test(String(row.secret_locator)) ? String(row.secret_locator).slice(6) : null;
function credentialChoice(row: DbRow): ManagedCredentialChoice { const variable = credentialVariable(row); return { id: row.id, label: row.credential_key, provider: row.provider, available: Boolean(variable && process.env[variable]), status: row.status }; }
export async function getManagedCredentialCatalog(context?:ManagedDatabaseContext):Promise<Pick<ModelRouteCenterCatalog,"credentials"|"environmentReferences">>{return withClient(context,async client=>{const credentials=(await client.query("SELECT * FROM new_design.model_credential_refs ORDER BY credential_key,id")).rows.map(credentialChoice);const environmentReferences=Object.keys(process.env).filter(name=>/^NEW_DESIGN_AI_[A-Z0-9_]+$/.test(name)&&!["NEW_DESIGN_AI_PROVIDER","NEW_DESIGN_AI_MODEL","NEW_DESIGN_AI_BASE_URL","NEW_DESIGN_AI_TIMEOUT_MS","NEW_DESIGN_AI_MAX_TOKENS"].includes(name)).sort().map(name=>({name,available:Boolean(process.env[name])}));return {credentials,environmentReferences};});}
export async function getModelRouteCenterCatalog(context?: ManagedDatabaseContext): Promise<ModelRouteCenterCatalog> {
  return withClient(context, async client => {
    const rows = (await client.query("SELECT * FROM new_design.model_route_configs WHERE status='active' AND ((scope='system_default') OR (scope='task' AND task_key=ANY($1::text[]) AND task_group IS NULL)) ORDER BY scope,task_key,id", [MODEL_TASKS.map(item => item.key)])).rows;
    const routes: ManagedRouteSummary[] = []; for (const row of rows) routes.push(await readSummary(client, row));
    const {credentials,environmentReferences}=await getManagedCredentialCatalog({...context,client});
    return { routes, credentials, tasks: MODEL_TASKS, environmentReferences };
  });
}
export async function getManagedCredentialEnvironment(id: string | null, provider: string, context?: ManagedDatabaseContext): Promise<string | null> {
  if (!id) return null;
  return withClient(context, async client => {
    const row = assertFound((await client.query("SELECT * FROM new_design.model_credential_refs WHERE id=$1", [id])).rows[0], "模型凭据引用不存在，请在模型设置重新选择。");
    const variable = credentialVariable(row);
    if (!variable || row.provider !== provider || !process.env[variable]) throw new NewDesignError("模型凭据未配置或供应商不匹配，请在模型设置绑定专用环境变量。", 422);
    return variable;
  });
}
export async function createManagedCredential(input: { name: string; provider: string; environmentVariable: string }, context?: ManagedDatabaseContext): Promise<ManagedCredentialChoice> {
  const name = input.name?.trim(), variable = input.environmentVariable?.trim();
  if (!name || name.length > 120 || !/^NEW_DESIGN_AI_[A-Z0-9_]+$/.test(variable ?? "")) throw new NewDesignError("请填写中文凭据名称并选择 NEW_DESIGN_AI_ 开头的专用环境变量名。", 422);
  const provider = providerSchema.parse(input.provider);
  return withClient(context, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`managed-credential:${name}`]);
    const existing = (await client.query("SELECT * FROM new_design.model_credential_refs WHERE credential_key=$1 FOR UPDATE", [name])).rows[0];
    if (existing) {
      if (existing.provider !== provider || existing.secret_locator !== `env://${variable}`) throw new NewDesignError("此名称已绑定其他凭据。请使用不同名称，原引用不会覆盖。", 409);
      return credentialChoice(existing);
    }
    const row = (await client.query("INSERT INTO new_design.model_credential_refs(id,credential_key,provider,secret_locator,status) VALUES($1,$2,$3,$4,'active') RETURNING *", [randomUUID(), name, provider, `env://${variable}`])).rows[0];
    return credentialChoice(row);
  }, true);
}
export async function saveManagedModelRoute(value: SaveManagedModelRouteInput & { replaceUnsupported?: boolean }, context?: ManagedDatabaseContext): Promise<SaveManagedModelRouteResult> {
  const input = saveSchema.parse(value);
  return withClient(context, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`managed-route-key:${input.idempotencyKey}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`managed-route-scope:${input.scope}:${input.taskType ?? ""}`]);
    const receipt = (await client.query("SELECT * FROM new_design.ai_contract_publications WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0];
    if (receipt) {
      if (receipt.entity_kind !== "model_route") throw new NewDesignError("此请求标识已用于其他操作。", 409);
      const config = assertFound((await client.query("SELECT * FROM new_design.model_route_configs WHERE id=$1", [receipt.entity_id])).rows[0], "保存回执的模型路由不存在。"), version = assertFound((await client.query("SELECT * FROM new_design.model_route_versions WHERE id=$1 AND config_id=$2", [receipt.to_version_id, config.id])).rows[0], "保存回执的模型版本不存在。");
      if (config.scope !== input.scope || (config.task_key ?? null) !== input.taskType || version.content_hash !== stableHash(input) || version.created_by !== `managed:${input.replaceUnsupported ? "replace" : "preserve"}`) throw new NewDesignError("同一请求标识不能用于不同的模型设置。", 409);
      return { route: await readSummary(client, config), savedVersionId: version.id, savedVersion: Number(version.version), active: config.status === "active" && config.published_version_id === version.id, repeated: true };
    }
    let config = (await client.query("SELECT * FROM new_design.model_route_configs WHERE status='active' AND scope=$1 AND task_key IS NOT DISTINCT FROM $2 AND task_group IS NULL AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL FOR UPDATE", [input.scope, input.taskType])).rows[0];
    if (config) {
      if (input.expectedConfigId !== config.id || input.expectedRevision !== Number(config.revision)) throw new NewDesignError("模型设置已更新。请刷新核对后重新保存，当前输入可保留。", 409);
      const current = assertFound((await client.query("SELECT * FROM new_design.model_route_versions WHERE id=$1", [config.current_version_id])).rows[0], "路由当前版本不存在。");
      if (unsupportedIssue(current, await readFallbacks(client, current.id)) && !input.replaceUnsupported) throw new NewDesignError("原版本含未支持的供应商或高级参数。请明确确认替换；原版本将保留。", 409);
    } else {
      if (input.expectedConfigId !== null || input.expectedRevision !== null) throw new NewDesignError("模型路由已恢复继承或归档，请刷新后重新保存。", 409);
      config = (await client.query("INSERT INTO new_design.model_route_configs(id,scope,task_key,name) VALUES($1,$2,$3,$4) RETURNING *", [randomUUID(), input.scope, input.taskType, input.scope === "system_default" ? "默认创作模型" : `${MODEL_TASKS.find(item => item.key === input.taskType)?.label}模型`])).rows[0];
    }
    for (const connection of [input.primary, ...input.fallbacks]) if (connection.credentialId) {
      const credential = assertFound((await client.query("SELECT * FROM new_design.model_credential_refs WHERE id=$1", [connection.credentialId])).rows[0], "选择的模型凭据不存在。");
      if (credential.provider !== connection.provider || !credentialVariable(credential)) throw new NewDesignError("模型凭据引用不可用或供应商不匹配，请重新选择。", 422);
    }
    const fromVersionId = config.published_version_id ?? null;
    const version = Number((await client.query("SELECT COALESCE(max(version),0)+1 AS version FROM new_design.model_route_versions WHERE config_id=$1", [config.id])).rows[0].version), versionId = randomUUID(), revision = Number(config.revision) + (config.current_version_id ? 2 : 1), contentHash = stableHash(input);
    await client.query("INSERT INTO new_design.model_route_versions(id,config_id,version,base_version_id,source,status,provider,model,parameters,required_capabilities,credential_ref_id,budget_policy,timeout_ms,retry_policy,fallback_mode,content_hash,created_by) VALUES($1,$2,$3,$4,'manual','draft',$5,$6,$7::jsonb,'{}',$8,$9::jsonb,$10,$11::jsonb,'replace',$12,$13)", [versionId, config.id, version, config.current_version_id, input.primary.provider, input.primary.model, JSON.stringify({ baseUrl: input.primary.endpoint }), input.primary.credentialId, JSON.stringify({ maxTokens: input.policy.maxTotalTokens, maxOutputTokens: input.policy.maxOutputTokens }), input.policy.timeoutMs, JSON.stringify({ maxRetries: input.policy.maxRetries, retryDelayMs: input.policy.retryDelayMs }), contentHash, `managed:${input.replaceUnsupported ? "replace" : "preserve"}`]);
    for (const [index, fallback] of input.fallbacks.entries()) await client.query("INSERT INTO new_design.model_route_fallbacks(id,route_version_id,sort_order,provider,model,parameters,credential_ref_id,technical_failure_categories) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)", [randomUUID(), versionId, index, fallback.provider, fallback.model, JSON.stringify({ baseUrl: fallback.endpoint }), fallback.credentialId, fallback.failureCategories]);
    if (config.published_version_id) await client.query("UPDATE new_design.model_route_versions SET status='superseded' WHERE id=$1", [config.published_version_id]);
    await client.query("UPDATE new_design.model_route_versions SET status='published' WHERE id=$1", [versionId]);
    config = (await client.query("UPDATE new_design.model_route_configs SET current_version_id=$2,published_version_id=$2,revision=$3,updated_at=now() WHERE id=$1 RETURNING *", [config.id, versionId, revision])).rows[0];
    await client.query("INSERT INTO new_design.ai_contract_publications(id,entity_kind,entity_id,from_version_id,to_version_id,entity_revision,action,actor,idempotency_key) VALUES($1,'model_route',$2,$3,$4,$5,'publish','managed-user',$6)", [randomUUID(), config.id, fromVersionId, versionId, revision, input.idempotencyKey]);
    return { route: await readSummary(client, config), savedVersionId: versionId, savedVersion: version, active: true, repeated: false };
  }, true);
}
export async function inheritManagedModelRoute(id: string, expectedRevision: number, context?: ManagedDatabaseContext): Promise<{ id: string; inherited: true }> {
  return withClient(context, async client => {
    let config = assertFound((await client.query("SELECT * FROM new_design.model_route_configs WHERE id=$1", [id])).rows[0], "任务模型路由不存在。");
    if (config.scope !== "task" || !taskSchema.safeParse(config.task_key).success || config.task_group !== null) throw new NewDesignError("只有明确任务路由可以恢复默认模型继承。", 422);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`managed-route-scope:task:${config.task_key}`]);
    config = assertFound((await client.query("SELECT * FROM new_design.model_route_configs WHERE id=$1 FOR UPDATE", [id])).rows[0], "任务模型路由不存在。");
    if (config.status !== "active" || Number(config.revision) !== expectedRevision) throw new NewDesignError("任务模型设置已更新，请刷新核对后重试。", 409);
    await client.query("UPDATE new_design.model_route_configs SET status='archived',revision=revision+1,updated_at=now() WHERE id=$1", [id]);
    return { id, inherited: true };
  }, true);
}

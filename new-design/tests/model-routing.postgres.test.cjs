const test = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { getNewDesignPool } = require("../dist/server/database/runtime");
const routes = require("../dist/server/database/modelManagement");

test("managed model routes share existing facts with atomic publication and isolated PostgreSQL fixtures", { skip: process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME !== "1", timeout: 60000 }, async t => {
  const pool = await getNewDesignPool(), client = await pool.connect();
  const schema = `model_route_test_${randomUUID().replaceAll("-", "")}`, context = { client, schema };
  const names = ["model_credential_refs", "model_route_configs", "model_route_versions", "model_route_fallbacks", "model_route_snapshots", "model_route_snapshot_fallbacks", "ai_contract_publications"];
  const originalDefault = (await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows;
  t.after(async () => { try { await client.query("ROLLBACK"); await client.query(`UPDATE ${schema}.model_route_configs SET status='archived',revision=revision+1 WHERE status='active'`); } finally { client.release(); await pool.end(); } });
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const name of names) await client.query(`CREATE TABLE ${schema}.${name} (LIKE new_design.${name} INCLUDING ALL)`);
  await client.query(`ALTER TABLE ${schema}.model_route_versions ADD FOREIGN KEY(config_id) REFERENCES ${schema}.model_route_configs(id), ADD FOREIGN KEY(base_version_id,config_id) REFERENCES ${schema}.model_route_versions(id,config_id), ADD FOREIGN KEY(credential_ref_id) REFERENCES ${schema}.model_credential_refs(id)`);
  await client.query(`ALTER TABLE ${schema}.model_route_configs ADD FOREIGN KEY(current_version_id,id) REFERENCES ${schema}.model_route_versions(id,config_id), ADD FOREIGN KEY(published_version_id,id) REFERENCES ${schema}.model_route_versions(id,config_id)`);
  await client.query(`ALTER TABLE ${schema}.model_route_fallbacks ADD FOREIGN KEY(route_version_id) REFERENCES ${schema}.model_route_versions(id), ADD FOREIGN KEY(credential_ref_id) REFERENCES ${schema}.model_credential_refs(id)`);
  await client.query(`ALTER TABLE ${schema}.model_route_snapshots ADD FOREIGN KEY(credential_ref_id) REFERENCES ${schema}.model_credential_refs(id)`);
  await client.query(`ALTER TABLE ${schema}.model_route_snapshot_fallbacks ADD FOREIGN KEY(snapshot_id) REFERENCES ${schema}.model_route_snapshots(id), ADD FOREIGN KEY(credential_ref_id) REFERENCES ${schema}.model_credential_refs(id)`);
  for (const name of ["model_route_versions", "model_route_fallbacks", "model_route_snapshots", "model_route_snapshot_fallbacks"]) await client.query(`CREATE TRIGGER fixture_immutable BEFORE UPDATE OR DELETE ON ${schema}.${name} FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable()`);
  await client.query("BEGIN");
  const settings = { primary: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "fixture-model", credentialId: null }, fallbacks: [{ provider: "openai-compatible", endpoint: "http://127.0.0.1:14000/v1", model: "backup-model", credentialId: null, failureCategories: ["transport", "timeout"] }], policy: { maxOutputTokens: 2048, maxTotalTokens: 12000, timeoutMs: 30000, maxRetries: 1, retryDelayMs: 1000 } };
  const input = { ...settings, scope: "system_default", taskType: null, expectedConfigId: null, expectedRevision: null, idempotencyKey: randomUUID() };
  let saved;
  await t.test("missing published default fails without environment model fallback", async () => {
    await assert.rejects(routes.resolveManagedTaskRoute("directions", context), /默认创作模型/);
  });
  await t.test("one transaction writes a version, publication and active pointers", async () => {
    saved = await routes.saveManagedModelRoute(input, context);
    assert.equal(saved.active, true); assert.equal(saved.repeated, false); assert.equal(saved.route.published.id, saved.savedVersionId);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.model_route_versions`)).rows[0].count, 1);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.ai_contract_publications`)).rows[0].count, 1);
  });
  await t.test("repeated save returns the original version; changed request is a conflict", async () => {
    const repeated = await routes.saveManagedModelRoute(input, context); assert.equal(repeated.savedVersionId, saved.savedVersionId); assert.equal(repeated.repeated, true);
    await assert.rejects(routes.saveManagedModelRoute({ ...input, primary: { ...input.primary, model: "different" } }, context), error => error.statusCode === 409 || error.status === 409);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.model_route_versions`)).rows[0].count, 1);
  });
  await t.test("task override resolution and inheritance keep original history", async () => {
    const taskInput = { ...settings, primary: { ...settings.primary, model: "form-model" }, fallbacks: [], scope: "task", taskType: "form_assist", expectedConfigId: null, expectedRevision: null, idempotencyKey: randomUUID() };
    const task = await routes.saveManagedModelRoute(taskInput, context);
    let resolved = await routes.resolveManagedTaskRoute("form_assist", context); assert.equal(resolved.primary.model, "form-model"); assert.equal(resolved.sourceLayers.length, 2); assert.equal(resolved.fallbacks.length, 0);
    await routes.inheritManagedModelRoute(task.route.id, task.route.revision, context);
    resolved = await routes.resolveManagedTaskRoute("form_assist", context); assert.equal(resolved.primary.model, "fixture-model"); assert.equal(resolved.sourceLayers.length, 1);
    const delayed = await routes.saveManagedModelRoute(taskInput, context); assert.equal(delayed.active, false); assert.equal(delayed.repeated, true);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.model_route_versions WHERE config_id=$1`, [task.route.id])).rows[0].count, 1);
  });
  await t.test("managed snapshots retain exact version refs and fallback rows without a book", async () => {
    const route = await routes.resolveManagedTaskRoute("directions", context), snapshot = await routes.captureManagedModelSnapshot("directions", route, context);
    const row = (await client.query(`SELECT * FROM ${schema}.model_route_snapshots WHERE id=$1`, [snapshot.id])).rows[0];
    assert.equal(row.book_id, null); assert.equal(row.task_contract_version_id, null); assert.equal(row.managed_task_key, "directions"); assert.deepEqual(row.source_layers, route.sourceLayers);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.model_route_snapshot_fallbacks WHERE snapshot_id=$1`, [snapshot.id])).rows[0].count, 1);
    await assert.rejects(routes.captureManagedModelSnapshot("directions", { ...route, primary: { ...route.primary, model: "fabricated" } }, context), /内容与来源版本不一致/);
  });
  await t.test("snapshot CHECK disallows a null task before a book exists", async () => {
    await client.query("SAVEPOINT invalid_scope");
    await assert.rejects(client.query(`INSERT INTO ${schema}.model_route_snapshots(id,provider,model,parameters,required_capabilities,budget_policy,timeout_ms,retry_policy,source_layers,policy_version,snapshot_hash) VALUES($1,'ollama','fixture','{}','{}','{}',1000,'{}','[]','test',$2)`, [randomUUID(), "a".repeat(64)]));
    await client.query("ROLLBACK TO SAVEPOINT invalid_scope");
  });
  await t.test("late receipts identify the originally saved version, never the latest active version", async () => {
    const latest=await routes.saveManagedModelRoute({...input,primary:{...settings.primary,model:"fixture-updated"},expectedConfigId:saved.route.id,expectedRevision:saved.route.revision,idempotencyKey:randomUUID()},context);
    const old=await routes.saveManagedModelRoute(input,context);
    assert.equal(old.savedVersionId,saved.savedVersionId);assert.equal(old.savedVersion,1);assert.equal(old.active,false);assert.equal(old.route.published.id,latest.savedVersionId);assert.equal(old.route.published.version,2);
  });
  await t.test("credentials are dedicated name-only references and never overwrite old locators", async () => {
    const envName = `NEW_DESIGN_AI_FIXTURE_${randomUUID().replaceAll("-", "").toUpperCase()}`; process.env[envName] = "private-value-not-in-output";
    try {
      const credential = await routes.createManagedCredential({ name: "验证专用凭据", provider: "openai-compatible", environmentVariable: envName }, context);
      assert.equal(credential.available, true); assert.equal(Object.hasOwn(credential, "secretLocator"), false); assert.equal(JSON.stringify(credential).includes(process.env[envName]), false);
      assert.equal(await routes.getManagedCredentialEnvironment(credential.id, "openai-compatible", context), envName);
      const repeated = await routes.createManagedCredential({ name: "验证专用凭据", provider: "openai-compatible", environmentVariable: envName }, context); assert.equal(repeated.id, credential.id);
      await assert.rejects(routes.createManagedCredential({ name: "验证专用凭据", provider: "ollama", environmentVariable: envName }, context), /已绑定其他凭据/);
      await assert.rejects(routes.createManagedCredential({ name: "越界引用", provider: "ollama", environmentVariable: "OPENAI_API_KEY" }, context));
      const oldId = randomUUID(); await client.query(`INSERT INTO ${schema}.model_credential_refs(id,credential_key,provider,secret_locator) VALUES($1,'旧专用外引用','openai-compatible','env://OPENAI_API_KEY')`, [oldId]);
      const catalog = await routes.getModelRouteCenterCatalog(context); assert.equal(catalog.credentials.find(item => item.id === oldId).available, false); assert.equal(JSON.stringify(catalog).includes("env://"), false); assert.equal(JSON.stringify(catalog).includes(process.env[envName]), false);
    } finally { delete process.env[envName]; }
  });
  await t.test("unsupported legacy parameters require explicit replacement and retain exact old content", async () => {
    const id = randomUUID(), versionId = randomUUID();
    await client.query(`INSERT INTO ${schema}.model_route_configs(id,scope,task_key,name) VALUES($1,'task','book_analysis','旧高级配置')`, [id]);
    await client.query(`INSERT INTO ${schema}.model_route_versions(id,config_id,version,source,status,provider,model,parameters,required_capabilities,budget_policy,timeout_ms,retry_policy,fallback_mode,content_hash) VALUES($1,$2,1,'import','published','legacy-provider','legacy-model','{"specialMode":true}','{}','{"maxTokens":12000}',30000,'{}','replace',$3)`, [versionId, id, "b".repeat(64)]);
    await client.query(`UPDATE ${schema}.model_route_configs SET current_version_id=$2,published_version_id=$2 WHERE id=$1`, [id, versionId]);
    const replacement = { ...settings, scope: "task", taskType: "book_analysis", expectedConfigId: id, expectedRevision: 1, idempotencyKey: randomUUID() };
    await assert.rejects(routes.saveManagedModelRoute(replacement, context), /明确确认替换/);
    const replaced = await routes.saveManagedModelRoute({ ...replacement, replaceUnsupported: true }, context); assert.equal(replaced.route.current.version, 2);
    const old = (await client.query(`SELECT provider,parameters,status FROM ${schema}.model_route_versions WHERE id=$1`, [versionId])).rows[0]; assert.equal(old.provider, "legacy-provider"); assert.deepEqual(old.parameters, { specialMode: true }); assert.equal(old.status, "superseded");
  });
  await t.test("failed credentials roll back all writes when caller uses a transaction savepoint", async () => {
    const before = (await client.query(`SELECT count(*)::int AS count FROM ${schema}.model_route_configs`)).rows[0].count;
    await client.query("SAVEPOINT invalid_credential");
    await assert.rejects(routes.saveManagedModelRoute({ ...settings, primary: { ...settings.primary, credentialId: randomUUID() }, scope: "task", taskType: "market_analysis", expectedConfigId: null, expectedRevision: null, idempotencyKey: randomUUID() }, context));
    await client.query("ROLLBACK TO SAVEPOINT invalid_credential");
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.model_route_configs`)).rows[0].count, before);
  });
  await client.query(`UPDATE ${schema}.model_route_configs SET status='archived',revision=revision+1 WHERE status='active'`);
  await client.query("COMMIT");
  assert.deepEqual((await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows, originalDefault);
  console.log(`Preserved isolated model route fixtures: ${schema}`);
});

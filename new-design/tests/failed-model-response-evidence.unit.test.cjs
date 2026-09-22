const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {preparePrompt} = require('../dist/server/ai/prompts');
const {executeManagedPrompt} = require('../dist/server/ai/runtime/managedExecution');
const {DEFAULT_MODEL_POLICY} = require('../dist/common/modelRouting');
const prompt = preparePrompt('form_assist', {
  bookName: '测试', formName: '人物', cardTitle: '人物', currentValues: {}, instruction: '',
  fields: [{key: 'name', name: '姓名', description: '', type: 'short_text', required: true,
    options: [], defaultValue: null, group: '基础', order: 0}],
});
const route = {
  primary: {provider: 'openai-compatible', endpoint: 'https://api.minimax.cn/v1', model: 'MiniMax-M3', credentialId: 'fixture-credential'},
  fallbacks: [], policy: {...DEFAULT_MODEL_POLICY, maxTotalTokens: 200000, maxRetries: 2}, sourceLayers: [],
};
function setup(content, {retain = true, finish = 'stop', status = 200} = {}) {
  let calls = 0;
  const dependencies = {
    retainFailedResponse: retain, routeResolver: async () => route,
    credentialResolver: async () => 'fixture-key-not-a-real-secret',
    snapshotWriter: async () => ({id: 'snapshot', snapshotHash: 'hash', taskType: 'form_assist', route}),
    fetcher: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      assert.equal(body.response_format, undefined);
      assert.deepEqual(body.thinking, {type: 'disabled'});
      return new Response(JSON.stringify({
        id: 'reply-id', model: 'MiniMax-M3', choices: [{finish_reason: finish,
          message: {content, reasoning_content: 'private-thinking', tool_calls: [{private: 'tool-data'}]}}],
        usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
        unknown_provider_field: 'not-allowed',
      }), {status});
    },
  };
  return {dependencies, calls: () => calls};
}
async function failure(content, options) {
  const fixture = setup(content, options);
  let error;
  try {await executeManagedPrompt('form_assist', prompt, fixture.dependencies);}
  catch (caught) {error = caught;}
  assert.ok(error, 'invalid output must not become a candidate');
  assert.equal(fixture.calls(), 1, 'content failure must not trigger another paid request');
  return error;
}

test('invalid JSON retains exact private final text, metadata, hash and usage without relaxing parsing', async () => {
  const content = '```json\n{"suggestions":{"name":"中文"}}\n```';
  const error = await failure(content), evidence = error.executionSnapshot.failedResponseEvidence;
  assert.equal(evidence.content, content);
  assert.equal(evidence.contentSha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(evidence.contentBytes, Buffer.byteLength(content));
  assert.equal(evidence.retainedBytes, evidence.contentBytes);
  assert.equal(evidence.truncated, false);
  assert.equal(evidence.finishReason, 'stop');
  assert.equal(evidence.responseId, 'reply-id');
  assert.equal(evidence.responseModel, 'MiniMax-M3');
  assert.equal(evidence.maxOutputTokens, Math.min(prompt.maxTokens, route.policy.maxOutputTokens));
  assert.equal(evidence.usedTokens, 15);
  assert.equal(error.executionSnapshot.knownTokens, 15);
  assert.equal(error.executionSnapshot.attempts[0].responseReceived, true);
  assert.ok(Number.isFinite(Date.parse(evidence.capturedAt)));
  assert.doesNotMatch(JSON.stringify(evidence), /private-thinking|tool-data|not-allowed|Authorization/);
  assert.doesNotMatch(JSON.stringify(error.recovery), /suggestions|reply-id/);
});

test('valid JSON with invalid fields also retains evidence and never auto-adopts', async () => {
  const content = '{"suggestions":{"name":42}}';
  const error = await failure(content);
  assert.equal(error.executionSnapshot.failedResponseEvidence.content, content);
  assert.equal(error.executionSnapshot.knownTokens, 15);
  assert.equal(error.recovery.failedStep, '核对创作结果');
});

test('provider length stop reason is retained rather than inferred from token counts', async () => {
  const error = await failure('{"suggestions":', {finish: 'length'});
  assert.equal(error.executionSnapshot.failedResponseEvidence.finishReason, 'length');
});

test('missing final text does not retain reasoning or tool payload as a substitute', async () => {
  const error = await failure(null, {finish: 'tool_calls'});
  assert.equal(error.executionSnapshot.failedResponseEvidence.content, null);
  assert.equal(error.executionSnapshot.failedResponseEvidence.contentSha256, null);
  assert.equal(error.executionSnapshot.failedResponseEvidence.finishReason, 'tool_calls');
});

test('other workflows do not retain raw output without explicit opt-in', async () => {
  const error = await failure('private-output', {retain: false});
  assert.equal(error.executionSnapshot.failedResponseEvidence, undefined);
  assert.equal(error.transportReceipt.responseEvidence, undefined);
});

test('oversized evidence is UTF-8 safe, explicitly truncated and hashes the full response', async () => {
  const content = '中'.repeat(700000), error = await failure(content);
  const evidence = error.executionSnapshot.failedResponseEvidence;
  assert.equal(evidence.truncated, true);
  assert.ok(evidence.retainedBytes <= 2 * 1024 * 1024);
  assert.ok(evidence.contentBytes > evidence.retainedBytes);
  assert.ok(content.startsWith(evidence.content));
  assert.equal(evidence.contentSha256, createHash('sha256').update(content).digest('hex'));
});

test('successful replies do not carry raw diagnostic text into public model snapshots', async () => {
  const fixture = setup('{"suggestions":{"name":"沈青"}}');
  const result = await executeManagedPrompt('form_assist', prompt, fixture.dependencies);
  assert.deepEqual(result.output, {suggestions: {name: '沈青'}});
  assert.equal(result.modelSnapshot.failedResponseEvidence, undefined);
  assert.equal(result.modelSnapshot.responseEvidence, undefined);
});

test('authentication errors do not retain upstream error bodies', async () => {
  const error = await failure('private-error-body', {status: 401});
  assert.equal(error.executionSnapshot.failedResponseEvidence, undefined);
  assert.doesNotMatch(JSON.stringify(error), /private-error-body|private-thinking/);
});

test('creation failures persist evidence in existing batch execution, but public receipts omit it', async t => {
  const {failCreationPreparation} = require('../dist/server/database/creationDirector/results');
  const repository = require('../dist/server/database/bookCreationProduction/repository');
  const transaction = require('../dist/server/database/creationDirector/transaction');
  const preparation = require('../dist/server/database/creationDirector/preparation');
  const batch = {id: 'batch', session_id: 'session', status: 'running', preparation_request_key: 'original-key',
    frozen_plan: {input: {stage: 'project'}}, base_revision: 2, current_session_revision: 2};
  t.mock.method(transaction, 'directorTransaction', async (_id, action) => action({}));
  t.mock.method(repository, 'lockCreationSession', async () => ({id: 'session', input_payload: {}}));
  t.mock.method(repository, 'updateCreationSession', async () => ({}));
  t.mock.method(repository, 'updateGenerationBatch', async (_db, _id, patch) => Object.assign(batch, patch));
  t.mock.method(preparation, 'readOwnedCreationBatch', async () => batch);
  const error = await failure('private-invalid-json');
  const fail = transaction.preparationFailure('session', 'batch', '解析创作结果', '格式不符', 'not_written', 'completed');
  const receipt = await failCreationPreparation({sessionId: 'session', batchId: 'batch'}, fail, error.executionSnapshot);
  assert.equal(batch.preparation_execution.failedResponseEvidence.content, 'private-invalid-json');
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.modelResultSaved, false);
  assert.equal(receipt.canAdoptSavedResult, false);
  assert.doesNotMatch(JSON.stringify(receipt), /private-invalid-json|failedResponseEvidence|reply-id/);
});

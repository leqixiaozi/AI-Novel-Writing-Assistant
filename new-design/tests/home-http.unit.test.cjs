const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('../node_modules/express');
const home = require('../dist/server/database/home');
const runtime = require('../dist/server/database/runtime');
const ai = require('../dist/server/ai/runtime/managedStatus');
const { homeRouter } = require('../dist/server/http/home');
const { MODEL_TASKS } = require('../dist/common/modelRouting');

test('home GET routes return facts and per-task configuration without recovery or model execution', async () => {
  const original = { read: home.getHomeSnapshot, pool: runtime.getInitializedNewDesignPool, bootstrap: runtime.getNewDesignPool, availability: ai.getIndependentTaskAvailability };
  const calls = [];
  home.getHomeSnapshot = async () => ({ books: [], creationDraft: null, readAt: '2026-09-17T00:00:00Z' });
  runtime.getInitializedNewDesignPool = async () => { calls.push('existing-pool'); return {}; };
  runtime.getNewDesignPool = async () => { throw new Error('Test must never bootstrap infrastructure'); };
  ai.getIndependentTaskAvailability = async task => { calls.push(task); return { configured: task !== 'chapter_generation', message: 'private diagnostic is not exposed' }; };
  const app = express();
  let recoveryCalls = 0;
  app.use('/api/new-design/home', homeRouter());
  app.use((_req, res) => { recoveryCalls++; res.sendStatus(404); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/new-design/home`;
  try {
    const snapshot = await fetch(`${base}/snapshot`);
    assert.equal(snapshot.status, 200);
    assert.deepEqual((await snapshot.json()).data.books, []);
    const models = await (await fetch(`${base}/models`)).json();
    assert.equal(models.data.configured, false);
    assert.equal(models.data.tasks.length, MODEL_TASKS.length);
    assert.equal(models.data.tasks.filter(task => !task.configured).length, 1);
    assert.equal(calls[0], 'existing-pool');
    assert.deepEqual(new Set(calls.slice(1)), new Set(MODEL_TASKS.map(task => task.key)));
    assert.doesNotMatch(JSON.stringify(models), /private diagnostic|endpoint|credential|apiKey/);
    assert.equal(recoveryCalls, 0);
    home.getHomeSnapshot = async () => { throw new Error('private database diagnostics'); };
    const failure = await fetch(`${base}/snapshot`);
    assert.equal(failure.status, 503);
    assert.doesNotMatch(await failure.text(), /private database/);
    runtime.getInitializedNewDesignPool = async () => { throw new Error('not initialized'); };
    const count = calls.length;
    assert.equal((await fetch(`${base}/models`)).status, 503);
    assert.equal(calls.length, count);
    assert.equal(recoveryCalls, 0);
  } finally {
    home.getHomeSnapshot = original.read;
    runtime.getInitializedNewDesignPool = original.pool;
    runtime.getNewDesignPool = original.bootstrap;
    ai.getIndependentTaskAvailability = original.availability;
    await new Promise(resolve => server.close(resolve));
  }
});

test('cold home database getter refuses to bootstrap the database', async () => {
  await assert.rejects(runtime.getInitializedNewDesignPool(), /尚未就绪/);
});

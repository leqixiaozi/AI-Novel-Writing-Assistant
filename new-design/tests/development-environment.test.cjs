'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseDevelopmentEnvironment, serializeDevelopmentEnvironment, readDevelopmentConfig, dockerEnvironment } = require('../scripts/development/environment.cjs');
const config = { port: 15433, user: 'new_design', password: 'unchanged-secret', database: 'new_design', bindAddress: '0.0.0.0', dataDirectory: 'D:/infra/data/ai-novel-new-design/postgres17' };

test('environment file round-trip preserves credentials, port and host directory', () => {
  assert.deepEqual(parseDevelopmentEnvironment(serializeDevelopmentEnvironment(config)), config);
  const special = { ...config, password: 'literal$sign # with spaces' };
  assert.deepEqual(parseDevelopmentEnvironment(serializeDevelopmentEnvironment(special)), special);
});
test('missing credentials or invalid port fail without including secrets in errors', () => {
  const source = serializeDevelopmentEnvironment(config);
  for (const text of [source.replace(/NEW_DESIGN_DEV_DB_PASSWORD=.*\n/, ''), source.replace("'15433'", "'invalid'"), source.replace("'unchanged-secret'", "''")]) {
    assert.throws(() => parseDevelopmentEnvironment(text), error => !error.message.includes(config.password));
  }
});
test('ambiguous unquoted hashes and interpolated dollars fail before Compose can diverge', () => {
  const source = serializeDevelopmentEnvironment(config);
  assert.throws(() => parseDevelopmentEnvironment(source.replace("'unchanged-secret'", 'synthetic#suffix')), /#/);
  assert.throws(() => parseDevelopmentEnvironment(source.replace("'D:/infra/data/ai-novel-new-design/postgres17'", 'D:/infra/database#one/postgres17')), /#/);
  assert.throws(() => parseDevelopmentEnvironment(source.replace("'unchanged-secret'", 'synthetic$SUFFIX')), /\$/);
  assert.throws(() => parseDevelopmentEnvironment(source.replace("'unchanged-secret'", '`synthetic`')), /反引号/);
  assert.throws(() => parseDevelopmentEnvironment(source.replace("'unchanged-secret'", '"synthetic\\tvalue"')), /转义/);
  assert.equal(parseDevelopmentEnvironment(source.replace("'unchanged-secret'", "'synthetic$literal' # preserved")).password, 'synthetic$literal');
  assert.equal(parseDevelopmentEnvironment(source.replace("'15433'", '15433 # port')).port, 15433);
});
test('named volume is explicit in env and remains the existing volume target', () => {
  const legacy = { port: 55432, user: 'new_design', password: 'same', database: 'new_design' };
  const parsed = parseDevelopmentEnvironment(serializeDevelopmentEnvironment(legacy));
  assert.equal(parsed.dataDirectory, undefined);
  assert.equal(parsed.bindAddress, '127.0.0.1');
  assert.equal(dockerEnvironment(parsed, {}).NEW_DESIGN_DEV_DB_DATA_SOURCE, 'new-design-postgres-data');
});
test('file configuration overrides stale shell values in spawned Compose', () => {
  const environment = dockerEnvironment(config, { PATH: 'keep-path', NEW_DESIGN_DEV_DB_PORT: '55432', NEW_DESIGN_DEV_DB_PASSWORD: 'old', NEW_DESIGN_DEV_DB_BIND_ADDRESS: '127.0.0.1' });
  assert.equal(environment.NEW_DESIGN_DEV_DB_PORT, '15433');
  assert.equal(environment.NEW_DESIGN_DEV_DB_PASSWORD, config.password);
  assert.equal(environment.NEW_DESIGN_DEV_DB_BIND_ADDRESS, '0.0.0.0');
  assert.equal(environment.PATH, 'keep-path');
});
test('each read uses .env edits; a legacy JSON never substitutes for a missing env file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-environment-'));
  try {
    await fs.mkdir(path.join(root, '.data'));
    await fs.writeFile(path.join(root, '.data/runtime.json'), JSON.stringify({ ...config, port: 55432 }));
    await assert.rejects(readDevelopmentConfig(root), /\.env/);
    await fs.writeFile(path.join(root, '.env'), serializeDevelopmentEnvironment(config));
    assert.equal((await readDevelopmentConfig(root)).port, 15433);
    await fs.writeFile(path.join(root, '.env'), serializeDevelopmentEnvironment({ ...config, port: 25432 }));
    assert.equal((await readDevelopmentConfig(root)).port, 25432);
  } finally {
    await fs.unlink(path.join(root, '.env')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(path.join(root, '.data/runtime.json'));
    await fs.rmdir(path.join(root, '.data'));
    await fs.rmdir(root);
  }
});

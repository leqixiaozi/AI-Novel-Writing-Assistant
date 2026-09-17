'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDockerTarget, matchesDockerTarget, assertNewDataDirectory } = require('../scripts/development/docker-target.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const local = { port: 55432, user: 'new_design', database: 'new_design' };
function container(config, mount) {
  return { Config: { Image: 'ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6', Labels: { 'com.docker.compose.project': 'ai-novel-new-design-dev' }, Env: ['POSTGRES_USER=new_design', 'POSTGRES_DB=new_design'] }, State: { Running: true }, Mounts: [mount], NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: config.bindAddress ?? '127.0.0.1', HostPort: '55432' }] } } };
}
test('old configurations keep their existing volume and loopback binding', () => {
  const target = resolveDockerTarget(local);
  assert.equal(target.mountType, 'volume');
  assert.equal(target.source, 'ai-novel-new-design-pg17-data');
  assert.equal(target.bindAddress, '127.0.0.1');
  assert.equal(matchesDockerTarget(container(local, { Type: 'volume', Name: target.source, Destination: '/var/lib/postgresql/data', RW: true }), local), true);
});
test('external binding and host storage must match the saved target exactly', () => {
  const config = { ...local, bindAddress: '0.0.0.0', dataDirectory: 'D:/infra/data/ai-novel-new-design/postgres17' };
  const target = resolveDockerTarget(config);
  assert.equal(target.mountType, 'bind');
  const inspected = container(config, { Type: 'bind', Source: '/run/desktop/mnt/host/d/infra/data/ai-novel-new-design/postgres17', Destination: '/var/lib/postgresql/data', RW: true });
  assert.equal(matchesDockerTarget(inspected, config), true);
  inspected.Mounts[0].Source += '-other';
  assert.equal(matchesDockerTarget(inspected, config), false);
  inspected.Mounts[0].Source = target.source;
  inspected.NetworkSettings.Ports['5432/tcp'][0].HostIp = '127.0.0.1';
  assert.equal(matchesDockerTarget(inspected, config), false);
});
test('stopped containers are checked against saved port bindings before startup', () => {
  const target = resolveDockerTarget(local);
  const inspected = container(local, { Type: 'volume', Name: target.source, Destination: '/var/lib/postgresql/data', RW: true });
  inspected.State.Running = false;
  inspected.HostConfig = { PortBindings: inspected.NetworkSettings.Ports };
  inspected.NetworkSettings.Ports = {};
  assert.equal(matchesDockerTarget(inspected, local), false);
  assert.equal(matchesDockerTarget(inspected, local, false), true);
  inspected.Config.Env = ['POSTGRES_USER=another', 'POSTGRES_DB=new_design'];
  assert.equal(matchesDockerTarget(inspected, local, false), false);
});
test('unsafe directory and unsupported bind address fail closed', () => {
  for (const dataDirectory of ['D:/', '/', '../data', 'D:/data/../other', '']) assert.throws(() => resolveDockerTarget({ ...local, dataDirectory }));
  assert.throws(() => resolveDockerTarget({ ...local, bindAddress: '192.168.1.120' }));
});
test('new initialization refuses an existing nonempty host directory', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-docker-target-'));
  try {
    await assertNewDataDirectory(directory);
    await fs.writeFile(path.join(directory, 'PG_VERSION'), '17');
    await assert.rejects(assertNewDataDirectory(directory), /已有/);
    assert.equal(await fs.readFile(path.join(directory, 'PG_VERSION'), 'utf8'), '17');
  } finally {
    await fs.unlink(path.join(directory, 'PG_VERSION'));
    await fs.rmdir(directory);
  }
});

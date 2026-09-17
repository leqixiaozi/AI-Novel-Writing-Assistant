'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const IMAGE = 'ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6';
const VOLUME = 'ai-novel-new-design-pg17-data';

function resolveDockerTarget(config) {
  const bindAddress = config.bindAddress ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(bindAddress)) throw new Error('开发数据库监听地址必须为 127.0.0.1 或 0.0.0.0。');
  if (config.dataDirectory === undefined) return { bindAddress, mountType: 'volume', source: VOLUME };
  const value = config.dataDirectory;
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f$]/.test(value)) throw new Error('数据库目录必须是绝对路径下的专用子目录。');
  const source = value.replace(/\\/g, '/').replace(/\/$/, '');
  if (!(source.startsWith('/') || /^[A-Za-z]:\//.test(source)) || source.startsWith('//') || source.split('/').some(part => part === '..' || part === '.') || !source || /^[A-Za-z]:$/.test(source)) throw new Error('数据库目录必须是绝对路径下的专用子目录。');
  return { bindAddress, mountType: 'bind', source };
}

function normalizedSource(value) {
  let result = String(value ?? '').replace(/\\/g, '/').replace(/\/$/, '');
  result = result.replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([A-Za-z])\//, '$1:/');
  return /^[A-Za-z]:\//.test(result) ? result.toLowerCase() : result;
}

function matchesDockerTarget(container, config, requireRunning = true) {
  const target = resolveDockerTarget(config);
  const ports = container?.NetworkSettings?.Ports?.['5432/tcp'] ?? [];
  const bindings = requireRunning ? ports : container?.HostConfig?.PortBindings?.['5432/tcp'] ?? ports;
  const env = container?.Config?.Env ?? [];
  const mounts = (container?.Mounts ?? []).filter(item => item.Destination === '/var/lib/postgresql/data');
  const mount = mounts[0];
  return container?.Config?.Image === IMAGE
    && container?.Config?.Labels?.['com.docker.compose.project'] === 'ai-novel-new-design-dev'
    && (!requireRunning || container?.State?.Running === true)
    && mounts.length === 1 && mount?.RW === true && mount.Type === target.mountType
    && (target.mountType === 'volume' ? mount.Name === target.source : normalizedSource(mount.Source) === normalizedSource(target.source))
    && bindings.length === 1 && bindings[0].HostIp === target.bindAddress && bindings[0].HostPort === String(config.port)
    && env.includes(`POSTGRES_USER=${config.user}`) && env.includes(`POSTGRES_DB=${config.database}`);
}

async function assertNewDataDirectory(directory) {
  const resolved = path.resolve(directory);
  let cursor = path.parse(resolved).root;
  for (const part of path.relative(cursor, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await fs.lstat(cursor).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink() || (await fs.realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) throw new Error('数据库目录不能经过链接或非普通目录。');
  }
  if ((await fs.readdir(resolved)).length) throw new Error('数据库目录已有内容；请恢复原配置，不生成新密码或初始化。');
}

module.exports = { resolveDockerTarget, matchesDockerTarget, assertNewDataDirectory };

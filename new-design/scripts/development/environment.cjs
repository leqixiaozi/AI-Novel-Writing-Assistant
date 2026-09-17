'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { resolveDockerTarget } = require('./docker-target.cjs');

function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('.env 中的开发数据库端口无效。');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.user ?? '') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.database ?? '') || typeof config.password !== 'string' || !config.password || /[\r\n\0]/.test(config.password)) throw new Error('.env 缺少有效的数据库账号、密码或库名。');
  resolveDockerTarget(config);
  return config;
}

function parseDevelopmentEnvironment(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(NEW_DESIGN_DEV_DB_[A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2].trim();
    if (raw.startsWith('`') || (raw.startsWith('"') && raw.includes('\\'))) throw new Error('.env 数据库值不支持反引号或双引号转义；特殊字符请使用单引号字面值。');
    if (!raw.startsWith("'") && !raw.startsWith('"')) {
      const comment = raw.search(/\s#/);
      const literal = comment < 0 ? raw : raw.slice(0, comment);
      if (literal.includes('#')) throw new Error('.env 数据库值中的 # 必须使用引号包裹，避免 Compose 与应用解析不同。');
    }
    entries.set(match[1], raw);
  }
  const values = parseEnv(text);
  // Compose interpolates dollar signs except in single-quoted values; Node does not.
  // Reject ambiguous entries instead of giving the application a different password.
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('NEW_DESIGN_DEV_DB_') || !value.includes('$')) continue;
    const literal = /^'([^']*)'\s*(?:#.*)?$/.exec(entries.get(key) ?? '');
    if (!literal || literal[1] !== value) throw new Error('.env 数据库值中的 $ 必须使用单引号包裹，不能依赖变量展开。');
  }
  const source = values.NEW_DESIGN_DEV_DB_DATA_SOURCE || 'new-design-postgres-data';
  return validateConfig({
    port: Number(values.NEW_DESIGN_DEV_DB_PORT),
    user: values.NEW_DESIGN_DEV_DB_USER,
    password: values.NEW_DESIGN_DEV_DB_PASSWORD,
    database: values.NEW_DESIGN_DEV_DB_NAME,
    bindAddress: values.NEW_DESIGN_DEV_DB_BIND_ADDRESS || '127.0.0.1',
    ...(source === 'new-design-postgres-data' ? {} : { dataDirectory: source }),
  });
}

function dockerEnvironment(config, base = process.env) {
  validateConfig(config);
  const target = resolveDockerTarget(config);
  return {
    ...base,
    NEW_DESIGN_DEV_DB_PORT: String(config.port),
    NEW_DESIGN_DEV_DB_USER: config.user,
    NEW_DESIGN_DEV_DB_PASSWORD: config.password,
    NEW_DESIGN_DEV_DB_NAME: config.database,
    NEW_DESIGN_DEV_DB_BIND_ADDRESS: target.bindAddress,
    NEW_DESIGN_DEV_DB_DATA_SOURCE: target.mountType === 'bind' ? target.source : 'new-design-postgres-data',
  };
}

function serializeDevelopmentEnvironment(config) {
  const entries = Object.entries(dockerEnvironment(config, {}));
  if (entries.some(([, value]) => /['\r\n\0]/.test(value))) throw new Error('旧配置含不能自动写入单引号环境文件的字符；请人工转写 .env，原配置未修改。');
  return '# Local development database; keep this file private.\n' + entries.map(([key, value]) => `${key}='${value}'`).join('\n') + '\n';
}

async function readDevelopmentConfig(root) {
  const file = path.join(root, '.env');
  const info = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') throw new Error('缺少 new-design/.env；已有配置请显式执行 initialize-development.cjs --import-runtime-json，勿重新初始化数据库。');
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16000) throw new Error('.env 必须是受控的普通文件。');
  return parseDevelopmentEnvironment(await fs.readFile(file, 'utf8'));
}

module.exports = { parseDevelopmentEnvironment, serializeDevelopmentEnvironment, readDevelopmentConfig, dockerEnvironment };

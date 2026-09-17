'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { serializeDevelopmentEnvironment } = require('./development/environment.cjs');
const root = path.resolve(__dirname, '..');
const environmentFile = path.join(root, '.env');
const legacyFile = path.join(root, '.data', 'runtime.json');
const exists = file => fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const run = args => new Promise((resolve, reject) => execFile('docker', args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(new Error('Docker 目标未能安全核对；没有生成配置。')) : resolve(stdout)));

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.log('新环境：--initialize-new 生成 .env，首次启动前编辑端口、监听地址及数据目录。已有 runtime.json：--import-runtime-json 原样转写为 .env，保留旧文件；不启动容器、不迁移数据、不生成新密码。');
    return;
  }
  if (args.length !== 1 || !['--initialize-new', '--import-runtime-json'].includes(args[0])) throw new Error('只接受 --initialize-new 或 --import-runtime-json。');
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('源码目录不是受控普通目录。');
  if (await exists(environmentFile)) throw new Error('.env 已存在；请直接维护该文件，不覆盖凭据。');
  const legacyInfo = await exists(legacyFile);
  let config;
  if (args[0] === '--import-runtime-json') {
    if (!legacyInfo?.isFile() || legacyInfo.isSymbolicLink() || legacyInfo.nlink !== 1 || legacyInfo.size > 16000) throw new Error('原 runtime.json 缺失或不是受控普通文件；停止转写。');
    try { config = JSON.parse(await fs.readFile(legacyFile, 'utf8')); }
    catch { throw new Error('原 runtime.json 无法解析；原配置未修改。'); }
  } else {
    if (legacyInfo) throw new Error('已有 runtime.json，请使用 --import-runtime-json 保留原密码和存储位置。');
    const [volumes, containers] = await Promise.all([run(['volume', 'ls', '--format', '{{.Name}}']), run(['container', 'ls', '--all', '--format', '{{.Names}}'])]);
    if (volumes.split(/\r?\n/).includes('ai-novel-new-design-pg17-data') || containers.split(/\r?\n/).includes('ai-novel-new-design-postgres-dev')) throw new Error('原开发卷或容器已存在；请恢复原 .env 或导入原 runtime.json，不生成新密码。');
    config = { port: 15433, user: 'new_design', password: crypto.randomBytes(32).toString('base64url'), database: 'new_design' };
  }
  const text = serializeDevelopmentEnvironment(config);
  const handle = await fs.open(environmentFile, 'wx', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  console.log('.env 已建立；后续启动和备份均读取此文件。原配置和数据库未修改，密码未输出。首次启动前核对监听地址、端口及数据目录。');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

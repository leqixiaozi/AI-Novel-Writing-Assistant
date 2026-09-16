import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { Pool } from "pg";
import type { PrivateRuntimeDiagnosticCheck, PrivateRuntimeDiagnostics } from "../../common/contracts";
import { migrations } from "./migrations";

interface DevelopmentRuntimeConfig {
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DevelopmentDatabaseRuntime {
  pool: Pool;
  postgresVersion: string;
  ageVersion: string;
  vectorVersion: string;
  pgTrgmVersion: string;
  port: number;
  migrationCount: number;
}

const COMPOSE_PROJECT = "ai-novel-new-design-dev";
const COMPOSE_FILE = path.resolve(__dirname, "../../../docker-compose.dev.yml");
const DEVELOPMENT_IMAGE = "ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6";
const RUNTIME_ROOT = path.resolve(__dirname, "../../..", ".data");
const CONFIG_PATH = path.join(RUNTIME_ROOT, "runtime.json");
let activeRuntime: DevelopmentDatabaseRuntime | null = null;
let startingRuntime: Promise<DevelopmentDatabaseRuntime> | null = null;

export function isDevelopmentDatabaseRuntimeEnabled(): boolean {
  return process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME === "1";
}

function runCommand(executable: string, args: string[], environment?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, env: environment ?? process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} 执行失败（${code ?? "unknown"}）：${(stderr || stdout).trim()}`));
    });
  });
}

async function readRuntimeConfig(): Promise<DevelopmentRuntimeConfig> {
  const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as DevelopmentRuntimeConfig;
  if (!Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535) throw new Error("开发数据库端口配置无效。");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parsed.user) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(parsed.database) || !parsed.password) {
    throw new Error("开发数据库配置字段无效。为保护已有数据，系统不会自动覆盖 runtime.json。");
  }
  return parsed;
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function startCompose(config: DevelopmentRuntimeConfig): Promise<void> {
  const dockerEnvironment = {
    ...process.env,
    NEW_DESIGN_DEV_DB_PORT: String(config.port),
    NEW_DESIGN_DEV_DB_USER: config.user,
    NEW_DESIGN_DEV_DB_PASSWORD: config.password,
    NEW_DESIGN_DEV_DB_NAME: config.database,
  };
  try {
    const imageExists = await runCommand("docker", ["image", "inspect", DEVELOPMENT_IMAGE], dockerEnvironment)
      .then(() => true)
      .catch(() => false);
    if (!imageExists) {
      await runCommand("docker", ["compose", "-f", COMPOSE_FILE, "-p", COMPOSE_PROJECT, "build", "postgres"], dockerEnvironment);
    }
    await runCommand("docker", ["compose", "-f", COMPOSE_FILE, "-p", COMPOSE_PROJECT, "up", "-d", "--no-build", "--pull", "never", "--wait", "postgres"], dockerEnvironment);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/dockerDesktopLinuxEngine|daemon|pipe/i.test(detail)) {
      throw new Error("Docker Desktop 尚未启动。开发数据库需要项目内的 AGE + pgvector 容器，请先启动 Docker Desktop 后重试。");
    }
    throw error;
  }
}

async function waitForDatabase(config: DevelopmentRuntimeConfig): Promise<Pool> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (await canConnect(config.port)) {
      const pool = new Pool({ host: "127.0.0.1", port: config.port, user: config.user, password: config.password, database: config.database, max: 8, application_name: "ai_novel_new_design_dev", connectionTimeoutMillis: 2000 });
      try {
        await pool.query("SELECT 1");
        return pool;
      } catch (error) {
        lastError = error;
        await pool.end().catch(() => undefined);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`AGE + pgvector 开发数据库在 60 秒内没有就绪：${lastError instanceof Error ? lastError.message : "端口不可用"}`);
}

async function ensureExtensions(pool: Pool): Promise<{ age: string; vector: string; pgTrgm: string }> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS age");
  await pool.query("LOAD 'age'");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  const result = await pool.query<{ extname: string; extversion: string }>("SELECT extname,extversion FROM pg_extension WHERE extname=ANY($1::text[])", [["age", "vector", "pg_trgm"]]);
  const versions = new Map(result.rows.map((row) => [row.extname, row.extversion]));
  if (!versions.get("age") || !versions.get("vector") || !versions.get("pg_trgm")) throw new Error("开发数据库没有完整加载 AGE、pgvector 和 pg_trgm。");
  return { age: versions.get("age")!, vector: versions.get("vector")!, pgTrgm: versions.get("pg_trgm")! };
}

async function applyMigrations(pool: Pool): Promise<number> {
  await pool.query("CREATE SCHEMA IF NOT EXISTS new_design");
  await pool.query("CREATE TABLE IF NOT EXISTS new_design.schema_migrations(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const migration of migrations) {
    const found = await pool.query("SELECT 1 FROM new_design.schema_migrations WHERE id=$1", [migration.id]);
    if (found.rowCount) continue;
    const sql = await fs.readFile(path.resolve(__dirname, "../../../migrations", migration.fileName), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO new_design.schema_migrations(id) VALUES($1) ON CONFLICT(id) DO NOTHING", [migration.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return Number((await pool.query("SELECT count(*) value FROM new_design.schema_migrations")).rows[0]?.value ?? 0);
}

async function initializeDevelopmentDatabaseRuntime(): Promise<DevelopmentDatabaseRuntime> {
  if (process.env.NEW_DESIGN_DATABASE_URL?.trim()) throw new Error("开发态不接受系统 PostgreSQL 连接串；只使用项目定义的 AGE + pgvector 数据库容器。");
  const config = await readRuntimeConfig();
  await startCompose(config);
  const pool = await waitForDatabase(config);
  try {
    const extensions = await ensureExtensions(pool);
    const migrationCount = await applyMigrations(pool);
    const version = await pool.query<{ server_version: string }>("SHOW server_version");
    activeRuntime = { pool, postgresVersion: version.rows[0]?.server_version ?? "unknown", ageVersion: extensions.age, vectorVersion: extensions.vector, pgTrgmVersion: extensions.pgTrgm, port: config.port, migrationCount };
    return activeRuntime;
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

export async function startDevelopmentDatabaseRuntime(): Promise<DevelopmentDatabaseRuntime> {
  if (activeRuntime) return activeRuntime;
  if (!startingRuntime) {
    startingRuntime = initializeDevelopmentDatabaseRuntime().finally(() => {
      startingRuntime = null;
    });
  }
  return startingRuntime;
}

export async function stopDevelopmentDatabaseRuntime(): Promise<void> {
  const runtime = activeRuntime;
  activeRuntime = null;
  if (runtime) await runtime.pool.end();
}

function check(key: string, status: PrivateRuntimeDiagnosticCheck["status"], summary: string, action: string): PrivateRuntimeDiagnosticCheck {
  return { key, status, summary, action };
}

export async function getDevelopmentRuntimeDiagnostics(): Promise<PrivateRuntimeDiagnostics> {
  const runtime = activeRuntime ?? await startDevelopmentDatabaseRuntime();
  const [queue, backup] = await Promise.all([
    runtime.pool.query("SELECT count(*) FILTER(WHERE status IN ('queued','leased','running','retry_scheduled','cancel_requested')) active, count(*) FILTER(WHERE status='dead_letter') dead FROM new_design.background_jobs"),
    runtime.pool.query("SELECT max(completed_at) latest FROM new_design.transfer_operations WHERE operation_kind='full_backup' AND status IN ('ready','archived')"),
  ]);
  const queueRow = queue.rows[0];
  return {
    status: { phase: "ready", packageAvailable: true, packageIntegrity: "unknown", runtimeId: "development-age-pgvector", manifestSha256: null, installationId: null, dataGeneration: "docker-volume", databaseReady: true, host: "127.0.0.1", port: runtime.port, versions: { application: "development", node: process.version, postgresql: runtime.postgresVersion, age: runtime.ageVersion, pgvector: runtime.vectorVersion, pgTrgm: runtime.pgTrgmVersion }, migrationsExpected: migrations.length, migrationsApplied: runtime.migrationCount, workerRuntime: "not_started", lastCleanShutdown: null, lastErrorCode: "", lastErrorSummary: "", logLocator: "logs/postgres.log", updatedAt: new Date().toISOString() },
    checks: [
      check("runtime.package", "warning", "开发环境使用项目 Dockerfile 构建的 PostgreSQL，不执行发布运行包 manifest 校验。", "正式打包前再装配并校验私有运行包。"),
      check("runtime.directories", "passed", "开发数据保存在 Docker 命名卷中。", "跨机器同步请使用数据导出或 pg_dump，不复制运行中的数据卷。"),
      check("runtime.extensions", "passed", `AGE ${runtime.ageVersion}，pgvector ${runtime.vectorVersion}，pg_trgm ${runtime.pgTrgmVersion}。`, ""),
      check("runtime.migrations", runtime.migrationCount === migrations.length ? "passed" : "failed", `已登记 ${runtime.migrationCount}/${migrations.length} 个迁移。`, "迁移不完整时查看容器日志。"),
      check("runtime.queue", Number(queueRow?.dead ?? 0) > 0 ? "warning" : "passed", `活动作业 ${Number(queueRow?.active ?? 0)}，死信 ${Number(queueRow?.dead ?? 0)}。`, "在运行维护中处理积压与死信。"),
      check("runtime.backup", backup.rows[0]?.latest ? "passed" : "warning", backup.rows[0]?.latest ? `最近完整备份：${new Date(String(backup.rows[0].latest)).toISOString()}` : "尚无可验证完整备份。", "跨机器开发前先完成数据导出或完整备份。"),
    ],
    checkedAt: new Date().toISOString(),
    releaseGateDebts: ["开发容器不等同于桌面发布运行包；正式发布仍需 manifest、离线二进制和许可证验收。"],
  };
}

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { migrations } from "./migrations";

interface RuntimeConfig {
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DatabaseRuntimeStatus {
  mode: "bundled" | "external";
  postgresVersion: string;
  database: string;
  host: string;
  port: number;
  dataDirectory: string | null;
}

const DEFAULT_DATABASE = "ai_novel_new_design";
const BUNDLED_PORT_START = 55432;
const BUNDLED_PORT_END = 55532;

let poolPromise: Promise<Pool> | null = null;
let runtimeStatus: DatabaseRuntimeStatus | null = null;
let bundledConfig: RuntimeConfig | null = null;
let bundledDataDirectory: string | null = null;
let shutdownRegistered = false;

function runCommand(executable: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      env: { ...process.env, LC_MESSAGES: "C" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(executable)} 执行失败（${code ?? "unknown"}）：${(stderr || stdout).trim()}`));
    });
  });
}

function resolveBundledBinaries(): { initdb: string; pgCtl: string } {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("新设计便携 PostgreSQL 当前仅支持 Windows x64。请设置 NEW_DESIGN_DATABASE_URL 连接真实 PostgreSQL。 ");
  }
  const entry = require.resolve("@embedded-postgres/windows-x64");
  const archiveBinDirectory = path.resolve(path.dirname(entry), "..", "native", "bin");
  const unpackedBinDirectory = archiveBinDirectory.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  const binDirectory = unpackedBinDirectory === archiveBinDirectory ? archiveBinDirectory : unpackedBinDirectory;
  return {
    initdb: path.join(binDirectory, "initdb.exe"),
    pgCtl: path.join(binDirectory, "pg_ctl.exe"),
  };
}

function resolveRuntimeRoot(): string {
  const explicit = process.env.NEW_DESIGN_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const appDataRoot = process.env.AI_NOVEL_APP_DATA_DIR?.trim();
  if (appDataRoot) return path.join(path.resolve(appDataRoot), "new-design");
  return path.resolve(__dirname, "../../..", ".data");
}

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

async function findAvailablePort(preferred?: number): Promise<number> {
  if (preferred && await canListen(preferred)) return preferred;
  for (let port = BUNDLED_PORT_START; port <= BUNDLED_PORT_END; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`新设计 PostgreSQL 无可用端口（${BUNDLED_PORT_START}-${BUNDLED_PORT_END}）。`);
}

async function readOrCreateRuntimeConfig(runtimeRoot: string): Promise<RuntimeConfig> {
  const configPath = path.join(runtimeRoot, "runtime.json");
  const dataDirectory = path.join(runtimeRoot, "postgres");
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as RuntimeConfig;
    if (!parsed.user || !parsed.password || !parsed.database || !Number.isInteger(parsed.port)) throw new Error("配置字段不完整");
    return parsed;
  } catch (error) {
    const dataExists = await fs.access(path.join(dataDirectory, "PG_VERSION")).then(() => true).catch(() => false);
    if (dataExists) {
      throw new Error(`检测到 PostgreSQL 数据但运行配置缺失或损坏：${configPath}。为保护数据，系统不会自动重置。`);
    }
    const config: RuntimeConfig = {
      port: await findAvailablePort(),
      user: "ai_novel_app",
      password: randomBytes(32).toString("base64url"),
      database: DEFAULT_DATABASE,
    };
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return config;
  }
}

async function initialiseCluster(initdb: string, dataDirectory: string, config: RuntimeConfig): Promise<void> {
  const versionPath = path.join(dataDirectory, "PG_VERSION");
  if (await fs.access(versionPath).then(() => true).catch(() => false)) return;
  if (await fs.access(dataDirectory).then(() => true).catch(() => false)) {
    const entries = await fs.readdir(dataDirectory);
    if (entries.length > 0) throw new Error(`PostgreSQL 数据目录未完成初始化且不为空：${dataDirectory}。请先备份后人工处理。`);
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  const passwordPath = path.join(path.dirname(dataDirectory), ".init-password");
  await fs.writeFile(passwordPath, `${config.password}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await runCommand(initdb, [
      `--pgdata=${dataDirectory}`,
      `--username=${config.user}`,
      `--pwfile=${passwordPath}`,
      "--auth-host=scram-sha-256",
      "--auth-local=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  } finally {
    await fs.rm(passwordPath, { force: true });
  }
}

async function isClusterRunning(pgCtl: string, dataDirectory: string): Promise<boolean> {
  return runCommand(pgCtl, ["status", "-D", dataDirectory]).then(() => true).catch(() => false);
}

async function startBundledPostgres(): Promise<Pool> {
  const runtimeRoot = resolveRuntimeRoot();
  const dataDirectory = path.join(runtimeRoot, "postgres");
  const logDirectory = path.join(runtimeRoot, "logs");
  const logPath = path.join(logDirectory, "postgres.log");
  const binaries = resolveBundledBinaries();
  const config = await readOrCreateRuntimeConfig(runtimeRoot);
  await fs.mkdir(logDirectory, { recursive: true });
  await initialiseCluster(binaries.initdb, dataDirectory, config);

  const running = await isClusterRunning(binaries.pgCtl, dataDirectory);
  if (!running) {
    config.port = await findAvailablePort(config.port);
    await fs.writeFile(path.join(runtimeRoot, "runtime.json"), `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await runCommand(binaries.pgCtl, [
      "start",
      "-D", dataDirectory,
      "-l", logPath,
      "-o", `-h 127.0.0.1 -p ${config.port}`,
      "-w",
      "-t", "30",
    ]);
  }

  const adminPool = new Pool({
    host: "127.0.0.1",
    port: config.port,
    user: config.user,
    password: config.password,
    database: "postgres",
    max: 1,
  });
  const exists = await adminPool.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists", [config.database]);
  if (!exists.rows[0]?.exists) {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
  }
  await adminPool.end();

  bundledConfig = config;
  bundledDataDirectory = dataDirectory;
  const pool = new Pool({
    host: "127.0.0.1",
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 8,
    application_name: "ai_novel_new_design",
  });
  const version = await pool.query<{ server_version: string }>("SHOW server_version");
  runtimeStatus = {
    mode: "bundled",
    postgresVersion: version.rows[0]?.server_version ?? "unknown",
    database: config.database,
    host: "127.0.0.1",
    port: config.port,
    dataDirectory,
  };
  registerShutdown();
  return pool;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function startExternalPostgres(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString, max: 8, application_name: "ai_novel_new_design" });
  const details = await pool.query<{ version: string; database: string; port: number }>(
    "SELECT current_setting('server_version') AS version, current_database() AS database, inet_server_port() AS port",
  );
  const row = details.rows[0];
  runtimeStatus = {
    mode: "external",
    postgresVersion: row?.version ?? "unknown",
    database: row?.database ?? "unknown",
    host: "configured",
    port: row?.port ?? 0,
    dataDirectory: null,
  };
  return pool;
}

async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query("CREATE SCHEMA IF NOT EXISTS new_design");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS new_design.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const migration of migrations) {
    const found = await pool.query("SELECT 1 FROM new_design.schema_migrations WHERE id = $1", [migration.id]);
    if (found.rowCount) continue;
    const client = await pool.connect();
    try {
      const migrationPath = path.resolve(__dirname, "../../../migrations", migration.fileName);
      const sql = await fs.readFile(migrationPath, "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO new_design.schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [migration.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function createPool(): Promise<Pool> {
  const external = process.env.NEW_DESIGN_DATABASE_URL?.trim();
  const pool = external ? await startExternalPostgres(external) : await startBundledPostgres();
  await applyMigrations(pool);
  return pool;
}

export async function getNewDesignPool(): Promise<Pool> {
  poolPromise ??= createPool().catch((error) => {
    poolPromise = null;
    throw error;
  });
  return poolPromise;
}

export async function getDatabaseRuntimeStatus(): Promise<DatabaseRuntimeStatus> {
  await getNewDesignPool();
  if (!runtimeStatus) throw new Error("新设计 PostgreSQL 尚未就绪。");
  return runtimeStatus;
}

export async function stopNewDesignDatabase(): Promise<void> {
  const pool = poolPromise ? await poolPromise.catch(() => null) : null;
  poolPromise = null;
  if (pool) await pool.end();
  if (bundledDataDirectory && bundledConfig) {
    const { pgCtl } = resolveBundledBinaries();
    if (await isClusterRunning(pgCtl, bundledDataDirectory)) {
      await runCommand(pgCtl, ["stop", "-D", bundledDataDirectory, "-m", "fast", "-w", "-t", "30"]);
    }
  }
  bundledConfig = null;
  bundledDataDirectory = null;
  runtimeStatus = null;
}

function registerShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const shutdown = () => {
    void stopNewDesignDatabase().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

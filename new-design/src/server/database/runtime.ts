import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import type { PrivateRuntimeDiagnostics } from "../../common/contracts";
import { recordRuntimeFailure, recordRuntimeReady, recordRuntimeStopRequested, type RuntimeAuditIdentity } from "../runtime/auditStore";
import { getPrivateRuntimeManager, type PrivateRuntimeConnection } from "../runtime/manager";
import { migrations } from "./migrations";

export interface DatabaseRuntimeStatus {mode:"bundled";postgresVersion:string;host:"127.0.0.1";port:number;dataLocator:string;runtimeId:string;manifestSha256:string;}
let poolPromise:Promise<Pool>|null=null,runtimeStatus:DatabaseRuntimeStatus|null=null,auditIdentity:RuntimeAuditIdentity|null=null,shutdownRegistered=false;

async function createPool():Promise<Pool>{
  if(process.env.NEW_DESIGN_DATABASE_URL?.trim())throw new Error("新设计不再接受系统数据库连接串；必须使用经 manifest 校验的应用私有运行包。");
  const manager=getPrivateRuntimeManager(),connection=await manager.startInfrastructure();
  let pool:Pool|null=null;
  try{
    await ensureApplicationDatabase(connection);
    pool=new Pool({host:connection.host,port:connection.port,user:connection.user,password:connection.password,database:connection.database,max:8,application_name:"ai_novel_new_design"});
    await ensureLockedExtensions(pool,connection);await applyMigrations(pool,connection);
    const versions=await pool.query<{server_version:string}>("SHOW server_version"),migrationCount=Number((await pool.query("SELECT count(*) value FROM new_design.schema_migrations")).rows[0]?.value??0);
    if(migrationCount!==migrations.length)throw new Error(`迁移登记数量不完整：预期 ${migrations.length}，实际 ${migrationCount}。`);
    await manager.markReady(migrationCount);
    auditIdentity={installationId:connection.installationId,dataGeneration:connection.dataGeneration,manifest:connection.manifest};await recordRuntimeReady(pool,auditIdentity);
    runtimeStatus={mode:"bundled",postgresVersion:versions.rows[0]?.server_version??"unknown",host:"127.0.0.1",port:connection.port,dataLocator:`database/generations/${path.basename(connection.dataDirectory)}`,runtimeId:connection.manifest.runtimeId,manifestSha256:connection.manifest.manifestSha256};registerShutdown();return pool;
  }catch(error){if(pool&&auditIdentity)await recordRuntimeFailure(pool,auditIdentity,error).catch(()=>undefined);if(pool)await pool.end().catch(()=>undefined);await manager.stopInfrastructure().catch(()=>undefined);auditIdentity=null;throw error;}
}

async function ensureApplicationDatabase(connection:PrivateRuntimeConnection):Promise<void>{
  if(!/^ndb_[a-f0-9]{16}$/.test(connection.database))throw new Error("私有数据库名称不符合固定格式。");
  const admin=new Pool({host:connection.host,port:connection.port,user:connection.user,password:connection.password,database:"postgres",max:1,application_name:"ai_novel_bootstrap"});
  try{const exists=await admin.query<{exists:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) exists",[connection.database]);if(!exists.rows[0]?.exists)await admin.query(`CREATE DATABASE "${connection.database}" TEMPLATE template0 ENCODING 'UTF8'`);}finally{await admin.end();}
}

async function ensureLockedExtensions(pool:Pool,connection:PrivateRuntimeConnection):Promise<void>{
  const expected={age:connection.manifest.components.age.version,vector:connection.manifest.components.pgvector.version,pg_trgm:connection.manifest.components.pgTrgm.version},names=Object.keys(expected);
  const available=await pool.query<{name:string;default_version:string}>("SELECT name,default_version FROM pg_available_extensions WHERE name=ANY($1::text[])",[names]),versions=new Map(available.rows.map(row=>[row.name,row.default_version]));
  for(const [name,version] of Object.entries(expected))if(versions.get(name)!==version)throw new Error(`扩展 ${name} 可用版本不是锁定版本 ${version}。`);
  await pool.query("CREATE EXTENSION IF NOT EXISTS age");await pool.query("LOAD 'age'");await pool.query("CREATE EXTENSION IF NOT EXISTS vector");await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  const installed=await pool.query<{extname:string;extversion:string}>("SELECT extname,extversion FROM pg_extension WHERE extname=ANY($1::text[])",[names]);for(const row of installed.rows)if(expected[row.extname as keyof typeof expected]!==row.extversion)throw new Error(`扩展 ${row.extname} 已安装版本与运行包不一致。`);if(installed.rowCount!==3)throw new Error("AGE、pgvector 或 pg_trgm 没有完整安装。");
}

async function applyMigrations(pool:Pool,connection:PrivateRuntimeConnection):Promise<void>{
  await pool.query("CREATE SCHEMA IF NOT EXISTS new_design");await pool.query("CREATE TABLE IF NOT EXISTS new_design.schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
  for(const migration of migrations){const found=await pool.query("SELECT 1 FROM new_design.schema_migrations WHERE id=$1",[migration.id]);if(found.rowCount)continue;const client=await pool.connect();try{const migrationPath=path.join(connection.packageRoot,"app","migrations",migration.fileName),sql=await fs.readFile(migrationPath,"utf8");await client.query("BEGIN");await client.query(sql);await client.query("INSERT INTO new_design.schema_migrations(id) VALUES($1) ON CONFLICT(id) DO NOTHING",[migration.id]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
}

export async function getNewDesignPool():Promise<Pool>{poolPromise??=createPool().catch(error=>{poolPromise=null;throw error;});return poolPromise;}
export async function getDatabaseRuntimeStatus():Promise<DatabaseRuntimeStatus>{await getNewDesignPool();if(!runtimeStatus)throw new Error("新设计 PostgreSQL 尚未就绪。");return runtimeStatus;}

export async function getPrivateRuntimeDiagnostics():Promise<PrivateRuntimeDiagnostics>{
  const manager=getPrivateRuntimeManager(),diagnostics=await manager.doctor(),pool=poolPromise?await poolPromise.catch(()=>null):null;if(!pool)return diagnostics;
  const [extensions,migrationsResult,queue,backup]=await Promise.all([pool.query<{extname:string;extversion:string}>("SELECT extname,extversion FROM pg_extension WHERE extname=ANY($1::text[])",[["age","vector","pg_trgm"]]),pool.query("SELECT count(*) value FROM new_design.schema_migrations"),pool.query("SELECT count(*) FILTER(WHERE status IN ('queued','leased','running','retry_scheduled','cancel_requested')) active,count(*) FILTER(WHERE status='dead_letter') dead FROM new_design.background_jobs"),pool.query("SELECT max(completed_at) latest FROM new_design.transfer_operations WHERE operation_kind='full_backup' AND status IN ('ready','archived')")]);
  const replace=(key:string,status:"passed"|"warning"|"failed"|"unavailable",summary:string,action:string)=>{const index=diagnostics.checks.findIndex(item=>item.key===key),value={key,status,summary,action};if(index>=0)diagnostics.checks[index]=value;else diagnostics.checks.push(value);};
  replace("runtime.extensions",extensions.rowCount===3?"passed":"failed",extensions.rowCount===3?extensions.rows.map(row=>`${row.extname} ${row.extversion}`).join("，"):"扩展数量不完整。","重新校验运行包版本组合后停止可写启动。");
  const applied=Number(migrationsResult.rows[0]?.value??0);replace("runtime.migrations",applied===migrations.length?"passed":"failed",`已登记 ${applied}/${migrations.length} 个迁移。`,"按顺序完成 001—041，不允许跳号。");
  const queueRow=queue.rows[0];replace("runtime.queue",Number(queueRow?.dead??0)>0?"warning":"passed",`活动作业 ${Number(queueRow?.active??0)}，死信 ${Number(queueRow?.dead??0)}。`,`使用 030 运行记录处理积压与死信。`);
  replace("runtime.backup",backup.rows[0]?.latest?"passed":"warning",backup.rows[0]?.latest?`最近完整备份：${new Date(String(backup.rows[0].latest)).toISOString()}`:"尚无可验证完整备份。","升级或恢复前先完成 031 完整备份和兼容预检。");return diagnostics;
}

export async function stopNewDesignDatabase():Promise<void>{const manager=getPrivateRuntimeManager(),pool=poolPromise?await poolPromise.catch(()=>null):null;poolPromise=null;await manager.setWorkerRuntime("draining").catch(()=>undefined);if(pool&&auditIdentity)await recordRuntimeStopRequested(pool,auditIdentity).catch(()=>undefined);if(pool)await pool.end();await manager.stopInfrastructure();runtimeStatus=null;auditIdentity=null;}
function registerShutdown():void{if(shutdownRegistered)return;shutdownRegistered=true;const shutdown=()=>{void stopNewDesignDatabase().finally(()=>process.exit(0));};process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);}

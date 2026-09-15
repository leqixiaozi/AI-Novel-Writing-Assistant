import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { PrivateRuntimeDiagnosticCheck, PrivateRuntimeDiagnostics, PrivateRuntimeStatus, RuntimePackageManifest } from "../../common/contracts";
import { NewDesignError } from "../domain/errors";
import { runControlledCommand, scrub, tightenWindowsAcl, verifyWindowsAcl } from "./command";
import { assertNoReparseChain, ensurePrivateRuntimeLayout, resolveDataGeneration, resolvePrivateRuntimeLayout, type PrivateRuntimeLayout } from "./layout";
import { resolvePackageFile, verifyRuntimePackage } from "./manifest";
import { acquireRuntimeLock, createBootstrapState, createRuntimeCredentials, readBootstrapState, readCredentials, writeBootstrapState, writeCredentials, type BootstrapState, type RuntimeCredentials } from "./state";

const PORT_START=55432,PORT_END=55532,MIN_DISK_BYTES=5*1024*1024*1024;
const RELEASE_GATE_DEBTS=["干净 Windows x64 离线安装与二进制/许可证装配","首次 initdb、随机凭据 ACL、本机监听与端口冲突","AGE/vector/pg_trgm 创建、LOAD 与 001—040 实库迁移","启动、停止、异常退出、重复启动与错误 PID 防误杀","030 runner 租约恢复与停机排空","031 备份恢复及数据库/附件一致性","同主版本与跨主版本升级、失败回滚","覆盖安装和卸载保留数据","长路径、中文用户目录、杀毒与权限限制","磁盘不足、性能与安全验证"];

export interface PrivateRuntimeConnection {host:"127.0.0.1";port:number;user:string;password:string;database:string;installationId:string;dataGeneration:string;dataDirectory:string;packageRoot:string;manifest:RuntimePackageManifest;}

export class PrivateRuntimeManager {
  readonly layout=resolvePrivateRuntimeLayout();

  async startInfrastructure():Promise<PrivateRuntimeConnection>{
    await this.prepareLockDirectory();const release=await acquireRuntimeLock(this.layout);
    try{
      const manifest=await verifyRuntimePackage(this.layout.packageRoot);await ensurePrivateRuntimeLayout(this.layout);await this.verifyDirectories();await this.ensureDiskSpace();
      let state=await readBootstrapState(this.layout),credentials=await readCredentials(this.layout);
      if(state&&!credentials)throw new NewDesignError("已存在数据世代但运行凭据缺失；拒绝生成无法解锁旧库的新口令。",503);
      if(!state&&credentials)throw new NewDesignError("存在孤立凭据但 bootstrap 状态缺失；拒绝覆盖。",503);
      if(!state&&(await fs.readdir(this.layout.databaseGenerationsDirectory)).length)throw new NewDesignError("发现没有 bootstrap 状态的数据世代；拒绝创建新库覆盖恢复线索。",503);
      if(state&&state.manifestSha256!==manifest.manifestSha256)throw new NewDesignError("运行包版本与当前数据世代不同；必须先执行受控 upgrade，不能直接可写启动。",503);
      if(state?.phase==="ready"||state?.phase==="starting"){
        const dataDirectory=resolveDataGeneration(this.layout,state.activeDataGeneration);await this.verifyGenerationOwner(dataDirectory,state);
        const identity=await this.readPostmasterIdentity(dataDirectory);
        if(identity&&identity.pid===state.postgresPid&&identity.startedAt===state.postgresStartedAt){await verifyWindowsAcl(this.layout.credentialsDirectory);await verifyWindowsAcl(path.join(this.layout.credentialsDirectory,"database.json"));return this.connection(state,credentials??raise("运行凭据缺失。"),manifest);}
        state={...state,phase:"failed",lastCleanShutdown:false,lastErrorCode:"unclean_runtime_identity",lastErrorSummary:"上次运行未正常结束且进程身份无法确认。"};await writeBootstrapState(this.layout,state);
        throw new NewDesignError("检测到非正常退出；请先运行 doctor，系统不会根据陈旧 PID 自动杀进程。",503);
      }
      if(state){const dataDirectory=resolveDataGeneration(this.layout,state.activeDataGeneration),identity=await this.readPostmasterIdentity(dataDirectory);if(identity)throw new NewDesignError("bootstrap 未登记为运行中，但数据世代仍有可确认的 PostgreSQL；请先执行受控 stop，禁止重复启动。",503);}
      const generation=state?.activeDataGeneration??`data-${randomHex(8)}`,port=await findAvailablePort(state?.port),nextState=state??createBootstrapState({runtimeId:manifest.runtimeId,manifestSha256:manifest.manifestSha256,dataGeneration:generation,port});
      credentials??=createRuntimeCredentials();await tightenWindowsAcl(this.layout.credentialsDirectory,true);await writeCredentials(this.layout,credentials);await tightenWindowsAcl(path.join(this.layout.credentialsDirectory,"database.json"),false);
      const dataDirectory=resolveDataGeneration(this.layout,generation),created=await this.initialiseCluster(manifest,dataDirectory,credentials,port);await this.ensureGenerationOwner(dataDirectory,nextState,created);
      await rotateLog(path.join(this.layout.logsDirectory,"postgres.log"));
      await writeBootstrapState(this.layout,{...nextState,phase:"starting",runtimeId:manifest.runtimeId,manifestSha256:manifest.manifestSha256,activeDataGeneration:generation,port,postgresPid:null,postgresStartedAt:null,lastCleanShutdown:false,lastErrorCode:"",lastErrorSummary:""});
      const pgCtl=resolvePackageFile(this.layout.packageRoot,"bin/pg_ctl.exe"),bin=path.dirname(pgCtl),log=path.join(this.layout.logsDirectory,"postgres.log");
      await runControlledCommand(pgCtl,["start","-D",dataDirectory,"-l",log,"-o",`-h 127.0.0.1 -p ${port}`,"-w","-t","30"],{packageBin:bin,timeoutMs:45000});
      const identity=await this.readPostmasterIdentity(dataDirectory);if(!identity)throw new NewDesignError("PostgreSQL 已返回启动但无法确认 PID/start time/data dir。",503);
      const started={...nextState,phase:"starting" as const,runtimeId:manifest.runtimeId,manifestSha256:manifest.manifestSha256,activeDataGeneration:generation,port,postgresPid:identity.pid,postgresStartedAt:identity.startedAt,lastCleanShutdown:false,lastErrorCode:"",lastErrorSummary:""};await writeBootstrapState(this.layout,started);
      await this.withPassfile(credentials,port,passfile=>runControlledCommand(resolvePackageFile(this.layout.packageRoot,"bin/pg_isready.exe"),["-h","127.0.0.1","-p",String(port),"-U",credentials.user,"-d","postgres"],{packageBin:bin,passfile,timeoutMs:10000}));
      return this.connection(started,credentials,manifest);
    }catch(error){await this.captureUnexpectedPostmasterIdentity().catch(()=>undefined);await this.recordFailure(error).catch(()=>undefined);throw error;}finally{await release();}
  }

  async markReady(migrationsApplied:number):Promise<void>{const release=await acquireRuntimeLock(this.layout);try{const state=raiseIfNull(await readBootstrapState(this.layout),"bootstrap 状态不存在。");if(state.phase!=="starting")throw new NewDesignError("运行时不在可完成启动的阶段。",409);await writeBootstrapState(this.layout,{...state,phase:"ready",migrationsApplied,workerRuntime:"not_started",lastErrorCode:"",lastErrorSummary:""});}finally{await release();}}
  async setWorkerRuntime(status:BootstrapState["workerRuntime"]):Promise<void>{const release=await acquireRuntimeLock(this.layout);try{const state=raiseIfNull(await readBootstrapState(this.layout),"bootstrap 状态不存在。");await writeBootstrapState(this.layout,{...state,workerRuntime:status});}finally{await release();}}

  async stopInfrastructure():Promise<void>{
    await this.prepareLockDirectory();const release=await acquireRuntimeLock(this.layout);
    try{const state=await readBootstrapState(this.layout);if(!state)return;const dataDirectory=resolveDataGeneration(this.layout,state.activeDataGeneration);if(state.phase==="stopped"){const unexpected=await this.readPostmasterIdentity(dataDirectory);if(!unexpected)return;throw new NewDesignError("状态为 stopped 但数据世代仍有活动 postmaster；缺少已登记启动身份，拒绝停止以防误杀。",503);}const manifest=await verifyRuntimePackage(this.layout.packageRoot);await this.verifyGenerationOwner(dataDirectory,state);const identity=await this.readPostmasterIdentity(dataDirectory);
      if(!identity||identity.pid!==state.postgresPid||identity.startedAt!==state.postgresStartedAt)throw new NewDesignError("PostgreSQL 进程身份与 bootstrap 状态不符，拒绝停止以防误杀。",503);
      await writeBootstrapState(this.layout,{...state,phase:"stopping",workerRuntime:"draining"});
      const pgCtl=resolvePackageFile(this.layout.packageRoot,"bin/pg_ctl.exe");await runControlledCommand(pgCtl,["stop","-D",dataDirectory,"-m","fast","-w","-t","30"],{packageBin:path.dirname(pgCtl),timeoutMs:45000});
      if(await this.readPostmasterIdentity(dataDirectory))throw new NewDesignError("PostgreSQL 在停止期限后仍存在，未执行强制 kill。",503);
      await writeBootstrapState(this.layout,{...state,phase:"stopped",postgresPid:null,postgresStartedAt:null,workerRuntime:"stopped",lastCleanShutdown:true,lastErrorCode:"",lastErrorSummary:""});void manifest;
    }catch(error){await this.recordFailure(error).catch(()=>undefined);throw error;}finally{await release();}
  }

  async status():Promise<PrivateRuntimeStatus>{
    let manifest:RuntimePackageManifest|null=null,integrity:PrivateRuntimeStatus["packageIntegrity"]="unknown",packageAvailable=false,errorCode="",errorSummary="";
    try{manifest=await verifyRuntimePackage(this.layout.packageRoot);integrity="verified";packageAvailable=true;}catch(error){integrity="failed";errorCode="runtime_package_unavailable";errorSummary=scrub(error instanceof Error?error.message:String(error));}
    let state:BootstrapState|null=null;try{state=await readBootstrapState(this.layout);}catch(error){errorCode="bootstrap_state_invalid";errorSummary=scrub(error instanceof Error?error.message:String(error));}
    return{phase:state?.phase??"unavailable",packageAvailable,packageIntegrity:integrity,runtimeId:manifest?.runtimeId??state?.runtimeId??null,manifestSha256:manifest?.manifestSha256??state?.manifestSha256??null,installationId:state?.installationId??null,dataGeneration:state?.activeDataGeneration??null,databaseReady:state?.phase==="ready",host:"127.0.0.1",port:state?.port??null,versions:manifest?{application:manifest.components.application.version,node:manifest.components.application.nodeVersion,postgresql:manifest.components.postgresql.version,age:manifest.components.age.version,pgvector:manifest.components.pgvector.version,pgTrgm:manifest.components.pgTrgm.version}:null,migrationsExpected:40,migrationsApplied:state?.migrationsApplied??null,workerRuntime:state?.workerRuntime??"not_started",lastCleanShutdown:state?.lastCleanShutdown??null,lastErrorCode:errorCode||state?.lastErrorCode||"",lastErrorSummary:errorSummary||state?.lastErrorSummary||"",logLocator:"logs/postgres.log",updatedAt:state?.updatedAt??null};
  }

  async doctor():Promise<PrivateRuntimeDiagnostics>{
    const checks:PrivateRuntimeDiagnosticCheck[]=[],status=await this.status();
    checks.push(check("runtime.package",status.packageIntegrity==="verified"?"passed":"failed",status.packageIntegrity==="verified"?"运行包 manifest 与逐文件 SHA-256 完整。":"运行包不存在或完整性校验失败。","重新执行离线受控装配，不能从系统 PATH 回退。"));
    try{await this.inspectDirectories();checks.push(check("runtime.directories","passed","应用数据目录分区存在且未发现符号链接。",""));}catch(error){checks.push(check("runtime.directories","failed",scrub(String(error)),"修复应用专属数据目录权限或重解析点。"));}
    try{await verifyWindowsAcl(this.layout.credentialsDirectory);const credentialFile=path.join(this.layout.credentialsDirectory,"database.json");if(await fs.access(credentialFile).then(()=>true).catch(()=>false))await verifyWindowsAcl(credentialFile);checks.push(check("runtime.acl","passed","凭据目录与凭据文件 ACL 结构可验证。","发布验收仍需确认只有应用用户具备读取权限。"));}catch(error){checks.push(check("runtime.acl","failed",scrub(String(error)),"重新收紧凭据 ACL；不得把口令复制到日志或命令行。"));}
    try{const root=await fs.lstat(this.layout.dataRoot).catch(()=>null);if(!root)throw new NewDesignError("应用数据目录尚未初始化。",503);await this.ensureDiskSpace();checks.push(check("runtime.disk","passed","可用磁盘空间达到最低启动门槛。",""));}catch(error){checks.push(check("runtime.disk","failed",scrub(String(error)),"释放至少 5 GiB 后重试。"));}
    const state=await readBootstrapState(this.layout).catch(()=>null);
    if(state?.postgresPid){const dataDirectory=resolveDataGeneration(this.layout,state.activeDataGeneration),identity=await this.readPostmasterIdentity(dataDirectory),owned=await this.isGenerationOwned(dataDirectory,state);checks.push(check("runtime.process_identity",owned&&identity&&identity.pid===state.postgresPid&&identity.startedAt===state.postgresStartedAt?"passed":"failed",owned&&identity?"运行实例 token、data dir、PID 与启动时间一致。":"没有可确认的本应用 PostgreSQL 身份。","不要手工 kill；确认数据世代后再由受控 stop 处理。"));if(status.packageIntegrity==="verified"&&identity){const pgReady=resolvePackageFile(this.layout.packageRoot,"bin/pg_isready.exe"),result=await runControlledCommand(pgReady,["-h","127.0.0.1","-p",String(state.port),"-t","5"],{packageBin:path.dirname(pgReady),timeoutMs:7000,allowFailure:true});checks.push(check("runtime.pg_isready",result.code===0?"passed":"failed",result.code===0?"PostgreSQL 本机端口接受连接。":"PostgreSQL 本机端口未通过 pg_isready。","查看脱敏日志并执行受控 stop/start。"));}}
    else checks.push(check("runtime.process_identity","unavailable","数据库当前没有登记运行实例。","需要使用 start 启动。"));
    checks.push(check("runtime.extensions",status.databaseReady?"warning":"unavailable",status.databaseReady?"需要由数据库层补充 AGE/vector/pg_trgm 实际版本检查。":"数据库未 ready，无法读取扩展。","运行完整 doctor 数据库检查。"));
    checks.push(check("runtime.migrations",status.migrationsApplied===40?"passed":"unavailable",status.migrationsApplied===40?"001—040 已登记。":"无法确认 001—040 实库迁移。","数据库 ready 后核对 schema_migrations。"));
    checks.push(check("runtime.queue",status.workerRuntime==="ready"?"passed":"unavailable","后台运行器状态由 030 runner 生命周期回报。","启动后确认消费者与积压。"));
    checks.push(check("runtime.backup","unavailable","最近完整备份必须从 031 传输账本查询。","升级或恢复前先完成可验证完整备份。"));
    return{status,checks,checkedAt:new Date().toISOString(),releaseGateDebts:RELEASE_GATE_DEBTS};
  }

  private connection(state:BootstrapState,credentials:RuntimeCredentials,manifest:RuntimePackageManifest):PrivateRuntimeConnection{return{host:"127.0.0.1",port:state.port,user:credentials.user,password:credentials.password,database:credentials.database,installationId:state.installationId,dataGeneration:state.activeDataGeneration,dataDirectory:resolveDataGeneration(this.layout,state.activeDataGeneration),packageRoot:this.layout.packageRoot,manifest};}
  private async prepareLockDirectory():Promise<void>{await fs.mkdir(this.layout.dataRoot,{recursive:true});await assertNoReparseChain(this.layout.dataRoot,this.layout.dataRoot);await fs.mkdir(this.layout.lockDirectory,{recursive:true});await assertNoReparseChain(this.layout.dataRoot,this.layout.lockDirectory);}
  private async verifyDirectories():Promise<void>{for(const dir of [this.layout.credentialsDirectory,this.layout.databaseGenerationsDirectory,this.layout.attachmentsDirectory,this.layout.backupsDirectory,this.layout.importsDirectory,this.layout.logsDirectory,this.layout.runtimeDirectory])await assertNoReparseChain(this.layout.dataRoot,dir);}
  private async inspectDirectories():Promise<void>{for(const dir of [this.layout.dataRoot,this.layout.bootstrapDirectory,this.layout.credentialsDirectory,this.layout.lockDirectory,this.layout.databaseGenerationsDirectory,this.layout.attachmentsDirectory,this.layout.backupsDirectory,this.layout.importsDirectory,this.layout.logsDirectory,this.layout.runtimeDirectory]){const stat=await fs.lstat(dir).catch(()=>null);if(!stat?.isDirectory()||stat.isSymbolicLink())throw new NewDesignError("应用数据目录未初始化、类型不符或包含重解析点。",503);await assertNoReparseChain(this.layout.dataRoot,dir);}}
  private async ensureDiskSpace():Promise<void>{const info=await fs.statfs(this.layout.dataRoot);if(Number(info.bavail)*Number(info.bsize)<MIN_DISK_BYTES)throw new NewDesignError("应用数据盘可用空间不足 5 GiB。",503);}
  private async initialiseCluster(manifest:RuntimePackageManifest,dataDirectory:string,credentials:RuntimeCredentials,port:number):Promise<boolean>{
    const version=path.join(dataDirectory,"PG_VERSION"),exists=await fs.access(version).then(()=>true).catch(()=>false);if(exists){const actual=(await fs.readFile(version,"utf8")).trim();if(actual!==String(manifest.components.postgresql.major))throw new NewDesignError("数据目录 PostgreSQL 主版本与运行包不匹配，必须升级 staging。",503);}else{
    const existing=await fs.readdir(dataDirectory).catch(()=>[]);if(existing.length)throw new NewDesignError("目标数据世代非空且未完成初始化，拒绝覆盖。",503);await fs.mkdir(dataDirectory,{recursive:true});await assertNoReparseChain(this.layout.dataRoot,dataDirectory);
    const passwordFile=path.join(this.layout.runtimeDirectory,`.init-password.${process.pid}.${randomHex(8)}`);await fs.writeFile(passwordFile,`${credentials.password}\n`,{encoding:"utf8",flag:"wx",mode:0o600});await tightenWindowsAcl(passwordFile,false);
    const initdb=resolvePackageFile(this.layout.packageRoot,"bin/initdb.exe");try{await runControlledCommand(initdb,["--pgdata",dataDirectory,"--username",credentials.user,"--pwfile",passwordFile,"--auth-host","scram-sha-256","--auth-local","scram-sha-256","--encoding","UTF8","--locale","C"],{packageBin:path.dirname(initdb),timeoutMs:120000});}finally{await fs.unlink(passwordFile).catch(()=>undefined);}
    }
    await fs.writeFile(path.join(dataDirectory,"postgresql.auto.conf"),[`listen_addresses = '127.0.0.1'`,`port = ${port}`,"password_encryption = 'scram-sha-256'","logging_collector = on","log_rotation_age = '1d'","log_rotation_size = '10MB'","max_connections = 40","shared_preload_libraries = ''",""].join("\n"),{encoding:"utf8"});
    await fs.writeFile(path.join(dataDirectory,"pg_hba.conf"),["# Managed by AI Novel Writing Assistant; local TCP only.","host all all 127.0.0.1/32 scram-sha-256","host all all ::1/128 reject",""].join("\n"),{encoding:"utf8"});
    return !exists;
  }
  private async readPostmasterIdentity(dataDirectory:string):Promise<{pid:number;startedAt:string}|null>{const raw=await fs.readFile(path.join(dataDirectory,"postmaster.pid"),"utf8").catch(()=>null);if(!raw)return null;const lines=raw.split(/\r?\n/),pid=Number(lines[0]),recordedData=path.resolve(lines[1]??"").toLocaleLowerCase("en-US"),expectedData=path.resolve(dataDirectory).toLocaleLowerCase("en-US"),startedEpoch=Number(lines[2]);if(!Number.isInteger(pid)||pid<=0||recordedData!==expectedData||!Number.isFinite(startedEpoch))return null;try{process.kill(pid,0);}catch{return null;}return{pid,startedAt:new Date(startedEpoch*1000).toISOString()};}
  private async ensureGenerationOwner(dataDirectory:string,state:BootstrapState,allowCreate:boolean):Promise<void>{const file=path.join(dataDirectory,".ai-novel-runtime-owner.json"),value={formatVersion:1,installationId:state.installationId,instanceToken:state.instanceToken,dataGeneration:state.activeDataGeneration};if(allowCreate)await fs.writeFile(file,`${JSON.stringify(value)}\n`,{encoding:"utf8",flag:"wx",mode:0o600});else await this.verifyGenerationOwner(dataDirectory,state);}
  private async verifyGenerationOwner(dataDirectory:string,state:BootstrapState):Promise<void>{if(!await this.isGenerationOwned(dataDirectory,state))throw new NewDesignError("数据世代缺少匹配的应用运行实例 token，拒绝启停。",503);}
  private async isGenerationOwned(dataDirectory:string,state:BootstrapState):Promise<boolean>{try{const file=path.join(dataDirectory,".ai-novel-runtime-owner.json"),stat=await fs.lstat(file).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink())return false;const value=JSON.parse(await fs.readFile(file,"utf8")) as Record<string,unknown>;return value.formatVersion===1&&value.installationId===state.installationId&&value.instanceToken===state.instanceToken&&value.dataGeneration===state.activeDataGeneration;}catch{return false;}}
  private async withPassfile<T>(credentials:RuntimeCredentials,port:number,action:(passfile:string)=>Promise<T>):Promise<T>{const file=path.join(this.layout.runtimeDirectory,`.pgpass.${process.pid}.${randomHex(8)}`);await fs.writeFile(file,`127.0.0.1:${port}:*:${credentials.user}:${credentials.password}\n`,{encoding:"utf8",flag:"wx",mode:0o600});await tightenWindowsAcl(file,false);try{return await action(file);}finally{await fs.unlink(file).catch(()=>undefined);}}
  private async captureUnexpectedPostmasterIdentity():Promise<void>{const state=await readBootstrapState(this.layout).catch(()=>null);if(!state||state.postgresPid)return;const identity=await this.readPostmasterIdentity(resolveDataGeneration(this.layout,state.activeDataGeneration));if(identity)await writeBootstrapState(this.layout,{...state,postgresPid:identity.pid,postgresStartedAt:identity.startedAt,lastCleanShutdown:false});}
  private async recordFailure(error:unknown):Promise<void>{const state=await readBootstrapState(this.layout).catch(()=>null);if(state)await writeBootstrapState(this.layout,{...state,phase:"failed",lastCleanShutdown:false,lastErrorCode:"runtime_start_failed",lastErrorSummary:scrub(error instanceof Error?error.message:String(error))});}
}

let singleton:PrivateRuntimeManager|null=null;export function getPrivateRuntimeManager():PrivateRuntimeManager{return singleton??=new PrivateRuntimeManager();}
function check(key:string,status:PrivateRuntimeDiagnosticCheck["status"],summary:string,action:string):PrivateRuntimeDiagnosticCheck{return{key,status,summary,action};}
function randomHex(bytes:number):string{return randomBytes(bytes).toString("hex");}
function raise(message:string):never{throw new NewDesignError(message,503);}function raiseIfNull<T>(value:T|null,message:string):T{return value??raise(message);}
async function findAvailablePort(preferred?:number):Promise<number>{if(preferred&&preferred>=PORT_START&&preferred<=PORT_END&&await canListen(preferred))return preferred;for(let port=PORT_START;port<=PORT_END;port+=1)if(await canListen(port))return port;throw new NewDesignError(`没有可用私有数据库端口（${PORT_START}-${PORT_END}）。`,503);}
function canListen(port:number):Promise<boolean>{return new Promise(resolve=>{const server=net.createServer();server.unref();server.once("error",()=>resolve(false));server.listen({host:"127.0.0.1",port},()=>server.close(()=>resolve(true)));});}
async function rotateLog(file:string):Promise<void>{const stat=await fs.lstat(file).catch(()=>null);if(!stat||stat.size<10*1024*1024)return;for(let index=5;index>=1;index-=1){const current=`${file}.${index}`,next=`${file}.${index+1}`;if(index===5)await fs.unlink(current).catch(()=>undefined);else if(await fs.access(current).then(()=>true).catch(()=>false))await fs.rename(current,next);}await fs.rename(file,`${file}.1`);}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrivateRuntimePhase } from "../../common/contracts";
import { NewDesignError } from "../domain/errors";
import type { PrivateRuntimeLayout } from "./layout";

export interface BootstrapState {
  formatVersion:1;
  installationId:string;
  instanceToken:string;
  phase:PrivateRuntimePhase;
  runtimeId:string;
  manifestSha256:string;
  activeDataGeneration:string;
  port:number;
  postgresPid:number|null;
  postgresStartedAt:string|null;
  workerRuntime:"not_started"|"starting"|"ready"|"draining"|"stopped"|"failed";
  migrationsApplied:number|null;
  lastCleanShutdown:boolean;
  lastErrorCode:string;
  lastErrorSummary:string;
  updatedAt:string;
}

interface StateEnvelope {formatVersion:1;payload:BootstrapState;checksum:string;}
export interface RuntimeCredentials {formatVersion:1;user:string;password:string;database:string;}

export async function readBootstrapState(layout:PrivateRuntimeLayout):Promise<BootstrapState|null>{
  const file=path.join(layout.bootstrapDirectory,"state.json"),raw=await fs.readFile(file,"utf8").catch(()=>null);if(!raw)return null;
  const envelope=JSON.parse(raw) as StateEnvelope;if(envelope.formatVersion!==1||!envelope.payload||envelope.checksum!==hash(envelope.payload))throw new NewDesignError("本机 bootstrap 状态损坏，已停止可写启动。",503);
  validateBootstrapState(envelope.payload);
  return envelope.payload;
}

export async function writeBootstrapState(layout:PrivateRuntimeLayout,state:BootstrapState):Promise<void>{
  const payload={...state,updatedAt:new Date().toISOString()},envelope:StateEnvelope={formatVersion:1,payload,checksum:hash(payload)};
  await atomicWrite(path.join(layout.bootstrapDirectory,"state.json"),`${JSON.stringify(envelope,null,2)}\n`);
}

export function createBootstrapState(input:{runtimeId:string;manifestSha256:string;dataGeneration:string;port:number}):BootstrapState{return{formatVersion:1,installationId:randomUUID(),instanceToken:randomBytes(32).toString("hex"),phase:"stopped",runtimeId:input.runtimeId,manifestSha256:input.manifestSha256,activeDataGeneration:input.dataGeneration,port:input.port,postgresPid:null,postgresStartedAt:null,workerRuntime:"not_started",migrationsApplied:null,lastCleanShutdown:true,lastErrorCode:"",lastErrorSummary:"",updatedAt:new Date().toISOString()};}
export function createRuntimeCredentials():RuntimeCredentials{return{formatVersion:1,user:`ndu_${randomBytes(8).toString("hex")}`,password:randomBytes(48).toString("base64url"),database:`ndb_${randomBytes(8).toString("hex")}`};}
export async function readCredentials(layout:PrivateRuntimeLayout):Promise<RuntimeCredentials|null>{const raw=await fs.readFile(path.join(layout.credentialsDirectory,"database.json"),"utf8").catch(()=>null);if(!raw)return null;const parsed=JSON.parse(raw) as RuntimeCredentials;if(parsed.formatVersion!==1||!/^ndu_[a-f0-9]{16}$/.test(parsed.user)||!/^ndb_[a-f0-9]{16}$/.test(parsed.database)||parsed.password.length<48)throw new NewDesignError("私有数据库凭据文件损坏。",503);return parsed;}
export async function writeCredentials(layout:PrivateRuntimeLayout,value:RuntimeCredentials):Promise<void>{await atomicWrite(path.join(layout.credentialsDirectory,"database.json"),`${JSON.stringify(value)}\n`,0o600);}

export async function acquireRuntimeLock(layout:PrivateRuntimeLayout):Promise<()=>Promise<void>>{
  const file=path.join(layout.lockDirectory,"runtime.lock"),token=randomBytes(24).toString("hex"),record={formatVersion:1,pid:process.pid,startedAt:new Date().toISOString(),token};
  try{await fs.writeFile(file,`${JSON.stringify(record)}\n`,{encoding:"utf8",flag:"wx",mode:0o600});}
  catch{const current=JSON.parse(await fs.readFile(file,"utf8").catch(()=>"{}")) as {pid?:number};if(current.pid&&isPidAlive(current.pid))throw new NewDesignError("另一个新设计运行管理器正在工作。",409);const stat=await fs.lstat(file).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink())throw new NewDesignError("运行互斥锁不是受控普通文件。",503);await fs.unlink(file);await fs.writeFile(file,`${JSON.stringify(record)}\n`,{encoding:"utf8",flag:"wx",mode:0o600});}
  return async()=>{const current=JSON.parse(await fs.readFile(file,"utf8").catch(()=>"{}")) as {token?:string};if(current.token===token)await fs.unlink(file).catch(()=>undefined);};
}

export async function atomicWrite(file:string,content:string,mode=0o600):Promise<void>{const temp=path.join(path.dirname(file),`.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);try{await fs.writeFile(temp,content,{encoding:"utf8",flag:"wx",mode});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>undefined);}}
function validateBootstrapState(value:BootstrapState):void{const phases:PrivateRuntimePhase[]=["unavailable","stopped","starting","ready","stopping","upgrading","restoring","degraded","failed"],workers:BootstrapState["workerRuntime"][]=["not_started","starting","ready","draining","stopped","failed"];if(value.formatVersion!==1||!phases.includes(value.phase)||!workers.includes(value.workerRuntime)||!/^[0-9a-f-]{36}$/i.test(value.installationId)||!/^[a-f0-9]{64}$/.test(value.instanceToken)||!/^[A-Za-z0-9._-]{8,160}$/.test(value.runtimeId)||!/^[a-f0-9]{64}$/.test(value.manifestSha256)||!/^data-[a-f0-9]{16}$/.test(value.activeDataGeneration)||!Number.isInteger(value.port)||value.port<1||value.port>65535||(value.postgresPid!==null&&(!Number.isInteger(value.postgresPid)||value.postgresPid<=0))||(value.postgresStartedAt!==null&&Number.isNaN(Date.parse(value.postgresStartedAt)))||(value.migrationsApplied!==null&&(!Number.isInteger(value.migrationsApplied)||value.migrationsApplied<0))||Number.isNaN(Date.parse(value.updatedAt))||value.lastErrorCode.length>120||value.lastErrorSummary.length>2000)throw new NewDesignError("本机 bootstrap 状态字段无效，已停止可写启动。",503);}
function isPidAlive(pid:number):boolean{try{process.kill(pid,0);return true;}catch{return false;}}
function hash(value:unknown):string{return createHash("sha256").update(stable(value),"utf8").digest("hex");}
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}

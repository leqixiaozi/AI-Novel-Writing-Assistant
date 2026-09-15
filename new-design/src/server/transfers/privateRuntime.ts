import { promises as fs } from "node:fs";
import path from "node:path";
import type { TransferOperationKind, TransferRuntimeAvailability } from "../../common/contracts";
import { NewDesignError } from "../domain/errors";

export interface ArchiveEntryCandidate {
  path:string;
  kind:"file"|"directory"|"symlink"|"reparse_point";
  compressedBytes:number;
  uncompressedBytes:number;
}

export interface ArchiveSafetyLimits {
  maxEntryCount:number;
  maxSingleFileBytes:number;
  maxTotalBytes:number;
  maxCompressionRatio:number;
}

export interface ValidatedArchiveEntry extends Omit<ArchiveEntryCandidate,"path"|"kind"> {
  path:string;
  normalizedCasePath:string;
  kind:"file"|"directory";
  compressionRatio:number;
}

const WINDOWS_DEVICE=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SAFE_SEGMENT=/^[A-Za-z0-9._-]+$/;

export function normalizePortableLocator(value:string):string {
  if(!value||value.length>480||value.includes("\\")||value.startsWith("/")||/^[A-Za-z]:/.test(value)||value.includes("//"))throw new NewDesignError("归档路径不是受控相对路径。",422);
  const segments=value.split("/");
  for(const segment of segments)if(!segment||segment==="."||segment===".."||segment.endsWith(".")||segment.endsWith(" ")||WINDOWS_DEVICE.test(segment)||!SAFE_SEGMENT.test(segment))throw new NewDesignError("归档路径包含危险或跨平台不兼容的名称。",422);
  return segments.join("/");
}

export function validateArchiveEntries(entries:ArchiveEntryCandidate[],limits:ArchiveSafetyLimits):ValidatedArchiveEntry[]{
  if(entries.length>limits.maxEntryCount)throw new NewDesignError("归档文件数量超过本次操作冻结的安全上限。",422);
  const seen=new Set<string>();
  let total=0;
  return entries.map((entry)=>{
    if(entry.kind==="symlink"||entry.kind==="reparse_point")throw new NewDesignError("归档包含符号链接或重解析点，已拒绝导入。",422);
    if(!Number.isSafeInteger(entry.compressedBytes)||!Number.isSafeInteger(entry.uncompressedBytes)||entry.compressedBytes<0||entry.uncompressedBytes<0)throw new NewDesignError("归档条目大小无效。",422);
    if(entry.kind==="file"&&entry.uncompressedBytes>limits.maxSingleFileBytes)throw new NewDesignError("归档包含超过单文件限制的内容。",422);
    total+=entry.uncompressedBytes;
    if(total>limits.maxTotalBytes)throw new NewDesignError("归档解压后的总大小超过安全上限。",422);
    const portablePath=normalizePortableLocator(entry.path),normalizedCasePath=portablePath.toLocaleLowerCase("en-US");
    if(seen.has(normalizedCasePath))throw new NewDesignError("归档包含仅大小写不同的重复路径。",422);
    seen.add(normalizedCasePath);
    const ratio=entry.uncompressedBytes===0?1:entry.compressedBytes===0?Number.POSITIVE_INFINITY:entry.uncompressedBytes/entry.compressedBytes;
    if(ratio>limits.maxCompressionRatio)throw new NewDesignError("归档条目的压缩比超过安全上限，可能是压缩炸弹。",422);
    return{...entry,path:portablePath,normalizedCasePath,kind:entry.kind,compressionRatio:ratio};
  });
}

function resolvePrivateRuntimeRoot():string {
  const explicit=process.env.NEW_DESIGN_DATA_DIR?.trim();
  if(explicit)return path.resolve(explicit);
  const appDataRoot=process.env.AI_NOVEL_APP_DATA_DIR?.trim();
  if(appDataRoot)return path.join(path.resolve(appDataRoot),"new-design");
  return path.resolve(__dirname,"../../..",".data");
}

function resolveBundledBinDirectory():string {
  const entry=require.resolve("@embedded-postgres/windows-x64");
  const archived=path.resolve(path.dirname(entry),"..","native","bin");
  return archived.replace(`${path.sep}app.asar${path.sep}`,`${path.sep}app.asar.unpacked${path.sep}`);
}

export async function getTransferRuntimeAvailability():Promise<TransferRuntimeAvailability>{
  let databaseToolsAvailable=false;
  try {
    const bin=resolveBundledBinDirectory();
    databaseToolsAvailable=await Promise.all(["pg_dump.exe","pg_restore.exe"].map((name)=>fs.access(path.join(bin,name)).then(()=>true).catch(()=>false))).then((items)=>items.every(Boolean));
  } catch {
    databaseToolsAvailable=false;
  }
  return{available:false,code:"package_runtime_unavailable",detail:databaseToolsAvailable?"数据库维护工具可定位，但受控归档打包/解包与原子切换运行时尚未接入。":"受控归档运行时与匹配 PostgreSQL 主版本的维护工具尚未完整接入。",packageRuntimeVersion:null,databaseToolsAvailable,restoreSwitchAvailable:false};
}

export async function requireTransferRuntime(operationKind:TransferOperationKind):Promise<void>{
  const availability=await getTransferRuntimeAvailability();
  if(!availability.available)throw new NewDesignError(`${operationKind} 当前不可执行：${availability.detail}`,503);
}

export async function resolveFixedDatabaseTool(tool:"pg_dump"|"pg_restore"):Promise<string>{
  const executable=path.join(resolveBundledBinDirectory(),`${tool}.exe`);
  const stat=await fs.lstat(executable).catch(()=>null);
  if(!stat?.isFile()||stat.isSymbolicLink())throw new NewDesignError(`固定维护工具 ${tool} 不可用。`,503);
  return executable;
}

export async function resolveReadyArtifactFile(locator:string):Promise<string>{
  const portable=normalizePortableLocator(locator),root=path.join(resolvePrivateRuntimeRoot(),"transfers"),candidate=path.resolve(root,...portable.split("/"));
  if(candidate!==root&&!candidate.startsWith(`${root}${path.sep}`))throw new NewDesignError("产物路径越过受控目录。",422);
  const realRoot=await fs.realpath(root).catch(()=>root),stat=await fs.lstat(candidate).catch(()=>null);
  if(!stat?.isFile()||stat.isSymbolicLink())throw new NewDesignError("可下载产物不存在或不是普通文件。",409);
  const realCandidate=await fs.realpath(candidate);
  if(realCandidate!==realRoot&&!realCandidate.startsWith(`${realRoot}${path.sep}`))throw new NewDesignError("产物路径经过重解析点越过受控目录。",422);
  return realCandidate;
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { TransferOperationKind, TransferRuntimeAvailability } from "../../common/contracts";
import { NewDesignError } from "../domain/errors";
import { resolvePrivateRuntimeLayout } from "../runtime/layout";
import { resolvePackageFile, verifyRuntimePackage } from "../runtime/manifest";

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

export async function getTransferRuntimeAvailability():Promise<TransferRuntimeAvailability>{
  try{const layout=resolvePrivateRuntimeLayout(),manifest=await verifyRuntimePackage(layout.packageRoot),databaseToolsAvailable=await Promise.all(["bin/pg_dump.exe","bin/pg_restore.exe"].map(name=>fs.access(resolvePackageFile(layout.packageRoot,name)).then(()=>true).catch(()=>false))).then(items=>items.every(Boolean)),archiveAvailable=await fs.access(resolvePackageFile(layout.packageRoot,"bin/bsdtar.exe")).then(()=>true).catch(()=>false);return{available:databaseToolsAvailable&&archiveAvailable,code:databaseToolsAvailable&&archiveAvailable?"ready":"package_runtime_unavailable",detail:databaseToolsAvailable&&archiveAvailable?"受控归档与数据库维护工具已经通过运行包 manifest 校验。":"运行包缺少受控归档或数据库维护工具。",packageRuntimeVersion:manifest.runtimeId,databaseToolsAvailable,restoreSwitchAvailable:false};}catch(error){return{available:false,code:"package_runtime_unavailable",detail:error instanceof Error?error.message:"私有运行包不可用。",packageRuntimeVersion:null,databaseToolsAvailable:false,restoreSwitchAvailable:false};}
}

export async function requireTransferRuntime(operationKind:TransferOperationKind):Promise<void>{
  const availability=await getTransferRuntimeAvailability();
  if(!availability.available||(operationKind==="full_restore"&&!availability.restoreSwitchAvailable))throw new NewDesignError(`${operationKind} 当前不可执行：${operationKind==="full_restore"&&!availability.restoreSwitchAvailable?"受控恢复 staging 与原子切换执行器尚未接入。":availability.detail}`,503);
}

export async function resolveFixedDatabaseTool(tool:"pg_dump"|"pg_restore"):Promise<string>{
  const layout=resolvePrivateRuntimeLayout();await verifyRuntimePackage(layout.packageRoot);const executable=resolvePackageFile(layout.packageRoot,`bin/${tool}.exe`);
  const stat=await fs.lstat(executable).catch(()=>null);
  if(!stat?.isFile()||stat.isSymbolicLink())throw new NewDesignError(`固定维护工具 ${tool} 不可用。`,503);
  return executable;
}

export async function resolveReadyArtifactFile(locator:string):Promise<string>{
  const portable=normalizePortableLocator(locator);if(!portable.startsWith("backups/"))throw new NewDesignError("下载只允许访问已完成的备份产物。",422);const root=resolvePrivateRuntimeLayout().dataRoot,candidate=path.resolve(root,...portable.split("/"));
  if(candidate!==root&&!candidate.startsWith(`${root}${path.sep}`))throw new NewDesignError("产物路径越过受控目录。",422);
  const realRoot=await fs.realpath(root).catch(()=>root),stat=await fs.lstat(candidate).catch(()=>null);
  if(!stat?.isFile()||stat.isSymbolicLink())throw new NewDesignError("可下载产物不存在或不是普通文件。",409);
  const realCandidate=await fs.realpath(candidate);
  if(realCandidate!==realRoot&&!realCandidate.startsWith(`${realRoot}${path.sep}`))throw new NewDesignError("产物路径经过重解析点越过受控目录。",422);
  return realCandidate;
}

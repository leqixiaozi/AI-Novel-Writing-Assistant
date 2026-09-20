import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { RuntimePackageFile, RuntimePackageManifest } from "../../common/contracts";
import {migrations as registeredMigrations} from "../database/migrations";
import { NewDesignError } from "../domain/errors";

const REQUIRED=["bin/node.exe","bin/initdb.exe","bin/pg_ctl.exe","bin/pg_isready.exe","bin/pg_dump.exe","bin/pg_restore.exe","bin/postgres.exe","bin/psql.exe","bin/bsdtar.exe","lib/age.dll","lib/vector.dll","share/extension/age.control","share/extension/age--1.6.0.sql","share/extension/vector.control","share/extension/vector--0.8.6.sql","share/extension/pg_trgm.control","share/extension/pg_trgm--1.6.sql","licenses/PostgreSQL.txt","licenses/Apache-AGE.txt","licenses/pgvector.txt","licenses/embedded-postgres-MIT.txt","licenses/NOTICE.md","licenses/libarchive.txt","licenses/Node.js.txt","app/server/index.js","app/server/runtime/cli.js","app/client/index.html","app/scripts/runtime.ps1","app/scripts/start.ps1","app/scripts/stop.ps1","app/scripts/status.ps1","app/scripts/doctor.ps1","app/scripts/backup.ps1","app/scripts/upgrade.ps1","app/migrations/001_card_kernel.sql","app/migrations/083_character_dialogue.sql"];
const MANUAL_MIGRATIONS=["084_world_packages.sql", "085_character_resource_backfill.sql", "087_stable_resource_supplements.sql", "088_stable_resource_supplement_candidates.sql", "089_resource_supplement_impact_reviews.sql", "090_resource_supplement_integrity.sql", "091_resource_supplement_correction_origins.sql", "092_resource_supplement_formal_commits.sql", "093_resource_supplement_correction_candidates.sql", "094_resource_supplement_correction_commits.sql", "095_chapter_quality_requests.sql", "096_public_character_profiles.sql", "097_public_character_workshop.sql", "098_image_prompt_preparation.sql", "099_dependency_creation_record_guards.sql", "100_image_reply_native_checksum.sql", "101_character_author_trials.sql", "102_character_author_influences.sql", "103_public_title_factory.sql", "104_book_content_history.sql", "105_database_model_credentials.sql"];
const SAFE=/^[A-Za-z0-9._/-]+$/;
const PREFIXES=["bin/","lib/","share/","licenses/","app/server/","app/client/","app/scripts/","app/migrations/"];
const LICENSES=["PostgreSQL","Apache-2.0","PostgreSQL-pgvector","BSD-2-Clause","MIT"];

export async function verifyRuntimePackage(packageRoot:string):Promise<RuntimePackageManifest>{
  if(process.platform!=="win32"||process.arch!=="x64")throw new NewDesignError("私有运行包只支持 Windows x64。",503);
  const manifestPath=path.join(packageRoot,"runtime-manifest.json"),manifestStat=await fs.lstat(manifestPath).catch(()=>null);if(!manifestStat?.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>4*1024*1024)throw new NewDesignError("私有运行包 manifest 不存在或不是受控普通文件；禁止从系统 PostgreSQL 回退。",503);
  const manifest=JSON.parse(await fs.readFile(manifestPath,"utf8")) as RuntimePackageManifest;
  validateManifestShape(manifest);
  const {manifestSha256,...unsigned}=manifest;
  if(digest(unsigned)!==manifestSha256)throw new NewDesignError("私有运行包 manifest 校验失败。",503);
  const seen=new Set<string>(),realRoot=await fs.realpath(packageRoot);
  for(const entry of manifest.files){
    validateEntry(entry);const key=entry.path.toLowerCase();if(seen.has(key))throw new NewDesignError("私有运行包存在大小写碰撞路径。",503);seen.add(key);
    const file=resolvePackageFile(packageRoot,entry.path),stat=await fs.lstat(file).catch(()=>null);
    if(!stat?.isFile()||stat.isSymbolicLink()||stat.size!==entry.byteSize)throw new NewDesignError(`私有运行包文件缺失或大小不符：${entry.path}`,503);
    const realFile=await fs.realpath(file);if(!realFile.startsWith(`${realRoot}${path.sep}`))throw new NewDesignError(`私有运行包文件经过重解析点逃逸：${entry.path}`,503);
    if(await sha256File(realFile)!==entry.sha256)throw new NewDesignError(`私有运行包文件校验失败：${entry.path}`,503);
  }
  for(const required of REQUIRED)if(!seen.has(required.toLowerCase()))throw new NewDesignError(`私有运行包缺少必需文件：${required}`,503);
  validateRuntimeMigrationFiles(manifest);
  if(manifest.components.postgresql.major!==17||manifest.components.age.postgresMajor!==17||manifest.components.pgvector.postgresMajor!==17||manifest.components.pgTrgm.postgresMajor!==17)throw new NewDesignError("PostgreSQL 与扩展主版本组合不兼容。",503);
  if(manifest.components.application.version!=="0.1.0"||manifest.components.application.nodeVersion!=="24.19.0"||manifest.components.postgresql.version!=="17.6"||manifest.components.age.version!=="1.6.0"||manifest.components.pgvector.version!=="0.8.6"||manifest.components.pgTrgm.version!=="1.6")throw new NewDesignError("私有运行包组件版本不符合锁定规格。",503);
  return manifest;
}

export function validateRuntimeMigrationFiles(manifest:Pick<RuntimePackageManifest,"files"|"migrationRange">):void{
  const requiredMigrations=registeredMigrations.map(item=>`app/migrations/${item.fileName}`).sort();
  const includedMigrations=manifest.files.filter(item=>item.path.startsWith('app/migrations/')&&!item.path.startsWith('app/migrations/manual/')).map(item=>item.path).sort();
  if(manifest.migrationRange.first!==registeredMigrations[0].fileName||manifest.migrationRange.last!==registeredMigrations.at(-1)!.fileName||manifest.migrationRange.count!==registeredMigrations.length||JSON.stringify(includedMigrations)!==JSON.stringify(requiredMigrations))throw new NewDesignError("\u79c1\u6709\u8fd0\u884c\u5305\u9ed8\u8ba4\u8fc1\u79fb\u5fc5\u987b\u4e0e\u5b9e\u9645\u6ce8\u518c\u9010\u9879\u4e00\u81f4\uff1b\u624b\u52a8\u8fc1\u79fb\u53ea\u80fd\u72ec\u7acb\u653e\u5728 manual \u76ee\u5f55\uff0c\u4e0d\u8ba1\u5165\u542f\u52a8\u6e05\u5355\u3002",503);
  const manualFiles=manifest.files.filter(item=>item.path.startsWith('app/migrations/manual/')).map(item=>item.path).sort();
  if(JSON.stringify(manualFiles)!==JSON.stringify(MANUAL_MIGRATIONS.map(name=>'app/migrations/manual/'+name).sort()))throw new NewDesignError("\u624b\u52a8\u8fc1\u79fb\u4ea4\u4ed8\u6587\u4ef6\u4e0e\u9501\u5b9a\u6e05\u5355\u4e0d\u4e00\u81f4\u3002",503);
}

export function resolvePackageFile(packageRoot:string,relative:string):string{
  if(!safeRelative(relative))throw new NewDesignError("私有运行包包含危险路径。",503);
  const target=path.resolve(packageRoot,...relative.split("/"));if(target===packageRoot||!target.startsWith(`${packageRoot}${path.sep}`))throw new NewDesignError("私有运行包路径越界。",503);return target;
}

function validateManifestShape(value:RuntimePackageManifest):void{if(!value||value.formatVersion!==1||value.platform!=="win32"||value.architecture!=="x64"||!/^[A-Za-z0-9._-]{8,160}$/.test(value.runtimeId)||!/^[A-Za-z0-9._-]{8,160}$/.test(value.specId)||!value.components?.postgresql||!value.components?.age||!value.components?.pgvector||!value.components?.pgTrgm||!value.components?.application||!value.components?.archive||!value.migrationRange||!Array.isArray(value.files)||value.files.length<1||value.files.length>10000||Number.isNaN(Date.parse(value.createdAt))||!/^[a-f0-9]{64}$/.test(value.manifestSha256))throw new NewDesignError("私有运行包 manifest 格式无效。",503);}
function validateEntry(value:RuntimePackageFile):void{if(!value||!safeRelative(value.path)||!PREFIXES.some(prefix=>value.path.startsWith(prefix))||!Number.isSafeInteger(value.byteSize)||value.byteSize<0||!/^[a-f0-9]{64}$/.test(value.sha256)||!["postgresql","age","pgvector","pg_trgm","archive","application","license"].includes(value.component)||!LICENSES.includes(value.licenseId))throw new NewDesignError("私有运行包文件记录无效。",503);}
function safeRelative(value:string):boolean{return Boolean(value&&value.length<=480&&SAFE.test(value)&&!value.startsWith("/")&&!value.includes("//")&&!value.split("/").some(item=>!item||item==="."||item===".."||/[ .]$/.test(item)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(item)));}
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}
function digest(value:unknown):string{return createHash("sha256").update(stable(value),"utf8").digest("hex");}
function sha256File(file:string):Promise<string>{return new Promise((resolve,reject)=>{const hash=createHash("sha256"),stream=createReadStream(file);stream.on("error",reject);stream.on("data",chunk=>hash.update(chunk));stream.on("end",()=>resolve(hash.digest("hex")));});}

#!/usr/bin/env node
"use strict";

const crypto=require("node:crypto");
const fs=require("node:fs");
const fsp=fs.promises;
const path=require("node:path");

const root=path.resolve(__dirname,"..");
let spec;

main().catch(error=>{process.stderr.write(`运行包装配失败：${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});

async function main(){
  spec=JSON.parse(await fsp.readFile(path.join(root,"runtime","runtime-package.spec.json"),"utf8"));
  const args=parseArgs(process.argv.slice(2));
  const sourceRoot=path.resolve(args["--source-root"]),outputRoot=path.resolve(args["--output-root"]),sourceManifestPath=path.resolve(args["--source-manifest"]);
  if(overlaps(sourceRoot,outputRoot))throw new Error("受控源目录与输出目录不能相同或互相包含。");
  await assertDirectory(sourceRoot,"受控源目录");
  await assertOrdinaryFile(sourceManifestPath,"source manifest");if((await fsp.stat(sourceManifestPath)).size>4*1024*1024)throw new Error("source manifest 超过 4 MiB 安全上限。");
  const sourceManifest=JSON.parse(await fsp.readFile(sourceManifestPath,"utf8"));
  validateSourceManifest(sourceManifest);
  await assertEmptyOrMissing(outputRoot);
  await fsp.mkdir(outputRoot,{recursive:true});
  for(const entry of sourceManifest.files){
    const source=await resolveContainedFile(sourceRoot,entry.sourcePath),target=resolveContained(outputRoot,entry.targetPath);
    const stat=await fsp.stat(source);
    if(stat.size!==entry.byteSize)throw new Error(`${entry.sourcePath} 大小与锁定清单不一致。`);
    if(await sha256File(source)!==entry.sha256)throw new Error(`${entry.sourcePath} SHA-256 与锁定清单不一致。`);
    await fsp.mkdir(path.dirname(target),{recursive:true});
    await fsp.copyFile(source,target,fs.constants.COPYFILE_EXCL);
    if(await sha256File(target)!==entry.sha256)throw new Error(`${entry.targetPath} 复制后校验失败。`);
  }
  const files=[...sourceManifest.files].map(({targetPath,component,licenseId,byteSize,sha256})=>({path:targetPath,component,licenseId,byteSize,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  const manifest={formatVersion:1,runtimeId:`${spec.specId}-${digest({components:spec.components,files}).slice(0,16)}`,specId:spec.specId,platform:spec.platform,architecture:spec.architecture,components:spec.components,migrationRange:spec.migrationRange,files,createdAt:new Date().toISOString()};
  manifest.manifestSha256=digest(manifest);
  await atomicWrite(path.join(outputRoot,"runtime-manifest.json"),`${JSON.stringify(manifest,null,2)}\n`);
  process.stdout.write(`运行包已装配：${manifest.runtimeId}\n文件：${files.length}\nmanifest SHA-256：${manifest.manifestSha256}\n`);
}

function parseArgs(values){
  if(values.includes("--help")||values.includes("-h")){process.stdout.write("用法：node assemble-runtime.cjs --source-root <dir> --source-manifest <json> --output-root <empty-dir>\n只从显式 source manifest 复制白名单文件，不联网、不扫描 PATH。\n");process.exit(0);}
  const allowed=new Set(["--source-root","--source-manifest","--output-root"]),result={};
  for(let i=0;i<values.length;i+=2){const key=values[i],value=values[i+1];if(!allowed.has(key)||!value||value.startsWith("--"))throw new Error(`未知或缺失参数：${key??"<empty>"}`);if(result[key])throw new Error(`参数重复：${key}`);result[key]=value;}
  for(const key of allowed)if(!result[key])throw new Error(`缺少参数 ${key}`);
  return result;
}

function validateSourceManifest(value){
  if(!value||value.formatVersion!==1||value.specId!==spec.specId||!value.components||!Array.isArray(value.files)||value.files.length<1||value.files.length>10000)throw new Error("source manifest 格式、specId 或文件数量不匹配。");
  if(stable(value.components)!==stable(spec.components))throw new Error("组件版本组合与 runtime-package.spec.json 不匹配。");
  const seen=new Set();
  for(const entry of value.files){
    if(!entry||!safeRelative(entry.sourcePath)||!safeRelative(entry.targetPath)||!Number.isSafeInteger(entry.byteSize)||entry.byteSize<0||!/^[a-f0-9]{64}$/.test(entry.sha256)||!["postgresql","age","pgvector","pg_trgm","archive","application","license"].includes(entry.component)||!["PostgreSQL","Apache-2.0","PostgreSQL-pgvector","BSD-2-Clause","MIT"].includes(entry.licenseId))throw new Error("source manifest 包含无效文件记录。");
    const key=entry.targetPath.toLowerCase();if(seen.has(key))throw new Error(`目标路径大小写碰撞：${entry.targetPath}`);seen.add(key);
    if(!spec.requiredPrefixes.some(prefix=>entry.targetPath.startsWith(prefix)))throw new Error(`目标路径不在白名单：${entry.targetPath}`);
  }
  for(const required of spec.requiredFiles)if(!seen.has(required.toLowerCase()))throw new Error(`缺少必需文件：${required}`);
  const migrations=value.files.filter(item=>item.targetPath.startsWith("app/migrations/")&&/^app\/migrations\/\d{3}_.+\.sql$/.test(item.targetPath)).map(item=>Number(item.targetPath.slice(15,18))).sort((a,b)=>a-b);
  if(migrations.length!==spec.migrationRange.count||migrations.some((number,index)=>number!==index+1))throw new Error(`迁移必须从 001 连续到 ${String(spec.migrationRange.count).padStart(3,"0")}，不得缺号或重复。`);
}

function safeRelative(value){return typeof value==="string"&&value.length<=480&&/^[A-Za-z0-9._/-]+$/.test(value)&&!value.startsWith("/")&&!value.includes("//")&&!value.split("/").some(part=>!part||part==="."||part===".."||/[ .]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part));}
function overlaps(left,right){const a=left.toLocaleLowerCase("en-US"),b=right.toLocaleLowerCase("en-US");return a===b||a.startsWith(`${b}${path.sep}`)||b.startsWith(`${a}${path.sep}`);}
function resolveContained(base,relative){if(!safeRelative(relative))throw new Error(`不安全相对路径：${relative}`);const target=path.resolve(base,...relative.split("/"));if(target===base||!target.startsWith(`${base}${path.sep}`))throw new Error(`路径越过受控目录：${relative}`);return target;}
async function resolveContainedFile(base,relative){const file=resolveContained(base,relative),stat=await fsp.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`源文件不是普通文件：${relative}`);const realBase=await fsp.realpath(base),realFile=await fsp.realpath(file);if(!realFile.startsWith(`${realBase}${path.sep}`))throw new Error(`源文件经过重解析点逃逸：${relative}`);return realFile;}
async function assertDirectory(value,label){const stat=await fsp.lstat(value).catch(()=>null);if(!stat?.isDirectory()||stat.isSymbolicLink())throw new Error(`${label}不存在或不是普通目录。`);}
async function assertOrdinaryFile(value,label){const stat=await fsp.lstat(value).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink())throw new Error(`${label}不存在或不是普通文件。`);}
async function assertEmptyOrMissing(value){const stat=await fsp.lstat(value).catch(()=>null);if(!stat)return;if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("输出位置必须是不存在或空的普通目录。");if((await fsp.readdir(value)).length)throw new Error("输出目录非空；assembler 不会覆盖或清理已有内容。");}
function stable(value){if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}
function digest(value){return crypto.createHash("sha256").update(stable(value),"utf8").digest("hex");}
function sha256File(file){return new Promise((resolve,reject)=>{const hash=crypto.createHash("sha256"),stream=fs.createReadStream(file);stream.on("error",reject);stream.on("data",chunk=>hash.update(chunk));stream.on("end",()=>resolve(hash.digest("hex")));});}
async function atomicWrite(file,content){const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;try{await fsp.writeFile(temp,content,{encoding:"utf8",flag:"wx"});await fsp.rename(temp,file);}finally{await fsp.unlink(temp).catch(()=>undefined);}}

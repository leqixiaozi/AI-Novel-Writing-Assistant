import { promises as fs } from "node:fs";
import path from "node:path";
import { NewDesignError } from "../domain/errors";

export interface PrivateRuntimeLayout {
  packageRoot:string;
  dataRoot:string;
  bootstrapDirectory:string;
  credentialsDirectory:string;
  lockDirectory:string;
  databaseGenerationsDirectory:string;
  attachmentsDirectory:string;
  backupsDirectory:string;
  importsDirectory:string;
  logsDirectory:string;
  runtimeDirectory:string;
}

export function resolvePrivateRuntimeLayout():PrivateRuntimeLayout{
  const container=path.resolve(__dirname,"../../..").replace(`${path.sep}app.asar${path.sep}`,`${path.sep}app.asar.unpacked${path.sep}`),packageRoot=path.basename(container).toLocaleLowerCase("en-US")==="runtime-package"?container:path.join(container,"runtime-package");
  const hostDataRoot=process.env.AI_NOVEL_APP_DATA_DIR?.trim();
  const localAppData=process.env.LOCALAPPDATA?.trim();if(!hostDataRoot&&!localAppData)throw new NewDesignError("无法确定安装目录外的 Windows 应用数据目录，拒绝把数据库写入程序目录。",503);
  const dataRoot=hostDataRoot?path.join(path.resolve(hostDataRoot),"new-design"):path.join(path.resolve(localAppData!),"AI-Novel-Writing-Assistant-v2","new-design");
  return{packageRoot,dataRoot,bootstrapDirectory:path.join(dataRoot,"bootstrap"),credentialsDirectory:path.join(dataRoot,"credentials"),lockDirectory:path.join(dataRoot,"locks"),databaseGenerationsDirectory:path.join(dataRoot,"database","generations"),attachmentsDirectory:path.join(dataRoot,"attachments"),backupsDirectory:path.join(dataRoot,"backups"),importsDirectory:path.join(dataRoot,"imports"),logsDirectory:path.join(dataRoot,"logs"),runtimeDirectory:path.join(dataRoot,"runtime")};
}

export async function ensurePrivateRuntimeLayout(layout:PrivateRuntimeLayout):Promise<void>{
  for(const directory of [layout.dataRoot,layout.bootstrapDirectory,layout.credentialsDirectory,layout.lockDirectory,layout.databaseGenerationsDirectory,layout.attachmentsDirectory,layout.backupsDirectory,layout.importsDirectory,layout.logsDirectory,layout.runtimeDirectory]){
    await assertContained(layout.dataRoot,directory);
    const existing=await fs.lstat(directory).catch(()=>null);
    if(existing&&(!existing.isDirectory()||existing.isSymbolicLink()))throw new NewDesignError("私有运行目录包含文件或重解析点，已停止启动。",503);
    await fs.mkdir(directory,{recursive:true});
  }
  await assertNoReparseChain(layout.dataRoot,layout.dataRoot);
}

export function resolveDataGeneration(layout:PrivateRuntimeLayout,generation:string):string{
  if(!/^data-[a-f0-9]{16}$/.test(generation))throw new NewDesignError("数据世代标识无效。",422);
  return contained(layout.databaseGenerationsDirectory,generation);
}

export function contained(root:string,...segments:string[]):string{
  const target=path.resolve(root,...segments);
  if(target===root||!target.startsWith(`${root}${path.sep}`))throw new NewDesignError("路径越过应用私有目录。",422);
  return target;
}

export async function assertNoReparseChain(root:string,target:string):Promise<void>{
  await assertContained(root,target);
  let cursor=target;
  while(cursor!==root){
    const stat=await fs.lstat(cursor).catch(()=>null);
    if(stat?.isSymbolicLink())throw new NewDesignError("私有运行路径包含符号链接或重解析点。",503);
    cursor=path.dirname(cursor);
  }
  const rootStat=await fs.lstat(root).catch(()=>null);
  if(rootStat?.isSymbolicLink())throw new NewDesignError("私有数据根目录不能是符号链接或重解析点。",503);
  if(rootStat){
    const realRoot=await fs.realpath(root),realTarget=await fs.realpath(target);
    if(realTarget!==realRoot&&!realTarget.startsWith(`${realRoot}${path.sep}`))throw new NewDesignError("私有运行路径经过重解析点越过数据根目录。",503);
  }
}

async function assertContained(root:string,target:string):Promise<void>{const resolvedRoot=path.resolve(root),resolvedTarget=path.resolve(target);if(resolvedTarget!==resolvedRoot&&!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`))throw new NewDesignError("路径越过应用私有目录。",422);}

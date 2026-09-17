'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const config=path.join(root,'.data','runtime.json');
const run=(args)=>new Promise((resolve,reject)=>execFile('docker',args,{windowsHide:true,maxBuffer:1024*1024},(error,stdout)=>error?reject(new Error('Docker目标未能安全核对；没有生成开发配置。请检查Docker Desktop。')):resolve(stdout)));
async function main(){
 const args=process.argv.slice(2);if(args.length===0||args[0]==='--help'){console.log('计划：仅新机器且原开发配置、容器、卷均不存在时，node scripts/initialize-development.cjs --initialize-new。已有机器保留原.data/runtime.json，不生成新密码。未执行Docker或写入。');return;}
 if(args.length!==1||args[0]!=='--initialize-new')throw new Error('只接受显式 --initialize-new；没有改写已有配置。');
 const rootInfo=await fs.lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||await fs.realpath(root)!==root)throw new Error('源码目录不是受控普通目录。');
 const exists=await fs.lstat(config).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(exists)throw new Error('原开发配置已经存在；为保护已有数据，本命令不会读取、覆盖或改密码。');
 const [volumes,containers]=await Promise.all([run(['volume','ls','--format','{{.Name}}']),run(['container','ls','--all','--format','{{.Names}}'])]);
 if(volumes.split(/\r?\n/).includes('ai-novel-new-design-pg17-data')||containers.split(/\r?\n/).includes('ai-novel-new-design-postgres-dev'))throw new Error('原开发卷或容器已经存在，不能把此机器当成新机器。请恢复原开发配置，不生成新密码。');
 const directory=path.dirname(config);try{await fs.mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const directoryInfo=await fs.lstat(directory);if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink()||await fs.realpath(directory)!==directory)throw new Error('开发配置目录不是受控普通目录。');
 const handle=await fs.open(config,'wx',0o600);try{await handle.writeFile(JSON.stringify({port:55432,user:'new_design',password:crypto.randomBytes(32).toString('base64url'),database:'new_design'},null,2)+'\n');await handle.sync();}finally{await handle.close();}
 console.log('新机器开发配置已建立。未启动数据库、未迁移；密码未输出。此文件只留本机，不加入Git；Windows请限制.data目录访问权限。下一步明确重建Docker镜像并启动本包。');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});

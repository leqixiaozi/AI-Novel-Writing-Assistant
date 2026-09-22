'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {spawn}=require('node:child_process');
const appRoot=path.resolve(__dirname,'..');
const container='ai-novel-new-design-postgres-dev',volume='ai-novel-new-design-pg17-data',image='ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6';
const roots=['data/assets','data/ai-receipts'];
class DevelopmentDataError extends Error {}
const fail=message=>new DevelopmentDataError(message);
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function safeRelative(value){return typeof value==='string'&&value.length>0&&value.length<=480&&!value.includes('\\')&&!value.includes(':')&&!value.startsWith('/')&&!/[\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!/[<>"|?*]/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));}
function parseArguments(values){
 const mode=values[0];if(!['backup','verify'].includes(mode))throw fail('选择 backup 或 verify，并明确 --package <绝对目录>。');
 let directory=null,confirmed=false;for(let i=1;i<values.length;i++){if(values[i]==='--package'&&!directory&&values[i+1])directory=values[++i];else if(values[i]==='--confirm-quiescent'&&!confirmed)confirmed=true;else throw fail('参数重复、缺少或未知；没有执行备份／恢复。');}
 if(!directory||!path.isAbsolute(directory))throw fail('必须显式指定绝对备份目录；不会猜当前目录。');
 if(mode==='backup'&&!confirmed)throw fail('备份前须停止所有写入者并明确 --confirm-quiescent；本工具不停止服务。');
 if(mode==='verify'&&confirmed)throw fail('verify 只校验文件，不接受写入确认参数。');
 const target=path.resolve(directory),relative=path.relative(appRoot,target);if(!relative||relative==='..'||same(target,path.parse(target).root))throw fail('备份位置不能是源码根或磁盘根。');
 if(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)&&!relative.startsWith(`backups${path.sep}`))throw fail('源码包内备份只允许显式 backups 子目录，不能覆盖代码或运行文件。');
 return {mode,directory:target,confirmed};
}
async function ordinaryDirectory(directory){
 const resolved=path.resolve(directory),parsed=path.parse(resolved);let current=parsed.root;
 for(const part of path.relative(parsed.root,resolved).split(path.sep).filter(Boolean)){current=path.join(current,part);const info=await fsp.lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||!same(await fsp.realpath(current),current))throw fail('目录经过链接或不是受控普通目录，停止操作。');}
 return resolved;
}
async function ordinaryBytes(file,max=50*1024*1024){
 await ordinaryDirectory(path.dirname(file));const before=await fsp.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>max)throw fail('备份条目不是独立普通文件或大小超限。');
 const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw fail('文件在核对时已改变。');const bytes=await handle.readFile();const after=await handle.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||bytes.length!==opened.size)throw fail('文件在读取时已改变，请停止写入后重新准备新备份。');return bytes;}finally{await handle.close();}
}
async function fileHash(file){
 await ordinaryDirectory(path.dirname(file));const before=await fsp.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw fail('数据库备份不是独立普通文件。');
 const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const info=await handle.stat();if(info.dev!==before.dev||info.ino!==before.ino||info.size!==before.size)throw fail('文件核对期间改变。');const digest=crypto.createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))digest.update(chunk);const after=await handle.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw fail('文件核对期间改变。');return {sha256:digest.digest('hex'),byteSize:info.size};}finally{await handle.close();}
}
async function walk(directory,prefix=''){
 await ordinaryDirectory(directory);const result=[];
 for(const entry of await fsp.readdir(directory,{withFileTypes:true})){const relative=prefix?`${prefix}/${entry.name}`:entry.name;if(!safeRelative(relative))throw fail('备份条目路径不安全。');const full=path.join(directory,entry.name),info=await fsp.lstat(full);if(info.isSymbolicLink())throw fail('备份拒绝符号链接或重解析点。');if(info.isDirectory())result.push(...await walk(full,relative));else if(info.isFile()&&info.nlink===1)result.push(relative);else throw fail('备份拒绝非普通文件。');if(result.length>100000)throw fail('备份文件数超过安全上限。');}
 return result.sort();
}
function docker(args,fd){return new Promise((resolve,reject)=>{
 let stdout='',bytes=0;const child=spawn('docker',args,{windowsHide:true,shell:false,stdio:['ignore',fd===undefined?'pipe':fd,'pipe']});
 if(fd===undefined)child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)child.kill();else stdout+=chunk.toString('utf8');});
 child.stderr.on('data',()=>{});child.on('error',()=>reject(fail('Docker工具不可用；已有数据与部分备份保留，未执行恢复。')));child.on('close',code=>code===0&&bytes<=4*1024*1024?resolve(stdout):reject(fail('Docker只读导出或目标核对失败，未恢复／清理数据。请检查Docker Desktop和原配置，再重新准备新备份目录。')));
});}
async function portOpen(port){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.setTimeout(1000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});}
async function backup(directory){
 if(await portOpen(5301)||await portOpen(5273))throw fail('本项目 5273／5301 端口仍可访问。请先保存填写、核对未知结果并停止所有写入者；本工具不结束进程或数据库。');
 const configBytes=await ordinaryBytes(path.join(appRoot,'.data','runtime.json'),16000),config=JSON.parse(configBytes.toString('utf8'));
 if(!Number.isInteger(config.port)||config.port<1024||config.port>65535||!/^([A-Za-z_][A-Za-z0-9_]*)$/.test(config.user)||!/^([A-Za-z_][A-Za-z0-9_]*)$/.test(config.database))throw fail('原开发配置范围无效；不会覆盖原配置或输出凭据。');
 const inspected=JSON.parse(await docker(['inspect','--type','container',container]));const target=inspected[0],ports=target?.NetworkSettings?.Ports?.['5432/tcp']??[],environment=target?.Config?.Env??[];
 if(inspected.length!==1||target?.Config?.Image!==image||target?.Config?.Labels?.['com.docker.compose.project']!=='ai-novel-new-design-dev'||!target?.State?.Running||!target.Mounts?.some(item=>item.Type==='volume'&&item.Name===volume&&item.Destination==='/var/lib/postgresql/data')||ports.length!==1||ports[0].HostIp!=='127.0.0.1'||ports[0].HostPort!==String(config.port)||!environment.includes(`POSTGRES_USER=${config.user}`)||!environment.includes(`POSTGRES_DB=${config.database}`))throw fail('数据库容器、原卷、镜像或端口不符合原开发目标；没有导出其他数据库。');
 const sql="SELECT json_build_object('postgresVersion',current_setting('server_version'),'database',current_database(),'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension WHERE extname IN ('age','vector','pg_trgm')),'migrations',(SELECT json_agg(id ORDER BY id) FROM new_design.schema_migrations))::text";
 const metadata=JSON.parse((await docker(['exec',container,'psql','-X','-A','-t','--set','ON_ERROR_STOP=1','--username',config.user,'--dbname',config.database,'--command',sql])).trim());
 if(metadata.database!==config.database||!Array.isArray(metadata.migrations)||!Array.isArray(metadata.extensions)||metadata.extensions.length!==3)throw fail('原数据库迁移／扩展未完整核对，没有生成就绪备份。');
 await ordinaryDirectory(path.dirname(directory));await fsp.mkdir(directory,{mode:0o700});await ordinaryDirectory(directory);
 const sourceFiles=[];for(const sourceRoot of roots){const folder=path.join(appRoot,...sourceRoot.split('/'));const info=await fsp.lstat(folder).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info)for(const file of await walk(folder)){const source=path.join(folder,...file.split('/')),bytes=await ordinaryBytes(source);sourceFiles.push({path:`${sourceRoot}/${file}`,sha256:hash(bytes),byteSize:bytes.length});}}
 const dump=path.join(directory,'database.dump'),dumpHandle=await fsp.open(dump,'wx',0o600);try{await docker(['exec',container,'pg_dump','--format=custom','--no-owner','--no-privileges','--username',config.user,'--dbname',config.database],dumpHandle.fd);await dumpHandle.sync();}finally{await dumpHandle.close();}
 const dumpEntry={path:'database.dump',...await fileHash(dump)};if(dumpEntry.byteSize===0)throw fail('数据库导出为空，不生成就绪清单。');const entries=[dumpEntry];
 for(const entry of sourceFiles){const bytes=await ordinaryBytes(path.join(appRoot,...entry.path.split('/')));if(hash(bytes)!==entry.sha256||bytes.length!==entry.byteSize)throw fail('受控附件或回复在数据库导出期间变化，当前备份未就绪；保留部分文件，不清理或覆盖。');const destination=path.join(directory,...entry.path.split('/'));await fsp.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await ordinaryDirectory(path.dirname(destination));const handle=await fsp.open(destination,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}entries.push(entry);}
 const afterFiles=[];for(const sourceRoot of roots){const folder=path.join(appRoot,...sourceRoot.split('/'));const exists=await fsp.lstat(folder).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(exists)afterFiles.push(...(await walk(folder)).map(file=>`${sourceRoot}/${file}`));}
 if(JSON.stringify(afterFiles.sort())!==JSON.stringify(sourceFiles.map(item=>item.path).sort()))throw fail('附件清单在备份期间改变，不能生成就绪清单；原数据和部分导出保留。');
 for(const entry of sourceFiles){const actual=await fileHash(path.join(appRoot,...entry.path.split('/')));if(actual.sha256!==entry.sha256||actual.byteSize!==entry.byteSize)throw fail('已复制的附件随后发生变化，当前备份未就绪；保留原数据与部分导出。');}
 const manifest={format:'new-design-development-snapshot',version:1,createdAt:new Date().toISOString(),consistency:'operator_quiescent',applicationVersion:JSON.parse(await fsp.readFile(path.join(appRoot,'package.json'),'utf8')).version,metadata,entries:entries.sort((a,b)=>a.path.localeCompare(b.path)),excluded:['.data/runtime.json','environment secrets','node_modules','Docker image layers','browser draft preferences'],restoreVerified:false};
 const manifestHandle=await fsp.open(path.join(directory,'manifest.json'),'wx',0o600);try{await manifestHandle.writeFile(JSON.stringify(manifest,null,2)+'\n');await manifestHandle.sync();}finally{await manifestHandle.close();}
 console.log('开发数据快照已导出：数据库逻辑备份＋受控附件／原回复＋SHA清单。未执行恢复演练，不等于已经验收可恢复；加入Git前需人工审查隐私。');
}
async function verify(directory){
 await ordinaryDirectory(directory);const manifest=JSON.parse((await ordinaryBytes(path.join(directory,'manifest.json'),32*1024*1024)).toString('utf8'));
 if(manifest.format!=='new-design-development-snapshot'||manifest.version!==1||manifest.consistency!=='operator_quiescent'||!Array.isArray(manifest.entries)||manifest.entries.length<1||manifest.entries.length>100000)throw fail('备份清单格式不受支持，未恢复。');
 const seen=new Set();for(const entry of manifest.entries){if(!entry||!safeRelative(entry.path)||!(entry.path==='database.dump'||roots.some(prefix=>entry.path.startsWith(`${prefix}/`)))||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.byteSize)||entry.byteSize<0||seen.has(entry.path.toLowerCase()))throw fail('备份清单包含非法路径、大小、SHA或重复文件，未恢复。');seen.add(entry.path.toLowerCase());const actual=await fileHash(path.join(directory,...entry.path.split('/')));if(actual.byteSize!==entry.byteSize||actual.sha256!==entry.sha256)throw fail('备份文件大小或SHA不一致；保留原文件，不恢复。');}
 if(!seen.has('database.dump')||!manifest.entries.some(entry=>entry.path==='database.dump'&&entry.byteSize>0))throw fail('数据库逻辑备份缺失或为空。');const actualFiles=await walk(directory),expected=[...manifest.entries.map(item=>item.path),'manifest.json'].sort();if(JSON.stringify(actualFiles)!==JSON.stringify(expected))throw fail('目录文件与清单不一致，不接受额外未声明文件。');
 console.log('快照文件大小／SHA／普通路径已核对；本次没有连接数据库或调用模型，不证明逻辑恢复成功。下一步在独立55584/tmpfs目标显式演练。');return manifest;
}
async function main(){if(process.argv.includes('--help')){console.log('node scripts/development-data.cjs backup --package <全新绝对目录> --confirm-quiescent\nnode scripts/development-data.cjs verify --package <绝对目录>\n只导出或只读校验，不包含恢复、DROP、清卷、重启、迁移或模型调用。');return;}const args=parseArguments(process.argv.slice(2));await(args.mode==='backup'?backup(args.directory):verify(args.directory));}
module.exports={safeRelative,parseArguments};
if(require.main===module)main().catch(error=>{console.error(`开发快照步骤未完成：${error instanceof DevelopmentDataError?error.message:'读取文件或工具回执失败，请核对运行维护。'} 原数据、原配置及部分导出文件保留；不覆盖旧备份或恢复当前开发库。`);process.exitCode=1;});

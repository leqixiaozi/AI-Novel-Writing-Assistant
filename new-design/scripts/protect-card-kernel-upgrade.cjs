'use strict';
// One explicitly requested protection copy for the destructive adapter cutover.
// This command never starts/stops services, creates databases, or restores data.
const fs=require('node:fs/promises');
const {createReadStream,createWriteStream}=require('node:fs');
const {pipeline}=require('node:stream/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const {isDeepStrictEqual}=require('node:util');
const {Pool}=require('pg');
const {databaseFingerprint}=require('./upgrade-card-kernel.cjs');
const root=path.resolve(__dirname,'..');
function child(args,stdio){
 const proc=spawn('docker',args,{stdio,windowsHide:true});
 let stderr='';proc.stderr?.on('data',chunk=>{stderr+=chunk;});
 const done=new Promise((resolve,reject)=>{proc.once('error',()=>reject(new Error('Docker backup process could not start')));proc.once('close',code=>code===0?resolve():reject(new Error(`Database backup tool failed with exit ${code}; no upgrade allowed`)));});
 // Do not print provider credentials or SQL data that tools may include in stderr.
 void stderr;
 return{proc,done};
}
async function protect(input){
 const config=JSON.parse(await fs.readFile(path.join(root,'.data/runtime.json'),'utf8'));
 if(config.database!==input.database||config.host&&!['127.0.0.1','localhost','::1'].includes(config.host))throw new Error('Protection target must be the configured local development database');
 if(!/^[a-zA-Z0-9_.-]+$/.test(input.container))throw new Error('Explicit Docker container name required');
 const base=path.resolve(root,'../.codex-backups'),destination=path.resolve(input.directory),relative=path.relative(base,destination);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Protection directory must be a new child of the ignored local backup directory');
 const pool=new Pool({...config,host:'127.0.0.1',max:1,application_name:'new_design_upgrade_protection'});
 try{
  await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const clients=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0].n;
  if(clients)throw new Error('Stop development database writers before making the protection copy');
  const cluster=(await pool.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id;
  const identity=child(['exec','-i',input.container,'psql','--username',config.user,'--dbname',config.database,'-At','-c','SELECT system_identifier::text FROM pg_control_system()'],['ignore','pipe','pipe']);
  let containerCluster='';identity.proc.stdout.on('data',chunk=>{containerCluster+=chunk;});await identity.done;
  if(containerCluster.trim()!==cluster)throw new Error('Docker container is not the connected PostgreSQL cluster');
  const fingerprint=await databaseFingerprint(pool);
  await pool.query('COMMIT');
  const backup=path.join(destination,'development-before-133.dump');
  if(input.verifyExisting===true){
   const stat=await fs.stat(backup);
   if(!stat.isFile()||stat.size<1024||Date.now()-stat.mtimeMs>60*60*1000)throw new Error('Only the recent protection file may resume verification');
  }else{
   // mkdir without recursive / wx files deliberately refuses to overwrite a copy.
   await fs.mkdir(destination);
   const dump=child(['exec','-i',input.container,'pg_dump','--username',config.user,'--dbname',config.database,'--format=custom'],['ignore','pipe','pipe']);
   await Promise.all([pipeline(dump.proc.stdout,createWriteStream(backup,{flags:'wx'})),dump.done]);
  }
  // Decode the entire archive to the container's null device. This validates
  // data sections without connecting to, creating or restoring any database.
  const complete=child(['exec','-i',input.container,'pg_restore','--file=/dev/null'],['pipe','ignore','pipe']);
  await Promise.all([pipeline(createReadStream(backup),complete.proc.stdin),complete.done]);
  const list=child(['exec','-i',input.container,'pg_restore','--list'],['pipe','pipe','pipe']);
  let toc='';list.proc.stdout.on('data',chunk=>{toc+=chunk;});
  // pg_restore --list intentionally exits after reading the TOC, before the
  // large data section. An EPIPE is acceptable only with exit 0 and a valid TOC.
  await Promise.all([pipeline(createReadStream(backup),list.proc.stdin).catch(error=>{if(!['EPIPE','ERR_STREAM_PREMATURE_CLOSE'].includes(error.code))throw error;}),list.done]);
  if(!toc.includes('new_design schema_migrations')||!toc.includes('new_design card_versions')||!toc.includes('new_design model_credential_refs'))throw new Error('Backup archive lacks required table entries');
  await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const after=await databaseFingerprint(pool);await pool.query('COMMIT');
  if(!isDeepStrictEqual(after,fingerprint))throw new Error('Database changed during protection; this copy cannot authorize an upgrade');
  const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(backup)){hash.update(chunk);bytes+=chunk.length;}
  if(bytes<1024)throw new Error('Backup is unexpectedly small');
  const manifest={database:input.database,cluster,createdAt:new Date().toISOString(),bytes,sha256:hash.digest('hex'),restoreListVerified:true,fullArchiveReadVerified:true,verificationResumed:input.verifyExisting===true,fingerprint};
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return{directory:destination,backup,manifest:path.join(destination,'manifest.json'),bytes,sha256:manifest.sha256,restoreListVerified:true};
 }finally{await pool.end();}
}
if(require.main===module){
 const args=process.argv.slice(2),input={};
 for(let i=0;i<args.length;i+=2){if(!['--database','--container','--directory'].includes(args[i])||!args[i+1]||input[args[i].slice(2)])throw new Error('Expected --database --container --directory exactly once');input[args[i].slice(2)]=args[i+1];}
 if(!input.database||!input.container||!input.directory)throw new Error('Explicit protection target is required');
 protect(input).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{console.error('Protection copy was not verified; database remains unchanged. Keep any partial file for inspection, do not run the upgrade.');process.exitCode=1;});
}
module.exports={protect};

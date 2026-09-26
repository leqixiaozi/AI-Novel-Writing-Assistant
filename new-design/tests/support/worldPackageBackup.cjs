const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{Pool}=require('pg');
const run=promisify(execFile),container='ai-novel-new-design-postgres-dev';
const tables=['world_package_capability','world_package_versions','world_package_card_refs','world_package_relation_refs','world_package_installations','world_package_install_card_refs','world_package_install_relation_refs','world_package_sync_commands','world_package_push_candidates','world_package_field_baselines','world_library_commands','world_library_candidates','cards','card_versions','card_type_versions','card_group_form_versions','dictionary_item_versions','card_relations','card_relation_versions','entity_initial_states','state_changes','canonical_facts','chapter_body_versions','chapter_settlements','knowledge_state_proposals','current_knowledge_state_projections'];
async function snapshot(pool){return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) data FROM new_design.${table} row`)).rows[0].data])));}
/** Full logical backup of this test's own fresh database, restored into another
 * verified empty retained database. Never --clean, drop, migrate or switch runtime. */
exports.verifyWorldPackageBackup=async function(t,sourcePool,sourceDatabase){
 if(!/^nd_reference_test_[a-f0-9]{32}$/.test(sourceDatabase))throw new Error('Only a fresh retained isolated test database may be backed up here.');
 const config=JSON.parse(await fs.readFile(path.join(__dirname,'../../.data/runtime.json'),'utf8')),suffix=randomUUID().replaceAll('-',''),name=`world-package-${suffix}.dump`,containerPath=`/tmp/${name}`,directory='C:/tool/codex-home/tmp/world-package-backups',file=path.join(directory,name),manifestFile=path.join(directory,`world-package-${suffix}.json`),before=await snapshot(sourcePool),targetDatabase=`nd_reference_test_${randomUUID().replaceAll('-','')}`;
 await fs.mkdir(directory,{recursive:true});
 await run('docker',['exec',container,'pg_dump','-U',config.user,'-d',sourceDatabase,'--format=custom','--file',containerPath],{windowsHide:true,maxBuffer:1024*1024});
 await run('docker',['cp',`${container}:${containerPath}`,file],{windowsHide:true,maxBuffer:1024*1024});
 const bytes=await fs.readFile(file);if(bytes.length<1024||bytes.subarray(0,5).toString()!=='PGDMP')throw new Error('Backup artifact failed existence, size or archive header validation.');
 const manifest={contract:'isolated_world_package_backup_v1',sourceDatabase,targetDatabase,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),outcome:'backup_verified',createdAt:new Date().toISOString()};
 await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));t.diagnostic(`Verified retained backup: ${file} (${bytes.length} bytes)`);
 const admin=new Pool({...config,host:'127.0.0.1',database:'postgres',max:1});try{await admin.query(`CREATE DATABASE "${targetDatabase}" TEMPLATE template0 ENCODING 'UTF8'`);}finally{await admin.end();}
 t.diagnostic(`Fresh restore database created and retained: ${targetDatabase}`);
 const restored=new Pool({...config,host:'127.0.0.1',database:targetDatabase,max:3});
 try{
  if((await restored.query("SELECT count(*)::integer n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n!==0)throw new Error('Restore target is not empty; no restore was attempted.');
  await run('docker',['exec',container,'pg_restore','-U',config.user,'-d',targetDatabase,'--exit-on-error','--no-owner','--no-privileges',containerPath],{windowsHide:true,maxBuffer:1024*1024});
  const actual=await snapshot(restored);require('node:assert/strict').deepEqual(actual,before);
  const guards=(await restored.query("SELECT count(*)::integer n FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='new_design' AND trigger.tgname LIKE 'world%package%' AND trigger.tgenabled='O'")).rows[0].n;
  if(guards<15)throw new Error('Restored world package guards are incomplete.');
  manifest.outcome='restored_and_verified';manifest.verifiedTables=tables;manifest.restoredGuards=guards;return manifest;
 }catch(error){manifest.outcome='restore_failed_retained';manifest.error=error.message;throw error;}
 finally{await restored.end();await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));}
};

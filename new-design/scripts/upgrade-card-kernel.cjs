'use strict';
// Explicit, in-place development upgrade. No CREATE DATABASE, runtime startup,
// provider call, automatic backup/restore, or retry after an unknown commit.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {Pool}=require('pg');
const {splitSqlStatements}=require('./sql-statements.cjs');
const {nativeTypes}=require('./inspect-card-kernel-upgrade.cjs');
const {classifyLegacyType}=require('./card-kernel-upgrade-mapping.cjs');
const {convertRecords,assertHubMirror,normalizedRecord,mergedTopicValues}=require('./card-kernel-upgrade-records.cjs');
const {transformAction}=require('./card-kernel-upgrade-special.cjs');
const {validateHistoricalDefaults}=require('./card-kernel-upgrade-defaults.cjs');
const root=path.resolve(__dirname,'..');
const migration='133_card_kernel_tables_only_upgrade';
const defaultSpace='00000000-0000-4000-8000-000000000001';
const quote=name=>'"'+String(name).replaceAll('"','""')+'"';
const uuid=seed=>{const h=createHash('md5').update(seed).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
function fail(message){throw new Error(message);}
function options(args){
 if(!Array.isArray(args)||args.some(value=>typeof value!=='string'))fail('Upgrade arguments must be strings');
 const out={},seen=new Set();
 for(let i=0;i<args.length;i++){
  if(seen.has(args[i]))fail('Unknown or repeated upgrade argument');
  seen.add(args[i]);
  if(['--database','--backup','--backup-sha256','--manifest'].includes(args[i])){
   const key=args[i].slice(2),value=args[++i];
   if(!value?.trim()||value.startsWith('--'))fail('Upgrade argument requires a non-empty value');
   out[key]=value;
  }
  else if(args[i]==='--confirm-in-place-upgrade'&&!out.confirmed)out.confirmed=true;
  else fail('Unknown or repeated upgrade argument');
 }
 if(!out.confirmed||!out.database||!out.backup||!out.manifest||!/^[a-f0-9]{64}$/i.test(out['backup-sha256']??''))fail('Explicit development database, verified backup path/SHA/manifest and in-place confirmation are required');
 return out;
}
async function protectedDigests(db){
 const tables=['books','chapter_documents','chapter_body_versions','chapter_body_adoptions','research_documents','research_document_versions',
  'model_credential_refs','model_route_configs','model_route_versions','model_route_snapshots','ai_tasks','ai_task_steps','ai_task_attempts','ai_task_events','ai_attempt_usage',
  'asset_content_objects','asset_versions','asset_links','asset_events','background_jobs','background_job_events','outbox_events','outbox_inbox_receipts'];
 const result={};
 for(const table of tables)result[table]=(await db.query(`SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(row)::text,E'\\n' ORDER BY id),'')) hash FROM new_design.${quote(table)} row`)).rows[0];
 return result;
}
async function databaseFingerprint(db){
 const result={};
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname IN('new_design','new_design_projection') ORDER BY schemaname,tablename")).rows;
 for(const {tablename} of tables){
  // Resolve the schema from the catalog rather than accepting external names.
  const actual=(await db.query("SELECT schemaname FROM pg_tables WHERE schemaname IN('new_design','new_design_projection') AND tablename=$1",[tablename])).rows;
  if(actual.length!==1)fail('Ambiguous table name in backup fingerprint');
  result[`${actual[0].schemaname}.${tablename}`]=(await db.query(`SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(row)::text,E'\\n' ORDER BY to_jsonb(row)::text),'')) hash FROM ${quote(actual[0].schemaname)}.${quote(tablename)} row`)).rows[0];
 }
 return result;
}
async function preservationProof(db){
 const excluded=['cards','card_types','card_type_versions','card_versions','card_version_actions','system_capabilities','schema_migrations'];
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname IN('new_design','new_design_projection') ORDER BY schemaname,tablename")).rows;
 const proof=[];
 for(const {tablename} of tables){
  if(excluded.includes(tablename))continue;
  const columns=(await db.query("SELECT table_schema,column_name FROM information_schema.columns WHERE table_schema IN('new_design','new_design_projection') AND table_name=$1 ORDER BY ordinal_position",[tablename])).rows;
  if(!columns.length)fail('Cannot inventory retained table columns');
  const sql=`SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(row)::text,E'\\n' ORDER BY to_jsonb(row)::text),'')) hash FROM (SELECT ${columns.map(c=>quote(c.column_name)).join(',')} FROM ${quote(columns[0].table_schema)}.${quote(tablename)}) row`;
  proof.push({name:tablename,sql,expected:(await db.query(sql)).rows[0]});
 }
 const versions=(await db.query('SELECT id FROM new_design.card_versions ORDER BY id')).rows.map(r=>r.id);
 const nativeCards=(await db.query("SELECT c.id FROM new_design.cards c JOIN new_design.card_types t ON t.id=c.card_type_id WHERE t.type_key NOT LIKE 'legacy.%' ORDER BY c.id")).rows.map(r=>r.id);
 const typeVersions=(await db.query('SELECT id FROM new_design.card_type_versions ORDER BY id')).rows.map(r=>r.id);
 const types=(await db.query('SELECT id FROM new_design.card_types ORDER BY id')).rows.map(r=>r.id);
 const actions=(await db.query('SELECT id FROM new_design.card_version_actions ORDER BY id')).rows.map(r=>r.id);
 for(const [name,ids] of [['card_versions',versions],['cards',nativeCards],['card_type_versions',typeVersions],['card_types',types],['card_version_actions',actions]]){
  const json=name==='card_types'?"(to_jsonb(row)-ARRAY['type_key','is_internal'])":'to_jsonb(row)';
  const sql=`SELECT count(*)::int count,md5(coalesce(string_agg(${json}::text,E'\\n' ORDER BY id),'')) hash FROM new_design.${quote(name)} row WHERE id=ANY($1::uuid[])`;
  proof.push({name,sql,params:[ids],expected:(await db.query(sql,[ids])).rows[0]});
 }
 const ledgerSql="SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(row)::text,E'\\n' ORDER BY id),'')) hash FROM new_design.schema_migrations row WHERE id<>$1";
 proof.push({name:'schema_migrations',sql:ledgerSql,params:[migration],expected:(await db.query(ledgerSql,[migration])).rows[0]});
 return proof;
}
async function catalog(db){return(await db.query(`SELECT card.*,type.type_key,version.values AS current_values FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE type.type_key LIKE 'legacy.%' ORDER BY type.type_key,card.id`)).rows;}
function planRows(rows,types){
 validateHistoricalDefaults(rows);
 return rows.map(row=>{
  const mapping=classifyLegacyType(row.type_key,types);
  if(row.type_key==='legacy.material_management_events')return{row,mapping:{kind:'action',sourceType:'material_management_events'}};
  if(['legacy.completion_rule_sets','legacy.graph_projection_mapping_definitions'].includes(row.type_key))return{row,mapping:{kind:'historical_default'}};
  if(row.type_key==='legacy.creative_hub_threads')return{row,mapping:{kind:'hub_mirror'}};
  // These old configuration records have no replacement runtime consumer. They
  // require a separately implemented equivalence check; do not silently archive.
  if(['unsupported','complex'].includes(mapping.kind))fail(`No lossless upgrade transformer: ${row.type_key}`);
  if(mapping.kind==='merged'&&mapping.sourceType!=='outbox_event_topics')fail(`Unimplemented structured merge: ${row.type_key}`);
  if(mapping.kind==='action'&&!['chapter_settlement_events','prompt_command_receipts','material_management_events'].includes(mapping.sourceType))fail(`Unimplemented historical action: ${row.type_key}`);
  if(mapping.kind==='physical'&&mapping.requiredTransform)fail(`Physical content transform required: ${row.type_key}`);
  return{row,mapping};
 });
}
async function checkPhysicalMirrors(db,plan){
 for(const {row,mapping} of plan.filter(item=>item.mapping.kind==='physical')){
  const original=row.current_values;
  if(!original.id)fail(`Physical mirror has no original identity: ${row.type_key}`);
  const actual=(await db.query(`SELECT to_jsonb(row) value FROM new_design.${quote(mapping.targetTable)} row WHERE id=$1`,[original.id])).rows[0]?.value;
  if(!actual)fail(`Physical mirror destination is absent: ${mapping.targetTable}`);
  for(const [key,value] of Object.entries(actual))if(!isDeepStrictEqual(value,original[key]))fail(`Physical mirror differs: ${mapping.targetTable}.${key}`);
 }
}
async function preparePlan(db,types){
 const rows=await catalog(db),plan=planRows(rows,types);
 await checkPhysicalMirrors(db,plan);
 const books=new Map((await db.query('SELECT id,space_id FROM new_design.books')).rows.map(row=>[row.id,row.space_id]));
 const spaces=new Set((await db.query('SELECT id FROM new_design.card_spaces')).rows.map(row=>row.id));
 for(const {row,mapping} of plan){
  if(mapping.kind==='record'){
   if(!spaces.has(normalizedRecord(row,books).spaceId))fail(`Record space is absent: ${row.type_key}`);
  }else if(mapping.kind==='hub_mirror'){
   const native=(await db.query(`SELECT c.*,v.values current_values,c.created_at::text created_at,c.updated_at::text updated_at FROM new_design.cards c JOIN new_design.card_types t ON t.id=c.card_type_id
    JOIN new_design.card_versions v ON v.id=c.current_version_id AND v.card_id=c.id WHERE c.id=$1 AND t.type_key='creative_hub_thread'`,[row.current_values.id])).rows[0];
   assertHubMirror(row,native);
  }else if(mapping.kind==='merged'){
   const handlers=plan.filter(p=>p.mapping.targetType==='background_job_handler'&&p.row.current_values.topic===row.current_values.topic&&Number(p.row.current_values.event_version)===Number(row.current_values.event_version));
   if(!handlers.length)fail('Outbox topic has no retained handler');
   for(const handler of handlers)mergedTopicValues(row,handler.row);
  }
 }
 const physical=new Map((await db.query('SELECT id,current_version_id FROM new_design.cards')).rows.map(row=>[row.id,row]));
 const logical=new Map();
 for(const {row,mapping} of plan.filter(p=>p.mapping.kind==='record')){
  const key=`${mapping.targetType}:${row.current_values.id??row.id}`;
  if(logical.has(key))fail(`Duplicate logical record: ${mapping.targetType}`);
  logical.set(key,row);
 }
 const actions=plan.filter(p=>p.mapping.kind==='action').map(p=>transformAction(p.row,(type,id)=>type?logical.get(`${type}:${id}`):physical.get(id)));
 if(new Set(actions.map(a=>a.id)).size!==actions.length)fail('Historical action identity collision');
 if(actions.length&&(await db.query('SELECT 1 FROM new_design.card_version_actions WHERE id=ANY($1::uuid[]) OR request_key::text=ANY($2::text[])',[actions.map(a=>a.id),actions.map(a=>a.request_key).filter(Boolean)])).rowCount)fail('Historical action already exists; reconcile before upgrade');
 for(const action of actions.filter(a=>a.card_version_id))if(!(await db.query('SELECT 1 FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[action.card_version_id,action.card_id])).rowCount)fail('Action exact version belongs to another card');
 return{plan,actions};
}
async function adapterDropOrder(db){
 // Only these three existing function OIDs back retained table CHECKs. Every
 // other domain function is explicitly reinstalled from the canonical source.
 const keep=['outbox_payload_is_reference_only(jsonb)','transfer_json_is_safe(jsonb)','transfer_locator_is_safe(text)'];
 const objects=(await db.query(`SELECT 'pg_proc' kind,p.oid::text id,'DROP FUNCTION '||p.oid::regprocedure::text||' RESTRICT' sql
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='new_design' AND p.prokind='f'
  AND NOT(p.proname||'('||oidvectortypes(p.proargtypes)||')'=ANY($1::text[]))
  UNION ALL SELECT 'pg_class',c.oid::text,'DROP VIEW new_design.'||quote_ident(c.relname)||' RESTRICT'
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind='v'
  UNION ALL SELECT 'pg_type',t.oid::text,'DROP TYPE new_design_compat.'||quote_ident(t.typname)||' RESTRICT'
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='new_design_compat' AND t.typtype='c'`,[keep])).rows;
 const aliases=new Map(objects.map(o=>[`${o.kind}:${o.id}`,`${o.kind}:${o.id}`]));
 const viewIds=objects.filter(o=>o.kind==='pg_class').map(o=>o.id);
 for(const row of(await db.query('SELECT oid::text id,ev_class::text owner FROM pg_rewrite WHERE ev_class=ANY($1::oid[])',[viewIds])).rows)aliases.set(`pg_rewrite:${row.id}`,`pg_class:${row.owner}`);
 for(const row of(await db.query('SELECT oid::text id,typrelid::text owner FROM pg_type WHERE typrelid=ANY($1::oid[])',[viewIds])).rows)aliases.set(`pg_type:${row.id}`,`pg_class:${row.owner}`);
 const ids=[...aliases.keys()].map(key=>key.split(':')[1]);
 const deps=(await db.query(`SELECT classid::regclass::text child_class,objid::text child,refclassid::regclass::text parent_class,refobjid::text parent
  FROM pg_depend WHERE deptype='n' AND refobjid=ANY($1::oid[])`,[ids])).rows
  .map(d=>({child:aliases.get(`${d.child_class}:${d.child}`),parent:aliases.get(`${d.parent_class}:${d.parent}`)}))
  .filter(d=>d.child&&d.parent&&d.child!==d.parent);
 const remaining=new Map(objects.map(o=>[`${o.kind}:${o.id}`,o])),ordered=[];
 while(remaining.size){
  const ready=[...remaining.keys()].filter(key=>!deps.some(d=>d.parent===key&&remaining.has(d.child)));
  if(!ready.length)fail('Adapter dependencies form a cycle; no CASCADE deletion allowed');
  for(const key of ready){ordered.push(remaining.get(key).sql);remaining.delete(key);}
 }
 return ordered;
}
async function dropOldAdapters(db){
 // RESTRICT everywhere: an unexpected dependency aborts the outer transaction.
 const triggers=(await db.query(`SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND NOT t.tgisinternal`)).rows;
 for(const row of triggers)await db.query(`DROP TRIGGER ${quote(row.tgname)} ON new_design.${quote(row.relname)}`);
 for(const sql of await adapterDropOrder(db))await db.query(sql);
 await db.query('DROP SCHEMA new_design_compat RESTRICT');
}
async function installRecordCatalog(db,plan,types){
 await db.query("UPDATE new_design.card_types SET is_internal=true WHERE type_key LIKE 'legacy.%'");
 const mappings=new Map(plan.filter(item=>item.mapping.kind==='record').map(item=>[item.row.card_type_id,item.mapping.targetType]));
 for(const [id,key] of mappings){
  if((await db.query('SELECT id FROM new_design.card_types WHERE type_key=$1 AND id<>$2',[key,id])).rowCount)fail(`Existing native record requires reconciliation: ${key}`);
  await db.query('UPDATE new_design.card_types SET type_key=$2,is_internal=true WHERE id=$1',[id,key]);
 }
 for(const key of types){
  const existing=(await db.query('SELECT id,current_version_id FROM new_design.card_types WHERE space_id=$1 AND type_key=$2',[defaultSpace,key])).rows[0];
  if(existing){await db.query('UPDATE new_design.card_types SET is_internal=true WHERE id=$1',[existing.id]);continue;}
  const id=uuid(`card-kernel:internal-type:${key}`),versionId=uuid(`card-kernel:internal-type-version:${key}:1`);
  await db.query("INSERT INTO new_design.card_types(id,space_id,type_key,name,description,status,is_internal,is_system,draft_fields) VALUES($1,$2,$3,$3,'内部工作流持久化记录','draft',true,true,'[]')",[id,defaultSpace,key]);
  await db.query("INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,1,'[]')",[versionId,id]);
  await db.query("UPDATE new_design.card_types SET current_version_id=$2,status='published' WHERE id=$1",[id,versionId]);
 }
}
async function installActions(db,actions){
 for(const action of actions)await db.query(`INSERT INTO new_design.card_version_actions
  (id,card_id,card_version_id,action_key,request_key,input_hash,payload,receipt,created_at)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::timestamptz)`,[
  action.id,action.card_id,action.card_version_id,action.action_key,action.request_key,action.input_hash,
  JSON.stringify(action.payload),action.receipt===null?null:JSON.stringify(action.receipt),action.created_at]);
}
async function installCapabilities(db,plan,summary,types){
 const entries=new Map(['card_kernel_v2','comic_projects_v1','public_character_profile_v1','public_character_trial_v1',
  'image_prompt_preparation_v1','character_dialogue_v1','character_author_v1','character_author_influence_v1',
  'public_title_factory_v1','book_content_history_v1'].map(key=>[key,{operational:true}]));
 for(const {row,mapping} of plan.filter(p=>p.mapping.kind==='capability')){
  const value=row.current_values,key=mapping.capabilityKey??value.contract??value.contract_key;
  if(!key||typeof value.operational!=='boolean')fail('Capability source has no explicit operational state');
  entries.set(key,{operational:value.operational,sourceCardId:row.id});
 }
 const disabledTypeKeys=[...types].filter(type=>entries.get('stable_resource_supplements_v1')?.operational===false
  &&(type.startsWith('resource_supplement_')||type==='chapter_resource_supplement'));
 for(const [key,value] of entries){
  const details={storage:'tables_only',migration,applicationTables:79,projectionTables:4,businessViews:0,
   ...(value.sourceCardId?{sourceCardId:value.sourceCardId}:{}),...(key==='card_kernel_v2'?{upgrade:summary,disabledTypeKeys}:{})};
  // Existing explicit disabled flags must survive; installation completeness
  // does not mean a previously disabled product workflow is authorized to run.
  await db.query(`INSERT INTO new_design.system_capabilities(capability_key,installed,operational,details)
   VALUES($1,true,$2,$3::jsonb) ON CONFLICT(capability_key) DO UPDATE SET installed=true,
   operational=system_capabilities.operational AND EXCLUDED.operational,details=system_capabilities.details||EXCLUDED.details`,[key,value.operational,JSON.stringify(details)]);
 }
}
async function verifyRecords(db,plan){
 for(let offset=0;offset<plan.length;offset+=500){
  const batch=plan.slice(offset,offset+500).filter(p=>p.mapping.kind==='record').map(p=>({id:p.row.id,space_id:p.row.space_id,type_key:p.mapping.targetType,values:p.row.current_values}));
  if(!batch.length)continue;
  const row=(await db.query(`SELECT count(*)::int n FROM jsonb_to_recordset($1::jsonb) expected(id uuid,space_id uuid,type_key text,values jsonb)
   JOIN new_design.cards c ON c.id=expected.id AND c.space_id=expected.space_id
   JOIN new_design.card_types t ON t.id=c.card_type_id AND t.type_key=expected.type_key AND t.is_internal
   JOIN new_design.card_versions v ON v.id=c.current_version_id AND v.card_id=c.id
   WHERE c.values=expected.values AND v.values=expected.values`,[JSON.stringify(batch)])).rows[0];
  if(row.n!==batch.length)fail('Converted record count, scope or payload verification failed');
 }
}
async function upgrade(input){
 const config=JSON.parse(await fs.readFile(path.join(root,'.data/runtime.json'),'utf8'));
 if(config.database!==input.database||config.host&&!['127.0.0.1','localhost','::1'].includes(config.host))fail('Target must match the configured local development database');
 const backup=await fs.readFile(path.resolve(input.backup));
 if(backup.subarray(0,5).toString()!=='PGDMP'||createHash('sha256').update(backup).digest('hex')!==input['backup-sha256'].toLowerCase())fail('Verified custom-format backup is required');
 const manifest=JSON.parse(await fs.readFile(path.resolve(input.manifest),'utf8'));
 if(manifest.database!==input.database||manifest.sha256!==input['backup-sha256'].toLowerCase()
  ||manifest.bytes!==backup.length||manifest.restoreListVerified!==true||manifest.fullArchiveReadVerified!==true||!manifest.fingerprint
  ||Date.now()-Date.parse(manifest.createdAt)>24*60*60*1000||!Number.isFinite(Date.parse(manifest.createdAt)))fail('Backup manifest does not match this fresh, verified development backup');
 const source=await fs.readFile(path.join(root,'migrations/132_card_kernel_tables_only.sql'),'utf8');
 const statements=splitSqlStatements(source),types=nativeTypes(await fs.readFile(path.join(root,'src/server/database/bootstrap/tablesOnly/record-types.sql'),'utf8'));
 const functions=statements.filter(sql=>/^CREATE (?:OR REPLACE )?FUNCTION /i.test(sql));
 const functionNames=functions.map(sql=>sql.match(/^CREATE (?:OR REPLACE )?FUNCTION (?:new_design\.)?([a-z_][a-z0-9_]*)/i)?.[1]);
 if(functionNames.some(name=>!name)||functions.length!==148)fail('Unrecognized canonical function assembly');
 const pool=new Pool({...config,host:'127.0.0.1',max:1,application_name:'new_design_explicit_in_place_upgrade'});
 let db,committing=false,committed=false,phase='connect';
 try{
  db=await pool.connect();await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('new-design-in-place-133',0))");
  const state=(await db.query("SELECT current_database() database,EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='131_card_kernel_v2_cutover') source,EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id=$1) done",[migration])).rows[0];
  if(state.database!==input.database||!state.source||state.done)fail('Expected a not-yet-upgraded 131 development database');
  const tables=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind='r' ORDER BY 1")).rows;
  if(tables.length!==79)fail('Unexpected physical table set');
  const otherConnections=(await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0].n;
  if(otherConnections)fail('Development database still has other client connections; stop writers first');
  await db.query(`LOCK TABLE ${tables.map(row=>'new_design.'+quote(row.relname)).join(',')} IN ACCESS EXCLUSIVE MODE`);
  phase='backup-baseline';
  if((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id!==manifest.cluster)fail('Backup belongs to a different PostgreSQL cluster');
  if(!isDeepStrictEqual(await databaseFingerprint(db),manifest.fingerprint))fail('Database changed after the verified backup; no mutation performed');
  phase='source-mapping';
  const proof=await preservationProof(db),{plan,actions}=await preparePlan(db,types);
  const beforeCounts=(await db.query('SELECT (SELECT count(*)::int FROM new_design.cards) cards,(SELECT count(*)::int FROM new_design.card_versions) versions,(SELECT count(*)::int FROM new_design.card_version_actions) actions,(SELECT count(*)::int FROM new_design.schema_migrations) migrations')).rows[0];
  phase='remove-adapters';await dropOldAdapters(db);
  phase='incremental-structure';
  await db.query(await fs.readFile(path.join(root,`migrations/${migration}.sql`),'utf8'));
  phase='record-catalog';
  await installRecordCatalog(db,plan,types);
  phase='convert-records';const converted=await convertRecords(db,plan);
  phase='preserve-actions';await installActions(db,actions);
  // Old mirrors/default catalogs remain available as internal archived evidence;
  // their payload, original head and every historical version are unchanged.
  await db.query("UPDATE new_design.cards SET status='archived',archived_at=coalesce(archived_at,now()) WHERE id=ANY($1::uuid[])",[plan.filter(p=>p.mapping.kind!=='record').map(p=>p.row.id)]);
  phase='install-guards';
  for(const [index,sql] of functions.entries()){phase=`install-function:${functionNames[index]}`;await db.query(sql.replace(/^CREATE (?:OR REPLACE )?FUNCTION /i,'CREATE OR REPLACE FUNCTION '));}
  phase='install-triggers';
  for(const sql of statements.filter(sql=>/^CREATE (?:CONSTRAINT )?TRIGGER /i.test(sql)))await db.query(sql);
  phase='final-verification';
  const finalize=splitSqlStatements(await fs.readFile(path.join(root,'src/server/database/bootstrap/tablesOnly/finalize.sql'),'utf8')).find(sql=>/^DO \$finalize\$/i.test(sql));
  if(!finalize)fail('Canonical structural verification is absent');
  await db.query(finalize);await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  await verifyRecords(db,plan);
  for(const entry of proof)if(!isDeepStrictEqual((await db.query(entry.sql,entry.params)).rows[0],entry.expected))fail(`Preserved data differs: ${entry.name}`);
  const counts=(await db.query(`SELECT (SELECT count(*)::int FROM new_design.cards) cards,(SELECT count(*)::int FROM new_design.card_versions) versions,
   (SELECT count(*)::int FROM new_design.card_version_actions) actions,
   (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='new_design' AND p.prokind='f') functions,
   (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND NOT t.tgisinternal) triggers`)).rows[0];
  if(counts.cards!==beforeCounts.cards||counts.versions!==beforeCounts.versions+converted.appended||counts.actions!==beforeCounts.actions+actions.length||counts.functions!==148||counts.triggers!==106)fail('Final row/object totals differ from the explicit upgrade plan');
  const summary={sourceMigration:'131_card_kernel_v2_cutover',sourceRecords:plan.length,appendedVersions:converted.appended,actions:actions.length,
   retainedEvidence:plan.filter(p=>p.mapping.kind!=='record').length,categories:plan.reduce((totals,p)=>(totals[p.mapping.kind]=(totals[p.mapping.kind]??0)+1,totals),{}),backupSha256:manifest.sha256};
  phase='register-upgrade';
  await installCapabilities(db,plan,summary,types);
  await db.query('INSERT INTO new_design.schema_migrations(id) VALUES($1)',[migration]);
  if((await db.query('SELECT count(*)::int n FROM new_design.schema_migrations')).rows[0].n!==beforeCounts.migrations+1)fail('Unexpected migration ledger change');
  phase='commit';committing=true;await db.query('COMMIT');committed=true;
  return{migration,committed:true,...counts,...summary,migrationCount:beforeCounts.migrations+1};
 }catch(error){
  if(!committing)await db?.query('ROLLBACK').catch(()=>undefined);
  if(committing&&!committed)fail('Commit outcome unknown: inspect migration ledger and data read-only; do not retry or restore automatically');
  // SQL diagnostics may include author payloads; expose phase/code only.
  if(error.severity)fail(`Upgrade rolled back at ${phase}; PostgreSQL code ${error.code??'unknown'}; table ${error.table??'-'}; constraint ${error.constraint??'-'}`);
  throw error;
 }
 finally{db?.release();await pool.end();}
}
if(require.main===module)Promise.resolve().then(()=>upgrade(options(process.argv.slice(2)))).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={options,planRows,protectedDigests,databaseFingerprint,preservationProof,preparePlan,adapterDropOrder,upgrade};

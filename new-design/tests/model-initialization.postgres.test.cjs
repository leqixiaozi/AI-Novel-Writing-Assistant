const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const https=require('node:https');
const {createHash,randomUUID}=require('node:crypto');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');
const {copyModelConfiguration}=require('../scripts/model-init.cjs');

const defaultSpace='00000000-0000-4000-8000-000000000001';
const fakeSecret='postgres-fixture-only-not-a-real-model-key';
const testDatabasePattern=/^nd_reference_test_[a-f0-9]{32}$/;
const modelTables=['model_route_configs','model_route_versions','model_credential_refs'];
const stateTables=[...modelTables,'cards','card_versions','card_version_actions'];
const executionTables=['ai_tasks','ai_task_steps','ai_task_attempts','ai_task_events','ai_attempt_usage','model_route_snapshots','media_jobs','media_job_attempts','media_outputs'];

// Read connection material only when the test executes. Never use its database
// identity: both endpoints must be fresh databases returned by the shared helper.
function isolatedConnections(source,target){
 assert.match(source.database,testDatabasePattern);
 assert.match(target.database,testDatabasePattern);
 assert.notEqual(source.database,target.database);
 const runtime=JSON.parse(fs.readFileSync(path.join(__dirname,'../.data/runtime.json'),'utf8'));
 assert.ok(source.database!==runtime.database&&target.database!==runtime.database,'fixture databases must not be the configured author database');
 const connection=database=>({host:'127.0.0.1',port:runtime.port,user:runtime.user,password:runtime.password,database});
 return{sourceConfig:connection(source.database),targetConfig:connection(target.database)};
}

async function requireBlank132({pool,database}){
 const identity=(await pool.query('SELECT current_database() AS database')).rows[0];
 assert.equal(identity.database,database);
 const capability=(await pool.query("SELECT EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only') AS migrated,EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational AND details->>'storage'='tables_only') AS ready")).rows[0];
 assert.deepEqual(capability,{migrated:true,ready:true});
 assert.equal((await pool.query("SELECT count(*)::integer AS count FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='new_design' AND relation.relkind IN ('v','m')")).rows[0].count,0);
 for(const table of [...modelTables,'books','chapter_documents','research_documents',...executionTables]){
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM new_design.${table}`)).rows[0].count,0,`${table} must begin empty`);
 }
 const type=(await pool.query("SELECT type.is_internal,type.status,version.id IS NOT NULL AS has_version FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id AND version.card_type_id=type.id WHERE type.type_key='model_route_fallback'")).rows;
 assert.deepEqual(type,[{is_internal:true,status:'published',has_version:true}]);
}

async function fingerprint(pool){
 const hash=createHash('sha256');
 for(const table of [...stateTables,...executionTables]){
  const rows=(await pool.query(`SELECT to_jsonb(record) AS value FROM new_design.${table} record ORDER BY id`)).rows;
  hash.update(table);hash.update(JSON.stringify(rows));
 }
 return hash.digest('hex');
}

async function readFallbacks(pool){
 return(await pool.query(`SELECT card.id AS physical_id,version.values AS payload
  FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  WHERE type.type_key='model_route_fallback' AND card.status='active'
  ORDER BY version.values->>'route_version_id',(version.values->>'sort_order')::integer`)).rows;
}

async function seedSource(pool,sourceKey,crypto){
 const ids={config:randomUUID(),published:randomUUID(),draft:randomUUID(),credential:randomUUID(),fallback:randomUUID()};
 const fallback={id:ids.fallback,route_version_id:ids.published,sort_order:0,provider:'openai-compatible',model:'fixture-fallback',parameters:{baseUrl:'http://127.0.0.1:1/never-call-fixture'},credential_ref_id:ids.credential,technical_failure_categories:['timeout','transport']};
 const envelope=crypto.sealModelCredential(fakeSecret,sourceKey);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("INSERT INTO new_design.model_credential_refs(id,credential_key,provider,secret_locator,secret_envelope,status) VALUES($1,'isolated-model-fixture','openai-compatible','secret://database',$2,'active')",[ids.credential,envelope]);
  await client.query("INSERT INTO new_design.model_route_configs(id,scope,name,status,revision) VALUES($1,'system_default','Isolated fixture route','active',3)",[ids.config]);
  // These are real 132 CHECK values, not the permissive SQL-mock fixture: route
  // source is manual, fallback_mode is replace, and the second version is draft.
  for(const version of [{id:ids.published,number:1,base:null,status:'published',model:'fixture-published'},{id:ids.draft,number:2,base:ids.published,status:'draft',model:'fixture-current-draft'}]){
   const parameters={baseUrl:'http://127.0.0.1:1/never-call-fixture',temperature:0};
   const contentHash=createHash('sha256').update(JSON.stringify({version,fallback})).digest('hex');
   await client.query(`INSERT INTO new_design.model_route_versions
    (id,config_id,version,base_version_id,source,status,provider,model,parameters,required_capabilities,credential_ref_id,budget_policy,timeout_ms,retry_policy,fallback_mode,content_hash,created_by)
    VALUES($1,$2,$3,$4,'manual',$5,'openai-compatible',$6,$7::jsonb,$8::text[],$9,$10::jsonb,1000,$11::jsonb,'replace',$12,'isolated-postgres-fixture')`,
   [version.id,ids.config,version.number,version.base,version.status,version.model,JSON.stringify(parameters),['structured_output'],ids.credential,JSON.stringify({maxTokens:16}),JSON.stringify({maxRetries:0}),contentHash]);
  }
  await client.query("SELECT new_design.kernel_store_record('model_route_fallback',$1::uuid,$2::uuid,$3::jsonb)",[defaultSpace,ids.fallback,JSON.stringify(fallback)]);
  await client.query('UPDATE new_design.model_route_configs SET current_version_id=$2,published_version_id=$3 WHERE id=$1',[ids.config,ids.draft,ids.published]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{envelope.fill(0);client.release();}
 return{ids,fallback};
}

test('132 model initialization copies only isolated configuration with exact versions, fallback cards and resealed credentials',{
 skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1'&&!process.env.ND_REFERENCE_TEST_BUILD,
 timeout:300000,
},async t=>{
 let httpCalls=0;
 const noModelHttp=()=>{httpCalls++;throw new Error('Model HTTP is forbidden in the isolated initialization test');};
 t.mock.method(globalThis,'fetch',noModelHttp);
 for(const transport of [http,https])for(const method of ['request','get'])t.mock.method(transport,method,noModelHttp);
 const source=await isolatedDatabase(t);
 const target=await isolatedDatabase(t);
 const {sourceConfig,targetConfig}=isolatedConnections(source,target);
 // No production runtime calls: the helper's currentPool now points at target,
 // so every query below deliberately uses its explicit source or target pool.
 await requireBlank132(source);await requireBlank132(target);
 const crypto=compiled('server/database/credentialCrypto');
 const sourceKey=crypto.deriveModelCredentialKey(sourceConfig.password,source.database);
 const targetKey=crypto.deriveModelCredentialKey(targetConfig.password,target.database);
 t.after(()=>{sourceKey.fill(0);targetKey.fill(0);});
 const {ids,fallback}=await seedSource(source.pool,sourceKey,crypto);
 const sourceBefore=await fingerprint(source.pool);
 const result=await copyModelConfiguration({sourceConfig,targetConfig,confirmed:true});
 assert.deepEqual(result,{database:target.database,configs:1,versions:2,fallbacks:1,credentials:1,sourceChanged:false,modelCalled:false,mutationOutcome:'committed'});
 assert.equal(await fingerprint(source.pool),sourceBefore,'source rows and encrypted credentials must remain unchanged');

 for(const table of ['model_route_configs','model_route_versions']){
  const query=`SELECT * FROM new_design.${table} ORDER BY id`;
  assert.deepEqual((await target.pool.query(query)).rows,(await source.pool.query(query)).rows,`${table} must retain exact source values`);
 }
 const route=(await target.pool.query('SELECT current_version_id,published_version_id FROM new_design.model_route_configs WHERE id=$1',[ids.config])).rows[0];
 assert.deepEqual(route,{current_version_id:ids.draft,published_version_id:ids.published});
 const versions=(await target.pool.query('SELECT id,base_version_id,status FROM new_design.model_route_versions ORDER BY version')).rows;
 assert.deepEqual(versions,[{id:ids.published,base_version_id:null,status:'published'},{id:ids.draft,base_version_id:ids.published,status:'draft'}]);
 const fallbacks=await readFallbacks(target.pool);
 assert.equal(fallbacks.length,1);
 assert.notEqual(fallbacks[0].physical_id,ids.fallback,'logical fallback ID is not the physical card ID');
 assert.deepEqual(Object.fromEntries(Object.keys(fallback).map(key=>[key,fallbacks[0].payload[key]])),fallback);
 assert.equal(fallbacks[0].payload.space_id,defaultSpace);
 assert.equal(fallbacks[0].payload.status,'active');
 assert.equal(fallbacks[0].payload.revision,1);
 assert.ok(!Object.keys(fallbacks[0].payload).some(key=>key.startsWith('__legacy')));

 const sourceCredential=(await source.pool.query('SELECT * FROM new_design.model_credential_refs WHERE id=$1',[ids.credential])).rows[0];
 const targetCredential=(await target.pool.query('SELECT * FROM new_design.model_credential_refs WHERE id=$1',[ids.credential])).rows[0];
 const {secret_envelope:sourceEnvelope,...sourceMetadata}=sourceCredential;
 const {secret_envelope:targetEnvelope,...targetMetadata}=targetCredential;
 t.after(()=>{sourceEnvelope.fill(0);targetEnvelope.fill(0);});
 assert.deepEqual(targetMetadata,sourceMetadata);
 assert.ok(Buffer.isBuffer(targetEnvelope)&&!targetEnvelope.equals(sourceEnvelope),'target must contain a different encrypted envelope');
 assert.ok(crypto.openModelCredential(targetEnvelope,targetKey)===fakeSecret,'target key must decrypt the exact fixture secret');
 assert.ok(crypto.openModelCredential(sourceEnvelope,sourceKey)===fakeSecret,'source envelope remains decryptable with its original key');
 assert.throws(()=>crypto.openModelCredential(targetEnvelope,sourceKey));
 assert.throws(()=>crypto.openModelCredential(sourceEnvelope,targetKey));

 const targetBeforeRepeat=await fingerprint(target.pool);
 await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig,confirmed:true}),error=>error.name==='ModelInitializationError'&&error.mutationOutcome==='not_written'&&/拒绝覆盖或重复初始化/.test(error.message));
 assert.equal(await fingerprint(target.pool),targetBeforeRepeat,'rejected repeated initialization must preserve the entire target ledger');
 assert.equal(await fingerprint(source.pool),sourceBefore,'repeated initialization must not mutate the source');
 for(const {pool} of [source,target])for(const table of [...executionTables,'books','chapter_documents','research_documents']){
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM new_design.${table}`)).rows[0].count,0,`${table} must remain empty`);
 }
 assert.equal(httpCalls,0,'configuration transfer must not call a model endpoint');
});

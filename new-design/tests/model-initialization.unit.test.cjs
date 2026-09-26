const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scryptSync,createCipheriv,createDecipheriv}=require('node:crypto');
const {Pool}=require('pg');
const {options,copyModelConfiguration}=require('../scripts/model-init.cjs');

const sourceConfig={database:'author_model_fixture',port:55432,user:'fixture',password:'unit-source-password'};
const targetConfig={...sourceConfig,database:'empty_model_fixture',password:'unit-target-password'};
const configId='10000000-0000-4000-8000-000000000001',versionId='10000000-0000-4000-8000-000000000002';
const credentialId='10000000-0000-4000-8000-000000000003',fallbackId='10000000-0000-4000-8000-000000000004';
const fakeSecret='unit-fixture-secret-not-a-real-key';
function key(config){return scryptSync(config.password,`ai-novel:new-design:credentials:v1:${config.database}`,32);}
function seal(config){
 const secretKey=key(config),iv=Buffer.alloc(12,7),cipher=createCipheriv('aes-256-gcm',secretKey,iv);
 const bytes=Buffer.concat([cipher.update(fakeSecret),cipher.final()]);secretKey.fill(0);
 return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),bytes]);
}
function open(envelope,config){
 const secretKey=key(config),decipher=createDecipheriv('aes-256-gcm',secretKey,envelope.subarray(1,13));
 decipher.setAuthTag(envelope.subarray(13,29));
 try{return Buffer.concat([decipher.update(envelope.subarray(29)),decipher.final()]).toString('utf8');}
 finally{secretKey.fill(0);}
}
function copy(value){if(Buffer.isBuffer(value))return Buffer.from(value);if(Array.isArray(value))return value.map(copy);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)]));return value;}
function fixture(t,overrides={}){
 const calls=[];
 const config={id:configId,scope:'system_default',task_group:null,task_key:null,node_key:null,book_id:null,override_key:null,name:'fixture route',status:'active',current_version_id:versionId,published_version_id:versionId,revision:2,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
 const version={id:versionId,config_id:configId,version:1,base_version_id:null,source:'manual',status:'published',provider:'openai-compatible',model:'fixture-model',parameters:{baseUrl:'http://127.0.0.1:9999'},required_capabilities:[],credential_ref_id:credentialId,budget_policy:{maxTokens:1000},timeout_ms:10000,retry_policy:{maxRetries:0},fallback_mode:'replace',content_hash:'a'.repeat(64),created_by:'fixture',created_at:'2026-01-01T00:00:00Z'};
 const fallback={id:fallbackId,route_version_id:versionId,sort_order:0,provider:'openai-compatible',model:'fixture-fallback',parameters:{baseUrl:'http://127.0.0.1:9998'},credential_ref_id:credentialId,technical_failure_categories:['timeout']};
 const envelope=seal(overrides.wrongKey?{...sourceConfig,password:'different-fixture-password'}:sourceConfig);
 const credential={id:credentialId,credential_key:'fixture-main',provider:'openai-compatible',secret_locator:'secret://database',secret_envelope:envelope,status:'active',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
 function client(which){return{release(){calls.push({which,sql:'release'});},async query(sql,parameters=[]){
  calls.push({which,sql,parameters:copy(parameters)});
  const rows=value=>({rows:value,rowCount:value.length});
  if(/^(BEGIN|ROLLBACK|LOCK TABLE)/.test(sql)||sql.includes('pg_advisory_xact_lock'))return rows([]);
  if(sql==='COMMIT'){if(overrides.commitUnknown)throw new Error('simulated unavailable acknowledgement');return rows([]);}
  if(sql.includes('current_database()'))return rows([{name:which==='source'?sourceConfig.database:targetConfig.database,recovery:false}]);
  if(which==='source'){
   if(sql.includes('FROM new_design.model_route_configs'))return rows(overrides.noDefault?[]:[config]);
   if(sql.includes('FROM new_design.model_route_versions'))return rows([version]);
   if(sql.includes("to_regclass('new_design.system_capabilities')"))return rows([{present:true}]);
   if(sql.startsWith('SELECT details'))return rows([{details:overrides.sourceStyle==='131'?{migration:'131_card_kernel_v2_cutover'}:{storage:'tables_only'}}]);
   if(sql.includes('FROM new_design.cards card'))return rows([{...fallback,origin_table:overrides.sourceStyle==='131'?'model_route_fallbacks':null,origin_id:overrides.corruptOrigin?'different-id':overrides.sourceStyle==='131'?fallbackId:null}]);
   if(sql.includes('FROM new_design.model_credential_refs'))return rows([credential]);
  }else{
   if(sql.includes('schema_migrations'))return rows([{ready:!overrides.notReady}]);
   if(sql.includes(' AS occupied'))return rows([{occupied:!!overrides.occupied}]);
   if(sql.startsWith('INSERT INTO')||sql.startsWith('UPDATE new_design.model_route_configs')||sql.includes('kernel_store_record'))return rows([]);
   if(sql.startsWith('SELECT (SELECT count(*)'))return rows([{configs:1,versions:1,credentials:1,fallbacks:1}]);
  }
  throw new Error('unexpected mock SQL; real database must never be contacted');
 }};}
 t.mock.method(Pool.prototype,'connect',async function(){return client(this.options.database===sourceConfig.database?'source':'target');});
 t.mock.method(Pool.prototype,'end',async()=>undefined);
 return{calls,envelope};
}

test('model initialization arguments require explicit separate target and confirmation',()=>{
 assert.deepEqual(options(['--database','model_target','--confirm-model-copy']),{database:'model_target',port:null,confirmed:true});
 assert.deepEqual(options(['--database','model_target','--port','55585','--confirm-model-copy']),{database:'model_target',port:55585,confirmed:true});
 for(const argv of [[],['--database','model_target'],['--confirm-model-copy'],['--database','postgres','--confirm-model-copy'],['--database','bad-name','--confirm-model-copy'],['--database','model_target','--port','1','--confirm-model-copy'],['--database','model_target','--confirm-model-copy','--confirm-model-copy'],['--database','model_target','--confirm-model-copy','--unknown']])assert.throws(()=>options(argv));
});

test('same author target, unconfirmed input and remote configuration fail before connection',async t=>{
 const connect=t.mock.method(Pool.prototype,'connect',async()=>{throw new Error('must not connect');});
 await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig:sourceConfig,confirmed:true}),/作者库/);
 await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig,confirmed:false}),/明确确认/);
 await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig:{...targetConfig,host:'example.invalid'},confirmed:true}),/同机/);
 assert.equal(connect.mock.callCount(),0);
});

test('nonempty or not-132 target is rolled back without importing anything',async t=>{
 for(const overrides of [{occupied:true},{notReady:true}])await t.test(JSON.stringify(overrides),async t=>{
  const {calls}=fixture(t,overrides);
  await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig,confirmed:true}),error=>error.mutationOutcome==='not_written');
  assert.ok(calls.some(call=>call.which==='target'&&call.sql==='ROLLBACK'));
  assert.equal(calls.filter(call=>call.which==='target'&&/^(INSERT|UPDATE)/.test(call.sql)).length,0);
  assert.ok(calls.some(call=>call.which==='source'&&call.sql==='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
 });
});

test('unmatched credential encryption key aborts without plaintext or target commit',async t=>{
 const {calls}=fixture(t,{wrongKey:true});
 await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig,confirmed:true}),error=>error.mutationOutcome==='not_written'&&/无法用原运行密钥核实/.test(error.message));
 assert.equal(calls.filter(call=>call.sql==='COMMIT').length,0);
 assert.equal(calls.filter(call=>call.which==='target'&&call.sql.startsWith('INSERT')).length,0);
 assert.ok(calls.some(call=>call.which==='target'&&call.sql==='ROLLBACK'));
 assert.ok(!JSON.stringify(calls).includes(fakeSecret));
});

test('131 fallback logical payload is read from cards and credentials are resealed for the target',async t=>{
 const {calls}=fixture(t,{sourceStyle:'131'});
 const result=await copyModelConfiguration({sourceConfig,targetConfig,confirmed:true});
 assert.deepEqual(result,{database:targetConfig.database,configs:1,versions:1,fallbacks:1,credentials:1,sourceChanged:false,modelCalled:false,mutationOutcome:'committed'});
 const read=calls.find(call=>call.which==='source'&&call.sql.includes('FROM new_design.cards card'));
 assert.equal(read.parameters[1],'legacy.model_route_fallbacks');
 assert.equal(calls.filter(call=>call.which==='source'&&/^(INSERT|UPDATE|DELETE|COMMIT)/.test(call.sql)).length,0);
 assert.equal(calls.filter(call=>call.which==='source'&&call.sql.includes('FROM new_design.model_route_fallbacks')).length,0);
 const inserted=calls.find(call=>call.which==='target'&&call.sql.startsWith('INSERT INTO new_design.model_credential_refs'));
 assert.equal(inserted.parameters[0],credentialId);assert.equal(inserted.parameters[1],'fixture-main');
 assert.equal(open(inserted.parameters[4],targetConfig),fakeSecret);
 assert.throws(()=>open(inserted.parameters[4],sourceConfig));
 const fallback=calls.find(call=>call.which==='target'&&call.sql.includes('kernel_store_record'));
 assert.equal(fallback.parameters[0],fallbackId);
 assert.equal(JSON.parse(fallback.parameters[1]).route_version_id,versionId);
 assert.ok(!fallback.parameters[1].includes('__legacy'));assert.ok(!JSON.stringify(calls).includes(fakeSecret));
});

test('corrupt 131 logical origin or absent real default route is not guessed into success',async t=>{
 for(const overrides of [{sourceStyle:'131',corruptOrigin:true},{noDefault:true}])await t.test(JSON.stringify(overrides),async t=>{
  const {calls}=fixture(t,overrides);
  await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig,confirmed:true}));
  assert.equal(calls.filter(call=>call.which==='target').length,0);
 });
});

test('lost commit acknowledgement is unknown and performs no second import',async t=>{
 const {calls}=fixture(t,{commitUnknown:true});
 await assert.rejects(copyModelConfiguration({sourceConfig,targetConfig,confirmed:true}),error=>error.mutationOutcome==='unknown'&&/不重试/.test(error.message));
 assert.equal(calls.filter(call=>call.sql==='COMMIT').length,1);
 assert.equal(calls.filter(call=>call.sql.startsWith('INSERT INTO new_design.model_route_configs')).length,1);
});

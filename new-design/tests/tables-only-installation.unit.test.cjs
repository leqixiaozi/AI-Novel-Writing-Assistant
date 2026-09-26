const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');

// Source-only module loading: no runtime, PostgreSQL pool, or model is imported.
function load(relative,mocks={}){
 const exports={};
 const source=fs.readFileSync(path.join(__dirname,'../src/server',relative),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports',output)(name=>{if(Object.hasOwn(mocks,name))return mocks[name];throw Error(`Unexpected source dependency: ${name}`);},exports);
 return exports;
}
const installation=load('database/tablesOnly.ts');
const baseline='132_card_kernel_tables_only',upgrade='133_card_kernel_tables_only_upgrade';
const errors=load('domain/errors.ts');
const workflow=load('database/cardWorkflow/index.ts',{
 'node:crypto':require('node:crypto'),'../../domain/errors':errors,
 '../store':{DEFAULT_SPACE_ID:'00000000-0000-4000-8000-000000000001'},
});
const readonly=calls=>{assert.ok(calls.length>0);for(const {sql} of calls){assert.match(sql.trim(),/^SELECT\b/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);}};

function installationFixture({migrations=[upgrade],found={ledger:true,capability:true},overrides={},missingResult=false}={}){
 const calls=[];
 const pool={query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(calls.length===1)return {rows:found?[found]:[]};
  assert.equal(calls.length,2);assert.deepEqual(args,[baseline,upgrade]);
  assert.match(sql,/WHERE id IN \(\$1,\$2\)/);
  assert.match(sql,/capability_key='card_kernel_v2' AND installed AND operational AND details->>'storage'='tables_only'/);
  return {rows:missingResult?[]:[{installed:migrations.some(id=>args.includes(id)),ready:true,application_tables:'79',projection_tables:'4',views:'0',compatibility_schema:false,...overrides}]};
 }};
 return {pool,calls,migrations};
}

test('tables-only readiness accepts either the true empty baseline or the retained-data upgrade ledger without registering another migration',async()=>{
 assert.equal(installation.TABLES_ONLY_MIGRATION,baseline);assert.equal(installation.TABLES_ONLY_UPGRADE_MIGRATION,upgrade);
 for(const migration of [baseline,upgrade]){
  const fixture=installationFixture({migrations:[migration]});
  assert.equal(await installation.requireTablesOnlyInstallation(fixture.pool),1);
  assert.deepEqual(fixture.migrations,[migration]);readonly(fixture.calls);
 }
});

test('131 alone and missing migration or capability catalogs fail closed with incremental-upgrade guidance',async()=>{
 for(const options of [{migrations:['131_card_kernel_v2_cutover']},{migrations:[]},{found:null},{found:{ledger:false,capability:true}},{found:{ledger:true,capability:false}},{missingResult:true}]){
  const fixture=installationFixture(options);
  await assert.rejects(installation.requireTablesOnlyInstallation(fixture.pool),error=>{assert.match(error.message,/增量升级/);assert.doesNotMatch(error.message,/独立空库|新建.*库/);return true;});
  readonly(fixture.calls);
 }
});

test('a valid 133 ledger does not bypass capability, 79/4, zero-view, or compatibility-schema requirements',async()=>{
 for(const overrides of [{ready:false},{installed:false},{application_tables:'78'},{application_tables:'80'},{projection_tables:'3'},{projection_tables:'5'},{views:'1'},{views:null},{compatibility_schema:true},{compatibility_schema:null}]){
  const fixture=installationFixture({overrides});
  await assert.rejects(installation.requireTablesOnlyInstallation(fixture.pool),/服务已停止写入/);readonly(fixture.calls);
 }
});

test('unknown database read errors propagate and are never turned into ready state or a write retry',async()=>{
 const failure=new Error('catalog read unavailable');let calls=0;
 await assert.rejects(installation.requireTablesOnlyInstallation({query:async()=>{calls++;throw failure;}}),error=>error===failure);
 assert.equal(calls,1);
});

function workflowFixture({migrations=[upgrade],catalog=true,kernel={installed:true,operational:true,details:{storage:'tables_only'}},feature={},protection={}}={}){
 const calls=[];
 const migrationPresent=sql=>{
  assert.match(sql,/WHERE id IN \('132_card_kernel_tables_only','133_card_kernel_tables_only_upgrade'\)/);
  return migrations.some(id=>id===baseline||id===upgrade);
 };
 const db={query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.includes('IS NOT NULL present'))return {rows:[{present:catalog}]};
  if(sql.includes('feature.installed')){
   assert.deepEqual(args,['test_feature',['creative_hub_thread']]);
   assert.match(sql,/is_internal AND status='published' AND current_version_id IS NOT NULL/);
   assert.match(sql,/card_version_actions_immutable/);assert.match(sql,/details->>'storage'='tables_only'/);
   return {rows:[{installed:true,operational:true,complete:migrationPresent(sql),kernel_ready:kernel.installed&&kernel.operational&&kernel.details.storage==='tables_only',type_count:'1',protected:true,...feature}]};
  }
  if(sql.includes('capability_table'))return {rows:[{capability_table:catalog,migration:migrationPresent(sql)}]};
  if(sql.includes('SELECT installed,operational,details'))return {rows:[kernel]};
  if(sql.includes('IS NOT NULL actions')){assert.deepEqual(args,[['creative_hub_thread']]);assert.match(sql,/status='published'/);assert.match(sql,/card_version_actions_immutable/);return {rows:[{actions:true,immutable:true,type_count:'1',...protection}]};}
  throw Error(`Unexpected capability query: ${sql}`);
 }};
 return {db,calls};
}

test('workflow capability and write gate accept true 132 or 133 ledgers while preserving published-type and action-protection checks',async()=>{
 for(const migration of [baseline,upgrade]){
  const fixture=workflowFixture({migrations:[migration]});
  assert.deepEqual(await workflow.readCardWorkflowCapability(fixture.db,'test_feature',['creative_hub_thread','creative_hub_thread']),{installed:true,operational:true});
  await workflow.requireCardWorkflowTypes(fixture.db,['creative_hub_thread'],true);readonly(fixture.calls);
 }
});

test('incremental upgrade preserves explicitly disabled workflow types instead of silently enabling them',async()=>{
 const fixture=workflowFixture({kernel:{installed:true,operational:true,details:{storage:'tables_only',disabledTypeKeys:['creative_hub_thread']}}});
 await assert.rejects(workflow.requireCardWorkflowTypes(fixture.db,['creative_hub_thread'],true),/停用设置/);
 readonly(fixture.calls);
});

test('workflow capability never promotes old ledgers or unavailable features and guards remain fail closed after 133',async()=>{
 for(const options of [{migrations:['131_card_kernel_v2_cutover']},{catalog:false},{kernel:{installed:true,operational:true,details:{storage:'compatibility'}}},{kernel:{installed:true,operational:false,details:{storage:'tables_only'}}},{feature:{type_count:'0'},protection:{type_count:'0'}},{feature:{protected:false},protection:{immutable:false}},{protection:{actions:false},feature:{protected:false}}]){
  const fixture=workflowFixture(options);
  assert.equal((await workflow.readCardWorkflowCapability(fixture.db,'test_feature',['creative_hub_thread'])).operational,false);
  await assert.rejects(workflow.requireCardWorkflowTypes(fixture.db,['creative_hub_thread'],true),error=>error.status===503);readonly(fixture.calls);
 }
 for(const feature of [{installed:false},{operational:false}]){
  const fixture=workflowFixture({feature});
  assert.equal((await workflow.readCardWorkflowCapability(fixture.db,'test_feature',['creative_hub_thread'])).operational,false);readonly(fixture.calls);
 }
});

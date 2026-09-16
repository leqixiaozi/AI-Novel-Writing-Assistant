const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const runtime=require('../../dist/server/database/runtime');
const {listPromptAssets}=require('../../dist/server/ai/prompts');
const {seedCreationTemplate}=require('../creationProduction/postgresFixture.cjs');

/** Real empty schema, real cloned application, exclusive fresh file root. No cleanup. */
exports.knowledgePipelineFixture=async function(t){
 assert.ok(require.cache[require.resolve('./bootstrap.cjs')],'Knowledge fixture requires the preloaded checked 55583/tmpfs bootstrap before filesystem or pool access');
 assert.equal(process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME,'1');
 const packageRoot=path.resolve(__dirname,'../..'),dataRoot=path.join(packageRoot,'.data'),parent=path.join(dataRoot,'unified-validation');
 const requireRealDirectory=async directory=>{const stat=await fs.lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Fixture directory must be a controlled ordinary directory');assert.equal((await fs.realpath(directory)).toLowerCase(),directory.toLowerCase(),'Fixture directory must not traverse a symlink/junction');};
 await requireRealDirectory(packageRoot);
 for(const directory of [dataRoot,parent]){try{await fs.mkdir(directory);}catch(error){if(error.code!=='EEXIST')throw error;}await requireRealDirectory(directory);}
 const appRoot=await fs.mkdtemp(path.join(parent,'knowledge-pipeline-'));await requireRealDirectory(appRoot);
 assert.equal(path.dirname(appRoot),parent);await fs.cp(path.join(packageRoot,'dist'),path.join(appRoot,'dist'),{recursive:true,errorOnExist:true,force:false});
 const sourceFiles=['server/application/knowledgeReference/files.js','server/ai/knowledgeEmbedding/receipts.js'];
 const digest=async base=>Promise.all(sourceFiles.map(async file=>createHash('sha256').update(await fs.readFile(path.join(base,'dist',file))).digest('hex')));
 assert.deepEqual(await digest(appRoot),await digest(packageRoot),'Compiled source is copied byte-for-byte, not path-patched');
 // Outer --require bootstrap owns the only connection identity check (55583/tmpfs).
 const basePool=await runtime.getNewDesignPool(),schema=`knowledge_pipeline_test_${randomUUID().replaceAll('-','')}`;
 const assetIds=listPromptAssets().map(asset=>asset.assetId),rewrite=sql=>{
  const protectedText=assetIds.reduce((value,id,index)=>value.replaceAll(id,`__ASSET_${index}__`),sql);
  return assetIds.reduce((value,id,index)=>value.replaceAll(`__ASSET_${index}__`,id),protectedText.replace(/\bnew_design\b/g,schema));
 };
 const setup=await basePool.connect();
 try{
  const locatorConstraint=(await setup.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='new_design.asset_content_objects'::regclass AND conname='asset_content_objects_storage_locator_check' AND contype='c'")).rows[0];
  assert.ok(locatorConstraint,'Actual locator constraint must exist before cloning');
  assert.ok(!locatorConstraint.definition.includes('{0,999}'),'Actual locator constraint must contain the PostgreSQL-safe 075 repair, not the historical invalid repetition');
  assert.match(locatorConstraint.definition,/length\(storage_locator\)\s*>=\s*1/,'Actual locator constraint must retain minimum length');
  assert.match(locatorConstraint.definition,/length\(storage_locator\)\s*<=\s*1000/,'Actual locator constraint must retain maximum length');
  assert.ok(locatorConstraint.definition.includes('^[A-Za-z0-9][A-Za-z0-9._/-]*$'),'Actual locator constraint must retain the character whitelist');
  assert.ok(locatorConstraint.definition.includes('!~'),'Actual locator constraint must retain unsafe path exclusions');
  for(const exclusion of ['^[A-Za-z]:','://','//','(/|$)'])assert.ok(locatorConstraint.definition.includes(exclusion),`Actual locator constraint must retain path exclusion ${exclusion}`);
  const guardedFunctions=['guard_knowledge_build_receipt','validate_knowledge_embedding_freeze','guard_knowledge_embedding_execution','guard_knowledge_embedding_result','validate_visual_source_receipt','validate_visual_preview_source','guard_visual_active_mount'];
  const scopes=(await setup.query("SELECT p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='new_design' AND p.proname=ANY($1::text[])",[guardedFunctions])).rows;
  for(const name of guardedFunctions){const row=scopes.find(row=>row.proname===name);assert.ok(row,`Missing actual guard ${name}`);assert.ok(row.proconfig?.some(setting=>/^search_path=/.test(setting)&&setting.includes('new_design')&&setting.includes('public')),`${name} must have production explicit search_path; fixture SET must not conceal missing scope`);}
  await setup.query(`CREATE SCHEMA ${schema}`);await setup.query(`SET search_path TO ${schema},public`);
  const tables=(await setup.query("SELECT tablename FROM pg_tables WHERE schemaname='new_design' ORDER BY tablename")).rows;
  for(const {tablename}of tables)await setup.query(`CREATE TABLE ${schema}.${tablename}(LIKE new_design.${tablename} INCLUDING ALL)`);
  const fks=(await setup.query("SELECT r.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='new_design' AND c.contype='f' ORDER BY r.relname,c.conname")).rows;
  for(const row of fks)await setup.query(`ALTER TABLE ${schema}.${row.table_name} ADD CONSTRAINT ${row.conname} ${rewrite(row.definition)}`);
  const functions=(await setup.query("SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='new_design' AND p.prokind='f' AND l.lanname IN ('sql','plpgsql') ORDER BY p.oid")).rows;
  for(const row of functions)await setup.query(rewrite(row.definition));
  const triggers=(await setup.query("SELECT pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='new_design' AND NOT t.tgisinternal ORDER BY r.relname,t.tgname")).rows;
  for(const row of triggers)await setup.query(rewrite(row.definition));
  // Original infrastructure catalogue only, no application facts or author data.
  const migration=await fs.readFile(path.join(packageRoot,'migrations','030_postgres_outbox_job_runtime.sql'),'utf8');
  for(const table of ['outbox_event_topics','background_job_handlers','outbox_consumers']){const statement=migration.match(new RegExp(`INSERT INTO ${table}\\([^;]+;`));assert.ok(statement);await setup.query(rewrite(statement[0]));}
 }finally{setup.release();}
 const fault={predicate:null,count:0},sqlFailures=[];
 const pool={connect:async()=>{
  const client=await basePool.connect();await client.query(`SET search_path TO ${schema},public`);
  return new Proxy(client,{get(target,key){if(key==='query')return async(sql,values)=>{
   const text=typeof sql==='string'?sql:sql.text;
   try{if(fault.predicate&&fault.predicate(text,values)){fault.predicate=null;fault.count++;return await target.query('SELECT 1/0');}
    return await target.query(typeof sql==='string'?rewrite(sql):{...sql,text:rewrite(text)},values);
   }catch(error){sqlFailures.push({code:error.code,routine:error.routine,...(error.code==='42702'?{message:error.message,functionContext:String(error.where??'').split('\n').filter(line=>/^PL\/pgSQL function /.test(line)).map(line=>line.slice(0,240))}:{}),statement:text.slice(0,180),expectedFixtureBoundary:text.includes('knowledge_pipeline_boundary_fixture')});throw error;}
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 },query:async(sql,values)=>{const client=await pool.connect();try{return await client.query(sql,values);}finally{client.release();}}};
 const clonedRuntime=require(path.join(appRoot,'dist/server/database/runtime'));clonedRuntime.getNewDesignPool=async()=>pool;
 for(const name of ['getDatabaseRuntimeStatus','getPrivateRuntimeStatus','getPrivateRuntimeDiagnostics','stopNewDesignDatabase'])if(name in clonedRuntime)clonedRuntime[name]=async()=>{throw new Error('Knowledge fixture cannot access developer runtime controls');};
 const load=relative=>require(path.join(appRoot,'dist',relative)),config=await seedCreationTemplate(pool);
 const template=load('server/database/templateStore'),book=await template.createBook({key:`knowledge_pipeline_${randomUUID()}`,name:'知识流水线隔离书',description:'仅测试夹具',templateVersionId:config.version},{includeTemplateSeed:false});
 const otherBook=await template.createBook({key:`knowledge_other_${randomUUID()}`,name:'跨书边界隔离书',description:'仅测试夹具',templateVersionId:config.version},{includeTemplateSeed:false});
 t.after(async()=>{await pool.query("UPDATE new_design.books SET status='archived' WHERE id=ANY($1::uuid[])",[[book.id,otherBook.id]]);assert.deepEqual(await digest(appRoot),await digest(packageRoot));await basePool.end();});
 return{appRoot,schema,pool,book,otherBook,fault,sqlFailures,load};
};

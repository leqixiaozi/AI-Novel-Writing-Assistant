const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

// This file may NEVER enter the ordinary developer runtime. Fail before obtaining
// any pool unless the explicitly approved, hard-checked preload is present.
const preload=require.resolve('./unifiedPostgres/bootstrap.cjs');
const runtime=require('../dist/server/database/runtime');
const models=require('../dist/server/database/modelManagement');
const knowledge=require('../dist/server/database/knowledgeIndex');
const templates=require('../dist/server/database/templateStore');
const {stableHash}=require('../dist/server/database/aiContracts');
const {withKnowledgeReferencePool}=require('../dist/server/database/knowledgeReference');

test('real isolated PostgreSQL: original embedding connection and knowledge preparation receipts',{timeout:60000},async t=>{
 assert.equal(process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME,'1','Only the approved unified validation process may run this fixture');
 assert.ok(require.cache[preload],'Explicit --require ./tests/unifiedPostgres/bootstrap.cjs is required');
 const pool=await runtime.getNewDesignPool();
 t.after(()=>pool.end()); // Connections only; fixtures and container remain intact.
 // Forward every call to the ACTUAL checked PostgreSQL client. Domain errors
 // intentionally redact SQL; capture fixture-only evidence without mocking rows,
 // injecting failures, reading credentials or logging bound parameter values.
 async function withSqlEvidence(action){
  let evidence;
  const traced={async connect(){const client=await pool.connect();return new Proxy(client,{get(target,key){if(key==='query')return async(...args)=>{try{return await target.query(...args);}catch(error){evidence={code:error.code,constraint:error.constraint,message:error.message,statement:args[0]};throw error;}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
  try{return await withKnowledgeReferencePool(traced,action);}catch(error){if(evidence)t.diagnostic(`Real isolated PostgreSQL error: ${JSON.stringify(evidence)}`);throw error;}
 }
 const identity=(await pool.query("SELECT current_database() name,current_setting('new_design.validation_scope',true) scope")).rows[0];
 assert.equal(identity.name,'new_design_unified_20260917');assert.equal(identity.scope,'unified-20260917');
 const priorConfig=(await pool.query("SELECT id,revision FROM new_design.model_route_configs WHERE scope='task_group' AND task_group='knowledge_embedding' AND task_key IS NULL AND status='active' AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL")).rows;
 assert.ok(priorConfig.length<=1,'The original embedding config must be unambiguous');
 const input={provider:'ollama',endpoint:'  http://127.0.0.1:1  ',model:`  pg-embedding-${randomUUID().slice(0,8)}  `,credentialId:null,timeoutMs:1000,maxRetries:0,retryDelayMs:0,expectedConfigId:priorConfig[0]?.id??null,expectedRevision:priorConfig[0]?Number(priorConfig[0].revision):null,idempotencyKey:randomUUID()};
 const normalized={...input,endpoint:input.endpoint.trim(),model:input.model.trim()};
 let saved,next,book,otherBook,profile;

 await t.test('save publishes an exact original version and a full normalized input hash',async()=>{
  saved=await models.saveManagedEmbeddingConnection(input);
  assert.equal(saved.repeated,false);assert.equal(saved.active,true);
  assert.equal(saved.connection.endpoint,normalized.endpoint);assert.equal(saved.connection.model,normalized.model);
  assert.equal(saved.connection.connectionHash,stableHash(normalized));
  assert.equal(saved.connection.id,saved.savedVersionId);assert.equal(saved.configRevision,(input.expectedRevision??1)+1);
  const version=(await pool.query('SELECT config_id,required_capabilities,parameters,content_hash FROM new_design.model_route_versions WHERE id=$1',[saved.savedVersionId])).rows[0];
  assert.equal(version.config_id,saved.connection.configId);assert.deepEqual(version.required_capabilities,['embedding']);
  assert.deepEqual(version.parameters,{baseUrl:normalized.endpoint});assert.equal(version.content_hash,saved.connection.connectionHash);
 });
 await t.test('parallel same-key saves and original-key GET return only the original publication',async()=>{
  const repeated=await Promise.all([models.saveManagedEmbeddingConnection(input),models.saveManagedEmbeddingConnection(normalized)]);
  for(const item of repeated){assert.equal(item.repeated,true);assert.equal(item.savedVersionId,saved.savedVersionId);}
  const receipt=await models.readManagedEmbeddingSaveReceipt(input.idempotencyKey);
  assert.equal(receipt.savedVersionId,saved.savedVersionId);assert.equal(receipt.connection.connectionHash,stableHash(normalized));
  assert.equal(Number((await pool.query('SELECT count(*) value FROM new_design.ai_contract_publications WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0].value),1);
 });
 await t.test('every persisted connection, policy and optimistic-identity field participates in same-key conflict detection',async()=>{
  const changes=[{provider:'openai-compatible'},{endpoint:'http://127.0.0.1:2'},{model:'another-embedding'},{credentialId:randomUUID()},{timeoutMs:2000},{maxRetries:1},{retryDelayMs:1},{expectedConfigId:randomUUID(),expectedRevision:1}];
  for(const change of changes)await assert.rejects(models.saveManagedEmbeddingConnection({...normalized,...change}),error=>error instanceof models.ManagedEmbeddingConfigurationError&&error.status===409);
  const receipt=await models.readManagedEmbeddingSaveReceipt(input.idempotencyKey);
  assert.equal(receipt.savedVersionId,saved.savedVersionId);assert.equal(receipt.connection.connectionHash,stableHash(normalized));
  assert.equal(Number((await pool.query('SELECT count(*) value FROM new_design.model_route_versions WHERE config_id=$1',[saved.connection.configId])).rows[0].value),saved.savedVersion);
 });
 await t.test('a later publication cannot replace the original receipt revision, hash or historical version',async()=>{
  next=await models.saveManagedEmbeddingConnection({...normalized,model:`${normalized.model}-next`,expectedConfigId:saved.connection.configId,expectedRevision:saved.configRevision,idempotencyKey:randomUUID()});
  const receipt=await models.readManagedEmbeddingSaveReceipt(input.idempotencyKey),historical=await models.readManagedEmbeddingConnectionVersion(saved.savedVersionId);
  assert.equal(next.configRevision,saved.configRevision+1);assert.equal(receipt.configRevision,saved.configRevision);
  assert.equal(receipt.active,false);assert.equal(receipt.savedVersionId,saved.savedVersionId);
  assert.equal(receipt.connection.connectionHash,stableHash(normalized));assert.equal(historical.model,normalized.model);
  assert.equal(historical.connectionHash,saved.connection.connectionHash);
  assert.equal((await models.saveManagedEmbeddingConnection(input)).savedVersionId,saved.savedVersionId);
 });
 await t.test('profile creation stores the exact original connection FK and recovers the same original key without duplication',async()=>{
  const template=(await pool.query('SELECT id FROM new_design.template_group_versions ORDER BY created_at,id LIMIT 1')).rows[0];assert.ok(template);
  const token=randomUUID();
  book=await templates.createBook({key:`knowledge_pg_${token}`,name:'知识索引独立数据库回归',description:'测试 fixture，不调用模型',templateVersionId:template.id});
  otherBook=await templates.createBook({key:`knowledge_pg_other_${token}`,name:'另一部隔离验证书',description:'测试 fixture',templateVersionId:template.id});
  const profileInput={requestKey:randomUUID(),connectionVersionId:saved.savedVersionId,name:'精确两维测试规格',dimensions:2,maxChunkChars:128,overlapChars:0,distanceMetric:'cosine',normalize:false};
  profile=await withSqlEvidence(()=>knowledge.createKnowledgeProfile(book.id,profileInput));profile.input=profileInput;
  const repeated=await knowledge.createKnowledgeProfile(book.id,profileInput),receipt=await knowledge.getKnowledgeProfileByKey(book.id,profileInput.requestKey);
  assert.equal(repeated.repeated,true);assert.equal(receipt.profileVersionId,profile.profileVersionId);
  assert.equal(receipt.inputHash,stableHash({contract:'knowledge_profile_v1',bookId:book.id,input:profileInput}));
  const row=(await pool.query('SELECT * FROM new_design.embedding_profile_versions WHERE id=$1',[profile.profileVersionId])).rows[0];
  assert.equal(row.connection_version_id,saved.savedVersionId);assert.equal(row.provider_key,normalized.provider);assert.equal(row.model_key,normalized.model);assert.equal(row.dimensions,2);
  assert.equal(row.knowledge_profile_book_id,book.id);assert.equal(row.knowledge_profile_key,profileInput.requestKey);
  assert.equal(Number((await pool.query('SELECT count(*) value FROM new_design.embedding_profile_versions WHERE knowledge_profile_key=$1',[profileInput.requestKey])).rows[0].value),1);
 });
 await t.test('same profile key with changed dimensions or another book preserves the committed original and rejects replacement',{skip:!profile&&'Blocked by failed profile creation above'},async()=>{
  for(const [bookId,patch] of [[book.id,{dimensions:3}],[otherBook.id,{}]])await assert.rejects(knowledge.createKnowledgeProfile(bookId,{...profile.input,...patch}),error=>error instanceof knowledge.OriginalKnowledgeRequestConflict&&error.status===409&&error.recovery.mutationOutcome==='unknown');
  assert.equal(await knowledge.getKnowledgeProfileByKey(otherBook.id,profile.input.requestKey),null);
  assert.equal((await knowledge.getKnowledgeProfileByKey(book.id,profile.input.requestKey)).profileVersionId,profile.profileVersionId);
 });
 await t.test('preparation rejects mismatched connection and unparsed source without creating a request or attempt',{skip:!profile&&'Blocked by failed profile creation above'},async()=>{
  const base={requestKey:randomUUID(),profileVersionId:profile.profileVersionId,connectionVersionId:saved.savedVersionId,sources:[{assetId:randomUUID(),sourceVersionId:randomUUID(),parsedVersionId:randomUUID(),checksum:'a'.repeat(64)}]};
  for(const patch of [{connectionVersionId:next.savedVersionId},{}]){
   const value={...base,...patch,requestKey:randomUUID()};
   await assert.rejects(knowledge.prepareKnowledgeIndex(book.id,value),error=>error instanceof knowledge.KnowledgeEmbeddingError&&error.recovery.modelRequestState==='not_sent'&&error.recovery.mutationOutcome==='not_written');
   assert.equal(await knowledge.getKnowledgeIndexByKey(book.id,value.requestKey),null);
  }
  for(const table of ['chunking_requests','embedding_requests'])assert.equal(Number((await pool.query(`SELECT count(*) value FROM new_design.${table} WHERE book_id=$1`,[book.id])).rows[0].value),0);
  assert.equal(Number((await pool.query('SELECT count(*) value FROM new_design.embedding_attempts attempt JOIN new_design.embedding_requests request ON request.id=attempt.request_id WHERE request.book_id=$1',[book.id])).rows[0].value),0);
 });
 // Deliberately not represented as passing coverage: positive parsed-file/source
 // preparation, claim leases, retained provider replies and pgvector generation.
 // Those need a separately isolated managed-file adapter plus real reply evidence;
 // this fixture neither writes production data/assets nor fabricates model output.
});

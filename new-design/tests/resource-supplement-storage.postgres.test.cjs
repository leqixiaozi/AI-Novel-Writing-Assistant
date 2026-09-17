const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs');
const key=()=>randomUUID(),hash=value=>compiled('server/database/aiContracts').stableHash(value);
const manual={id:'087_stable_resource_supplements',fileName:'087_stable_resource_supplements.sql'};

test('manual stable supplement storage preserves terminal history and refuses incomplete closure',async t=>{
 const fixture=await resourceSupplementFixture(t,[manual]),{pool,book,chapter,planning,volume,planContent,supplements}=fixture;
 const first=await chapter(1,1,true),basis=await transaction(client=>supplements.readStableResourceSupplementBasisInTransaction(client,book.id,first.checkpoint.id));
 const originals=async()=> (await pool.query(`SELECT to_jsonb(document) document,to_jsonb(body) body,to_jsonb(session) session,
  to_jsonb(settlement) settlement,to_jsonb(checkpoint) checkpoint
  FROM new_design.chapter_stable_checkpoints checkpoint JOIN new_design.chapter_documents document ON document.id=checkpoint.chapter_document_id
  JOIN new_design.chapter_body_versions body ON body.id=checkpoint.body_version_id
  JOIN new_design.chapter_adoption_sessions session ON session.id=checkpoint.session_id JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id
  WHERE checkpoint.id=$1`,[first.checkpoint.id])).rows[0];
 const before=await originals();
 async function transaction(action,commit=false){const client=await pool.connect();try{await client.query('BEGIN');const result=await action(client);await client.query(commit?'COMMIT':'ROLLBACK');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
 async function insertChild(client,{receipt=true,baseId=first.checkpoint.id,kind='resource_supplement',bodyId=basis.bodyVersionId}={}){
  const preparationId=key(),sessionId=key(),requestKey=key(),dependency={...basis.original.preparation.dependency_snapshot,supplementBaseCheckpointId:baseId,documentRevision:basis.documentRevision},dependencyHash=hash(dependency);
  await client.query(`INSERT INTO new_design.chapter_adoption_preparations(id,book_id,chapter_document_id,body_version_id,expected_document_revision,
   planning_object_id,planning_version_id,planning_content_hash,context_manifest_id,dependency_snapshot,dependency_hash,status,idempotency_key,supplement_base_checkpoint_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'consumed',$12,$13)`,[preparationId,book.id,basis.chapterDocumentId,bodyId,basis.documentRevision,basis.planningObjectId,basis.planningVersionId,basis.original.planning_version.content_hash,basis.contextManifestId,JSON.stringify(dependency),dependencyHash,key(),baseId]);
  await client.query(`INSERT INTO new_design.chapter_adoption_sessions(id,book_id,chapter_document_id,body_version_id,preparation_id,adoption_id,policy_version_id,
   planning_object_id,planning_version_id,context_manifest_id,dependency_hash,adoption_kind,status,idempotency_key,supplement_base_checkpoint_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'adopted_pending_proposals',$13,$14)`,[sessionId,book.id,basis.chapterDocumentId,bodyId,preparationId,basis.adoptionId,basis.policyVersionId,basis.planningObjectId,basis.planningVersionId,basis.contextManifestId,dependencyHash,kind,key(),baseId]);
  const input={requestKey,checkpointId:baseId,expectedSourceHash:basis.sourceHash},inputHash=hash({bookId:book.id,input}),original={sessionId,bookId:book.id,baseCheckpointId:baseId,bodyVersionId:bodyId,preparationId,requestKey,input,inputHash};
  if(receipt)await client.query(`INSERT INTO new_design.chapter_resource_supplements(session_id,book_id,base_checkpoint_id,request_key,full_input,input_hash,source_snapshot,source_hash,original_receipt)
   VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9::jsonb)`,[sessionId,book.id,baseId,requestKey,JSON.stringify(input),inputHash,JSON.stringify({basis}),basis.sourceHash,JSON.stringify(original)]);
  return{sessionId,preparationId,requestKey,input,inputHash,original};
 }
 await t.test('ordinary primary pipeline remains unchanged and retains all confirmed sources',async()=>{
  assert.equal(basis.confirmed.facts.length,1);assert.equal(basis.confirmed.knowledge.length,1);assert.equal(basis.confirmed.states.length,1);
  assert.equal((await pool.query("SELECT operational FROM new_design.resource_supplement_capabilities")).rows[0].operational,false);
  const registered=compiled('server/database/migrations').migrations;assert.ok(!registered.some(item=>item.id===manual.id));
 });
 await t.test('original terminal session and checkpoint summary cannot be reopened or rewritten',async()=>{
  await assert.rejects(transaction(client=>client.query("UPDATE new_design.chapter_adoption_sessions SET status='pending_review',revision=revision+1 WHERE id=$1",[basis.sessionId])),error=>error.code==='23514');
  await assert.rejects(transaction(client=>client.query("UPDATE new_design.chapter_stable_checkpoints SET summary='{}' WHERE id=$1",[basis.checkpointId])),error=>error.code==='23514');
  await assert.rejects(transaction(client=>client.query("DELETE FROM new_design.chapter_stable_checkpoints WHERE id=$1",[basis.checkpointId])),error=>error.code==='23514');
  assert.deepEqual(await originals(),before);
 });
 await t.test('new child without its atomic original input receipt cannot commit',async()=>{
  await assert.rejects(transaction(async client=>{await insertChild(client,{receipt:false});await client.query('SET CONSTRAINTS ALL IMMEDIATE');}),error=>error.code==='23514'&&/full original receipt/.test(error.message));
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,0);
 });
 await t.test('wrong base, body or adoption kind cannot masquerade as an independent supplement',async()=>{
  for(const options of [{baseId:key()},{bodyId:key()},{kind:'first_adoption'}])await assert.rejects(transaction(client=>insertChild(client,options)),error=>['23514','23503'].includes(error.code));
  assert.deepEqual(await originals(),before);
 });
 let child;
 await t.test('fresh preparation uses original body plan even after a later plan is adopted',async()=>{
  let changed=await planning.addPlanningVersion(first.object.id,{content:{...planContent,notes:'后来策划'},source:'manual',executionMode:'ai_assisted',basedOnParentVersionId:volume.adoptedVersionId,references:[],expectedRevision:first.object.revision,idempotencyKey:key()});changed=await planning.adoptPlanningVersion(changed.id,{versionId:changed.currentVersionId,expectedRevision:changed.revision,idempotencyKey:key()});
  assert.notEqual(changed.adoptedVersionId,basis.planningVersionId);
  const contenders=await Promise.allSettled([transaction(client=>insertChild(client),true),transaction(client=>insertChild(client),true)]),saved=contenders.filter(result=>result.status==='fulfilled'),refused=contenders.filter(result=>result.status==='rejected');
  assert.equal(saved.length,1);assert.equal(refused.length,1);assert.equal(refused[0].reason.code,'23505');child=saved[0].value;assert.deepEqual(await originals(),before);
  const rows=(await pool.query('SELECT * FROM new_design.chapter_resource_supplements WHERE book_id=$1 AND request_key=$2',[book.id,child.requestKey])).rows;assert.equal(rows.length,1);assert.deepEqual(rows[0].original_receipt,child.original);
 });
 await t.test('original full receipt and immutable base cannot be overwritten',async()=>{
  await assert.rejects(transaction(client=>client.query("UPDATE new_design.chapter_resource_supplements SET full_input='{}' WHERE session_id=$1",[child.sessionId])),error=>error.code==='23514');
  await assert.rejects(transaction(client=>client.query('UPDATE new_design.chapter_adoption_sessions SET supplement_base_checkpoint_id=NULL,revision=revision+1 WHERE id=$1',[child.sessionId])),error=>error.code==='23514');
  await assert.rejects(transaction(client=>client.query('UPDATE new_design.chapter_adoption_sessions SET adoption_id=NULL,revision=revision+1 WHERE id=$1',[child.sessionId])),error=>error.code==='23514');
 });
 await t.test('another active child cannot attach to the same original chapter',async()=>{
  await assert.rejects(transaction(client=>insertChild(client),true),error=>error.code==='23505');
 });
 await t.test('resource child cannot reuse an original fact item as new confirmation',async()=>{
  await assert.rejects(transaction(client=>client.query(`INSERT INTO new_design.chapter_settlement_items(id,session_id,category,title,canonical_fact_id,evidence_anchor_id,risk_level,after_value,source_kind)
   VALUES($1,$2,'fact','复制原事实',$3,$4,'medium','1'::jsonb,'manual')`,[key(),child.sessionId,basis.confirmed.facts[0],first.workspace.items.find(item=>item.canonicalFactId).evidenceAnchorId])),error=>error.code==='23514'&&/frozen resource scope/.test(error.message));
 });
 await t.test('ordinary settlement cannot lose original confirmations or bypass downstream closure',async()=>{
  await assert.rejects(transaction(async client=>{
   await client.query("UPDATE new_design.chapter_adoption_sessions SET status='settling',revision=revision+1 WHERE id=$1",[child.sessionId]);
   await client.query(`INSERT INTO new_design.chapter_settlements(id,book_id,chapter_document_id,body_version_id,status,idempotency_key,supplement_base_checkpoint_id)
    VALUES($1,$2,$3,$4,'committed',$5,$6)`,[key(),book.id,basis.chapterDocumentId,basis.bodyVersionId,key(),basis.checkpointId]);
   await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  }),error=>error.code==='23514'&&/retain original settlement/.test(error.message));
  await assert.rejects(transaction(client=>client.query('UPDATE new_design.resource_supplement_capabilities SET operational=true')),error=>error.code==='23514');
  assert.deepEqual(await originals(),before);
 });
 await t.test('merged checkpoint cannot omit, duplicate or invent original confirmations; complete merge is still disabled',async()=>{
  for(const variant of ['omit','duplicate','invent','complete']){
   await assert.rejects(transaction(async client=>{
    const settlementId=key(),confirmed=structuredClone(basis.confirmed);
    if(variant==='omit')confirmed.states=[];if(variant==='duplicate')confirmed.facts.push(confirmed.facts[0]);if(variant==='invent')confirmed.knowledge.push(key());
    await client.query("UPDATE new_design.chapter_adoption_sessions SET status='settling',revision=revision+1 WHERE id=$1",[child.sessionId]);
    await client.query(`INSERT INTO new_design.chapter_settlements(id,book_id,chapter_document_id,body_version_id,status,idempotency_key,supplement_base_checkpoint_id)
     VALUES($1,$2,$3,$4,'committed',$5,$6)`,[settlementId,book.id,basis.chapterDocumentId,basis.bodyVersionId,key(),basis.checkpointId]);
    await client.query("UPDATE new_design.chapter_stable_checkpoints SET status='superseded' WHERE id=$1",[basis.checkpointId]);
    await client.query(`INSERT INTO new_design.chapter_stable_checkpoints(id,book_id,chapter_document_id,body_version_id,session_id,settlement_id,previous_checkpoint_id,chapter_order,summary,dependency_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[key(),book.id,basis.chapterDocumentId,basis.bodyVersionId,child.sessionId,settlementId,basis.checkpointId,basis.chapterOrder,JSON.stringify({confirmed,supplementBaseCheckpointId:basis.checkpointId}),hash({variant})]);
    await client.query("UPDATE new_design.chapter_adoption_sessions SET settlement_id=$2,status='stable',revision=revision+1 WHERE id=$1",[child.sessionId,settlementId]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
   }),error=>error.code==='23514'&&(variant==='complete'?/not operational/.test(error.message):/omit, duplicate or invent/.test(error.message)));
   assert.deepEqual(await originals(),before);
  }
 });
 await t.test('unfinished storage child cannot call ordinary AI, commit or establish retrospective initial state',async()=>{
  const {settlement,actor,late}=fixture,workspace=await settlement.getChapterSettlementEditingWorkspace(child.sessionId),field=workspace.catalog.subjects.find(item=>item.id===actor.id).fields.find(item=>item.key===late);
  await assert.rejects(settlement.commitChapterSettlementEditing(child.sessionId,{expectedSessionRevision:workspace.session.revision,requestKey:key()}),error=>error.status===503&&error.recovery?.mutationOutcome==='not_written');
  await assert.rejects(settlement.establishChapterSettlementEditingInitialState(child.sessionId,{expectedSessionRevision:workspace.session.revision,requestKey:key(),subjectKind:'card',subjectId:actor.id,stateKey:late,specificationHash:field.specificationHash,value:0}),error=>error.status===503&&error.recovery?.mutationOutcome==='not_written');
  assert.ok(workspace.blockedReason);const requests=compiled('server/ai/chapterSettlement/requests');
  for(const candidate of [workspace,{...workspace,session:{...workspace.session,adoptionKind:'first_adoption'}}])await assert.rejects(requests.claimSettlementAi(candidate,{requestKey:key(),expectedSessionRevision:workspace.session.revision,catalogHash:workspace.catalog.specificationHash}),error=>error.status===503);
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_proposal_extraction_requests')).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.entity_initial_states WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,actor.id,late])).rows[0].n,0);
 });
 await t.test('creation adds no body adoption, formal state, fact, knowledge or AI task',async()=>{
  const counts=(await pool.query(`SELECT (SELECT count(*) FROM new_design.chapter_body_adoptions) adoptions,
   (SELECT count(*) FROM new_design.chapter_body_versions) bodies,(SELECT count(*) FROM new_design.chapter_settlements) settlements,
   (SELECT count(*) FROM new_design.canonical_facts) facts,(SELECT count(*) FROM new_design.knowledge_state_changes) knowledge,
   (SELECT count(*) FROM new_design.state_changes) states,(SELECT count(*) FROM new_design.ai_tasks) ai`)).rows[0];
  assert.deepEqual(counts,{adoptions:'1',bodies:'1',settlements:'1',facts:'1',knowledge:'1',states:'1',ai:'0'});
  assert.deepEqual(await originals(),before);
 });
 await t.test('deactivation retains the complete child receipt and original history',async()=>{
  const fs=require('node:fs'),path=require('node:path');await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback/087_stable_resource_supplements.sql'),'utf8'));
  assert.deepEqual((await pool.query('SELECT original_receipt FROM new_design.chapter_resource_supplements WHERE session_id=$1',[child.sessionId])).rows[0].original_receipt,child.original);
  assert.deepEqual(await originals(),before);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='chapter_resource_supplement_closure_required' AND NOT tgisinternal")).rows[0].n,1);
 });
});

const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const key=()=>randomUUID();

test('stable supplement sources retain original confirmations and use chapter-end historical state',async t=>{
 const {pool,book,actor,quantity,holding,late,zero,initialQty,initialHolding,initialZero,volume,planContent,chapter,state,planning,supplements}=await require('./support/resourceSupplementFixture.cjs').resourceSupplementFixture(t);
 const first=await chapter(1,1,true);
 async function read(action){const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await action(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
 const basis=await read(client=>supplements.readStableResourceSupplementBasisInTransaction(client,book.id,first.checkpoint.id));
 const stateInput={bookId:book.id,checkpointId:first.checkpoint.id,subjectKind:'card',subjectId:actor.id,stateKey:quantity};
 await t.test('original body, planning version and all three kinds of confirmations are frozen without reopening',async()=>{
  assert.equal(basis.bodyVersionId,first.version.id);assert.equal(basis.bodyContent,first.content);assert.equal(basis.planningVersionId,first.object.adoptedVersionId);assert.equal(basis.preparationId,first.preparation.id);
  assert.equal(basis.confirmed.facts.length,1);assert.equal(basis.confirmed.knowledge.length,1);assert.equal(basis.confirmed.states.length,1);
  assert.deepEqual(basis.original.checkpoint.summary.confirmed,basis.confirmed);assert.equal(basis.original.session.status,'stable');assert.equal(basis.original.settlement.status,'committed');
  const cutoff=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,stateInput));assert.equal(cutoff.value,1);assert.equal(cutoff.sourceId,basis.confirmed.states[0]);assert.equal(cutoff.sourceKind,'state_change');assert.notEqual(cutoff.sourceId,initialQty.currentVersionId);
 });
 const beforeFollowing=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,stateInput)),second=await chapter(2,2);
 await t.test('next-chapter context reads actual checkpoint confirmation ids and refuses a missing merged source',async()=>{
  const settlement=require('./support/isolatedDatabase.cjs').compiled('server/database/chapterSettlement');
  const context=await settlement.getNextChapterStableContext(book.id,second.card.id);assert.equal(context.previousCheckpoint.id,first.checkpoint.id);
  assert.equal(context.recentStateChanges[0].id,basis.confirmed.states[0]);assert.equal(context.recentStateChanges[0].afterValue,1);
  const summary=(await pool.query('SELECT summary FROM new_design.chapter_stable_checkpoints WHERE id=$1',[first.checkpoint.id])).rows[0].summary;
  await pool.query("UPDATE new_design.chapter_stable_checkpoints SET summary=jsonb_set(summary,'{confirmed,states}',$2::jsonb) WHERE id=$1",[first.checkpoint.id,JSON.stringify([randomUUID()])]);
  try{await assert.rejects(settlement.getNextChapterStableContext(book.id,second.card.id),error=>error.status===409);}finally{await pool.query('UPDATE new_design.chapter_stable_checkpoints SET summary=$2::jsonb WHERE id=$1',[first.checkpoint.id,JSON.stringify(summary)]);}
 });
 await t.test('later committed chapter and latest projection cannot leak into an earlier stable chapter',async()=>{
  assert.equal((await pool.query('SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,actor.id,quantity])).rows[0].value_json,2);
  const earlier=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,stateInput));assert.equal(earlier.value,1);assert.equal(earlier.hash,beforeFollowing.hash);
  const later=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,{...stateInput,checkpointId:second.checkpoint.id}));assert.equal(later.value,2);assert.notEqual(later.sourceId,earlier.sourceId);
 });
 await state.saveInitialState({bookId:book.id,subjectKind:'card',subjectId:actor.id,stateKey:holding,value:true,expectedRevision:initialHolding.revision,requestKey:key(),actor:'isolated_test',note:'后续明确修改'});
 await state.saveInitialState({bookId:book.id,subjectKind:'card',subjectId:actor.id,stateKey:late,value:0,requestKey:key(),actor:'isolated_test',note:'检查点之后建立'});
 await t.test('false, zero and missing historical initial values remain distinct',async()=>{
  const flag=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,{...stateInput,stateKey:holding}));assert.equal(flag.known,true);assert.equal(flag.value,false);assert.equal(flag.sourceId,initialHolding.currentVersionId);
  const count=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,{...stateInput,stateKey:zero}));assert.equal(count.known,true);assert.equal(count.value,0);assert.equal(count.sourceId,initialZero.currentVersionId);
  const unknown=await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,{...stateInput,stateKey:late}));assert.equal(unknown.known,false);assert.equal(unknown.value,null);assert.equal(unknown.sourceKind,'unknown');assert.equal(unknown.sourceId,null);
 });
 await t.test('adopting a later plan retains the body original planning version',async()=>{
  let changed=await planning.addPlanningVersion(first.object.id,{content:{...planContent,notes:'后续策划'},source:'manual',executionMode:'ai_assisted',basedOnParentVersionId:volume.adoptedVersionId,references:[],expectedRevision:first.object.revision,idempotencyKey:key()});changed=await planning.adoptPlanningVersion(changed.id,{versionId:changed.currentVersionId,expectedRevision:changed.revision,idempotencyKey:key()});
  const frozen=await read(client=>supplements.readStableResourceSupplementBasisInTransaction(client,book.id,first.checkpoint.id));assert.equal(frozen.planningVersionId,first.object.adoptedVersionId);assert.notEqual(frozen.planningVersionId,changed.adoptedVersionId);
 });
 await t.test('cross-book and unrecognized scope cannot select another book history',async()=>{
  await assert.rejects(read(client=>supplements.readStableResourceSupplementBasisInTransaction(client,key(),first.checkpoint.id)),error=>error.status===409);
  await assert.rejects(read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,{...stateInput,subjectId:key()})),error=>error.status===422);
  await assert.rejects(read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,{...stateInput,chapterOrder:500})),error=>error.status===422);
 });
 await t.test('uninstalled manual storage is rejected without creating any table or application row',async()=>{
  const current=(await pool.query('SELECT current_version_id,revision FROM new_design.cards WHERE id=$1',[actor.id])).rows[0];
  const command={checkpointId:first.checkpoint.id,requestKey:key(),expectedSourceHash:'0'.repeat(64),resourceScope:{relationTypeId:key(),holdingDimensionKey:'holding',specificationHash:'0'.repeat(64),characterId:actor.id,characterVersionId:current.current_version_id,characterRevision:current.revision,resourceIds:[key()],relationIds:[key()]}};
  await assert.rejects(supplements.startResourceSupplement(book.id,command),error=>error.status===503&&error.mutationOutcome==='unknown');
  assert.equal((await pool.query("SELECT to_regclass('new_design.chapter_resource_supplements') table_name")).rows[0].table_name,null);
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_adoption_sessions')).rows[0].n,2);
 });
 async function corruption(sql,values){const client=await pool.connect();try{await client.query('BEGIN');await client.query(sql,values);await assert.rejects(supplements.readStableResourceSupplementBasisInTransaction(client,book.id,first.checkpoint.id),error=>error.status===409);}finally{await client.query('ROLLBACK');client.release();}}
 await t.test('missing confirmation ledger or stale evidence refuses supplementation and retains history',async()=>{
  await corruption("UPDATE new_design.chapter_stable_checkpoints SET summary='{}'::jsonb WHERE id=$1",[first.checkpoint.id]);
  await corruption("UPDATE new_design.chapter_text_anchors SET status='archived',revision=revision+1 WHERE body_version_id=$1",[first.version.id]);
  await corruption("UPDATE new_design.books SET status='archived' WHERE id=$1",[book.id]);
 });
 await t.test('repeated reads preserve every original row and create no session, settlement, proposal or AI task',async()=>{
  const snapshot=()=>pool.query(`SELECT (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.chapter_body_versions t) bodies,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.chapter_body_adoptions t) adoptions,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.chapter_adoption_sessions t) sessions,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.chapter_settlements t) settlements,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.chapter_stable_checkpoints t) checkpoints,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.canonical_facts t) facts,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.knowledge_state_changes t) knowledge,
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM new_design.state_changes t) states,
   (SELECT count(*) FROM new_design.ai_tasks) ai_tasks`);
  const before=(await snapshot()).rows[0];for(let i=0;i<3;i++){await read(client=>supplements.readStableResourceSupplementBasisInTransaction(client,book.id,first.checkpoint.id));await read(client=>supplements.readResourceSupplementHistoricalStateInTransaction(client,stateInput));}
  assert.deepEqual((await snapshot()).rows[0],before);assert.equal(before.ai_tasks,'0');assert.equal(before.sessions.length,2);assert.equal(before.settlements.length,2);
 });
});

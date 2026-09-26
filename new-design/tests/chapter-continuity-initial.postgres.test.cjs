const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs');
test('actual continuity preserves complete initial and confirmed knowledge versions',async t=>{
 const fixture=await resourceSupplementFixture(t),{pool,book,create,planning,volume,body,chapter}=fixture;
 const card=await create('chapter','待写第二章',{chapter_name:'待写第二章',chapter_goal:'核对来源'});
 let object=await planning.createPlanningObject({bookId:book.id,level:'chapter',parentObjectId:volume.id,basedOnParentVersionId:volume.adoptedVersionId,
  cardId:card.id,title:'第二章',sortOrder:2,content:fixture.planContent,source:'manual',executionMode:'ai_assisted',references:[],idempotencyKey:randomUUID()});
 object=await planning.adoptPlanningVersion(object.id,{versionId:object.currentVersionId,expectedRevision:object.revision,idempotencyKey:randomUUID()});
 await body.createChapterDocument({bookId:book.id,chapterCardId:card.id,logicalOrder:2,title:'第二章'});
 const {readChapterContinuitySources}=compiled('server/database/chapterProduction/continuitySources');
 const read=async()=>{const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  return await readChapterContinuitySources(client,book.id,card.id);
 }finally{await client.query('ROLLBACK');client.release();}};
 await t.test('initial false and zero use complete real version rows',async()=>{
  const result=await read(),sources=result.sources.filter(row=>row.type==='entity_initial_state');assert.equal(sources.length,3);
  for(const source of sources){assert.equal(typeof source.content.version,'object');assert.equal(source.content.version.id,source.versionId);}
  assert.ok(sources.some(source=>source.content.version.value_json===false));assert.ok(sources.some(source=>source.content.version.value_json===0));
 });
 const first=await chapter(1,1,true);
 await t.test('committed predecessor retains complete knowledge version and original state',async()=>{
  const result=await read(),knowledge=result.sources.find(row=>row.type==='knowledge_state_change'),state=result.sources.find(row=>row.type==='state_change');
  assert.ok(knowledge);assert.equal(typeof knowledge.content.version,'object');assert.equal(knowledge.content.version.id,knowledge.content.change.proposal_version_id);
  assert.ok(knowledge.content.version.text_anchor_id);assert.equal(state.content.change.settlement_id,first.checkpoint.settlement_id);assert.equal(state.content.change.after_json,1);
  assert.ok(result.sources.some(row=>row.type==='canonical_fact'));assert.ok(result.sources.some(row=>row.type==='entity_initial_state'&&row.content.version.value_json===false));
 });
});

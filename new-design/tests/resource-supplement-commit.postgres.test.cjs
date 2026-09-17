const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs');
const key=()=>randomUUID(),field=(key,name,type)=>({key,name,type,description:'正式资源维度',required:false,defaultValue:null,options:[],group:'资源',order:1,aiSuggestible:true});
test('actual independently committed supplement fences its real downstream source and creates a separately recoverable correction',async t=>{
 const fixture=await resourceSupplementFixture(t,[['087','stable_resource_supplements'],['085','character_resource_backfill'],['088','stable_resource_supplement_candidates'],['089','resource_supplement_impact_reviews'],['090','resource_supplement_integrity'],['091','resource_supplement_correction_origins']].map(([n,name])=>({id:`${n}_${name}`,fileName:`${n}_${name}.sql`})));
 const {pool,book,actor,chapter,create,settlement,state,supplements}=fixture,resources=compiled('server/database/characterResources');
 const prop=await create('prop','正式资源',{name:'正式资源'}),definition={name:'人物持有资源',description:'正式已发布规格',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['prop'],sourceMax:null,targetMax:null,fields:[field('holding','持有','boolean'),field('quantity','数量','number')],capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'holding',label:'持有',direction:'forward',policy:'tracked',mode:'absolute'},{fieldKey:'quantity',label:'数量',direction:'forward',policy:'tracked',mode:'delta'}]};
 const config=await settlement.saveSettlementRelationConfigurationDraft(book.id,{requestKey:key(),expectedRelationTypeRevision:null,definition});
 await settlement.publishSettlementRelationConfigurationDraft(book.id,{requestKey:key(),draftId:config.draftId,expectedRevision:1,confirmPublish:true,confirmInstanceRebind:false,rebindRelations:[],createRelations:[{sourceCardId:actor.id,targetCardId:prop.id}]});
 const ledger=await resources.getCharacterResources(book.id,actor.id),choice=ledger.choices.find(item=>item.holdingDimensionKey==='holding'),selection={relationTypeId:choice.relationTypeId,holdingDimensionKey:choice.holdingDimensionKey,specificationHash:choice.specificationHash};
 const selected=await resources.getCharacterResources(book.id,actor.id,selection),relationId=selected.items[0].relationId,scope={...selection,characterId:actor.id,characterVersionId:selected.characterVersionId,characterRevision:selected.characterRevision,resourceIds:[prop.id],relationIds:[relationId]};
 for(const [stateKey,value] of [['holding',false],['quantity',0]])await state.saveInitialState({bookId:book.id,subjectKind:'relation',subjectId:relationId,stateKey,value,requestKey:key(),actor:'isolated_author',note:''});
 const first=await chapter(1,1,true),second=await chapter(2,2,false,(workspace,content)=>{
  const choice=workspace.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity');
  return[{category:'relationship',title:'后续章确认数量',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:choice.specificationHash,baselineHash:choice.baseline.hash,beforeValue:choice.baseline.value,afterValue:2,changeValue:2,riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:content,reason:'明确确认原后续章'}];
 });
 const quantity=preview=>preview.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity');
 const preview=await supplements.previewResourceSupplement(book.id,{checkpointId:first.checkpoint.id,resourceScope:scope});
 const startInput={...preview.input,requestKey:key(),expectedSourceHash:preview.sourceHash},start=await supplements.startResourceSupplement(book.id,startInput);
 let workspace=await settlement.getChapterSettlementEditingWorkspace(start.sessionId);
 const added=await settlement.createChapterSettlementEditingItem(start.sessionId,{requestKey:key(),expectedSessionRevision:workspace.session.revision,actor:'isolated_author',draft:{category:'relationship',title:'补充遗漏资源数量',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:quantity(preview).specificationHash,baselineHash:quantity(preview).baseline.hash,beforeValue:0,afterValue:1,changeValue:1,riskLevel:'low',evidenceStart:0,evidenceEnd:first.content.length,evidenceLabel:first.content,reason:'作者核对实际原正文'}});workspace=added.workspace;
 workspace=(await settlement.decideChapterSettlementEditingItems(start.sessionId,{requestKey:key(),expectedSessionRevision:workspace.session.revision,decisions:[{itemId:workspace.items[0].id,expectedRevision:workspace.items[0].revision,decision:'confirm',note:'明确核对正文及数量'}],actor:'isolated_author'})).workspace;
 const impact=await supplements.previewResourceSupplementSettlement(book.id,start.sessionId),chain=impact.stateChain[0];assert.equal(chain.reason,'before_conflict');
 const review=await supplements.confirmResourceSupplementSettlementImpact(book.id,start.sessionId,{requestKey:key(),expectedSessionRevision:workspace.session.revision,expectedImpactHash:impact.impactHash,acknowledgedConflictStateChangeIds:[chain.stateChangeId],note:'核对真实0→2与新增章前1，知悉仍需来源修正'});
 const command={requestKey:key(),reviewId:review.reviewId,expectedSessionRevision:workspace.session.revision,expectedImpactHash:impact.impactHash};
 // A genuine active isolated profile only queues the newly committed source;
 // no runtime, worker, chunks, embedding call or author data is involved.
 const profileId=key(),profileVersionId=key(),{stableHash}=compiled('server/database/aiContracts');
 const profileConfig={providerKey:'isolated_stub',modelKey:'isolated_never_called',dimensions:3,distanceMetric:'cosine',normalize:false,chunkerKey:'paragraph',chunkerVersion:'v1',maxChunkChars:1024,overlapChars:64,allowedSourceKinds:['state_change']};
 await pool.query("INSERT INTO new_design.embedding_profiles(id,profile_key,name,purpose) VALUES($1,$2,'隔离来源排队验证','semantic_retrieval')",[profileId,`isolated_${key().replaceAll('-','')}`]);
 await pool.query(`INSERT INTO new_design.embedding_profile_versions(id,profile_id,version,provider_key,model_key,dimensions,distance_metric,normalize,chunker_key,chunker_version,max_chunk_chars,overlap_chars,allowed_source_kinds,content_hash)
  VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[profileVersionId,profileId,profileConfig.providerKey,profileConfig.modelKey,3,'cosine',false,'paragraph','v1',1024,64,['state_change'],stableHash(profileConfig)]);
 await pool.query('UPDATE new_design.embedding_profiles SET current_version_id=$2 WHERE id=$1',[profileId,profileVersionId]);
 const originalRows=async()=> (await pool.query(`SELECT to_jsonb(session) session,to_jsonb(checkpoint) checkpoint,to_jsonb(settlement) settlement,to_jsonb(body) body
  FROM new_design.chapter_stable_checkpoints checkpoint JOIN new_design.chapter_adoption_sessions session ON session.id=checkpoint.session_id
  JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id JOIN new_design.chapter_body_versions body ON body.id=checkpoint.body_version_id WHERE checkpoint.id=$1`,[first.checkpoint.id])).rows[0];
 const old=await originalRows(),runtime=compiled('server/database/runtime'),originalPool=runtime.getNewDesignPool;
 const counts=async()=>(await pool.query(`SELECT (SELECT count(*) FROM new_design.chapter_settlements) settlements,(SELECT count(*) FROM new_design.state_changes) states,
  (SELECT count(*) FROM new_design.resource_supplement_integrity_issues) issues,(SELECT count(*) FROM new_design.resource_supplement_integrity_journals) journals,(SELECT count(*) FROM new_design.ai_tasks) tasks`)).rows[0],before=await counts();
 await t.test('uninstalled formal contract cannot publish or mutate a checkpoint',async()=>{
  await assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,command),error=>error.status===503&&error.mutationOutcome==='unknown');assert.deepEqual(await originalRows(),old);assert.deepEqual(await counts(),before);
 });
 const oid=(await pool.query("SELECT 'new_design.require_resource_supplement_closure()'::regprocedure::oid oid")).rows[0].oid;
 assert.match(fixture.database,/^nd_reference_test_[a-f0-9]{32}$/);
 const installer=await pool.connect();try{await installer.query('BEGIN');await installer.query(fs.readFileSync(path.join(__dirname,'../migrations/092_resource_supplement_formal_commits.sql'),'utf8'));await installer.query("INSERT INTO new_design.schema_migrations(id) VALUES('092_resource_supplement_formal_commits')");await installer.query('COMMIT');}finally{installer.release();}
 assert.equal((await pool.query("SELECT 'new_design.require_resource_supplement_closure()'::regprocedure::oid oid")).rows[0].oid,oid);
 async function intercept(predicate,mutate,action){let injected=false;runtime.getNewDesignPool=async()=>({connect:async()=>{const client=await pool.connect();return new Proxy(client,{get(target,name){if(name==='query')return async(sql,values)=>{if(!injected&&typeof sql==='string'&&predicate(sql)){injected=true;return mutate(target,sql,values);}return target.query(sql,values);};const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});}});
  try{await action();assert.equal(injected,true);}finally{runtime.getNewDesignPool=originalPool;}}
 const unchanged=async()=>{assert.deepEqual(await originalRows(),old);assert.deepEqual(await counts(),before);assert.equal(await supplements.readResourceSupplementCommitOriginal(book.id,start.sessionId,command),null);};
 await t.test('actual final guard refuses a merge and real journal without the full atomic commit original',async()=>{
  const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const merged=await settlement.writeResourceSupplementMergedSettlementInTransaction(client,book.id,start.sessionId,command);
    await state.rebuildStateProjectionInTransaction(client,{bookId:book.id,subjectKind:'relation',subjectId:relationId,stateKey:'quantity'});
    await supplements.recordResourceSupplementIntegrityInTransaction(client,book.id,merged,impact);
    await assert.rejects(client.query('SET CONSTRAINTS new_design.chapter_resource_supplement_closure_required IMMEDIATE'),error=>error.code==='23514'&&/atomic full original commit receipt/.test(error.message));
  }finally{await client.query('ROLLBACK');client.release();}await unchanged();
 });
 await t.test('original lookup interruption remains unknown and cannot begin a replacement write',async()=>{
  await intercept(sql=>sql.includes('SELECT session_id,full_input,input_hash'),target=>target.query('SELECT 1/0'),()=>assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,command),error=>error.mutationOutcome==='unknown'));await unchanged();
 });
 await t.test('formal receipt insertion failure rolls back merged states, journal, fences and checkpoint together',async()=>{
  await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_formal_commits'),target=>target.query('SELECT 1/0'),()=>assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,command),error=>error.mutationOutcome==='not_written'));await unchanged();
 });
 await t.test('actual receipt SQL refuses rehashed omission of a real source conflict',async()=>{
  const {stable,stableHash}=compiled('server/database/aiContracts/integrity');
  await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_formal_commits'),async(target,sql,values)=>{const changed=[...values],receipt=JSON.parse(changed[7]);receipt.issues=[];changed[7]=JSON.stringify(receipt);changed[8]=stableHash(receipt);changed[9]=stable(receipt);return target.query(sql,changed);},()=>assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,command),error=>error.mutationOutcome==='not_written'&&error.cause?.code==='23514'));await unchanged();
 });
 await t.test('deferred final guard rejects a real downstream change made after the complete receipt insert',async()=>{
  await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_formal_commits'),async(target,sql,values)=>{const result=await target.query(sql,values);await target.query('UPDATE new_design.chapter_documents SET revision=revision+1,updated_at=now() WHERE id=$1',[second.document.id]);return result;},()=>assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,command),error=>error.mutationOutcome==='unknown'&&error.cause?.code==='23514'&&/downstream source changed/.test(error.cause.message)));await unchanged();
 });
 let receipt;
 await t.test('real physical commit with lost acknowledgement recovers the complete immutable formal original',async()=>{
  await intercept(sql=>sql==='COMMIT',async(target,sql,values)=>{await target.query(sql,values);throw new Error('Isolated commit acknowledgement lost');},()=>assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,command),error=>{assert.equal(error.cause?.message,'Isolated commit acknowledgement lost',error.cause?.stack??error.stack);return error.mutationOutcome==='unknown';}));
  receipt=await supplements.readResourceSupplementCommitOriginal(book.id,start.sessionId,command);assert.ok(receipt);assert.equal(receipt.repeated,true);assert.deepEqual(receipt.input,command);assert.equal(receipt.issues.length,1);
  assert.deepEqual(receipt.originalReview.impact,impact);assert.deepEqual(receipt.originalStart.input,startInput);
  const now=await originalRows();assert.equal(now.checkpoint.status,'superseded');now.checkpoint.status='stable';assert.deepEqual(now,old);
  assert.deepEqual(receipt.merged.confirmed.facts,preview.basis.confirmed.facts);assert.deepEqual(receipt.merged.confirmed.knowledge,preview.basis.confirmed.knowledge);assert.deepEqual(receipt.merged.confirmed.states,[...preview.basis.confirmed.states,...receipt.merged.newStateChangeIds]);
  const repeats=await Promise.all([supplements.commitResourceSupplement(book.id,start.sessionId,command),supplements.commitResourceSupplement(book.id,start.sessionId,command)]);assert.ok(repeats.every(item=>item.merged.settlementId===receipt.merged.settlementId&&item.repeated));
  await assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,{...command,expectedImpactHash:'0'.repeat(64)}),error=>error.mutationOutcome==='unknown');
  const current=await counts();assert.equal(Number(current.states),Number(before.states)+1);assert.equal(Number(current.settlements),Number(before.settlements)+1);assert.equal(Number(current.journals),1);assert.equal(Number(current.issues),1);assert.equal(current.tasks,before.tasks);
 });
 await t.test('only the newly committed actual state gains its matching dependency and pending semantic source',async()=>{
  const sources=(await pool.query(`SELECT source.source_version_id,source.source_hash,resource.content_hash,request.expected_source_hash,request.status
    FROM new_design.embedding_source_snapshots source JOIN new_design.dependency_resources resource ON resource.id=source.dependency_source_resource_id
    JOIN new_design.chunking_requests request ON request.source_snapshot_id=source.id AND request.profile_version_id=source.profile_version_id
    WHERE source.book_id=$1 AND source.profile_version_id=$2`,[book.id,profileVersionId])).rows;
  assert.equal(sources.length,1);assert.equal(sources[0].source_version_id,receipt.merged.newStateChangeIds[0]);assert.equal(sources[0].source_hash,sources[0].content_hash);assert.equal(sources[0].expected_source_hash,sources[0].content_hash);assert.equal(sources[0].status,'pending');
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.embedding_chunks WHERE book_id=$1',[book.id])).rows[0].n,0);
 });
 await t.test('committed full confirmation context preserves all original facts, knowledge and states; actual future source is fenced',async()=>{
  const context=await settlement.getNextChapterStableContext(book.id,second.card.id);assert.equal(context.previousCheckpoint.id,receipt.merged.checkpointId);assert.deepEqual(context.previousCheckpoint.summary.confirmed,receipt.merged.confirmed);
  const projection=(await pool.query("SELECT * FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0];assert.equal(projection.value_json,2);assert.equal(projection.source_state_change_id,chain.stateChangeId);assert.equal(projection.is_stale,true);
  const client=await pool.connect();try{await assert.rejects(compiled('server/database/chapterProduction/continuitySources').readChapterContinuitySources(client,book.id,second.card.id),error=>error.status===409);await assert.rejects(supplements.previewResourceSupplementInTransaction(client,book.id,{checkpointId:second.checkpoint.id,resourceScope:scope}),error=>error.status===409);}finally{client.release();}
  await assert.rejects(pool.query("UPDATE new_design.current_state_projections SET is_stale=false WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId]),error=>error.code==='23514');
 });
 let correctionCommand,correctionReceipt;
 await t.test('independent correction commit with lost acknowledgement preserves the exact actual chapter-before source',async()=>{
  const client=await pool.connect();let corrective;try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');corrective=await supplements.previewResourceSupplementCorrectionInTransaction(client,book.id,{issueId:receipt.issues[0].issue_id,resourceScope:scope});await client.query('COMMIT');}finally{client.release();}
  assert.equal(quantity(corrective).baseline.value,1);assert.equal(corrective.correction.originalRecordedAfter,2);assert.equal(corrective.correction.prefixSource.change.id,receipt.merged.newStateChangeIds[0]);
  correctionCommand={issueId:receipt.issues[0].issue_id,checkpointId:second.checkpoint.id,resourceScope:scope,requestKey:key(),expectedSourceHash:corrective.sourceHash};
  await intercept(sql=>sql==='COMMIT',async(target,sql,values)=>{await target.query(sql,values);throw new Error('Isolated corrective commit acknowledgement lost');},()=>assert.rejects(supplements.startResourceSupplementCorrection(book.id,correctionCommand),error=>{assert.equal(error.cause?.message,'Isolated corrective commit acknowledgement lost',error.cause?.stack??error.stack);return error.mutationOutcome==='unknown';}));
  correctionReceipt=await supplements.readResourceSupplementCorrectionStartOriginal(book.id,correctionCommand);assert.ok(correctionReceipt);assert.deepEqual(correctionReceipt.input,correctionCommand);assert.equal(correctionReceipt.bodyVersionId,second.version.id);
  const repeats=await Promise.all([supplements.startResourceSupplementCorrection(book.id,correctionCommand),supplements.startResourceSupplementCorrection(book.id,correctionCommand)]);assert.ok(repeats.every(item=>item.sessionId===correctionReceipt.sessionId&&item.repeated));
  await assert.rejects(supplements.startResourceSupplementCorrection(book.id,{...correctionCommand,expectedSourceHash:'0'.repeat(64)}),error=>error.mutationOutcome==='unknown');
  await assert.rejects(supplements.startResourceSupplementCorrection(book.id,{...correctionCommand,requestKey:key()}),error=>error.status===409&&error.mutationOutcome==='not_written');
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_correction_origins')).rows[0].n,1);assert.equal((await counts()).tasks,before.tasks);
 });
 await t.test('deactivation and archive preserve full formal and correction originals without clearing actual source fences',async()=>{
  await assert.rejects(pool.query('DELETE FROM new_design.resource_supplement_formal_commits WHERE settlement_id=$1',[receipt.merged.settlementId]),error=>error.code==='23514');
  for(const file of ['092_resource_supplement_formal_commits.sql','091_resource_supplement_correction_origins.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback',file),'utf8'));
  await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[book.id]);
  assert.deepEqual(await supplements.readResourceSupplementCommitOriginal(book.id,start.sessionId,command),receipt);assert.deepEqual(await supplements.readResourceSupplementCorrectionStartOriginal(book.id,correctionCommand),correctionReceipt);
  assert.equal((await supplements.commitResourceSupplement(book.id,start.sessionId,command)).repeated,true);assert.equal((await supplements.startResourceSupplementCorrection(book.id,correctionCommand)).repeated,true);
  await assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,{...command,requestKey:key()}),error=>error.status===503&&error.mutationOutcome==='not_written');
  await assert.rejects(supplements.startResourceSupplementCorrection(book.id,{...correctionCommand,requestKey:key()}),error=>error.status===503&&error.mutationOutcome==='not_written');
  assert.equal((await pool.query("SELECT is_stale FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0].is_stale,true);
  assert.equal((await pool.query('SELECT operational FROM new_design.resource_supplement_capabilities')).rows[0].operational,false);
 });
});

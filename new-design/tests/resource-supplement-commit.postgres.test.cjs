const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs');
const {resourceSupplementHttp}=require('./support/resourceSupplementHttp.cjs');
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
 const http=await resourceSupplementHttp(t),httpBase=`/books/${book.id}/resource-supplements`;
 const preview=await http.get(`${httpBase}/preview${http.query({checkpointId:first.checkpoint.id,resourceScope:scope})}`);
 const startInput={...preview.input,requestKey:key(),expectedSourceHash:preview.sourceHash},start=await http.post(httpBase,startInput);
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
 await t.test('dedicated actual corrective candidate, governed model original and author review remain bound to the proven single field',async candidateTests=>{
  const ai=compiled('server/ai/chapterSettlement'),models=compiled('server/database/modelManagement'),prompts=compiled('server/ai/prompts');
  const source=(await pool.query('SELECT source_snapshot FROM new_design.chapter_resource_supplements WHERE session_id=$1',[correctionReceipt.sessionId])).rows[0].source_snapshot;
  const promptInput=prompts.buildResourceSupplementCorrectionPromptInput({sessionId:correctionReceipt.sessionId,sessionRevision:1,source}),prepared=prompts.preparePrompt('stable_resource_correction',promptInput);
  const quantityField=promptInput.catalog.subjects[0].fields[0];
  const draft={category:'relationship',title:'核对本章资源数量来源',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:quantityField.specificationHash,baselineHash:quantityField.baseline.hash,beforeValue:1,afterValue:2,changeValue:1,riskLevel:'medium',confidence:0.8,confidenceNote:'需作者核对',planAlignment:'not_applicable',planExpectation:'',evidenceStart:0,evidenceEnd:second.content.length,evidenceLabel:second.content,reason:'依据原采用正文，原章前0保留供比较，实际章前为1'};
  await candidateTests.test('registered exact source schema rejects other fields or rehashed false chapter-before, and permits only this repair no-op',async()=>{
    assert.equal(prepared.assetId,'new_design.character.stable_resource_correction');assert.equal(promptInput.catalog.subjects.length,1);assert.equal(promptInput.catalog.subjects[0].fields.length,1);
    assert.equal(prepared.parseOutput({items:[draft],notes:[]}).items[0].beforeValue,1);
    assert.equal(prepared.parseOutput({items:[{...draft,afterValue:1,changeValue:0}],notes:[]}).items[0].afterValue,1);
    assert.throws(()=>prepared.parseOutput({items:[{...draft,stateKey:'holding'}],notes:[]}));
    const forged=structuredClone(source);forged.correction.beforeValue=2;const {sourceHash:ignored,...correction}=forged.correction;forged.correction.sourceHash=stableHash(correction);
    forged.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity').baseline.value=2;const {sourceHash,...frame}=forged;forged.sourceHash=stableHash(frame);
    assert.throws(()=>prompts.preparePrompt('stable_resource_correction',prompts.buildResourceSupplementCorrectionPromptInput({sessionId:correctionReceipt.sessionId,sessionRevision:1,source:forged})));
  });
  const route={primary:{provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'isolated-stub-never-real-model',credentialId:null},fallbacks:[],policy:{maxOutputTokens:8000,maxTotalTokens:1000000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}};
  for(const [scope,taskType] of [['system_default',null],['task','chapter_settlement']]){const current=(await models.getModelRouteCenterCatalog()).routes.find(item=>item.scope===scope&&item.taskType===taskType);await models.saveManagedModelRoute({...route,scope,taskType,expectedConfigId:current?.id??null,expectedRevision:current?.revision??null,replaceUnsupported:true,idempotencyKey:key()});}
  let workspace=await settlement.getChapterSettlementEditingWorkspace(correctionReceipt.sessionId),calls=0;
  const request={requestKey:key(),expectedSessionRevision:workspace.session.revision,catalogHash:workspace.catalog.specificationHash,resourceScope:scope};
  const fetcher=async()=>{calls++;return new Response(JSON.stringify({message:{content:JSON.stringify({items:[draft],notes:['仅核对实际冲突字段']})},prompt_eval_count:100,eval_count:50}),{status:200,headers:{'content-type':'application/json'}});};
  await assert.rejects(ai.runChapterSettlementAiExtraction(correctionReceipt.sessionId,request,{fetcher}),error=>error.status===503);assert.equal(calls,0);
  const installer=await pool.connect();try{await installer.query('BEGIN');await installer.query(fs.readFileSync(path.join(__dirname,'../migrations/093_resource_supplement_correction_candidates.sql'),'utf8'));await installer.query("INSERT INTO new_design.schema_migrations(id) VALUES('093_resource_supplement_correction_candidates')");await installer.query('COMMIT');}finally{installer.release();}
  const generated=await ai.runChapterSettlementAiExtraction(correctionReceipt.sessionId,request,{fetcher});assert.equal(generated.status,'succeeded',JSON.stringify(generated.failure));assert.equal(generated.proposalsSaved,true);assert.equal(calls,1);
  assert.equal((await ai.runChapterSettlementAiExtraction(correctionReceipt.sessionId,request,{fetcher})).repeated,true);assert.equal(calls,1);
  const stored=(await pool.query('SELECT * FROM new_design.chapter_proposal_extraction_requests WHERE id=$1',[generated.id])).rows[0];assert.equal(stored.frozen_plan.assetId,'new_design.character.stable_resource_correction');assert.deepEqual(stored.frozen_plan.input.stableCorrection.source,source);assert.equal(stored.frozen_plan.input.stableSupplement,undefined);
  assert.equal((await pool.query("SELECT exact_version_id FROM new_design.context_manifest_entries WHERE manifest_id=$1 AND source_type='planning_version'",[stored.context_manifest_id])).rows[0].exact_version_id,source.basis.planningVersionId);
  workspace=await settlement.getChapterSettlementEditingWorkspace(correctionReceipt.sessionId);assert.equal(workspace.items.length,1);assert.equal(workspace.items[0].beforeValue,1);
  await assert.rejects(settlement.createChapterSettlementEditingItem(correctionReceipt.sessionId,{requestKey:key(),expectedSessionRevision:workspace.session.revision,draft:{...draft,stateKey:'holding'},actor:'isolated_author'}),error=>error.status===409);
  workspace=(await settlement.updateChapterSettlementEditingItem(workspace.items[0].id,{requestKey:key(),expectedSessionRevision:workspace.session.revision,expectedRevision:workspace.items[0].revision,draft:{...draft,afterValue:1,changeValue:0,reason:'作者以原正文核对本字段来源修正的无净增量候选'},actor:'isolated_author'})).workspace;
  assert.equal(workspace.items[0].beforeValue,1);assert.equal(workspace.items[0].afterValue,1);
  const edit={requestKey:key(),expectedSessionRevision:workspace.session.revision,expectedRevision:workspace.items[0].revision,draft:{...draft,title:'作者核对正确前值1与原正文末值2'},actor:'isolated_author'};
  workspace=(await settlement.updateChapterSettlementEditingItem(workspace.items[0].id,edit)).workspace;
  workspace=(await settlement.decideChapterSettlementEditingItems(correctionReceipt.sessionId,{requestKey:key(),expectedSessionRevision:workspace.session.revision,decisions:[{itemId:workspace.items[0].id,expectedRevision:workspace.items[0].revision,decision:'confirm',note:'明确核对本字段原0→2及正确1→2'}],actor:'isolated_author'})).workspace;
  assert.equal(workspace.items[0].decision,'confirm');assert.equal(workspace.items[0].beforeValue,1);assert.equal(workspace.items[0].afterValue,2);
  await assert.rejects(supplements.previewResourceSupplementSettlement(book.id,correctionReceipt.sessionId),error=>error.status===503);
  assert.equal((await pool.query("SELECT is_stale FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0].is_stale,true);
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
  await candidateTests.test('independent cached corrective claim rejects a real invalid latest prefix and preserves the original result',async()=>{
    const client=await pool.connect();try{await client.query('BEGIN');await client.query("UPDATE new_design.chapter_text_anchors SET status='archived' WHERE id=$1",[source.correction.prefixSource.change.text_anchor_id]);
      await assert.rejects(client.query(`INSERT INTO new_design.chapter_proposal_extraction_requests(id,session_id,book_id,body_version_id,expected_session_revision,frozen_plan)
        VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[key(),correctionReceipt.sessionId,book.id,second.version.id,workspace.session.revision,JSON.stringify(stored.frozen_plan)]),error=>error.code==='23514'&&/actual valid latest chapter-before proof/.test(error.message));
    }finally{await client.query('ROLLBACK');client.release();}
    assert.equal((await ai.runChapterSettlementAiExtraction(correctionReceipt.sessionId,request,{fetcher})).repeated,true);assert.equal(calls,1);
  });
  await candidateTests.test('candidate deactivation preserves full governed result and manual receipts without reopening the source',async()=>{
    await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback/093_resource_supplement_correction_candidates.sql'),'utf8'));
    assert.equal((await ai.runChapterSettlementAiExtraction(correctionReceipt.sessionId,request,{fetcher})).repeated,true);assert.equal(calls,1);
    assert.ok(await settlement.readChapterSettlementEditingReceipt(correctionReceipt.sessionId,edit.requestKey));
    await assert.rejects(settlement.createChapterSettlementEditingItem(correctionReceipt.sessionId,{requestKey:key(),expectedSessionRevision:workspace.session.revision,draft,actor:'isolated_author'}),error=>error.status===503);
    assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
  });
 });
 let correctionFormalCommand,correctionFormalReceipt;
 await t.test('actual corrective formal commit closes the exact proof and restores a healthy real source',async formalTests=>{
  const sql93=fs.readFileSync(path.join(__dirname,'../migrations/093_resource_supplement_correction_candidates.sql'),'utf8');
  const guardStart=sql93.indexOf('CREATE OR REPLACE FUNCTION block_unavailable_resource_correction_candidates(');
  await pool.query(sql93.slice(guardStart,sql93.indexOf('END $$;',guardStart)+7));
  const installer=await pool.connect();try{await installer.query('BEGIN');await installer.query(fs.readFileSync(path.join(__dirname,'../migrations/094_resource_supplement_correction_commits.sql'),'utf8'));await installer.query("INSERT INTO new_design.schema_migrations(id) VALUES('094_resource_supplement_correction_commits')");await installer.query('COMMIT');}finally{installer.release();}
  const impact=await supplements.previewResourceSupplementSettlement(book.id,correctionReceipt.sessionId);
  assert.equal(impact.changes.length,1);assert.equal(impact.changes[0].before,1);assert.equal(impact.changes[0].after,2);
  const review=await supplements.confirmResourceSupplementSettlementImpact(book.id,correctionReceipt.sessionId,{requestKey:key(),expectedSessionRevision:impact.sessionRevision,expectedImpactHash:impact.impactHash,acknowledgedConflictStateChangeIds:[],note:'作者核对实际正确章前1及原正文末2，正式修正完整来源'});
  correctionFormalCommand={requestKey:key(),reviewId:review.reviewId,expectedSessionRevision:impact.sessionRevision,expectedImpactHash:impact.impactHash};
  await formalTests.test('ordinary formal contract cannot reinterpret the corrective original',async()=>{
    await assert.rejects(supplements.commitResourceSupplement(book.id,correctionReceipt.sessionId,correctionFormalCommand),error=>error.status===409&&error.mutationOutcome==='not_written');
    assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
  });
  await formalTests.test('missing formal original rolls back actual corrective states and all resolution proofs',async()=>{
    await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_formal_commits'),async(client)=>client.query('SELECT 1/0'),async()=>{
      await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand),error=>error.mutationOutcome==='not_written');
    });
    assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
    assert.equal((await pool.query("SELECT is_stale FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0].is_stale,true);
  });
  await formalTests.test('actual SQL refuses rehashed false correction source in an immutable resolution proof',async()=>{
    const {stable}=compiled('server/database/aiContracts/integrity');
    await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_integrity_resolutions'),async(client,sql,values)=>{
      const proof=JSON.parse(values[5]);proof.correctionSource.correction.beforeValue=2;
      const {sourceHash,...frame}=proof.correctionSource.correction;proof.correctionSource.correction.sourceHash=stableHash(frame);
      const {sourceHash:ignored,...sourceFrame}=proof.correctionSource;proof.correctionSource.sourceHash=stableHash(sourceFrame);
      const hash=stableHash(proof),receipt=JSON.parse(values[8]);receipt.proofHash=hash;
      const changed=[...values];changed[5]=JSON.stringify(proof);changed[6]=hash;changed[7]=stable(proof);changed[8]=JSON.stringify(receipt);return client.query(sql,changed);
    },async()=>{await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand),error=>error.mutationOutcome==='not_written'&&error.cause?.code==='23514');});
    assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
  });
  await formalTests.test('actual deferred guard cannot publish resolution proofs without the atomic formal original',async()=>{
    await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_formal_commits'),client=>client.query('SELECT 1'),async()=>{
      await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand),error=>error.mutationOutcome==='unknown'&&error.cause?.code==='23514'&&/atomic full original commit receipt/.test(error.cause.message));
    });
    assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
    assert.equal((await pool.query("SELECT is_stale FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0].is_stale,true);
  });
  await formalTests.test('deferred actual SQL rejects a real prefix change after the complete corrective receipt',async()=>{
    await intercept(sql=>sql.includes('INSERT INTO new_design.resource_supplement_formal_commits'),async(client,sql,values)=>{
      const result=await client.query(sql,values);const source=(await client.query('SELECT source_snapshot FROM new_design.chapter_resource_supplements WHERE session_id=$1',[correctionReceipt.sessionId])).rows[0].source_snapshot;
      await client.query("UPDATE new_design.chapter_text_anchors SET status='archived' WHERE id=$1",[source.correction.prefixSource.change.text_anchor_id]);return result;
    },async()=>{await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand),error=>error.mutationOutcome==='unknown'&&error.cause?.code==='23514');});
    assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_resolutions')).rows[0].n,0);
  });
  await formalTests.test('actual corrective COMMIT with lost acknowledgement recovers the unique complete original',async()=>{
    await intercept(sql=>sql==='COMMIT',async client=>{await client.query('COMMIT');throw new Error('Isolated corrective formal acknowledgement lost');},async()=>{
      await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand),error=>error.mutationOutcome==='unknown'&&error.cause?.message==='Isolated corrective formal acknowledgement lost');
    });
    correctionFormalReceipt=await supplements.readResourceSupplementCorrectionCommitOriginal(book.id,correctionReceipt.sessionId,correctionFormalCommand);
    assert.ok(correctionFormalReceipt);assert.equal(correctionFormalReceipt.contract,'resource_supplement_correction_commit_v1');assert.equal(correctionFormalReceipt.resolutions.length,1);
    assert.deepEqual(correctionFormalReceipt.originalStart,{...correctionReceipt,repeated:false});assert.deepEqual(correctionFormalReceipt.originalReview,review);
    assert.equal((await supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand)).repeated,true);
    const concurrent=await Promise.all(Array.from({length:3},()=>supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand)));
    assert.ok(concurrent.every(row=>row.repeated&&row.merged.settlementId===correctionFormalReceipt.merged.settlementId));
    await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,{...correctionFormalCommand,expectedImpactHash:'a'.repeat(64)}),error=>error.mutationOutcome==='unknown');
  });
  const projection=(await pool.query("SELECT * FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0];
  assert.equal(projection.is_stale,false);assert.equal(projection.value_json,2);assert.equal(projection.source_state_change_id,correctionFormalReceipt.merged.newStateChangeIds[0]);
  assert.ok(correctionFormalReceipt.merged.confirmed.states.includes(chain.stateChangeId));
  assert.deepEqual(correctionFormalReceipt.merged.confirmed.facts,second.checkpoint.summary.confirmed.facts);assert.deepEqual(correctionFormalReceipt.merged.confirmed.knowledge,second.checkpoint.summary.confirmed.knowledge);
  const thirdCard=await create('chapter','下一章连续性核对',{chapter_name:'下一章连续性核对',chapter_goal:'核对资源'});
  const thirdPlan=await fixture.planning.createPlanningObject({bookId:book.id,level:'chapter',parentObjectId:fixture.volume.id,basedOnParentVersionId:fixture.volume.adoptedVersionId,cardId:thirdCard.id,title:'下一章连续性核对',sortOrder:3,content:fixture.planContent,source:'manual',executionMode:'ai_assisted',references:[],idempotencyKey:key()});
  await fixture.planning.adoptPlanningVersion(thirdPlan.id,{versionId:thirdPlan.currentVersionId,expectedRevision:thirdPlan.revision,idempotencyKey:key()});
  await fixture.body.createChapterDocument({bookId:book.id,chapterCardId:thirdCard.id,logicalOrder:3,title:'下一章连续性核对'});
  const context=await settlement.getNextChapterStableContext(book.id,thirdCard.id);
  assert.equal(context.previousCheckpoint.id,correctionFormalReceipt.merged.checkpointId);assert.deepEqual(context.previousCheckpoint.summary.confirmed,correctionFormalReceipt.merged.confirmed);
  const client=await pool.connect();try{
    const fresh=await supplements.readResourceSupplementHistoricalStateInTransaction(client,{bookId:book.id,checkpointId:correctionFormalReceipt.merged.checkpointId,subjectKind:'relation',subjectId:relationId,stateKey:'quantity'});assert.equal(fresh.value,2);assert.equal(fresh.sourceId,correctionFormalReceipt.merged.newStateChangeIds[0]);
    await supplements.assertResourceSupplementHistoricalSourceAvailableInTransaction(client,book.id,2,[{subjectKind:'relation',id:relationId}]);
    const continuity=await compiled('server/database/chapterProduction/continuitySources').readChapterContinuitySources(client,book.id,thirdCard.id);
    assert.ok(continuity.sources.some(row=>row.type==='state_change'&&row.stableId===correctionFormalReceipt.merged.newStateChangeIds[0]));
  }finally{client.release();}
  await assert.rejects(pool.query('DELETE FROM new_design.resource_supplement_integrity_resolutions WHERE issue_id=$1',[receipt.issues[0].issue_id]),error=>error.code==='23514');
 });
 await t.test('real source HTTP reads preserve complete originals without importing, resolving or changing rows',async()=>{
  const prior=await counts();
  assert.equal((await http.get(`${httpBase}/sessions/${start.sessionId}/source`)).contract,'stable_resource_supplement_preview_v1');
  const corrective=await http.get(`${httpBase}/sessions/${correctionReceipt.sessionId}/source`);assert.equal(corrective.contract,'stable_resource_correction_preview_v1');assert.equal(corrective.correction.beforeValue,1);
  assert.deepEqual(await http.get(`${httpBase}/original${http.query(startInput)}`),{...start,repeated:true});
  assert.deepEqual(await http.get(`${httpBase}/corrections/original${http.query(correctionCommand)}`),correctionReceipt);
  assert.deepEqual(await http.get(`${httpBase}/sessions/${start.sessionId}/commit-original${http.query(command)}`),receipt);
  assert.deepEqual(await http.get(`${httpBase}/sessions/${correctionReceipt.sessionId}/correction-commit-original${http.query(correctionFormalCommand)}`),correctionFormalReceipt);
  assert.equal((await http.get(`${httpBase}/chapters/${second.document.id}`)).checkpointId,correctionFormalReceipt.merged.checkpointId);
  assert.deepEqual(await http.get(`${httpBase}/characters/${actor.id}/issues`),[]);
  assert.equal((await http.get(`${httpBase}/issues/${receipt.issues[0].issue_id}`)).issue.issue_id,receipt.issues[0].issue_id);
  assert.deepEqual(await counts(),prior);
  const foreign=`/books/${key()}/resource-supplements/sessions/${correctionReceipt.sessionId}/source`,missing=await http.raw('GET',foreign);assert.equal(missing.status,404);assert.match((await missing.json()).recovery.sourceRoute,/^\/new-design\/books\//);
  const malformed=await http.raw('POST',`${httpBase}/sessions/${correctionReceipt.sessionId}/correction-commit`,{...correctionFormalCommand,expectedSessionRevision:0});assert.equal(malformed.status,422);assert.equal((await malformed.json()).recovery.mutationOutcome,'not_written');
  assert.deepEqual(await counts(),prior);
 });
 await t.test('deactivation and archive preserve full formal and correction originals and healthy proven source',async()=>{
  await assert.rejects(pool.query('DELETE FROM new_design.resource_supplement_formal_commits WHERE settlement_id=$1',[receipt.merged.settlementId]),error=>error.code==='23514');
  for(const file of ['094_resource_supplement_correction_commits.sql','092_resource_supplement_formal_commits.sql','091_resource_supplement_correction_origins.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback',file),'utf8'));
  await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[book.id]);
  assert.deepEqual(await supplements.readResourceSupplementCommitOriginal(book.id,start.sessionId,command),receipt);assert.deepEqual(await supplements.readResourceSupplementCorrectionStartOriginal(book.id,correctionCommand),correctionReceipt);
  assert.equal((await supplements.commitResourceSupplement(book.id,start.sessionId,command)).repeated,true);assert.equal((await supplements.startResourceSupplementCorrection(book.id,correctionCommand)).repeated,true);
  await assert.rejects(supplements.commitResourceSupplement(book.id,start.sessionId,{...command,requestKey:key()}),error=>error.status===503&&error.mutationOutcome==='not_written');
  await assert.rejects(supplements.startResourceSupplementCorrection(book.id,{...correctionCommand,requestKey:key()}),error=>error.status===503&&error.mutationOutcome==='not_written');
  assert.deepEqual(await supplements.readResourceSupplementCorrectionCommitOriginal(book.id,correctionReceipt.sessionId,correctionFormalCommand),correctionFormalReceipt);
  assert.equal((await supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,correctionFormalCommand)).repeated,true);
  await assert.rejects(supplements.commitResourceSupplementCorrection(book.id,correctionReceipt.sessionId,{...correctionFormalCommand,requestKey:key()}),error=>error.status===503&&error.mutationOutcome==='not_written');
  assert.equal((await pool.query("SELECT is_stale FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='quantity'",[book.id,relationId])).rows[0].is_stale,false);
  assert.equal((await pool.query('SELECT operational FROM new_design.resource_supplement_capabilities')).rows[0].operational,false);
 });
});

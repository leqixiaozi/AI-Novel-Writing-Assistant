const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs');
const key=()=>randomUUID(),field=(key,name,type)=>({key,name,type,description:'正式持有维度',required:false,defaultValue:null,options:[],group:'资源',order:1,aiSuggestible:true});

test('stable supplement preview and exact original request create only an independent closed session',async t=>{
 const fixture=await resourceSupplementFixture(t,[{id:'087_stable_resource_supplements',fileName:'087_stable_resource_supplements.sql'}]);
 const {pool,book,actor,chapter,create,settlement,state,supplements}=fixture,resources=compiled('server/database/characterResources');
 const prop=await create('prop','正文资源',{name:'正文资源'}),definition={name:'人物持有资源',description:'显式正式维度',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['prop'],sourceMax:null,targetMax:null,fields:[field('holding','持有','boolean'),field('quantity','数量','number')],capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'holding',label:'持有',direction:'forward',policy:'tracked',mode:'absolute'},{fieldKey:'quantity',label:'数量',direction:'forward',policy:'tracked',mode:'delta'}]};
 const draft=await settlement.saveSettlementRelationConfigurationDraft(book.id,{requestKey:key(),expectedRelationTypeRevision:null,definition});
 await settlement.publishSettlementRelationConfigurationDraft(book.id,{requestKey:key(),draftId:draft.draftId,expectedRevision:1,confirmPublish:true,confirmInstanceRebind:false,rebindRelations:[],createRelations:[{sourceCardId:actor.id,targetCardId:prop.id}]});
 const ledger=await resources.getCharacterResources(book.id,actor.id),choice=ledger.choices.find(item=>item.holdingDimensionKey==='holding'),selection={relationTypeId:choice.relationTypeId,holdingDimensionKey:choice.holdingDimensionKey,specificationHash:choice.specificationHash},selected=await resources.getCharacterResources(book.id,actor.id,selection),relationId=selected.items[0].relationId;
 for(const [stateKey,value] of [['holding',false],['quantity',0]])await state.saveInitialState({bookId:book.id,subjectKind:'relation',subjectId:relationId,stateKey,value,requestKey:key(),actor:'isolated_test',note:''});
 const first=await chapter(1,1,true),input={checkpointId:first.checkpoint.id,resourceScope:{...selection,characterId:actor.id,characterVersionId:selected.characterVersionId,characterRevision:selected.characterRevision,resourceIds:[prop.id],relationIds:[relationId]}};
 const before=await supplements.previewResourceSupplement(book.id,input);
 const quantity=preview=>preview.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity');
 await t.test('full actual scope and historical zero/false are frozen without any writes',async()=>{
  assert.equal(quantity(before).baseline.value,0);assert.equal(before.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='holding').baseline.value,false);
  assert.equal(before.resourceScope.resources[0].id,prop.id);assert.equal(before.resourceScope.resources[0].relationId,relationId);assert.ok(before.resourceScope.anchors.length);
  assert.ok(before.catalog.subjects.every(item=>[prop.id,relationId].includes(item.id)));assert.equal(before.basis.confirmed.facts.length,1);assert.equal(before.basis.confirmed.knowledge.length,1);assert.equal(before.basis.confirmed.states.length,1);
  const knowledge=before.basis.original.confirmedSources.knowledge[0];assert.equal(typeof knowledge.proposal_version,'object');assert.equal(knowledge.proposal_version.id,knowledge.proposal_version_id);assert.ok(knowledge.proposal_version.text_anchor_id);
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,0);
 });
 const second=await chapter(2,2,false,(workspace,content)=>['quantity','holding'].map(stateKey=>{
  const field=workspace.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key===stateKey);
  return{category:'relationship',title:'后续资源确认',subjectKind:'relation',subjectId:relationId,stateKey,specificationHash:field.specificationHash,baselineHash:field.baseline.hash,beforeValue:field.baseline.value,afterValue:stateKey==='quantity'?2:true,...(stateKey==='quantity'?{changeValue:2}:{}),riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:'后续正文',reason:'作者明确确认后续资源变化'};
 }));
 const preview=await supplements.previewResourceSupplement(book.id,input),command={...input,requestKey:key(),expectedSourceHash:preview.sourceHash};
 const originalRows=async()=> (await pool.query(`SELECT to_jsonb(session) session,to_jsonb(checkpoint) checkpoint,to_jsonb(settlement) settlement,to_jsonb(body) body
  FROM new_design.chapter_stable_checkpoints checkpoint JOIN new_design.chapter_adoption_sessions session ON session.id=checkpoint.session_id
  JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id JOIN new_design.chapter_body_versions body ON body.id=checkpoint.body_version_id
  WHERE checkpoint.id=$1`,[first.checkpoint.id])).rows[0];
 const originalSnapshot=await originalRows();
 await t.test('later real resource changes remain absent from earlier chapter-end catalog and source hash',async()=>{
  const latest=await resources.getCharacterResources(book.id,actor.id,selection);assert.equal(latest.items[0].states.find(item=>item.fieldLabel==='数量').display,'2');assert.equal(latest.items[0].holding.display,'是');
  assert.equal(quantity(preview).baseline.value,0);assert.equal(preview.sourceHash,before.sourceHash);
 });
 await t.test('invalid scope or changed preview cannot create a preparation or session',async()=>{
  await assert.rejects(supplements.previewResourceSupplement(book.id,{...input,resourceScope:{...input.resourceScope,resourceIds:[actor.id]}}),error=>error.status===409);
  await assert.rejects(supplements.startResourceSupplement(book.id,{...command,expectedSourceHash:'0'.repeat(64)}),error=>error.status===409&&error.mutationOutcome==='not_written');
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,0);assert.deepEqual(await originalRows(),originalSnapshot);
 });
 const runtime=compiled('server/database/runtime'),originalPool=runtime.getNewDesignPool;
 async function fault(sqlPredicate,mode,action){
  let injected=false;runtime.getNewDesignPool=async()=>({query:pool.query.bind(pool),connect:async()=>{
   const client=await pool.connect();return new Proxy(client,{get(target,key){if(key==='query')return async(sql,values)=>{
    if(!injected&&typeof sql==='string'&&sqlPredicate(sql)){injected=true;if(mode==='ack_lost'){await target.query(sql,values);throw new Error('Isolated commit acknowledgement lost');}return target.query('SELECT 1/0');}
    return target.query(sql,values);
   };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  }});try{await action();assert.equal(injected,true);}finally{runtime.getNewDesignPool=originalPool;}
 }
 await t.test('audit insertion failure rolls back the new preparation and child together',async()=>{
  await fault(sql=>sql.includes('INSERT INTO new_design.chapter_resource_supplements'),'rollback',()=>assert.rejects(supplements.startResourceSupplement(book.id,command),error=>error.mutationOutcome==='not_written'));
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,0);assert.equal((await pool.query("SELECT count(*)::int n FROM new_design.chapter_adoption_sessions WHERE adoption_kind='resource_supplement'")).rows[0].n,0);assert.deepEqual(await originalRows(),originalSnapshot);
 });
 let receipt;
 await t.test('real commit with lost acknowledgement preserves full original request and creates no formal change',async()=>{
  await fault(sql=>sql==='COMMIT','ack_lost',()=>assert.rejects(supplements.startResourceSupplement(book.id,command),error=>error.mutationOutcome==='unknown'));
  receipt=await supplements.readResourceSupplementStartOriginal(book.id,command);assert.ok(receipt);assert.deepEqual(receipt.input,command);assert.equal(receipt.baseCheckpointId,first.checkpoint.id);assert.equal(receipt.bodyVersionId,first.version.id);
  const actual=(await pool.query('SELECT * FROM new_design.chapter_adoption_sessions WHERE id=$1',[receipt.sessionId])).rows[0];assert.equal(actual.adoption_kind,'resource_supplement');assert.equal(actual.adoption_id,originalSnapshot.session.adoption_id);assert.equal(actual.status,'adopted_pending_proposals');assert.notEqual(actual.preparation_id,originalSnapshot.session.preparation_id);
  const stored=(await pool.query('SELECT * FROM new_design.chapter_resource_supplements WHERE session_id=$1',[receipt.sessionId])).rows[0];assert.equal(stored.source_snapshot.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity').baseline.value,0);assert.equal(stored.source_snapshot.sourceHash,command.expectedSourceHash);
  assert.deepEqual(await originalRows(),originalSnapshot);assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.ai_tasks')).rows[0].n,0);
 });
 await t.test('concurrent same full request returns only the original; different input remains unknown',async()=>{
  const repeated=await Promise.all([supplements.startResourceSupplement(book.id,command),supplements.startResourceSupplement(book.id,command)]);assert.ok(repeated.every(item=>item.repeated&&item.sessionId===receipt.sessionId));
  await assert.rejects(supplements.startResourceSupplement(book.id,{...command,expectedSourceHash:'f'.repeat(64)}),error=>error.mutationOutcome==='unknown');
  await assert.rejects(supplements.readResourceSupplementStartOriginal(book.id,{...command,resourceScope:{...command.resourceScope,characterVersionId:key()}}),error=>error.mutationOutcome==='unknown');
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,1);
 });
 await t.test('closed supplement read view shows frozen chapter-end baseline and preserves its original receipt',async()=>{
  const workspace=await settlement.getChapterSettlementEditingWorkspace(receipt.sessionId);assert.ok(workspace.blockedReason);
  assert.equal(workspace.catalog.sessionId,receipt.sessionId);assert.equal(workspace.catalog.sessionRevision,workspace.session.revision);
  assert.equal(workspace.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity').baseline.value,0);
  assert.equal(workspace.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='holding').baseline.value,false);
  assert.equal((await supplements.readResourceSupplementStartOriginal(book.id,command)).sessionId,receipt.sessionId);assert.deepEqual(await originalRows(),originalSnapshot);
 });
 await t.test('original lookup interruption cannot authorize a new write after acknowledged rollback',async()=>{
  await fault(sql=>sql.includes('SELECT input_hash,full_input,original_receipt'),'rollback',()=>assert.rejects(supplements.startResourceSupplement(book.id,command),error=>error.mutationOutcome==='unknown'));
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,1);
 });
 await t.test('registered stable prompt freezes original confirmed sources and old plan without model or write',async()=>{
  const ai=compiled('server/ai/chapterSettlement'),prompts=compiled('server/ai/prompts');
  assert.equal(prompts.listPromptAssets().find(item=>item.taskType==='stable_resource_supplement').assetId,'new_design.character.stable_resource_supplement');
  const prompt=await ai.prepareStableResourceSupplementPrompt(receipt.sessionId),data=JSON.parse(prompt.messages[1].content).taskData;
  assert.equal(data.catalog.sessionId,receipt.sessionId);assert.equal(data.catalog.subjects.find(item=>item.id===relationId).fields.find(item=>item.key==='quantity').baseline.value,0);
  assert.equal(data.stableOrigin.planningVersionId,preview.basis.planningVersionId);assert.deepEqual(data.stableOrigin.confirmed,preview.basis.confirmed);
  assert.deepEqual(data.stableOrigin.confirmedSources,preview.basis.original.confirmedSources);assert.deepEqual(prompt.parseOutput({items:[],notes:['请核对遗漏变化']}),{items:[],notes:['请核对遗漏变化']});
  assert.deepEqual(await originalRows(),originalSnapshot);assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.ai_tasks')).rows[0].n,0);
  const draft={category:'relationship',title:'正文资源数量变化',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:quantity(preview).specificationHash,baselineHash:quantity(preview).baseline.hash,beforeValue:0,afterValue:1,changeValue:1,riskLevel:'low',confidence:0.8,confidenceNote:'需作者确认',planAlignment:'not_applicable',planExpectation:'',evidenceStart:0,evidenceEnd:2,evidenceLabel:preview.basis.bodyContent.slice(0,2),reason:'原正文证据'};
  assert.deepEqual(prompt.parseOutput({items:[draft],notes:[]}).items[0],draft);
  assert.throws(()=>prompt.parseOutput({items:[{...draft,beforeValue:2,afterValue:3}],notes:[]}));
  assert.throws(()=>prompt.parseOutput({items:[{...draft,category:'fact'}],notes:[]}));
  assert.throws(()=>prompt.parseOutput({items:[{...draft,afterValue:0,changeValue:0}],notes:[]}));
  await assert.rejects(ai.prepareStableResourceSupplementPrompt(preview.basis.sessionId),error=>error.status===409);
 });
 await t.test('stable prompt rejects altered frame, incomplete original sources and repeated confirmed changes',async()=>{
  const {preparePrompt,buildStableResourceSupplementPromptInput:build}=compiled('server/ai/prompts'),{stableHash}=compiled('server/database/aiContracts');
  const raw={sessionId:receipt.sessionId,sessionRevision:1,source:structuredClone(preview)};
  raw.source.basis.bodyContent+='伪造';assert.throws(()=>preparePrompt('stable_resource_supplement',build(raw)));
  raw.source=structuredClone(preview);raw.source.basis.original.confirmedSources.facts=[];
  function rehash(source){delete source.basis.sourceHash;source.basis.sourceHash=stableHash(source.basis);delete source.sourceHash;source.sourceHash=stableHash(source);}
  rehash(raw.source);assert.throws(()=>preparePrompt('stable_resource_supplement',build(raw)));
  raw.source=structuredClone(preview);
  const row=raw.source.basis.original.confirmedSources.states[0];row.subject_kind='relation';row.subject_id=relationId;row.state_key='quantity';row.before_json=0;row.after_json=1;
  rehash(raw.source);const prompt=preparePrompt('stable_resource_supplement',build(raw));
  const draft={category:'relationship',title:'已有变化',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:quantity(preview).specificationHash,baselineHash:quantity(preview).baseline.hash,beforeValue:0,afterValue:1,changeValue:1,riskLevel:'low',confidence:0.8,confidenceNote:'',planAlignment:'not_applicable',planExpectation:'',evidenceStart:0,evidenceEnd:2,evidenceLabel:preview.basis.bodyContent.slice(0,2),reason:'候选'};
  assert.throws(()=>prompt.parseOutput({items:[draft],notes:[]}));
 });
 await t.test('manual candidate-only contract uses governed generation and author review while formal history stays closed',async reviewTests=>{
  const fs=require('node:fs'),path=require('node:path');
  assert.equal((await pool.query('SELECT current_database() name')).rows[0].name,fixture.database);
  assert.match(fixture.database,/^nd_reference_test_[a-f0-9]{32}$/);
  const installer=await pool.connect();try{await installer.query('BEGIN');for(const [id,file] of [['085_character_resource_backfill','085_character_resource_backfill.sql'],['088_stable_resource_supplement_candidates','088_stable_resource_supplement_candidates.sql'],['089_resource_supplement_impact_reviews','089_resource_supplement_impact_reviews.sql'],['090_resource_supplement_integrity','090_resource_supplement_integrity.sql']]){
   await installer.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));await installer.query('INSERT INTO new_design.schema_migrations(id) VALUES($1)',[id]);
  }await installer.query('COMMIT');}catch(error){await installer.query('ROLLBACK');throw error;}finally{installer.release();}
  const ai=compiled('server/ai/chapterSettlement'),models=compiled('server/database/modelManagement');
  let laterPlan=await fixture.planning.addPlanningVersion(first.object.id,{content:{...fixture.planContent,notes:'补充创建后另行采用的计划'},source:'manual',executionMode:'ai_assisted',basedOnParentVersionId:fixture.volume.adoptedVersionId,references:[],expectedRevision:first.object.revision,idempotencyKey:key()});
  laterPlan=await fixture.planning.adoptPlanningVersion(laterPlan.id,{versionId:laterPlan.currentVersionId,expectedRevision:laterPlan.revision,idempotencyKey:key()});assert.notEqual(laterPlan.adoptedVersionId,preview.basis.planningVersionId);
  const route={primary:{provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'isolated-stub-never-real-model',credentialId:null},fallbacks:[],policy:{maxOutputTokens:8000,maxTotalTokens:1000000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}};
  for(const [scope,taskType] of [['system_default',null],['task','chapter_settlement']]){const current=(await models.getModelRouteCenterCatalog()).routes.find(item=>item.scope===scope&&item.taskType===taskType);await models.saveManagedModelRoute({...route,scope,taskType,expectedConfigId:current?.id??null,expectedRevision:current?.revision??null,replaceUnsupported:true,idempotencyKey:key()});}
  let workspace=await settlement.getChapterSettlementEditingWorkspace(receipt.sessionId),calls=0;
  const draft={category:'relationship',title:'补充取得一份资源',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:quantity(preview).specificationHash,baselineHash:quantity(preview).baseline.hash,beforeValue:0,afterValue:1,changeValue:1,riskLevel:'low',confidence:0.8,confidenceNote:'待作者核对',planAlignment:'not_applicable',planExpectation:'',evidenceStart:0,evidenceEnd:preview.basis.bodyContent.length,evidenceLabel:preview.basis.bodyContent,reason:'原正文明确'};
  const request={expectedSessionRevision:workspace.session.revision,requestKey:key(),catalogHash:workspace.catalog.specificationHash,resourceScope:input.resourceScope};
  const fetcher=async()=>{calls++;return new Response(JSON.stringify({message:{content:JSON.stringify({items:[draft],notes:['仅整理遗漏变化']})},prompt_eval_count:100,eval_count:50}),{status:200,headers:{'content-type':'application/json'}});};
  const generated=await ai.runChapterSettlementAiExtraction(receipt.sessionId,request,{fetcher});assert.equal(generated.status,'succeeded',JSON.stringify(generated.failure));assert.equal(generated.proposalsSaved,true);assert.equal(calls,1);
  assert.equal((await ai.runChapterSettlementAiExtraction(receipt.sessionId,request,{fetcher})).repeated,true);assert.equal(calls,1);
  const stored=(await pool.query('SELECT * FROM new_design.chapter_proposal_extraction_requests WHERE id=$1',[generated.id])).rows[0];assert.equal(stored.frozen_plan.assetId,'new_design.character.stable_resource_supplement');assert.deepEqual(stored.frozen_plan.input.stableSupplement.source,preview);
  assert.equal((await pool.query("SELECT exact_version_id FROM new_design.context_manifest_entries WHERE manifest_id=$1 AND source_type='planning_version'",[stored.context_manifest_id])).rows[0].exact_version_id,preview.basis.planningVersionId);
  await assert.rejects(ai.runChapterSettlementAiExtraction(receipt.sessionId,{...request,catalogHash:'0'.repeat(64)},{fetcher}),error=>error.status===409);assert.equal(calls,1);
  workspace=await settlement.getChapterSettlementEditingWorkspace(receipt.sessionId);const item=workspace.items[0];assert.equal(item.beforeValue,0);
  const uncertainEdit={expectedSessionRevision:workspace.session.revision,expectedRevision:item.revision,requestKey:key(),draft:{...draft,title:'读取中断时保留输入'},actor:'isolated_author'};
  await fault(sql=>sql.includes('SELECT editing_input_hash,editing_receipt'),'rollback',()=>assert.rejects(settlement.updateChapterSettlementEditingItem(item.id,uncertainEdit),error=>{assert.equal(error.recovery?.mutationOutcome,'unknown',error.stack);return true;}));
  assert.equal(await settlement.readChapterSettlementEditingReceipt(receipt.sessionId,uncertainEdit.requestKey),null);
  const editRequest={expectedSessionRevision:workspace.session.revision,expectedRevision:item.revision,requestKey:key(),draft:{...draft,title:'作者核对遗漏资源'},actor:'isolated_author'};
  await fault(sql=>sql==='COMMIT','ack_lost',()=>assert.rejects(settlement.updateChapterSettlementEditingItem(item.id,editRequest),error=>error.recovery.mutationOutcome==='unknown'));
  const edited=await settlement.readChapterSettlementEditingReceipt(receipt.sessionId,editRequest.requestKey);assert.ok(edited);workspace=edited.workspace;
  const repeated=await settlement.updateChapterSettlementEditingItem(item.id,editRequest);assert.equal(repeated.repeated,true);
  await assert.rejects(settlement.updateChapterSettlementEditingItem(item.id,{...editRequest,draft:{...editRequest.draft,title:'同原键不可覆盖'}}),error=>error.status===409&&error.recovery.mutationOutcome==='unknown');
  await assert.rejects(settlement.createChapterSettlementEditingItem(receipt.sessionId,{expectedSessionRevision:workspace.session.revision,requestKey:key(),draft:{...draft,afterValue:0,changeValue:0}}),error=>error.status===409);
  const decided=await settlement.decideChapterSettlementEditingItems(receipt.sessionId,{expectedSessionRevision:workspace.session.revision,requestKey:key(),decisions:[{itemId:item.id,expectedRevision:workspace.items[0].revision,decision:'confirm',note:'明确核对原正文'}],actor:'isolated_author'});workspace=decided.workspace;
  assert.equal(workspace.items[0].decision,'confirm');assert.deepEqual(await originalRows(),originalSnapshot);
  const counts=async()=>(await pool.query('SELECT (SELECT count(*) FROM new_design.chapter_settlements) settlements,(SELECT count(*) FROM new_design.chapter_stable_checkpoints) checkpoints,(SELECT count(*) FROM new_design.state_changes) states,(SELECT count(*) FROM new_design.ai_tasks) tasks')).rows[0],unchanged=await counts();
  const impact=await supplements.previewResourceSupplementSettlement(book.id,receipt.sessionId),chain=impact.stateChain.find(row=>row.subjectId===relationId&&row.stateKey==='quantity');
  assert.ok(chain);assert.equal(chain.expectedBefore,1);assert.equal(chain.recordedBefore,0);assert.equal(chain.recordedAfter,2);assert.equal(chain.reason,'before_conflict');
  assert.equal(impact.downstreamSource.chapters.length,1);assert.equal(impact.downstreamSource.chapters[0].body.id,chain.bodyVersionId);
  assert.equal(impact.downstreamSource.states[0].change.id,chain.stateChangeId);assert.equal(impact.changes[0].proposalId,workspace.items[0].stateProposalId);
  assert.equal((await supplements.previewResourceSupplementSettlement(book.id,receipt.sessionId)).impactHash,impact.impactHash);assert.deepEqual(await counts(),unchanged);
  await assert.rejects(supplements.previewResourceSupplementSettlement(key(),receipt.sessionId),error=>error.status===409);
  const reviewInput={requestKey:key(),expectedSessionRevision:workspace.session.revision,expectedImpactHash:impact.impactHash,acknowledgedConflictStateChangeIds:[chain.stateChangeId],note:'已核对原0→2与补充后预期前值1；影响确认不会修复下游状态。'};
  let savedReview,freshReview;
  await reviewTests.test('impact review missing conflict acknowledgement writes nothing',async()=>{
   await assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,{...reviewInput,requestKey:key(),acknowledgedConflictStateChangeIds:[]}),error=>error.status===422&&error.mutationOutcome==='not_written');
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_impact_reviews')).rows[0].n,0);
  });
  await reviewTests.test('impact review lookup interruption remains unknown and insert failure rolls back',async()=>{
   await fault(sql=>sql.includes('SELECT review_id,book_id,session_id,input_hash'),'rollback',()=>assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,reviewInput),error=>error.mutationOutcome==='unknown'));
   await fault(sql=>sql.includes('INSERT INTO new_design.resource_supplement_impact_reviews'),'rollback',()=>assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,reviewInput),error=>error.mutationOutcome==='not_written'));
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_impact_reviews')).rows[0].n,0);
  });
  await reviewTests.test('impact review real commit with lost acknowledgement recovers full original',async()=>{
   await fault(sql=>sql==='COMMIT','ack_lost',()=>assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,reviewInput),error=>{assert.equal(error.mutationOutcome,'unknown',error.cause?.stack??error.stack);return true;}));
   savedReview=await supplements.readResourceSupplementImpactReviewOriginal(book.id,receipt.sessionId,reviewInput);
   assert.ok(savedReview);assert.deepEqual(savedReview.input,reviewInput);assert.deepEqual(savedReview.impact,impact);assert.equal(savedReview.repeated,true);
   const repeats=await Promise.all([supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,reviewInput),supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,reviewInput)]);
   assert.ok(repeats.every(row=>row.reviewId===savedReview.reviewId&&row.repeated));
   await assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,{...reviewInput,note:'同原键修改说明'}),error=>error.mutationOutcome==='unknown');
   await assert.rejects(supplements.readResourceSupplementImpactReviewOriginal(book.id,key(),reviewInput),error=>error.mutationOutcome==='unknown');
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_impact_reviews')).rows[0].n,1);assert.deepEqual(await counts(),unchanged);
   await assert.rejects(pool.query('UPDATE new_design.resource_supplement_impact_reviews SET full_input=full_input WHERE review_id=$1',[savedReview.reviewId]),error=>error.code==='23514');
   await assert.rejects(pool.query('DELETE FROM new_design.resource_supplement_impact_reviews WHERE review_id=$1',[savedReview.reviewId]),error=>error.code==='23514');
  });
  await reviewTests.test('actual SQL rejects a rehashed fake compatible chain or omitted downstream sources',async()=>{
   const {stable,stableHash}=compiled('server/database/aiContracts/integrity');
   for(const modify of [r=>{r.impact.stateChain[0].reason='compatible';r.input.acknowledgedConflictStateChangeIds=[];},r=>{r.impact.downstreamSource.states=[];r.impact.stateChain=[];r.input.acknowledgedConflictStateChangeIds=[];},r=>{r.impact.downstreamSource.chapters=[];}]){
    const r=structuredClone(savedReview);r.reviewId=key();r.input.requestKey=key();r.repeated=false;modify(r);
    delete r.impact.impactHash;r.impact.impactHash=stableHash(r.impact);r.input.expectedImpactHash=r.impact.impactHash;
    const requestFrame={contract:r.contract,bookId:book.id,sessionId:receipt.sessionId,input:r.input};r.inputHash=stableHash(requestFrame);
    const {impactHash,...frame}=r.impact;
    await assert.rejects(pool.query(`INSERT INTO new_design.resource_supplement_impact_reviews(review_id,book_id,session_id,request_key,session_revision,full_input,input_hash,canonical_input,impact_snapshot,impact_hash,canonical_impact,original_receipt)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12::jsonb)`,[r.reviewId,book.id,receipt.sessionId,r.input.requestKey,r.sessionRevision,JSON.stringify(r.input),r.inputHash,stable(requestFrame),JSON.stringify(r.impact),impactHash,stable(frame),JSON.stringify(r)]),error=>error.code==='23514');
   }
   const checker=await pool.connect();try{await checker.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    assert.equal((await supplements.readResourceSupplementImpactReviewForSettlementInTransaction(checker,book.id,receipt.sessionId,savedReview.reviewId,impact)).reviewId,savedReview.reviewId);
   }finally{await checker.query('ROLLBACK');checker.release();}
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_impact_reviews')).rows[0].n,1);assert.deepEqual(await counts(),unchanged);
  });
  const propVersionId=(await pool.query('SELECT current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2',[prop.id,book.spaceId])).rows[0].current_version_id;
  let nextPlan=await fixture.planning.addPlanningVersion(second.object.id,{content:{...fixture.planContent,notes:'下游预览后另行采用的新计划'},source:'manual',executionMode:'ai_assisted',basedOnParentVersionId:fixture.volume.adoptedVersionId,references:[{role:'item',cardId:prop.id,cardVersionId:propVersionId,note:'核对确切资源版本',sortOrder:1}],expectedRevision:second.object.revision,idempotencyKey:key()});
  nextPlan=await fixture.planning.adoptPlanningVersion(nextPlan.id,{versionId:nextPlan.currentVersionId,expectedRevision:nextPlan.revision,idempotencyKey:key()});
  const refreshed=await supplements.previewResourceSupplementSettlement(book.id,receipt.sessionId);assert.notEqual(refreshed.impactHash,impact.impactHash);assert.equal(refreshed.downstreamSource.chapters[0].adopted_plan.id,nextPlan.adoptedVersionId);assert.equal(refreshed.downstreamSource.chapters[0].body_plan.id,second.object.adoptedVersionId);
  assert.equal(refreshed.downstreamSource.planningReferences.length,1);assert.equal(typeof refreshed.downstreamSource.planningReferences[0].source_version,'object');assert.equal(refreshed.downstreamSource.planningReferences[0].source_version.id,propVersionId);assert.equal(refreshed.downstreamSource.planningReferences[0].source_version.card_id,prop.id);
  await reviewTests.test('changed downstream plan invalidates a new review and preserves the complete saved one',async()=>{
   await assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,{...reviewInput,requestKey:key()}),error=>error.status===409&&error.mutationOutcome==='not_written');
   assert.deepEqual((await supplements.readResourceSupplementImpactReviewOriginal(book.id,receipt.sessionId,reviewInput)).impact,impact);
   const checker=await pool.connect();try{await checker.query('BEGIN');
    await assert.rejects(supplements.readResourceSupplementImpactReviewForSettlementInTransaction(checker,book.id,receipt.sessionId,savedReview.reviewId,refreshed),error=>error.status===409);
   }finally{await checker.query('ROLLBACK');checker.release();}
   freshReview=await supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,{...reviewInput,requestKey:key(),expectedImpactHash:refreshed.impactHash});
   assert.deepEqual(freshReview.impact,refreshed);assert.equal(freshReview.impact.stateChain[0].reason,'before_conflict');assert.deepEqual(await counts(),unchanged);
  });
  const verifier=await pool.connect();try{await verifier.query('BEGIN');await verifier.query("UPDATE new_design.chapter_text_anchors SET status='archived' WHERE id=$1",[impact.downstreamSource.states[0].change.text_anchor_id]);
   await assert.rejects(supplements.previewResourceSupplementSettlementInTransaction(verifier,book.id,receipt.sessionId),error=>error.status===409);
  }finally{await verifier.query('ROLLBACK');verifier.release();}
  assert.equal((await supplements.previewResourceSupplementSettlement(book.id,receipt.sessionId)).impactHash,refreshed.impactHash);assert.deepEqual(await counts(),unchanged);
  assert.equal((await pool.query('SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity'])).rows[0].value_json,2);
  await assert.rejects(settlement.commitChapterSettlementEditing(receipt.sessionId,{expectedSessionRevision:workspace.session.revision,requestKey:key(),note:'下游尚未复核'}),error=>error.status===503&&error.recovery.mutationOutcome==='not_written');
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_settlements WHERE supplement_base_checkpoint_id IS NOT NULL')).rows[0].n,0);
  await reviewTests.test('real merged SQL retains all old confirmations and the unchanged deferred guard prevents publication',async()=>{
   const futurePreview=await supplements.previewResourceSupplement(book.id,{...input,checkpointId:second.checkpoint.id});
   const futureCommand={...input,checkpointId:second.checkpoint.id,requestKey:key(),expectedSourceHash:futurePreview.sourceHash};
   const futureReceipt=await supplements.startResourceSupplement(book.id,futureCommand);
   const merger=await pool.connect();let merged;
   try{await merger.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    merged=await settlement.writeResourceSupplementMergedSettlementInTransaction(merger,book.id,receipt.sessionId,{requestKey:key(),reviewId:freshReview.reviewId,expectedSessionRevision:workspace.session.revision,expectedImpactHash:refreshed.impactHash});
    assert.deepEqual(merged.confirmed.facts,preview.basis.confirmed.facts);assert.deepEqual(merged.confirmed.knowledge,preview.basis.confirmed.knowledge);
    assert.deepEqual(merged.confirmed.states,[...preview.basis.confirmed.states,...merged.newStateChangeIds]);assert.equal(merged.newStateChangeIds.length,1);
    const newCheckpoint=(await merger.query('SELECT * FROM new_design.chapter_stable_checkpoints WHERE id=$1',[merged.checkpointId])).rows[0];
    assert.equal(newCheckpoint.previous_checkpoint_id,first.checkpoint.id);assert.equal(newCheckpoint.body_version_id,first.version.id);assert.equal(newCheckpoint.status,'stable');
    const oldRows=(await merger.query(`SELECT to_jsonb(session) session,to_jsonb(checkpoint) checkpoint,to_jsonb(settlement) settlement,to_jsonb(body) body
      FROM new_design.chapter_stable_checkpoints checkpoint JOIN new_design.chapter_adoption_sessions session ON session.id=checkpoint.session_id
      JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id JOIN new_design.chapter_body_versions body ON body.id=checkpoint.body_version_id WHERE checkpoint.id=$1`,[first.checkpoint.id])).rows[0];
    assert.equal(oldRows.checkpoint.status,'superseded');oldRows.checkpoint.status='stable';assert.deepEqual(oldRows,originalSnapshot);
    const context=await settlement.getNextChapterStableContextInTransaction(merger,book.id,second.card.id);
    assert.equal(context.previousCheckpoint.id,merged.checkpointId);assert.deepEqual(context.previousCheckpoint.summary.confirmed,merged.confirmed);
    assert.deepEqual(context.confirmedFacts.map(row=>row.id),merged.confirmed.facts);assert.deepEqual(context.knowledgeChanges.map(row=>row.id),merged.confirmed.knowledge);
    assert.ok(context.recentStateChanges.some(row=>row.id===preview.basis.confirmed.states[0]));assert.ok(context.recentStateChanges.some(row=>row.id===merged.newStateChangeIds[0]&&row.afterValue===1));
    await state.rebuildStateProjectionInTransaction(merger,{bookId:book.id,subjectKind:'relation',subjectId:relationId,stateKey:'quantity'});
    const projection=(await merger.query('SELECT * FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity'])).rows[0];
    assert.equal(projection.value_json,2);assert.equal(projection.source_state_change_id,chain.stateChangeId);
    const integrity=await supplements.recordResourceSupplementIntegrityInTransaction(merger,book.id,merged,refreshed);assert.equal(integrity.issueIds.length,1);
    const issue=(await merger.query('SELECT * FROM new_design.resource_supplement_integrity_issues WHERE issue_id=$1',[integrity.issueIds[0]])).rows[0];
    assert.equal(issue.state_change_id,chain.stateChangeId);assert.equal(issue.chapter_document_id,second.document.id);assert.equal(issue.body_version_id,second.version.id);assert.equal(issue.impact.expectedBefore,1);assert.equal(issue.impact.recordedBefore,0);
    assert.equal((await merger.query('SELECT is_stale FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity'])).rows[0].is_stale,true);
    const correction=await supplements.readResourceSupplementCorrectionBasisInTransaction(merger,book.id,issue.issue_id);
    assert.equal(correction.beforeValue,1);assert.equal(correction.originalRecordedBefore,0);assert.equal(correction.originalRecordedAfter,2);
    assert.equal(correction.baseCheckpointId,second.checkpoint.id);assert.equal(correction.prefixSource.change.id,merged.newStateChangeIds[0]);
    assert.equal(correction.prefixSource.checkpoint.id,merged.checkpointId);assert.equal(correction.chapterEndBasis.bodyVersionId,second.version.id);
    const endState=await supplements.readResourceSupplementHistoricalStateInTransaction(merger,{bookId:book.id,checkpointId:second.checkpoint.id,subjectKind:'relation',subjectId:relationId,stateKey:'quantity'});
    assert.equal(endState.value,2);assert.equal((await supplements.readResourceSupplementCorrectionBasisInTransaction(merger,book.id,issue.issue_id)).sourceHash,correction.sourceHash);
    await assert.rejects(supplements.previewResourceSupplementInTransaction(merger,book.id,{...input,checkpointId:second.checkpoint.id}),error=>error.status===409&&/未修正的真实冲突/.test(error.message));
    await assert.rejects(supplements.assertResourceSupplementHistoricalSourceAvailableInTransaction(merger,book.id,2,[{subjectKind:'relation',id:relationId}]),error=>error.status===409);
    await supplements.assertResourceSupplementHistoricalSourceAvailableInTransaction(merger,book.id,1,[{subjectKind:'relation',id:relationId}]);
    await supplements.assertResourceSupplementHistoricalSourceAvailableInTransaction(merger,book.id,2,[{subjectKind:'card',id:actor.id}]);
    await supplements.assertResourceSupplementHistoricalSourceAvailableInTransaction(merger,book.id,2,[{subjectKind:'card',id:relationId}]);
    const pendingFuture=(await merger.query('SELECT * FROM new_design.chapter_adoption_sessions WHERE id=$1',[futureReceipt.sessionId])).rows[0];
    await assert.rejects(settlement.assertResourceSupplementCandidateContract(merger,pendingFuture,'preview',false),error=>error.status===409&&/未修正的真实冲突/.test(error.message));
    await assert.rejects(supplements.readResourceSupplementCorrectionBasisInTransaction(merger,key(),issue.issue_id),error=>error.status===409);
    await merger.query('SAVEPOINT invalid_correction_prefix');
    try{await merger.query("UPDATE new_design.chapter_text_anchors SET status='archived' WHERE id=$1",[correction.prefixSource.change.text_anchor_id]);
      await assert.rejects(supplements.readResourceSupplementCorrectionBasisInTransaction(merger,book.id,issue.issue_id),error=>error.status===409&&/真实章前状态来源/.test(error.message));
    }finally{await merger.query('ROLLBACK TO SAVEPOINT invalid_correction_prefix');await merger.query('RELEASE SAVEPOINT invalid_correction_prefix');}
    const production=compiled('server/database/chapterProduction/continuitySources');
    await assert.rejects(production.readChapterContinuitySources(merger,book.id,second.card.id),error=>error.status===409&&/原来源已失效/.test(error.message));
    const cannotBypass=async action=>{await merger.query('SAVEPOINT actual_integrity_guard');
      try{await assert.rejects(action,error=>error.code==='23514');}finally{await merger.query('ROLLBACK TO SAVEPOINT actual_integrity_guard');await merger.query('RELEASE SAVEPOINT actual_integrity_guard');}};
    await cannotBypass(()=>state.rebuildStateProjectionInTransaction(merger,{bookId:book.id,subjectKind:'relation',subjectId:relationId,stateKey:'quantity'}));
    await cannotBypass(()=>merger.query('UPDATE new_design.current_state_projections SET is_stale=false WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity']));
    await cannotBypass(()=>merger.query('DELETE FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity']));
    await cannotBypass(()=>merger.query("UPDATE new_design.current_state_projections SET state_key='fake_move' WHERE book_id=$1 AND subject_id=$2 AND state_key=$3",[book.id,relationId,'quantity']));
    await cannotBypass(()=>merger.query('DELETE FROM new_design.resource_supplement_integrity_issues WHERE issue_id=$1',[issue.issue_id]));
    await merger.query('SAVEPOINT cached_source_claim');try{
      await assert.rejects(merger.query(`INSERT INTO new_design.chapter_proposal_extraction_requests(id,session_id,book_id,body_version_id,expected_session_revision)
        VALUES($1,$2,$3,$4,$5)`,[key(),futureReceipt.sessionId,book.id,second.version.id,pendingFuture.revision]),error=>error.code==='23514'&&/cannot bypass actual source conflict/.test(error.message));
    }finally{await merger.query('ROLLBACK TO SAVEPOINT cached_source_claim');await merger.query('RELEASE SAVEPOINT cached_source_claim');}
    await cannotBypass(()=>merger.query(`INSERT INTO new_design.resource_supplement_integrity_resolutions(resolution_id,issue_id,book_id,correction_checkpoint_id,request_key,full_proof,proof_hash,original_receipt)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,[key(),issue.issue_id,book.id,second.checkpoint.id,key(),JSON.stringify({acknowledged:true}),'a'.repeat(64),JSON.stringify({resolved:true})]));
    await merger.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback/090_resource_supplement_integrity.sql'),'utf8'));
    await cannotBypass(()=>merger.query('UPDATE new_design.current_state_projections SET is_stale=false WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity']));
    await assert.rejects(production.readChapterContinuitySources(merger,book.id,second.card.id),error=>error.status===409&&/原来源已失效/.test(error.message));
    await assert.rejects(merger.query('SET CONSTRAINTS new_design.chapter_resource_supplement_closure_required IMMEDIATE'),error=>error.code==='23514'&&/downstream closure is not operational/.test(error.message));
   }finally{await merger.query('ROLLBACK');merger.release();}
   assert.deepEqual(await originalRows(),originalSnapshot);assert.deepEqual(await counts(),unchanged);
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_settlements WHERE supplement_base_checkpoint_id IS NOT NULL')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_stable_checkpoints WHERE id=$1',[merged.checkpointId])).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_issues')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.resource_supplement_integrity_journals')).rows[0].n,0);
  });
  await reviewTests.test('review deactivation retains receipts and forbids new writes without clearing any source conflict',async()=>{
   await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback/089_resource_supplement_impact_reviews.sql'),'utf8'));
   assert.equal((await supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,reviewInput)).reviewId,savedReview.reviewId);
   await assert.rejects(supplements.confirmResourceSupplementSettlementImpact(book.id,receipt.sessionId,{...reviewInput,requestKey:key(),expectedImpactHash:refreshed.impactHash}),error=>error.status===503&&error.mutationOutcome==='not_written');
   assert.deepEqual((await supplements.readResourceSupplementImpactReviewOriginal(book.id,receipt.sessionId,reviewInput)).impact,impact);assert.deepEqual(await counts(),unchanged);
  });
  const actorView=await fixture.cards.getCard(actor.id);
  await fixture.cards.updateCard(actor.id,{title:actorView.title+'资料更新',values:actorView.values,revision:actorView.revision});
  await assert.rejects(ai.runChapterSettlementAiExtraction(receipt.sessionId,{...request,requestKey:key(),expectedSessionRevision:workspace.session.revision},{fetcher}),error=>error.status===409&&error.modelRequestState==='not_sent');assert.equal(calls,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_proposal_extraction_requests WHERE session_id=$1',[receipt.sessionId])).rows[0].n,1);
  assert.deepEqual(await originalRows(),originalSnapshot);
  await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/manual-rollback/088_stable_resource_supplement_candidates.sql'),'utf8'));
  assert.equal((await ai.runChapterSettlementAiExtraction(receipt.sessionId,request,{fetcher})).id,generated.id);assert.equal(calls,1);
  await assert.rejects(ai.runChapterSettlementAiExtraction(receipt.sessionId,{...request,requestKey:key(),expectedSessionRevision:workspace.session.revision},{fetcher}),error=>error.status===503);assert.equal(calls,1);
  assert.equal((await supplements.readResourceSupplementStartOriginal(book.id,command)).sessionId,receipt.sessionId);assert.deepEqual(await originalRows(),originalSnapshot);
 });
 await t.test('archive does not rewrite or hide the saved original result and new writes stay blocked',async()=>{
  await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[book.id]);
  assert.equal((await supplements.readResourceSupplementStartOriginal(book.id,command)).sessionId,receipt.sessionId);
  await assert.rejects(supplements.startResourceSupplement(book.id,{...command,requestKey:key()}),error=>error.mutationOutcome==='not_written');
  assert.deepEqual(await originalRows(),originalSnapshot);
 });
});

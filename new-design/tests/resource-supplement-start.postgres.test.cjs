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
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_resource_supplements')).rows[0].n,0);
 });
 await chapter(2,2,false,(workspace,content)=>['quantity','holding'].map(stateKey=>{
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
 await t.test('manual candidate-only contract uses governed generation and author review while formal history stays closed',async()=>{
  const fs=require('node:fs'),path=require('node:path');
  assert.equal((await pool.query('SELECT current_database() name')).rows[0].name,fixture.database);
  assert.match(fixture.database,/^nd_reference_test_[a-f0-9]{32}$/);
  const installer=await pool.connect();try{await installer.query('BEGIN');for(const [id,file] of [['085_character_resource_backfill','085_character_resource_backfill.sql'],['088_stable_resource_supplement_candidates','088_stable_resource_supplement_candidates.sql']]){
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
  assert.equal((await pool.query('SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key=$3',[book.id,relationId,'quantity'])).rows[0].value_json,2);
  await assert.rejects(settlement.commitChapterSettlementEditing(receipt.sessionId,{expectedSessionRevision:workspace.session.revision,requestKey:key(),note:'下游尚未复核'}),error=>error.status===503&&error.recovery.mutationOutcome==='not_written');
  assert.equal((await pool.query('SELECT count(*)::int n FROM new_design.chapter_settlements WHERE supplement_base_checkpoint_id IS NOT NULL')).rows[0].n,0);
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

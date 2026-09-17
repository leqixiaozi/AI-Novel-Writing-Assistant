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
  let injected=false;runtime.getNewDesignPool=async()=>({connect:async()=>{
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
  const {preparePrompt}=compiled('server/ai/prompts'),{stableHash}=compiled('server/database/aiContracts');
  const raw={sessionId:receipt.sessionId,sessionRevision:1,source:structuredClone(preview)};
  raw.source.basis.bodyContent+='伪造';assert.throws(()=>preparePrompt('stable_resource_supplement',raw));
  raw.source=structuredClone(preview);raw.source.basis.original.confirmedSources.facts=[];
  function rehash(source){delete source.basis.sourceHash;source.basis.sourceHash=stableHash(source.basis);delete source.sourceHash;source.sourceHash=stableHash(source);}
  rehash(raw.source);assert.throws(()=>preparePrompt('stable_resource_supplement',raw));
  raw.source=structuredClone(preview);
  const row=raw.source.basis.original.confirmedSources.states[0];row.subject_kind='relation';row.subject_id=relationId;row.state_key='quantity';row.before_json=0;row.after_json=1;
  rehash(raw.source);const prompt=preparePrompt('stable_resource_supplement',raw);
  const draft={category:'relationship',title:'已有变化',subjectKind:'relation',subjectId:relationId,stateKey:'quantity',specificationHash:quantity(preview).specificationHash,baselineHash:quantity(preview).baseline.hash,beforeValue:0,afterValue:1,changeValue:1,riskLevel:'low',confidence:0.8,confidenceNote:'',planAlignment:'not_applicable',planExpectation:'',evidenceStart:0,evidenceEnd:2,evidenceLabel:preview.basis.bodyContent.slice(0,2),reason:'候选'};
  assert.throws(()=>prompt.parseOutput({items:[draft],notes:[]}));
 });
 await t.test('archive does not rewrite or hide the saved original result and new writes stay blocked',async()=>{
  await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[book.id]);
  assert.equal((await supplements.readResourceSupplementStartOriginal(book.id,command)).sessionId,receipt.sessionId);
  await assert.rejects(supplements.startResourceSupplement(book.id,{...command,requestKey:key()}),error=>error.mutationOutcome==='not_written');
  assert.deepEqual(await originalRows(),originalSnapshot);
 });
});

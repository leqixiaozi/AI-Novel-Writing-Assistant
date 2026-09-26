const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs'),{resourceSupplementHttp}=require('./support/resourceSupplementHttp.cjs');
const key=()=>randomUUID();
test('real PostgreSQL / complete HTTP resource focus keeps formal sources and recovers the saved original without another provider call',async t=>{
 const f=await resourceSupplementFixture(t),{pool,book,actor,settlement}=f,prop=await f.create('prop','显示建议资源',{name:'显示建议资源'});
 const field=(key,name,type)=>({key,name,type,description:'真实资源',required:false,defaultValue:null,options:[],group:'资源',order:1,aiSuggestible:true});
 const definition={name:'显示建议人物持有',description:'隔离范围',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['prop'],sourceMax:null,targetMax:null,fields:[field('holding','持有','boolean'),field('quantity','数量','number')],capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'holding',label:'持有',direction:'forward',policy:'tracked',mode:'absolute'},{fieldKey:'quantity',label:'数量',direction:'forward',policy:'tracked',mode:'delta'}]};
 const draft=await settlement.saveSettlementRelationConfigurationDraft(book.id,{requestKey:key(),expectedRelationTypeRevision:null,definition});
 await settlement.publishSettlementRelationConfigurationDraft(book.id,{requestKey:key(),draftId:draft.draftId,expectedRevision:1,confirmPublish:true,confirmInstanceRebind:false,rebindRelations:[],createRelations:[{sourceCardId:actor.id,targetCardId:prop.id}]});
 const resources=compiled('server/database/characterResources'),focus=compiled('server/database/characterResources/focus'),schema=compiled('common/characterResources/focus'),models=compiled('server/database/modelManagement');
 const ledger=await resources.getCharacterResources(book.id,actor.id),choice=ledger.choices.find(item=>item.holdingDimensionKey==='quantity'),selection={relationTypeId:choice.relationTypeId,holdingDimensionKey:choice.holdingDimensionKey,specificationHash:choice.specificationHash};
 const route={primary:{provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'isolated-resource-focus-provider-stub',credentialId:null},fallbacks:[],policy:{maxOutputTokens:24000,maxTotalTokens:1000000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}};
 for(const [scope,taskType]of [['system_default',null],['task','form_assist']]){const current=(await models.getModelRouteCenterCatalog()).routes.find(item=>item.scope===scope&&item.taskType===taskType);await models.saveManagedModelRoute({...route,scope,taskType,expectedConfigId:current?.id??null,expectedRevision:current?.revision??null,replaceUnsupported:true,idempotencyKey:key()});}
 let calls=0,lose=true,failProvider=false;
 const gateway=compiled('server/ai').createIndependentAiGateway({fetcher:async(_url,init)=>{
  calls++;if(failProvider)throw new Error('Controlled provider response lost after request');
  const {snapshot}=JSON.parse(JSON.parse(init.body).messages.at(-1).content).taskData;
  const source=snapshot.evidenceSources.find(source=>source.cardId===actor.id&&source.fieldKey==='story_role');assert.ok(source);
  const proof={cardId:source.cardId,versionId:source.versionId,fieldKey:source.fieldKey,start:0,end:source.text.length,excerpt:source.text};
  const output={role:{value:'protagonist',explanation:'已保存人物定位证据',evidence:[proof]},resources:snapshot.ledger.items.map(item=>({relationId:item.relationId,resourceId:item.resourceId,importance:'unknown',reasons:[],explanation:'缺少叙事用途证据，不推定重要性',evidence:[]})),notes:['数量0与持有false保持原来源。']};
  return new Response(JSON.stringify({message:{content:JSON.stringify(output)},prompt_eval_count:100,eval_count:120}),{status:200});
 }});
 const base=`/books/${book.id}/characters/${actor.id}/resource-focus`;
 const http=await resourceSupplementHttp(t,{ai:gateway,beforeRouter:app=>app.use('/api/new-design',(req,res,next)=>{if(req.method==='POST'&&req.path===base){const json=res.json.bind(res);res.json=envelope=>{if(lose&&envelope.success&&envelope.data?.status==='review'){lose=false;res.destroy();return res;}return json(envelope);};}next();})});
 const tables=['cards','card_versions','card_relations','card_relation_versions','entity_initial_states','entity_initial_state_versions','current_state_projections','state_changes','current_knowledge_state_projections','story_time_proposals','story_event_timings'];
 const originals=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pool.query(`SELECT to_jsonb(row) value FROM new_design.${table} row ORDER BY to_jsonb(row)::text`)).rows])));
 const before=await originals(),counts=async()=>(await pool.query("SELECT count(*)::int n FROM new_design.ai_generation_batches WHERE input_payload->>'contract'='character_resource_focus_v1'")).rows[0].n;
 let preview,request,record;
 await t.test('GET preview and invalid or stale whole input have zero model calls or batch writes',async()=>{
  preview=await http.get(`${base}/preview?${new URLSearchParams(selection)}`);assert.ok(schema.resourceFocusSchemaFor({snapshot:preview.snapshot,instruction:''}));assert.equal(await counts(),0);assert.equal(calls,0);
  assert.equal(preview.snapshot.evidenceSources.find(source=>source.cardId===actor.id&&source.fieldKey===f.quantity).text,'0');assert.equal(preview.snapshot.evidenceSources.find(source=>source.cardId===actor.id&&source.fieldKey===f.holding).text,'false');
  request={requestKey:key(),characterId:actor.id,selection,expectedSourceHash:preview.sourceHash,instruction:''};
  for(const input of [{...request,characterId:prop.id},{...request,requestKey:key(),expectedSourceHash:'b'.repeat(64)},{...request,unexpected:true}]){const response=await http.raw('POST',base,input),envelope=await response.json();assert.ok(response.status>=400);assert.equal(envelope.recovery.mutationOutcome,'not_written');}
  assert.equal(calls,0);assert.equal(await counts(),0);assert.deepEqual(await originals(),before);
 });
 await t.test('concurrent full original generates once; lost HTTP after actual result save restores only the original',async()=>{
  const responses=await Promise.allSettled([http.post(base,request),http.post(base,request)]);assert.ok(responses.some(response=>response.status==='rejected'));assert.equal(lose,false);assert.equal(calls,1);assert.equal(await counts(),1);
  record=await http.post(`${base}/original-receipt`,request);assert.equal(record.status,'review');assert.equal(schema.validResourceFocusRecord(record,book.id,actor.id),true);assert.deepEqual(record.request,request);assert.equal((await http.post(base,request)).id,record.id);assert.equal(calls,1);assert.deepEqual(await originals(),before);
  await assert.rejects(http.post(`${base}/original-receipt`,{...request,instruction:'替换原要求'}),error=>error.recovery.mutationOutcome==='unknown');
 });
 await t.test('by-id and all GETs remain readonly and isolate actor and book while preserving original proofs',async()=>{
  assert.deepEqual(await http.get(`${base}/by-id/${request.requestKey}`),record);
  assert.equal(await http.get(`/books/${book.id}/characters/${prop.id}/resource-focus/by-id/${request.requestKey}`),null);
  assert.equal(await http.get(`/books/${key()}/characters/${actor.id}/resource-focus/by-id/${request.requestKey}`),null);
  assert.equal((await http.get(`${base}/preview?${new URLSearchParams(selection)}`)).sourceHash,preview.sourceHash);
  assert.equal(calls,1);assert.equal(await counts(),1);assert.deepEqual(await originals(),before);
 });
 await t.test('actual unknown transport never repeats; active execution cannot end; explicit ending retains full origin',async()=>{
  failProvider=true;const input={...request,requestKey:key()};await assert.rejects(http.post(base,input),error=>error.recovery.mutationOutcome==='unknown');assert.equal(calls,2);
  const unknown=await http.post(`${base}/original-receipt`,input);assert.equal(unknown.status,'running');assert.equal(unknown.stage,'result_unknown');assert.equal((await http.post(base,input)).status,'running');assert.equal(calls,2);
  const lock=await pool.connect();try{await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`resource-focus-execution:${input.requestKey}`]);await assert.rejects(http.post(`${base}/end-unknown`,{confirm:true,input}),error=>error.status===409);}finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`resource-focus-execution:${input.requestKey}`]);lock.release();}
  const ended=await http.post(`${base}/end-unknown`,{confirm:true,input});assert.equal(ended.status,'discarded');assert.equal(ended.stage,'ended_unknown');assert.deepEqual(ended.snapshot,unknown.snapshot);assert.deepEqual(ended.request,unknown.request);assert.equal(ended.output,null);assert.equal(schema.validResourceFocusRecord(ended,book.id,actor.id),true);
  assert.equal((await http.post(`${base}/end-unknown`,{confirm:true,input})).id,ended.id);assert.equal((await http.post(`${base}/original-receipt`,input)).stage,'ended_unknown');assert.equal(calls,2);assert.deepEqual(await originals(),before);
 });
 await t.test('known saved result cannot be ended or overwritten, and stale source changes do not reinterpret originals',async()=>{
  await assert.rejects(http.post(`${base}/end-unknown`,{confirm:true,input:request}),error=>error.status===409);
  await f.cards.updateCard(prop.id,{title:'显示来源变更',values:prop.values,revision:prop.revision});
  const changed=await focus.previewResourceFocus(book.id,actor.id,selection);assert.notEqual(changed.sourceHash,preview.sourceHash);assert.equal(changed.snapshot.ledger.items[0].name,'显示来源变更');
  assert.deepEqual(await http.post(`${base}/original-receipt`,request),record);assert.equal(calls,2);
  const after=await originals();for(const table of tables.filter(table=>!['cards','card_versions'].includes(table)))assert.deepEqual(after[table],before[table]);
 });
});

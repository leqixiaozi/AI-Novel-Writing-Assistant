const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceHistoryScenario}=require('./support/resourceHistory/index.cjs'),{resourceSupplementHttp}=require('./support/resourceSupplementHttp.cjs'),{resourceBackfillClient}=require('./support/resourceBackfillClient.cjs');
const key=()=>randomUUID();
test('real PostgreSQL / managed HTTP historical focus preserves actual transferred and stale sources without current holding writes',async t=>{
 const f=await resourceHistoryScenario(t),{pool,book,actor,props,selection}=f,models=compiled('server/database/modelManagement'),focus=compiled('server/database/characterResources/focus'),validation=compiled('common/characterResources/focus');
 const route={primary:{provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'isolated-history-focus-provider-stub',credentialId:null},fallbacks:[],policy:{maxOutputTokens:24000,maxTotalTokens:1000000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}};
 for(const [scope,taskType]of [['system_default',null],['task','form_assist']]){const current=(await models.getModelRouteCenterCatalog()).routes.find(item=>item.scope===scope&&item.taskType===taskType);await models.saveManagedModelRoute({...route,scope,taskType,expectedConfigId:current?.id??null,expectedRevision:current?.revision??null,replaceUnsupported:true,idempotencyKey:key()});}
 let calls=0,lose=true,modelInput;
 const gateway=compiled('server/ai').createIndependentAiGateway({fetcher:async(_url,init)=>{
  calls++;modelInput=JSON.parse(JSON.parse(init.body).messages.at(-1).content).taskData.snapshot;
  const role=modelInput.evidenceSources.find(source=>source.fieldKey===f.roleField),history=modelInput.history.items.map(item=>{const source=modelInput.history.sources.find(source=>source.relationId===item.relationId);assert.ok(source);return{relationId:item.relationId,resourceId:item.resourceId,status:item.resourceId===props[0].id?'transferred':'stale',explanation:'引用已确认叙事状态和匹配的原正文，仅提供显示建议',evidence:[{changeId:source.changeId,bodyVersionId:source.bodyVersionId,start:source.start,end:source.end,excerpt:source.text}]};});
  const output={role:{value:'temporary',explanation:'作者明确记录临时登场安排',evidence:[{cardId:role.cardId,versionId:role.versionId,fieldKey:role.fieldKey,start:0,end:role.text.length,excerpt:role.text}]},resources:[],history,notes:['归档资源当前持有保持未知，历史不改正式状态。']};return new Response(JSON.stringify({message:{content:JSON.stringify(output)},prompt_eval_count:80,eval_count:100}),{status:200});
 }});
 const base=`/books/${book.id}/characters/${actor.id}/resource-focus`,http=await resourceSupplementHttp(t,{ai:gateway,beforeRouter:app=>app.use('/api/new-design',(req,res,next)=>{if(req.method==='POST'&&req.path===base){const json=res.json.bind(res);res.json=value=>{if(lose&&value.success&&value.data?.status==='review'){lose=false;res.destroy();return res;}return json(value);};}next();})});
 const tables=['cards','card_versions','card_relations','card_relation_versions','chapter_documents','chapter_body_versions','chapter_settlements','chapter_stable_checkpoints','state_changes','current_state_projections','story_time_proposals','story_event_timings'];
 const frame=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pool.query(`SELECT to_jsonb(row) value FROM new_design.${table} row ORDER BY to_jsonb(row)::text`)).rows]))),before=await frame();
 let preview,input,record;
 await t.test('readonly distinct full historical preflight exposes actual archived sources and latest confirmations, v1 remains unchanged',async()=>{
  const old=await http.get(`${base}/preview?${new URLSearchParams(selection)}`);assert.equal(old.snapshot.contract,'character_resource_focus_v1');assert.equal(Object.hasOwn(old.snapshot,'history'),false);
  preview=await http.get(`${base}/preview?${new URLSearchParams({...selection,includeHistory:'true'})}`);assert.equal(preview.snapshot.contract,'character_resource_focus_v2');assert.equal(preview.snapshot.ledger.items.length,0);assert.equal(preview.snapshot.history.items.length,2);assert.equal(preview.snapshot.history.items[0].currentHolding,null);assert.equal(calls,0);assert.deepEqual(await frame(),before);
  input={requestKey:key(),characterId:actor.id,selection,expectedSourceHash:preview.sourceHash,instruction:'',includeHistory:true};
  await assert.rejects(http.post(base,{...input,includeHistory:undefined}));assert.equal(calls,0);
 });
 await t.test('actual managed result save then lost HTTP recovers complete historical original without model repetition',async()=>{
  await assert.rejects(http.post(base,input));record=await http.post(`${base}/original-receipt`,input);assert.equal(record.status,'review');assert.equal(calls,1);assert.equal(validation.validResourceFocusRecord(record,book.id,actor.id),true);
  assert.deepEqual(record.snapshot,preview.snapshot);assert.equal(record.output.history.find(item=>item.resourceId===props[0].id).status,'transferred');assert.equal(record.output.history.find(item=>item.resourceId===props[1].id).status,'stale');
  assert.equal(modelInput.history.sources.length,4);assert.equal(Object.hasOwn(modelInput.history,'chapters'),false);assert.equal(Object.hasOwn(modelInput.history,'original'),false);assert.equal(modelInput.history.sources[0].bodyVersionId,f.second.version.id);
  assert.deepEqual(await http.post(base,input),record);await assert.rejects(http.post(`${base}/original-receipt`,{...input,includeHistory:undefined}));assert.equal(calls,1);assert.deepEqual(await frame(),before);
 });
 await t.test('explicit verified historical display uses proven transfer and excludes stale without losing full source or changing current state',async()=>{
  const view=resourceBackfillClient('focusView').resourceFocusView(record.snapshot.ledger,{record,applied:true,verifiedHash:input.expectedSourceHash});assert.equal(view.role,'temporary');assert.equal(view.entries.length,1);assert.equal(view.entries[0].item.resourceId,props[0].id);assert.equal(view.entries[0].item.currentHolding,null);assert.equal(view.allEntries.length,2);assert.equal(view.limit,5);
  const pending=resourceBackfillClient('focusView').resourceFocusView(record.snapshot.ledger,{record,applied:false,verifiedHash:null});assert.equal(pending.role,'unknown');assert.equal(pending.entries.length,2);assert.ok(pending.entries.every(entry=>entry.item.currentHolding===null));assert.deepEqual(await frame(),before);
 });
 await t.test('changed complete historical source blocks new generation before model and preserves the old original exactly',async()=>{
  const changed=await f.cards.updateCard(actor.id,{title:actor.title,values:{...actor.values,[f.roleField]:'作者改为长期角色，需重新核对历史显示。'},revision:actor.revision});assert.ok(changed);
  const after=await frame(),fresh=await http.get(`${base}/preview?${new URLSearchParams({...selection,includeHistory:'true'})}`);assert.notEqual(fresh.sourceHash,preview.sourceHash);await assert.rejects(http.post(base,{...input,requestKey:key()}));assert.equal(calls,1);assert.deepEqual(await focus.readResourceFocusOriginal(book.id,input),record);assert.deepEqual(await frame(),after);
 });
});

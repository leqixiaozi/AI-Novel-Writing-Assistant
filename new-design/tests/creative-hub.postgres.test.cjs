const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');

test('creative hub keeps bindings, archives instead of deleting, and replays the original turn idempotently',{skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1',timeout:180000},async t=>{
  const {pool}=await isolatedDatabase(t,[{id:'115_creative_hub',fileName:'115_creative_hub.sql'}]);
  const repository=compiled('server/database/creativeHub');
  await repository.withCreativeHubPool(pool,async()=>{
    assert.deepEqual(await repository.getCreativeHubCapability(),{installed:true,operational:true,reason:'创作中枢会话、只读诊断与原回执保护可用。'});
    const binding={bookId:randomUUID(),chapterDocumentId:randomUUID(),taskKind:'quality_audit',taskId:randomUUID()};
    const thread=await repository.createCreativeHubThread({title:'第十章诊断',binding});
    assert.equal(thread.revision,1);
    assert.deepEqual(thread.binding,binding);

    const requestKey=randomUUID(),question='这章为什么还不能发布？';
    const first=await repository.startCreativeHubTurn(thread.id,{requestKey,question,expectedThreadRevision:1},{book:{id:binding.bookId,name:'测试书'},tasks:[],blockers:['尚未质量检查'],sourceLinks:[]});
    const repeated=await repository.startCreativeHubTurn(thread.id,{requestKey,question,expectedThreadRevision:1},{book:{id:binding.bookId,name:'测试书'},tasks:[],blockers:['尚未质量检查'],sourceLinks:[]});
    assert.equal(first.turn.id,repeated.turn.id);
    assert.equal(first.repeated,false);
    assert.equal(repeated.repeated,true);
    await assert.rejects(repository.startCreativeHubTurn(thread.id,{requestKey,question:'换一个问题',expectedThreadRevision:1},{book:null,tasks:[],blockers:[],sourceLinks:[]}),error=>error.status===409);

    const newer=await repository.startCreativeHubTurn(thread.id,{requestKey:randomUUID(),question:'再核对当前任务。',expectedThreadRevision:1},{book:{id:binding.bookId,name:'测试书'},tasks:[],blockers:[],sourceLinks:[]});

    const result={summary:'尚未检查。',findings:[],actions:[{kind:'find_entry',label:'前往检查',href:`/new-design/books/${binding.bookId}/views/quality`} ]};
    const completed=await repository.completeCreativeHubTurn(first.turn.id,result,{assetId:'new_design.creative_hub.diagnosis',version:'v1'},{routeKey:'creative_hub'},42);
    assert.equal(completed.status,'succeeded');
    assert.deepEqual(completed.result,result);
    assert.equal((await repository.getCreativeHubTurn(newer.turn.id)).status,'running');

    const archived=await repository.archiveCreativeHubThread(thread.id,1);
    assert.equal(archived.status,'archived');
    assert.equal((await repository.listCreativeHubThreads({includeArchived:false})).length,0);
    assert.equal((await repository.listCreativeHubThreads({includeArchived:true})).length,1);
    assert.equal((await repository.listCreativeHubTurns(thread.id))[0].id,first.turn.id);

    const application=compiled('server/application/creativeHub'),plain=await repository.createCreativeHubThread({title:'全局入口',binding:{}});let calls=0;
    const ai={diagnoseCreativeHub:async input=>{calls++;assert.equal(input.state.book,null);return{output:{summary:'当前没有绑定作品。',findings:[],actions:[{kind:'find_entry',label:'返回项目导航',href:'/new-design'}]},promptSnapshot:{assetId:'new_design.creative_hub.diagnosis',version:'v1'},modelSnapshot:{routeKey:'creative_hub'},usedTokens:7};}};
    const request={requestKey:randomUUID(),question:'我下一步去哪里？',expectedThreadRevision:1};
    const generated=await application.runCreativeHubTurn(plain.id,request,ai),replayed=await application.runCreativeHubTurn(plain.id,request,ai);
    assert.equal(generated.turn.status,'succeeded');assert.equal(replayed.turn.id,generated.turn.id);assert.equal(replayed.repeated,true);assert.equal(calls,1);
  });
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
require('../node_modules/tsx/dist/cjs/index.cjs');

test('creative hub is a primary route with strict local deep links',()=>{
  const navigation=require('../src/client/navigation.ts'),location=require('../src/client/creativeHub/location.ts');
  const item=navigation.NEW_DESIGN_PRIMARY_NAV.find(value=>value.key==='creative-hub');
  assert.deepEqual(item,{key:'creative-hub',label:'创作中枢',href:'/new-design/creative-hub'});
  assert.equal(navigation.newDesignCurrentMenuHref('/new-design/creative-hub'),item.href);
  const threadId=randomUUID(),href=location.creativeHubHref(threadId);
  assert.equal(href,`/new-design/creative-hub?threadId=${threadId}`);
  assert.deepEqual(location.readCreativeHubLocation(`?threadId=${threadId}`),{threadId,binding:{},explicit:true,bindingExplicit:false,error:null});
  const bookId=randomUUID(),chapterDocumentId=randomUUID(),taskId=randomUUID(),bound=location.readCreativeHubLocation(`?bookId=${bookId}&chapterDocumentId=${chapterDocumentId}&taskKind=quality_issue&taskId=${taskId}`);
  assert.deepEqual(bound,{threadId:null,binding:{bookId,chapterDocumentId,taskKind:'quality_issue',taskId},explicit:false,bindingExplicit:true,error:null});
  assert.equal(location.creativeHubHref(null,bound.binding),`/new-design/creative-hub?bookId=${bookId}&chapterDocumentId=${chapterDocumentId}&taskKind=quality_issue&taskId=${taskId}`);
  assert.equal(location.readCreativeHubLocation('?threadId=bad').error,'会话地址无效，请从创作中枢列表重新选择。');
});

test('client api maps sessions and original diagnostic turns without legacy runtime controls',async()=>{
  const {createCreativeHubApi}=require('../src/client/creativeHub/api.ts'),calls=[],request=async(path,init)=>{calls.push([path,init]);return{ok:true};},api=createCreativeHubApi(request),threadId=randomUUID(),turnId=randomUUID(),requestKey=randomUUID();
  await api.list();await api.state(threadId);await api.history(threadId);await api.start(threadId,{requestKey,question:'为什么还不能继续？',expectedThreadRevision:2});await api.resume(threadId,turnId);await api.restore(threadId,3);
  assert.deepEqual(calls.map(call=>call[0]),['/creative-hub/threads',`/creative-hub/threads/${threadId}/state`,`/creative-hub/threads/${threadId}/history`,`/creative-hub/threads/${threadId}/turns`,`/creative-hub/threads/${threadId}/turns/${turnId}/resume`,`/creative-hub/threads/${threadId}/restore`]);
  assert.equal(calls.some(call=>/interrupts|runs\/stream|approve|cancel/.test(call[0])),false);
});

test('conversation renders evidence links but no business write action',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{CreativeHubConversation}=require('../src/client/creativeHub/CreativeHubConversation.tsx'),threadId=randomUUID();
  const turn={id:randomUUID(),threadId,requestKey:randomUUID(),requestHash:'a'.repeat(64),question:'为什么不能继续？',frozenState:{book:null,tasks:[],blockers:[],sourceLinks:[]},status:'succeeded',result:{summary:'缺少质量检查。',findings:[{kind:'quality',label:'尚未检查',detail:'未检查不代表通过。',severity:'warning'}],actions:[{kind:'find_entry',label:'前往质量检查',href:'/new-design/books/00000000-0000-4000-8000-000000000001/views/quality'}]},failure:null,promptSnapshot:null,modelSnapshot:null,usedTokens:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
  const html=renderToStaticMarkup(React.createElement(CreativeHubConversation,{turns:[turn],busy:false,question:'',onQuestionChange(){},onSubmit(){},onResume(){}}));
  assert.match(html,/前往质量检查/);assert.match(html,/未检查不代表通过/);for(const label of ['批准任务','取消任务','直接保存','生成正文'])assert.doesNotMatch(html,new RegExp(`>${label}<`));
});

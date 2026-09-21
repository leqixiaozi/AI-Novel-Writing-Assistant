const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {creativeHubDiagnosticSchema,creativeHubThreadCreateSchema,creativeHubTurnRequestSchema}=require('../dist/common/creativeHub');
const {preparePrompt,listPromptAssets}=require('../dist/server/ai/prompts');

function diagnostic(){
  return {
    summary:'当前章节尚未完成质量检查。',
    findings:[{kind:'missing_check',label:'质量检查待执行',detail:'未检查不代表通过。',severity:'warning',source:{kind:'chapter',id:randomUUID(),label:'第十章'}}],
    actions:[{kind:'find_entry',label:'前往该章质量检查',href:`/new-design/books/${randomUUID()}/views/quality`}],
  };
}

test('creative hub only accepts explicit read-only diagnostic actions',()=>{
  const value=diagnostic();
  assert.deepEqual(creativeHubDiagnosticSchema.parse(value),value);
  for(const kind of ['create_novel','save_content','start_workflow','approve_candidate','cancel_task']){
    assert.throws(()=>creativeHubDiagnosticSchema.parse({...value,actions:[{kind,label:'越权动作',href:'/new-design'}]}));
  }
});

test('thread bindings and original request identities are strict',()=>{
  const bookId=randomUUID(),requestKey=randomUUID();
  const thread={title:'检查第十章为什么没有通过',binding:{bookId,chapterDocumentId:randomUUID(),taskKind:'quality_audit',taskId:randomUUID()}};
  assert.deepEqual(creativeHubThreadCreateSchema.parse(thread),thread);
  const request={requestKey,question:'这章现在缺什么？',expectedThreadRevision:1};
  assert.deepEqual(creativeHubTurnRequestSchema.parse(request),request);
  for(const patch of [{requestKey:'same-name'},{question:''},{expectedThreadRevision:0},{provider:'fake'}])assert.throws(()=>creativeHubTurnRequestSchema.parse({...request,...patch}));
});

test('dedicated prompt is registered and rejects write-like output',()=>{
  const input={question:'为什么这章还不能发布？',binding:{bookId:randomUUID()},state:{book:{id:randomUUID(),name:'测试书'},tasks:[],blockers:[],sourceLinks:[]}};
  assert.ok(listPromptAssets().some(asset=>asset.assetId==='new_design.creative_hub.diagnosis'&&asset.taskType==='creative_hub'));
  const prompt=preparePrompt('creative_hub',input),value=diagnostic();
  assert.deepEqual(prompt.parseOutput(value),value);
  assert.throws(()=>prompt.parseOutput({...value,actions:[{kind:'save_content',label:'直接保存',href:'/new-design'}]}));
});

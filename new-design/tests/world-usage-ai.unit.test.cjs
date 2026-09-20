const {test}=require('node:test');
const assert=require('node:assert/strict');
const {preparePrompt,listPromptAssets}=require('../dist/server/ai/prompts');
const {createIndependentAiGateway}=require('../dist/server/ai');
const {DEFAULT_MODEL_POLICY}=require('../dist/common/modelRouting');

const id=n=>`52000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sources={bookId:id(1),rootCardId:id(2),rootVersionId:id(3),rootTitle:'本书世界',rootValues:{name:'本书世界'},formVersionId:null,instanceId:null,instanceRevision:null,associationSources:[],cards:[{cardId:id(4),versionId:id(5),typeKey:'location',title:'南城',values:{name:'南城'},slotKey:'locations',mountId:null,mountRevision:null}],sourceHash:'a'.repeat(64)};
const selection={primaryLocationId:id(4),factionIds:[],locationIds:[id(4)],ruleIds:[],boundary:'以南城为主舞台'};

test('world usage AI is a registered new-design asset and only accepts frozen source IDs',()=>{
 const asset=listPromptAssets().find(item=>item.taskType==='world_usage');
 assert.equal(asset.assetId,'new_design.world.usage_scope');
 const prompt=preparePrompt('world_usage',{sources,instruction:'建议主舞台'});
 assert.equal(prompt.messages[0].content.includes('建议主舞台'),false);
 assert.equal(JSON.parse(prompt.messages[1].content).taskData.sources.sourceHash,sources.sourceHash);
 assert.deepEqual(prompt.parseOutput(selection),selection);
 assert.throws(()=>prompt.parseOutput({...selection,locationIds:[id(9)]}));
 assert.throws(()=>prompt.parseOutput({...selection,primaryLocationId:id(9)}));
 assert.throws(()=>prompt.parseOutput({...selection,secret:'越权'}));
 assert.throws(()=>preparePrompt('world_usage',{sources:{...sources,cards:[]},instruction:''}));
});

test('world usage gateway uses the existing managed planning route and records one model receipt',async()=>{
 let calls=0;const route={primary:{provider:'ollama',endpoint:'http://127.0.0.1:9999',model:'fixture',credentialId:null},fallbacks:[],policy:{...DEFAULT_MODEL_POLICY,maxTotalTokens:200000},sourceLayers:[]};
 const gateway=createIndependentAiGateway({routeResolver:async task=>{assert.equal(task,'planning_candidate');return route;},snapshotWriter:async task=>({id:id(8),snapshotHash:'fixture-snapshot',taskType:task,route}),fetcher:async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(JSON.parse(body.messages[1].content).taskData.sources.sourceHash,sources.sourceHash);return new Response(JSON.stringify({message:{content:JSON.stringify(selection)},prompt_eval_count:7,eval_count:9}),{status:200});}});
 const result=await gateway.suggestWorldUsage({sources,instruction:'建议主舞台'});
 assert.deepEqual(result.output,selection);
 assert.equal(result.promptSnapshot.assetId,'new_design.world.usage_scope');
 assert.equal(result.modelSnapshot.routeSnapshotId,id(8));
 assert.equal(result.usedTokens,16);
 assert.equal(calls,1);
});

test('world usage gateway does not resend after an unknown provider response',async()=>{
 let calls=0;const route={primary:{provider:'ollama',endpoint:'http://127.0.0.1:9999',model:'fixture',credentialId:null},fallbacks:[],policy:{...DEFAULT_MODEL_POLICY,maxTotalTokens:200000,maxRetries:2,retryDelayMs:0},sourceLayers:[]};
 const gateway=createIndependentAiGateway({routeResolver:async()=>route,snapshotWriter:async task=>({id:id(8),snapshotHash:'fixture-snapshot',taskType:task,route}),fetcher:async()=>{calls++;throw Error('response lost');}});
 await assert.rejects(gateway.suggestWorldUsage({sources,instruction:''}),error=>{assert.equal(error.executionSnapshot.attempts.length,1);assert.equal(error.executionSnapshot.attempts[0].requestSent,true);assert.equal(error.executionSnapshot.attempts[0].responseReceived,false);return true;});
 assert.equal(calls,1);
});

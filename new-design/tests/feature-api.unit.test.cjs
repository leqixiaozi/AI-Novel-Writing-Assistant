const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/client/featureApi/index.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exported={};
new Function('require','exports',compiled)(()=>{throw new Error('Interface-only transport must not load runtime business modules.');},exported);
function fixture(){const calls=[];const api=exported.createFeatureApi(async(route,init)=>{calls.push({route,init});return null;});return{api,calls};}
test('professional view uses the exact original book scoped read endpoint',async()=>{
 const {api,calls}=fixture();await api.getProfessionalViewsWorkspace('book');
 assert.equal(calls[0].route,'/books/book/professional-views/workspace');assert.equal(calls[0].init,undefined);
});
test('dialogue workspace and original receipt checks preserve book/session/key scope',async()=>{
 const {api,calls}=fixture();await api.characterDialogue.getCharacterDialogueWorkspace('book',{checkpointId:'chapter',participantCardIds:['one','two']});
 const url=new URL(calls[0].route,'http://test');assert.equal(url.searchParams.get('participantCardIds'),'one,two');assert.equal(url.searchParams.get('checkpointId'),'chapter');
 await api.characterDialogue.getCharacterDialogueRoundByKey('book','session','original-key');
 assert.equal(calls[1].route,'/books/book/character-dialogue/sessions/session/rounds/by-key/original-key');assert.equal(calls[1].init,undefined);
});
test('manual world revision is an explicit original repair command, not a second material save',async()=>{
 const {api,calls}=fixture();const input={requestKey:'key',authorWriteRequestKey:'saved-key',allowManualRevision:true};
 await api.recordWorldRepairSaved('book','candidate',input);
 assert.equal(calls.length,1);assert.equal(calls[0].route,'/books/book/world-consistency/repairs/candidate/saved');assert.deepEqual(JSON.parse(calls[0].init.body),input);
});
test('native image commands do not call text model settings or implicit retries',async()=>{
 const {api,calls}=fixture();await api.imageGeneration.completeSaved('request');await api.imageGeneration.connectionCatalog();
 assert.deepEqual(calls.map(call=>call.route),['/image-generation/requests/request/complete-saved','/models/image-generation/catalog']);
});
test('director console filters omit absent values and records stay read only',async()=>{
 const {api,calls}=fixture();await api.directorFollowup.workspace({bookId:undefined});await api.directorFollowup.detail('ai_task','record');
 assert.equal(calls[0].route.includes('undefined'),false);assert.equal(calls[1].route,'/director-followup/records/ai_task/record');assert.equal(calls[1].init,undefined);
});
test('planning projection uses the original supported selection query, not rejected hash navigation',()=>{
 const query=fs.readFileSync(path.join(__dirname,'../src/server/database/authorTasks/sourceQuery.ts'),'utf8');
 assert.match(query,/'\/planning'\|\|COALESCE\('\?plan='/);assert.match(query,/'\/planning\?plan='\|\|o\.id::text/);assert.doesNotMatch(query,/#plan-/);
});

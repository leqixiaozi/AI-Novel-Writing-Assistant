const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {compiled}=require('./support/isolatedDatabase.cjs');
const source=fs.readFileSync(path.join(__dirname,'../src/client/storyWorkspace/referenceLayout/experienceSeries/controller.ts'),'utf8'),moduleValue={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(name.endsWith('characterExperiences/schema'))return compiled('common/characterExperiences/schema');throw new Error(name);},moduleValue,moduleValue.exports);
const {ExperienceSeriesController,validSeries}=moduleValue.exports,key=()=>randomUUID();
function receipt(input,bookId,status='review'){
 return{id:input.requestKey,bookId,request:structuredClone(input),status,stage:status,error:'',createdAt:new Date().toISOString(),snapshot:{bookId,bookName:'隔离测试',instruction:input.instruction,events:[],actors:input.sources.map(source=>({id:source.characterId,title:'人物',versionId:key(),revision:1,fieldKey:source.fieldKey,fieldLabel:'小传',text:'已有原文',form:{target:{cardTypeId:key()},sourceHash:'a'.repeat(64)},slotIds:[key(),key(),key()]}))},output:status==='review'?{candidates:[],notes:[]}:null};
}
function fixture(count=41){
 const bookId=key(),ids=Array.from({length:count},key),storageKey=`series:${bookId}:${ids[0]}`,values=new Map(),sent=[],reads=[],results=[];
 const ports={key:storageKey,bookId,characterId:ids[0],uuid:key,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},prepare:async input=>({bookId,sources:input.characterIds.map(characterId=>({characterId,fieldKey:input.fieldKey,sourceHash:'a'.repeat(64)}))}),write:async input=>{const saved=JSON.parse(values.get(storageKey));assert.equal(saved.stage,'pending');assert.deepEqual(saved.parts[saved.next],input);sent.push(structuredClone(input));return receipt(input,bookId);},read:async input=>{reads.push(structuredClone(input));return null;},endUnknown:async input=>receipt(input,bookId,'discarded'),notWritten:e=>e.outcome==='not_written',changed:()=>{},result:r=>results.push(r)};
 return{bookId,ids,storageKey,values,sent,reads,results,ports,input:{characterIds:ids,fieldKey:'bio'},controller:()=>new ExperienceSeriesController(ports)};
}
test('41 actors run 20/20/1 with complete frozen requests, durable results and no repeated actors',async()=>{
 const f=fixture(),c=f.controller();c.restore();await c.start(f.input,'  已有小传  ');
 assert.equal(c.plan.stage,'complete');assert.equal(c.plan.next,3);assert.deepEqual(f.sent.map(input=>input.sources.length),[20,20,1]);assert.deepEqual(f.sent.flatMap(input=>input.sources.map(source=>source.characterId)),f.ids);assert.equal(new Set(f.sent.map(input=>input.requestKey)).size,3);assert.equal(c.plan.records.length,3);assert.equal(validSeries(JSON.parse(f.values.get(f.storageKey)),f.bookId,f.ids[0]),true);
 const restored=f.controller();restored.restore();assert.equal(restored.plan.stage,'complete');await restored.resume();assert.equal(f.sent.length,3);
 await c.start(f.input,'明确新一轮');assert.equal(f.values.has(`${f.storageKey}:history:${restored.plan.id}`),true);assert.equal(f.sent.length,6);
});
test('lost response restores read only and never sends the original model request again',async()=>{
 const f=fixture();let saved;f.ports.write=async input=>{f.sent.push(structuredClone(input));saved=receipt(input,f.bookId);throw new Error('lost acknowledgement');};
 const c=f.controller();c.restore();await c.start(f.input,'核对');assert.equal(c.plan.stage,'pending');assert.equal(f.sent.length,1);await c.start(f.input,'再次');assert.equal(f.sent.length,1);c.cancel();
 const restored=f.controller();restored.restore();assert.equal(f.sent.length,1);await restored.resume();assert.equal(f.reads.length,1);assert.equal(f.sent.length,1);assert.equal(restored.plan.stage,'pending');
 f.ports.read=async input=>{assert.deepEqual(input,saved.request);return{...saved,status:'running',output:null};};await restored.resume();assert.equal(f.sent.length,1);
 f.ports.read=async()=>saved;f.ports.write=async input=>{f.sent.push(input);return receipt(input,f.bookId);};await restored.resume();assert.equal(restored.plan.stage,'complete');assert.equal(f.sent.length,3);assert.equal(new Set(f.sent.map(input=>input.requestKey)).size,3);
});
test('known failed result halts all remaining actors and cannot silently continue',async()=>{
 const f=fixture();f.ports.write=async input=>{f.sent.push(input);return receipt(input,f.bookId,'failed');};const c=f.controller();c.restore();await c.start(f.input,'核对');assert.equal(c.plan.stage,'stopped');assert.equal(c.plan.records.length,1);await c.resume();assert.equal(f.sent.length,1);assert.equal(validSeries(c.plan,f.bookId,f.ids[0]),true);
});
test('original result storage failure keeps pending credentials and blocks further sends',async()=>{
 const f=fixture();f.ports.storage.setItem=(k,v)=>{if(JSON.parse(v).records.length)throw new Error('quota');f.values.set(k,v);};const c=f.controller();c.restore();await c.start(f.input,'核对');assert.equal(c.blocked,true);assert.equal(JSON.parse(f.values.get(f.storageKey)).stage,'pending');assert.equal(f.sent.length,1);await c.resume();assert.equal(f.sent.length,1);
});
test('corrupt or other-book credentials block writes; late old scope results cannot continue',async()=>{
 const f=fixture();f.values.set(f.storageKey,'corrupt');let c=f.controller();c.restore();assert.equal(c.blocked,true);await c.start(f.input,'核对');assert.equal(f.sent.length,0);
 f.values.clear();let resolve;f.ports.write=input=>{f.sent.push(input);return new Promise(r=>resolve=()=>r(receipt(input,f.bookId)));};c=f.controller();c.restore();const promise=c.start(f.input,'核对');await new Promise(r=>setImmediate(r));c.cancel();resolve();await promise;assert.equal(f.sent.length,1);assert.equal(f.results.length,0);assert.equal(JSON.parse(f.values.get(f.storageKey)).stage,'pending');
 const plan=JSON.parse(f.values.get(f.storageKey));assert.equal(validSeries(plan,key(),f.ids[0]),false);plan.parts[1].sources[0].characterId=plan.parts[0].sources[0].characterId;assert.equal(validSeries(plan,f.bookId,f.ids[0]),false);
});
test('preflight refusal or credential storage failure sends no model request',async()=>{
 const f=fixture();f.ports.prepare=async()=>{throw new Error('last actor missing biography');};let c=f.controller();c.restore();await c.start(f.input,'核对');assert.equal(f.sent.length,0);assert.equal(f.values.size,0);
 f.ports.prepare=async input=>({bookId:f.bookId,sources:input.characterIds.map(characterId=>({characterId,fieldKey:input.fieldKey,sourceHash:'a'.repeat(64)}))});f.ports.storage.setItem=()=>{throw new Error('quota');};c=f.controller();c.restore();await c.start(f.input,'核对');assert.equal(f.sent.length,0);assert.equal(c.blocked,true);
});
test('explicit unknown end preserves discarded result and never starts remaining actors',async()=>{
 const f=fixture();f.ports.write=async input=>{f.sent.push(input);throw new Error('unknown');};const c=f.controller();c.restore();await c.start(f.input,'核对');await c.endUnknown();assert.equal(c.plan.stage,'stopped');assert.equal(c.plan.records[0].status,'discarded');await c.resume();assert.equal(f.sent.length,1);
});
test('confirmed not_written ends range; restored ready requires explicit continuation',async()=>{
 const f=fixture();f.ports.write=async input=>{f.sent.push(input);throw Object.assign(new Error('source changed'),{outcome:'not_written'});};let c=f.controller();c.restore();await c.start(f.input,'核对');assert.equal(c.plan.stage,'stopped');assert.equal(c.plan.next,0);assert.equal(validSeries(c.plan,f.bookId,f.ids[0]),true);await c.resume();assert.equal(f.sent.length,1);
 const plan={...c.plan,stage:'ready'};f.values.set(f.storageKey,JSON.stringify(plan));c=f.controller();c.restore();assert.equal(f.sent.length,1);c.stop();assert.equal(c.plan.stage,'stopped');assert.equal(f.sent.length,1);
});

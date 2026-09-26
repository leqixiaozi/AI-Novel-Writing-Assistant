const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {resourceBackfillClient:client}=require('./support/resourceBackfillClient.cjs');
const {ResourceBackfillSeriesController,validResourceBackfillSeries}=client('controller'),key=()=>randomUUID(),hash='a'.repeat(64);
function fixture(){
 const bookId=key(),actor=key(),scope={characterId:actor,characterVersionId:key(),characterRevision:1,relationTypeId:key(),holdingDimensionKey:'holding',specificationHash:hash,resourceIds:[key()],relationIds:[key()]},chapters=Array.from({length:5},(_,i)=>({documentId:key(),chapterCardId:key(),bodyVersionId:key(),bodyContentHash:hash,title:`第${i+1}章`,logicalOrder:i+1})),input={resourceScope:scope,documentIds:chapters.map(c=>c.documentId)},values=new Map(),starts=[],calls=[],reads=[],storageKey=`range:${bookId}:${actor}`;
 const ai=(sessionId,requestKey=key())=>({sessionId,input:{requestKey,expectedSessionRevision:1,catalogHash:hash,resourceScope:structuredClone(scope)}});
 const parts=chapters.map((chapter,i)=>{const aiRequestKey=key();return{chapter,aiRequestKey,kind:i<3?'stable':'editable',startInput:i<3?{checkpointId:key(),resourceScope:structuredClone(scope),requestKey:key(),expectedSourceHash:hash}:null,startReceipt:null,ai:i<3?null:ai(key(),aiRequestKey),receipt:null};});
 function startReceipt(command){const part=parts.find(p=>p.startInput?.requestKey===command.requestKey),sessionId=key();return{contract:'stable_resource_supplement_start_v1',bookId,chapterDocumentId:part.chapter.documentId,sessionId,preparationId:key(),baseCheckpointId:command.checkpointId,bodyVersionId:part.chapter.bodyVersionId,requestKey:command.requestKey,input:structuredClone(command),inputHash:hash,sourceHash:hash,sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${part.chapter.documentId}&session=${sessionId}`,repeated:false};}
 function receipt(command,status='succeeded'){const saved=JSON.parse(values.get(storageKey)),part=saved.parts.find(p=>p.ai?.sessionId===command.sessionId);return{id:key(),sessionId:command.sessionId,requestKey:command.input.requestKey,taskId:key(),status,modelResultSaved:status==='succeeded',proposalCount:status==='succeeded'?1:0,proposalsSaved:status==='succeeded',notes:[],failure:null,sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${part.chapter.documentId}&session=${command.sessionId}`,canImportSavedResult:false,repeated:false,ledgerPending:false,canReleaseSavedResult:false,canEndExpiredUnknownRun:false};}
 const ports={bookId,characterId:actor,key:storageKey,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},uuid:key,changed:()=>{},lock:run=>run(),prepare:async()=>structuredClone(parts),prepareAi:async p=>p.ai??ai(p.startReceipt.sessionId,p.aiRequestKey),start:async command=>{const saved=JSON.parse(values.get(storageKey));assert.equal(saved.stage,'pending_start');assert.deepEqual(saved.parts[saved.next].startInput,command);starts.push(structuredClone(command));return startReceipt(command);},readStart:async command=>{reads.push(['start',command]);return null;},ai:async command=>{const saved=JSON.parse(values.get(storageKey));assert.equal(saved.stage,'pending_ai');assert.deepEqual(saved.parts[saved.next].ai,command);calls.push(structuredClone(command));return receipt(command);},readAi:async command=>{reads.push(['ai',command]);return null;},notWritten:error=>error.outcome==='not_written'};
 return{bookId,actor,scope,chapters,input,parts,values,starts,calls,reads,storageKey,ports,startReceipt,receipt,controller:()=>new ResourceBackfillSeriesController(ports)};
}
test('five frozen chapters create only three independent lists and prepare five candidates in order',async()=>{
 const f=fixture(),c=f.controller();c.restore();await c.start(f.input);assert.equal(c.plan.stage,'complete');assert.equal(c.plan.next,5);assert.equal(f.starts.length,3);assert.equal(f.calls.length,5);assert.equal(new Set(f.calls.map(x=>x.input.requestKey)).size,5);assert.deepEqual(c.plan.parts.map(p=>p.chapter.documentId),f.input.documentIds);assert.equal(validResourceBackfillSeries(c.plan,f.bookId,f.actor),true);
 const restored=f.controller();restored.restore();await restored.verify();await restored.resume();assert.equal(f.calls.length,5);assert.equal(f.starts.length,3);
});
test('lost independent creation acknowledgement restores only the full original; verification sends no model',async()=>{
 const f=fixture();let original;f.ports.start=async input=>{f.starts.push(input);original=f.startReceipt(input);throw new Error('lost COMMIT response');};let c=f.controller();c.restore();await c.start(f.input);assert.equal(c.plan.stage,'pending_start');assert.equal(f.calls.length,0);await c.start(f.input);assert.equal(f.starts.length,1);c.cancel();
 c=f.controller();c.restore();assert.equal(f.calls.length,0);await c.verify();assert.equal(c.plan.stage,'pending_start');assert.equal(f.starts.length,1);
 f.ports.readStart=async input=>{assert.deepEqual(input,original.input);return original;};await c.verify();assert.equal(c.plan.stage,'ready');assert.equal(f.calls.length,0);assert.equal(f.starts.length,1);
 f.ports.start=async input=>{f.starts.push(input);return f.startReceipt(input);};await c.resume();assert.equal(c.plan.stage,'complete');assert.equal(f.starts.length,3);assert.equal(f.calls.length,5);
});
test('lost second model response stops the remaining range; original read never sends later chapters',async()=>{
 const f=fixture();let original;f.ports.ai=async command=>{f.calls.push(command);const result=f.receipt(command);if(f.calls.length===2){original=result;throw new Error('lost model response');}return result;};let c=f.controller();c.restore();await c.start(f.input);assert.equal(c.plan.next,1);assert.equal(c.plan.stage,'pending_ai');assert.equal(f.calls.length,2);c.cancel();
 c=f.controller();c.restore();await c.resume();assert.equal(f.calls.length,2);f.ports.readAi=async command=>{assert.equal(command.input.requestKey,original.requestKey);return original;};await c.verify();assert.equal(c.plan.next,2);assert.equal(c.plan.stage,'ready');assert.equal(f.calls.length,2);await c.resume();assert.equal(c.plan.stage,'complete');assert.equal(f.calls.length,5);
});
test('full original creation input mismatch cannot clear pending credentials',async()=>{
 const f=fixture();let original;f.ports.start=async input=>{original=f.startReceipt(input);throw new Error('unknown');};const c=f.controller();c.restore();await c.start(f.input);f.ports.readStart=async()=>({...original,input:{...original.input,expectedSourceHash:'b'.repeat(64)}});await c.verify();assert.equal(c.plan.stage,'pending_start');assert.equal(f.calls.length,0);assert.match(c.message,/完整原输入/);
});
test('running, pending import and pending usage all retain the original model command',async()=>{
 for(const mode of ['running','import','usage']){const f=fixture();let original;f.ports.ai=async command=>{f.calls.push(command);original={...f.receipt(command),...(mode==='running'?{status:'running',proposalsSaved:false}:mode==='import'?{canImportSavedResult:true}:{ledgerPending:true})};return original;};const c=f.controller();c.restore();await c.start(f.input);assert.equal(c.plan.stage,'pending_ai');assert.equal(f.calls.length,1);f.ports.readAi=async()=>original;await c.verify();assert.equal(f.calls.length,1);assert.equal(c.plan.next,0);}
});
test('a known failed candidate preserves its result and stops later chapters',async()=>{
 const f=fixture();f.ports.ai=async command=>{f.calls.push(command);return f.receipt(command,'failed');};const c=f.controller();c.restore();await c.start(f.input);assert.equal(c.plan.stage,'stopped');assert.equal(c.plan.next,1);assert.equal(c.plan.parts[0].receipt.status,'failed');assert.equal(validResourceBackfillSeries(c.plan,f.bookId,f.actor),true);await c.resume();assert.equal(f.calls.length,1);
});
test('complete preflight or first credential storage refusal performs zero writes',async()=>{
 const f=fixture();f.ports.prepare=async()=>{throw new Error('last chapter invalid');};let c=f.controller();c.restore();await c.start(f.input);assert.equal(f.starts.length,0);assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
 f.ports.prepare=async()=>structuredClone(f.parts);f.ports.storage.setItem=()=>{throw new Error('quota');};c=f.controller();c.restore();await c.start(f.input);assert.equal(c.blocked,true);assert.equal(f.starts.length,0);assert.equal(f.calls.length,0);
});
test('creation result storage failure retains the durable pending original and stops before a model',async()=>{
 const f=fixture();f.ports.storage.setItem=(k,v)=>{if(JSON.parse(v).parts.some(p=>p.startReceipt))throw new Error('quota');f.values.set(k,v);};const c=f.controller();c.restore();await c.start(f.input);assert.equal(c.blocked,true);assert.equal(f.starts.length,1);assert.equal(f.calls.length,0);assert.equal(JSON.parse(f.values.get(f.storageKey)).stage,'pending_start');
});
test('late source change stops before its next model while prior candidates remain',async()=>{
 const f=fixture();const prepare=f.ports.prepareAi;f.ports.prepareAi=async(part,input)=>{if(part.chapter.logicalOrder===2)throw new Error('adopted body changed');return prepare(part,input);};const c=f.controller();c.restore();await c.start(f.input);assert.equal(c.plan.stage,'stopped');assert.equal(f.calls.length,1);assert.equal(c.plan.parts[0].receipt.proposalsSaved,true);assert.equal(c.plan.parts[1].startReceipt!==null,true);
});
test('corrupt, cross-book, changed-scope and duplicate ranges block any sends',async()=>{
 const f=fixture(),c=f.controller();c.restore();await c.start(f.input);const original=structuredClone(c.plan);assert.equal(validResourceBackfillSeries(original,key(),f.actor),false);
 for(const corrupt of ['bad',JSON.stringify({...original,input:{...original.input,resourceScope:{...f.scope,characterRevision:2}}}),JSON.stringify({...original,parts:[original.parts[0],...original.parts.slice(0,4)]})]){f.values.set(f.storageKey,corrupt);const restored=f.controller();restored.restore();assert.equal(restored.blocked,true);await restored.start(f.input);assert.equal(f.calls.length,5);}
});
test('leaving during an in-flight original preserves pending credentials and ignores the old reply',async()=>{
 const f=fixture();let release;f.ports.ai=command=>{f.calls.push(command);return new Promise(resolve=>release=()=>resolve(f.receipt(command)));};const c=f.controller();c.restore();const task=c.start(f.input);await new Promise(resolve=>setImmediate(resolve));c.cancel();release();await task;assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.values.get(f.storageKey)).stage,'pending_ai');assert.equal(c.plan.next,0);
});
test('restored ready requires explicit continuation; ending retains saved lists without new calls',async()=>{
 const f=fixture();f.ports.ai=async command=>{f.calls.push(command);throw new Error('unknown');};let c=f.controller();c.restore();await c.start(f.input);f.ports.readAi=async command=>f.receipt(command);await c.verify();assert.equal(c.plan.stage,'ready');c.cancel();c=f.controller();c.restore();assert.equal(f.calls.length,1);await c.stop();assert.equal(c.plan.stage,'stopped');assert.equal(c.plan.parts[0].receipt.proposalsSaved,true);await c.resume();assert.equal(f.calls.length,1);
});
test('an old page cannot overwrite the completed range from another page or generate a new later request',async()=>{
 const f=fixture();let first;f.ports.ai=async command=>{f.calls.push(command);first=f.receipt(command);throw new Error('unknown');};const old=f.controller();old.restore();await old.start(f.input);const fresh=f.controller();fresh.restore();f.ports.readAi=async()=>first;await fresh.verify();f.ports.ai=async command=>{f.calls.push(command);return f.receipt(command);};await fresh.resume();const durable=f.values.get(f.storageKey);assert.equal(f.calls.length,5);
 await old.verify();assert.equal(old.plan.stage,'complete');assert.equal(f.values.get(f.storageKey),durable);await old.resume();assert.equal(f.calls.length,5);assert.equal(f.values.get(f.storageKey),durable);
});
test('two restored ready pages use one range lock and only the preallocated later model requests',async()=>{
 const f=fixture();let first;f.ports.ai=async command=>{f.calls.push(command);first=f.receipt(command);throw new Error('unknown');};let c=f.controller();c.restore();await c.start(f.input);f.ports.readAi=async()=>first;await c.verify();
 let tail=Promise.resolve();f.ports.lock=run=>{const task=tail.then(run);tail=task.catch(()=>{});return task;};f.ports.ai=async command=>{f.calls.push(command);await new Promise(resolve=>setImmediate(resolve));return f.receipt(command);};
 const a=f.controller(),b=f.controller();a.restore();b.restore();await Promise.all([a.resume(),b.resume()]);assert.equal(f.calls.length,5);assert.equal(f.starts.length,3);assert.equal(a.plan.stage,'complete');assert.equal(b.plan.stage,'complete');assert.deepEqual(f.calls.map(command=>command.input.requestKey),a.plan.parts.map(part=>part.aiRequestKey));
});
test('unavailable browser range lock sends no creation or model and retains credentials',async()=>{
 const f=fixture();f.ports.lock=async()=>{throw new Error('lock unavailable');};const c=f.controller();c.restore();await c.start(f.input);assert.equal(c.blocked,true);assert.equal(f.starts.length,0);assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
});

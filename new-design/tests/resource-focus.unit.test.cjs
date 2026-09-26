const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const build=process.env.ND_REFERENCE_TEST_BUILD;
if(!build)throw new Error('ND_REFERENCE_TEST_BUILD is required');
const {resourceFocusSchemaFor,resourceFocusEvidenceText}=require(path.join(build,'common/characterResources/focus'));
const {preparePrompt}=require(path.join(build,'server/ai/prompts'));
const {resourceFocusView}=require('./support/resourceBackfillClient.cjs').resourceBackfillClient('focusView');
const {ResourceFocusRecovery}=require('./support/resourceBackfillClient.cjs').resourceBackfillClient('focusRecovery');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const field={key:'plan',name:'已保存策划',type:'long_text',hidden:false};
 const actor={id:id(1),versionId:id(2),revision:1,fields:[{field,versionId:id(3),origin:'type'}],values:{plan:'🍃这是作者填写的主角规划'},unavailableReason:null};
 const resource={id:id(4),versionId:id(5),revision:1,fields:[{field,versionId:id(6),origin:'type'}],values:{plan:'道具将在后续冲突中再次使用'},unavailableReason:null};
 const selection={relationTypeId:id(7),holdingDimensionKey:'quantity',specificationHash:'a'.repeat(64)},item={relationId:id(8),resourceId:resource.id,resourceVersionId:resource.versionId,available:true};
 const snapshot={contract:'character_resource_focus_v1',bookId:id(9),characterId:actor.id,selection,ledger:{bookId:id(9),characterId:actor.id,selection,truncated:false,items:[item]},objects:[actor,resource],evidenceSources:[actor,resource].map(object=>({cardId:object.id,versionId:object.versionId,fieldKey:'plan',text:object.values.plan}))};
 const proof=object=>({cardId:object.id,versionId:object.versionId,fieldKey:'plan',start:0,end:object.values.plan.length,excerpt:object.values.plan});
 const output={role:{value:'protagonist',explanation:'有原档案规划出处',evidence:[proof(actor)]},resources:[{relationId:item.relationId,resourceId:resource.id,importance:'key',reasons:['cross_chapter','conflict'],explanation:'引用作者后续使用计划',evidence:[proof(resource)]}],notes:[]};
 return{input:{snapshot,instruction:''},output,actor,resource,item};
}
test('registered focus uses a dedicated asset and exact UTF-16 saved field proofs',()=>{
 const f=fixture(),prompt=preparePrompt('character_resource_focus',f.input);assert.equal(prompt.assetId,'new_design.character.resource_focus');assert.deepEqual(prompt.parseOutput(f.output),f.output);assert.equal(f.output.role.evidence[0].excerpt.slice(0,2),'🍃');
});
test('managed prompt context omits full ledger properties, states and knowledge while original source remains intact',()=>{
 const f=fixture();f.item.properties=[{key:'internal',display:'not model context'}];f.item.states=[{display:'original confirmed state'}];f.item.readerKnowledge=[{display:'original knowledge'}];
 const prompt=preparePrompt('character_resource_focus',f.input),modelInput=JSON.parse(prompt.messages.at(-1).content).taskData;
 assert.equal(modelInput.snapshot.ledger.items[0].properties,undefined);assert.equal(modelInput.snapshot.ledger.items[0].states,undefined);assert.equal(modelInput.snapshot.ledger.items[0].readerKnowledge,undefined);assert.equal(f.item.states.length,1);assert.equal(f.item.properties.length,1);assert.deepEqual(prompt.parseOutput(f.output),f.output);
});
test('foreign versions, resource proofs for another object, altered offsets and invented fields are rejected',()=>{
 for(const mutate of [out=>out.role.evidence[0].versionId=id(99),out=>out.role.evidence[0].start=1,out=>out.role.evidence[0].fieldKey='invented',out=>out.resources[0].evidence[0].cardId=id(99)]){const f=fixture();mutate(f.output);assert.equal(resourceFocusSchemaFor(f.input).safeParse(f.output).success,false);}
});
test('whole resource coverage, unique real relations and explicit reasons are required',()=>{
 for(const mutate of [out=>out.resources=[],out=>out.resources.push(out.resources[0]),out=>out.resources[0].relationId=id(99),out=>out.resources[0].reasons=[],out=>out.resources[0].reasons=['conflict','conflict']]){const f=fixture();mutate(f.output);assert.equal(resourceFocusSchemaFor(f.input).safeParse(f.output).success,false);}
});
test('unknown is valid without invented evidence; invalid origins cannot become a known judgment',()=>{
 const f=fixture();f.output.role={value:'unknown',explanation:'定位证据不足',evidence:[]};f.output.resources[0]={...f.output.resources[0],importance:'unknown',reasons:[],explanation:'用途证据不足',evidence:[]};assert.equal(resourceFocusSchemaFor(f.input).safeParse(f.output).success,true);
 f.output.resources[0].reasons=['conflict'];assert.equal(resourceFocusSchemaFor(f.input).safeParse(f.output).success,false);
 const invalid=fixture();invalid.item.available=false;assert.equal(resourceFocusSchemaFor(invalid.input).safeParse(invalid.output).success,false);
});
test('zero, false and JSON are exact evidence values; null and missing stay unknown',()=>{
 assert.equal(resourceFocusEvidenceText(0),'0');assert.equal(resourceFocusEvidenceText(false),'false');assert.equal(resourceFocusEvidenceText(null),null);assert.equal(resourceFocusEvidenceText(undefined),null);
 const f=fixture();f.resource.values.plan=0;f.input.snapshot.evidenceSources[1].text='0';f.output.resources[0].evidence[0]={...f.output.resources[0].evidence[0],end:1,excerpt:'0'};assert.equal(resourceFocusSchemaFor(f.input).safeParse(f.output).success,true);
 f.input.snapshot.evidenceSources[1].text='1';assert.throws(()=>resourceFocusSchemaFor(f.input));
});
test('wrong book, truncated sources, hidden field or omitted original resource version fail before model preparation',()=>{
 for(const mutate of [input=>input.snapshot.ledger.bookId=id(99),input=>input.snapshot.ledger.truncated=true,input=>input.snapshot.objects[0].fields[0].field.hidden=true,input=>input.snapshot.objects[1].versionId=id(99)]){const f=fixture();mutate(f.input);assert.throws(()=>preparePrompt('character_resource_focus',f.input));}
});
test('display narrows only after explicit adoption and full current frame verification; changed sources reveal all',()=>{
 const f=fixture(),ledger=f.input.snapshot.ledger;ledger.items=[1,2,3].map((number)=>({...f.item,relationId:id(20+number),resourceId:id(30+number)}));
 const output={...f.output,role:{...f.output.role,value:'temporary'},resources:ledger.items.map((item,index)=>({relationId:item.relationId,resourceId:item.resourceId,importance:index===0?'key':index===1?'ordinary':'unknown'}))};
 const record={snapshot:structuredClone(f.input.snapshot),output,request:{expectedSourceHash:'a'.repeat(64)}},controller={record,applied:false,verifiedHash:'a'.repeat(64)};
 assert.equal(resourceFocusView(ledger,controller).items.length,3);controller.applied=true;const narrowed=resourceFocusView(ledger,controller);assert.equal(narrowed.limit,5);assert.deepEqual(narrowed.items.map(item=>item.relationId),[id(21),id(23)]);
 for(const mutate of [value=>value.bookId=id(99),value=>value.items[0].resourceVersionId=id(99),value=>value.truncated=true]){const current=structuredClone(ledger);mutate(current);assert.equal(resourceFocusView(current,controller).valid,false);assert.equal(resourceFocusView(current,controller).items.length,3);}
 controller.verifiedHash=null;assert.equal(resourceFocusView(ledger,controller).valid,false);controller.verifiedHash='a'.repeat(64);record.output.role.value='protagonist';assert.equal(resourceFocusView(ledger,controller).limit,10);record.output.role.value='long_term';assert.equal(resourceFocusView(ledger,controller).limit,6);
});
function recoveryFixture(){const f=fixture(),values=new Map(),bookId=f.input.snapshot.bookId,characterId=f.actor.id,storageKey=`nd-resource-focus:${bookId}:${characterId}`,storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},request={requestKey:id(50),characterId,selection:f.input.snapshot.selection,expectedSourceHash:'a'.repeat(64),instruction:''},record={id:request.requestKey,bookId,request,status:'review',stage:'review',error:'',snapshot:f.input.snapshot,output:f.output,createdAt:'2026-09-18T01:00:00.000Z',sourceRoute:`/new-design/books/${bookId}/story-setting?tab=characters&selected=${characterId}&detail=resources&resourceFocus=${request.requestKey}`};return{...f,values,storage,storageKey,request,record,recovery:new ResourceFocusRecovery(bookId,characterId,storageKey,storage,run=>run())};}
test('old page cannot clear another complete pending request or send a new command while a frame exists',async()=>{
 const f=recoveryFixture(),next={...f.request,requestKey:id(51)},raw=JSON.stringify({format:1,storage:f.storageKey,input:next});f.values.set(f.storageKey,raw);let sends=0;
 await assert.rejects(f.recovery.exclusive(f.request,false,async()=>{sends++;}));await assert.rejects(f.recovery.exclusive(next,true,async()=>{sends++;}));assert.equal(sends,0);assert.equal(f.values.get(f.storageKey),raw);
 await f.recovery.exclusive(next,false,async()=>{sends++;});assert.equal(sends,1);
});
test('reading the same full result preserves an adopted display choice; older results cannot replace newer cache',()=>{
 const f=recoveryFixture();assert.equal(f.recovery.save(f.record,true,false,true),true);assert.equal(f.recovery.save(f.record,false,true),true);assert.equal(JSON.parse(f.values.get(`${f.storageKey}:result`)).applied,true);
 const next={...structuredClone(f.record),id:id(51),request:{...f.request,requestKey:id(51)},createdAt:'2026-09-18T01:01:00.000Z',sourceRoute:f.record.sourceRoute.replace(id(50),id(51))};f.recovery.save(next,false);const current=f.values.get(`${f.storageKey}:result`);f.recovery.save(f.record,false,true);assert.equal(f.values.get(`${f.storageKey}:result`),current);assert.ok(f.values.has(`${f.storageKey}:history:${f.record.id}`));
});
test('corrupt complete result, malformed pending metadata or unavailable lock rejects before another send',async()=>{
 const f=recoveryFixture();f.values.set(`${f.storageKey}:result`,'{"format":1}');assert.throws(()=>f.recovery.save(f.record,false));f.values.set(f.storageKey,'not JSON');let sends=0;await assert.rejects(f.recovery.exclusive(f.request,false,async()=>{sends++;}));
 const locked=new ResourceFocusRecovery(f.record.bookId,f.request.characterId,f.storageKey,f.storage,async()=>{throw new Error('lock unavailable');});await assert.rejects(locked.exclusive(f.request,true,async()=>{sends++;}));assert.equal(sends,0);
});
test('serial focus lock checks the durable original after waiting and prevents a second page from replacing it',async()=>{
 const f=recoveryFixture();let tail=Promise.resolve(),release;const blocked=new Promise(resolve=>{release=resolve;}),lock=async run=>{const prior=tail;let done;tail=new Promise(resolve=>{done=resolve;});await prior;try{await run();}finally{done();}},a=new ResourceFocusRecovery(f.record.bookId,f.request.characterId,f.storageKey,f.storage,lock),b=new ResourceFocusRecovery(f.record.bookId,f.request.characterId,f.storageKey,f.storage,lock);let sends=0;
 const first=a.exclusive(f.request,true,async()=>{f.values.set(f.storageKey,JSON.stringify({format:1,storage:f.storageKey,input:f.request}));sends++;await blocked;});await Promise.resolve();await Promise.resolve();const second=b.exclusive({...f.request,requestKey:id(51)},true,async()=>{sends++;});release();await first;await assert.rejects(second);assert.equal(sends,1);assert.deepEqual(JSON.parse(f.values.get(f.storageKey)).input,f.request);
});

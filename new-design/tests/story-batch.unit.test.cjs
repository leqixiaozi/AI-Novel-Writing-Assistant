const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {preparePrompt}=require('../src/server/ai/prompts/index.ts');
const {NewDesignError,assertFound}=require('../src/server/domain/errors.ts');
const {AiExecutionError}=require('../src/server/ai/runtime/errors.ts');
const {canonicalWriteInput,writeInputHash}=require('../src/common/storyWorkspace/receipts.ts');
const {initialWriteInput}=require('../src/common/storyWorkspace/initialReceipts.ts');
const hash=value=>crypto.createHash('sha256').update(canonicalWriteInput(value)).digest('hex');
const book='41000000-0000-4000-8000-000000000002',key='91000000-0000-4000-8000-000000000001',id='92000000-0000-4000-8000-000000000001';
function load(file,mocks){const exports={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name in mocks)return mocks[name];throw Error('Unexpected source dependency '+name);},exports);return exports;}
function recordFixture(allowedTypes){
 const records=new Map(),writes=[];
 const recordCards={
  findRecordCard:async(_db,recordId,type)=>{const row=records.get(recordId);return row?.type===type?structuredClone(row.value):null;},
  listRecordCards:async(_db,type,options={})=>[...records.values()].filter(row=>row.type===type&&Object.entries(options.where??{}).every(([key,value])=>row.value[key]===value)).map(row=>structuredClone(row.value)),
  createRecordCard:async(_db,input)=>{assert.ok(allowedTypes.includes(input.typeKey),`Unexpected record creation: ${input.typeKey}`);const recordId=input.id??crypto.randomUUID();assert.equal(records.has(recordId),false);const now=new Date().toISOString(),value={id:recordId,space_id:input.spaceId,status:'active',revision:1,created_at:now,updated_at:now,...structuredClone(input.values),recordCardId:recordId,recordSpaceId:input.spaceId};records.set(recordId,{type:input.typeKey,value});writes.push({operation:'create',type:input.typeKey,id:recordId,values:structuredClone(value)});return structuredClone(value);},
  replaceRecordCard:async(_db,input)=>{const current=records.get(input.id);assert.equal(current?.type,input.typeKey);assert.equal(current.value.recordSpaceId,input.spaceId);const value={...structuredClone(input.values),recordCardId:input.id,recordSpaceId:input.spaceId};records.set(input.id,{type:input.typeKey,value});writes.push({operation:'replace',type:input.typeKey,id:input.id,values:structuredClone(value)});return structuredClone(value);},
 };
 return {records,writes,recordCards};
}
test('model availability preserves public configuration failures and hides unexpected infrastructure errors',async()=>{
 let failure=new NewDesignError('生效模型版本包含不支持的高级参数。',422);
 const status=load('src/server/ai/runtime/managedStatus.ts',{'../../database/modelManagement':{resolveManagedTaskRoute:async()=>{throw failure;}},'../prompts':{listPromptAssets:()=>[]},'../../domain/errors':{NewDesignError},'./managedExecution':{configurationForConnection:async()=>{}},'./errors':{AiExecutionError}});
 assert.match((await status.getIndependentTaskAvailability('form_assist')).message,/不支持的高级参数/);
 assert.match((await status.getIndependentModelStatus()).recovery.summary,/不支持的高级参数/);
 failure=new Error('private connection password');
 assert.doesNotMatch(JSON.stringify(await status.getIndependentTaskAvailability('form_assist')),/private|password/);
 assert.doesNotMatch(JSON.stringify(await status.getIndependentModelStatus()),/private|password/);
});
const field={key:'age',name:'年龄',description:'',type:'number',required:false,options:[],group:'身份',order:1,defaultValue:null};
function snapshot(mode='setting'){return {bookName:'测试小说',bookDescription:'',instruction:'',mode,slots:[{id,title:'原人物',values:{name:'作者填写'},fields:mode==='setting'?[field]:[],target:null,planningId:null,revision:null,baseVersionId:null,parentVersionId:null,level:null,sourceHash:'a'.repeat(64)}],materials:[],adoptedPlans:[]};}
test('character and planning batch prompts consume only the exact adopted world scope snapshot',()=>{
 const worldUsage=[{rootCardId:book,rootVersionId:book,rootTitle:'本书世界',rootValues:{name:'本书世界'},adoptionId:key,version:1,sourceHash:'a'.repeat(64),primaryLocationId:id,boundary:'限在主舞台',factions:[],locations:[{cardId:id,versionId:id,title:'主舞台',values:{name:'主舞台'}}],rules:[]}];
 const setting=preparePrompt('story_workspace_batch',{...snapshot(),worldUsage});
 assert.deepEqual(JSON.parse(setting.messages[1].content).taskData.worldUsage,worldUsage);
 const planning=preparePrompt('story_workspace_batch',{...snapshot('planning'),worldUsage});
 assert.deepEqual(JSON.parse(planning.messages[1].content).taskData.worldUsage,worldUsage);
});
test('batch prompt preserves exact slots and typed fields, rejecting manual fields and missing targets',()=>{
 const prompt=preparePrompt('story_workspace_batch',snapshot());
 assert.deepEqual(prompt.parseOutput({candidates:{[id]:{age:23}}}),{candidates:{[id]:{age:23}}});
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{name:'覆盖人工'}}}));
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{age:'23'}}}));
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{}}}));
 assert.throws(()=>prompt.parseOutput({candidates:{}}));
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{age:23},[key]:{age:3}}}));
});
test('range prompt allows only actual event references and same-book different characters',()=>{
 const input=snapshot('planning'),event=key,p1='93000000-0000-4000-8000-000000000001',p2='93000000-0000-4000-8000-000000000002';
 input.slots[0].references=[{role:'event',cardId:event}];input.materials=[p1,p2].map(value=>({id:value,versionId:key,title:'人物',typeKey:'character',values:{}}));
 const content={goal:'目标',storyTime:'',mustHappen:[],mustPreserve:[],forbiddenBoundaries:[],expectedChanges:[],characterArc:'',notes:'',eventSchedule:{[event]:{occurrenceOrder:2,timeLabel:'清晨'}},relationshipPlans:[{sourceId:p1,targetId:p2,description:'计划决裂'}]},prompt=preparePrompt('story_workspace_batch',input);
 assert.equal(prompt.parseOutput({candidates:{[id]:content}}).candidates[id].relationshipPlans.length,1);
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{...content,eventSchedule:{[p1]:{occurrenceOrder:1,timeLabel:''}}}}}));
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{...content,relationshipPlans:[{sourceId:p1,targetId:p1,description:'自关系'}]}}}));
 assert.throws(()=>prompt.parseOutput({candidates:{[id]:{...content,relationshipPlans:[{sourceId:p1,targetId:key,description:'外来人物'}]}}}));
});
function batchFixture(gateway,options={}){
 const storage=recordFixture(['ai_generation_batch']),calls=[];let executing=false;
 const query=async(sql,args=[])=>{calls.push(sql);
  if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:!executing}]};
  if(sql.includes('pg_advisory_lock(')){executing=true;return {rows:[]};}
  if(sql.includes('pg_advisory_unlock(')){executing=false;return {rows:[]};}
  if(sql.includes('pg_advisory_xact_lock')||/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.startsWith('SELECT space_id FROM new_design.books')){assert.equal(args[0],book);return {rows:[{space_id:book}]};}
  if(sql.startsWith('SELECT card.id,card.current_version_id FROM new_design.cards')){assert.deepEqual(args,[book,[]]);return {rows:[]};}
  throw Error('Unexpected batch SQL '+sql);
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const repository=load('src/server/database/bookCreationProduction/repository.ts',{'node:async_hooks':require('node:async_hooks'),'node:crypto':crypto,'../runtime':{getNewDesignPool:async()=>pool},'../../domain/errors':{NewDesignError},'../recordCards':storage.recordCards});
 const generation=load('src/server/database/generationBatches.ts',{'../domain/errors':{assertFound},'./recordCards':storage.recordCards,'./bookCreationProduction/repository':repository});
 const module=load('src/server/database/storyWorkspace/index.ts',{'../generationBatches':generation,'../bookCreationProduction/repository':repository,'../recordCards':storage.recordCards,'zod':require('zod'),'../../ai/runtime/errors':{AiExecutionError},'../../ai/prompts':{preparePrompt,storyBatchTask:mode=>mode==='visible_prepare'?'visible_prepare':mode==='visible_adjust'?'visible_adjust':'story_workspace_batch'},'../../domain/errors':{NewDesignError},'../runtime':{getNewDesignPool:async()=>pool},'../formAssist':{formHash:hash},'../../domain/formAssist':{},'./snapshot':{freezeStoryBatch:async()=>options.snapshotValue??snapshot()},'../worldUsage':{assertWorldUsageScopesCurrent:options.assertWorldUsage??(async()=>{})},'./adoptions':{},'./visibleBatchWrites':{}});
 const request={mode:'setting',requestKey:key,instruction:'',typeIds:[id],newTypeId:id,newCount:0};
 return {check:slotId=>module.checkStoryBatchSlot(book,key,slotId),generate:input=>module.generateStoryBatch(book,input??request,gateway),read:()=>module.readStoryBatch(book,key),end:()=>module.endUnknownStoryBatch(book,key),records:storage.records,writes:storage.writes,calls,request};
}
test('same original batch request invokes a model once and reads the retained candidates without saving cards',async()=>{
 let invocations=0;const fixture=batchFixture({generateStoryWorkspaceBatch:async()=>{invocations++;return {output:{candidates:{[id]:{age:23}}},promptSnapshot:{},modelSnapshot:{},usedTokens:20};}});
 const first=await fixture.generate(),second=await fixture.generate(),read=await fixture.read();assert.equal(invocations,1);assert.equal(first.id,second.id);assert.equal(read.status,'review');
 assert.equal(fixture.writes.filter(write=>write.operation==='create'&&write.type==='ai_generation_batch').length,1);assert.ok(fixture.calls.some(sql=>sql.includes('pg_advisory_xact_lock')));
 assert.ok(fixture.writes.every(write=>write.type==='ai_generation_batch'));assert.equal(fixture.records.get(key).value.status,'review');
 assert.equal(fixture.calls.some(sql=>/INSERT INTO new_design\.(cards|planning_versions|entity_initial_states)/.test(sql)),false);
 await assert.rejects(fixture.generate({...fixture.request,instruction:'换输入'}),/原请求内容不匹配/);assert.equal(invocations,1);
});
test('a changed adopted world scope blocks loading an old character batch candidate',async()=>{
 let stale=false,modelCalls=0;
 const fixture=batchFixture({generateStoryWorkspaceBatch:async()=>{modelCalls++;return {output:{candidates:{[id]:{age:23}}},promptSnapshot:{},modelSnapshot:{},usedTokens:1};}},{snapshotValue:{...snapshot(),worldUsage:[]},assertWorldUsage:async()=>{if(stale)throw new NewDesignError('正式世界使用范围已变化。',409);}});
 await fixture.generate();
 assert.deepEqual((await fixture.check(id)).values,{age:23});
 stale=true;
 await assert.rejects(fixture.check(id),/世界使用范围已变化/);
 assert.equal(modelCalls,1);
});
test('lost model response retains the original claim and blocks another provider call with the same key',async()=>{
 let invocations=0;const fixture=batchFixture({generateStoryWorkspaceBatch:async()=>{invocations++;throw Error('lost response');}});
 await assert.rejects(fixture.generate(),error=>error.mutationOutcome==='unknown');const read=await fixture.read();assert.equal(read.status,'running');assert.equal(read.stage,'result_unknown');await fixture.generate();assert.equal(invocations,1);
 assert.equal((await fixture.end()).status,'ended_unknown');assert.equal((await fixture.generate()).status,'ended_unknown');assert.equal(invocations,1);
});
test('an active batch execution cannot be ended; repeated requests do not invoke another provider',async()=>{
 let finish,started;const ready=new Promise(resolve=>started=resolve),held=new Promise(resolve=>finish=resolve);let invocations=0;
 const fixture=batchFixture({generateStoryWorkspaceBatch:async()=>{invocations++;started();await held;return {output:{candidates:{[id]:{age:23}}},promptSnapshot:{},modelSnapshot:{},usedTokens:1};}});
 const first=fixture.generate();await ready;await assert.rejects(fixture.end(),/仍在处理/);assert.equal((await fixture.generate()).status,'running');assert.equal(invocations,1);finish();await first;
});
test('a proved pre-send model error retains an ended record so another request is an explicit choice',async()=>{
 const fixture=batchFixture({generateStoryWorkspaceBatch:async()=>{const error=new AiExecutionError('检查配置','请连接模型',422);error.executionSnapshot={attempts:[],usageStatus:'not_invoked'};throw error;}});
 const result=await fixture.generate();assert.equal(result.status,'failed');assert.equal(result.error,'请连接模型');
});
test('browser and server receipt hashes agree for full inputs; expected revision and binding differences never match',async()=>{
 const input={bookId:book,requestKey:key,subjectKind:'card',subjectId:id,stateKey:'age',value:23,expectedRevision:0};
 const normalized=initialWriteInput(input);assert.equal(await writeInputHash(normalized),hash(normalized));
 assert.notEqual(hash(initialWriteInput({...input,expectedRevision:1})),hash(normalized));assert.notEqual(hash(initialWriteInput({...input,subjectKind:'relation'})),hash(normalized));
 const plan={content:{custom:{z:1,a:2},goal:'目标'},references:[],expectedRevision:4,idempotencyKey:key};assert.equal(await writeInputHash({objectId:id,...plan}),hash({objectId:id,...plan}));
 assert.notEqual(hash({objectId:id,...plan}),hash({objectId:id,...plan,expectedRevision:5}));
});
function initialFixture({failCommit=false,failValidation=false}={}){
 const storage=recordFixture(['entity_initial_state','entity_initial_state_version']),calls=[];let transactionSnapshot;
 const rowsOf=type=>[...storage.records.values()].filter(row=>row.type===type).map(row=>row.value);
 const {storyRecordCtes}=require('../src/server/database/storyTimeline/persistence/recordRows.ts');
 const defaults=require('../src/server/database/storyTimeline/persistence/recordDefaults.ts'),checks=require('../src/server/database/storyTimeline/persistence/recordChecks.ts'),references=require('../src/server/database/storyTimeline/persistence/recordReferences.ts');
 const query=async(sql,args=[])=>{calls.push(sql);
  if(sql.startsWith('BEGIN')){transactionSnapshot=structuredClone(storage.records);return {rows:[]};}
  if(sql==='COMMIT'){transactionSnapshot=undefined;if(failCommit)throw Error('commit response lost');return {rows:[]};}
  if(sql==='ROLLBACK'){if(transactionSnapshot){storage.records.clear();for(const entry of transactionSnapshot)storage.records.set(...entry);}transactionSnapshot=undefined;return {rows:[]};}
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql==='SELECT space_id FROM new_design.books WHERE id=$1'){assert.equal(args[0],book);return {rows:[{space_id:book}]};}
  if(sql==='SELECT 1 FROM new_design.books WHERE id=$1')return {rows:args[0]===book?[{exists:1}]:[],rowCount:args[0]===book?1:0};
  if(sql===checks.storyRecordChecks.entity_initial_state||sql===checks.storyRecordChecks.entity_initial_state_version){const row=JSON.parse(args[0]);assert.ok(row.id);assert.ok(row.created_at);if(sql===checks.storyRecordChecks.entity_initial_state){assert.equal(row.book_id,book);assert.equal(row.subject_kind,'card');assert.equal(row.subject_id,id);assert.ok(row.revision>0);}else{assert.ok(storage.records.has(row.initial_state_id));assert.ok(row.version>0);assert.equal(row.value_hash,hash(row.value_json));}return {rows:[{valid:true}]};}
  if(sql.includes('SELECT version.*,state.book_id')){const version=rowsOf('entity_initial_state_version').find(row=>row.id===args[0]),state=version&&rowsOf('entity_initial_state').find(row=>row.id===version.initial_state_id);return {rows:state?[{...version,book_id:state.book_id,subject_kind:state.subject_kind,subject_id:state.subject_id,state_key:state.state_key}]:[]};}
  if(sql.includes('SELECT * FROM entity_initial_states WHERE book_id='))return {rows:rowsOf('entity_initial_state').filter(row=>row.book_id===args[0]&&row.subject_kind===args[1]&&row.subject_id===args[2]&&row.state_key===args[3])};
  if(sql.includes('SELECT COALESCE(max(version),0)+1'))return {rows:[{version:Math.max(0,...rowsOf('entity_initial_state_version').filter(row=>row.initial_state_id===args[0]).map(row=>row.version))+1}]};
  if(sql.startsWith('SELECT ($1)::uuid AS id')&&sql.includes('AS initial_state_id'))return {rows:[{id:args[0],initial_state_id:args[1],version:args[2],value_json:JSON.parse(args[3]),value_hash:args[4],source_fact_id:args[5],actor:args[6],note:args[7]}]};
  if(sql.startsWith('SELECT ($1)::uuid AS id')&&sql.includes('AS subject_kind'))return {rows:[{id:args[0],book_id:args[1],subject_kind:args[2],subject_id:args[3],state_key:args[4]}]};
  if(sql.includes('SELECT entity_initial_states.*,($2)::uuid AS current_version_id')){const row=rowsOf('entity_initial_state').find(row=>row.id===args[0]);return {rows:row?[{...row,current_version_id:args[1],revision:row.current_version_id?row.revision+1:row.revision,updated_at:new Date().toISOString()}]:[]};}
  throw Error('Unexpected initial-state SQL '+sql);
 };
 const mutations=load('src/server/database/storyTimeline/persistence/recordMutations.ts',{'node:crypto':crypto,'../../../domain/errors':{NewDesignError,assertFound},'../../recordCards':storage.recordCards,'../../cardWorkflow':{recordWorkflowAction:async()=>{throw Error('Unexpected review action');}},'../../store':{DEFAULT_SPACE_ID:book},'./recordDefaults':defaults,'./recordChecks':checks,'./recordReferences':references});
 const pool={connect:async()=>({query,release(){}})},module=load('src/server/database/initialStates/index.ts',{'../storyTimeline/persistence':{storyRecordCtes,...mutations},'node:crypto':crypto,'../../../common/storyWorkspace':{initialWriteInput,canonicalWriteInput},'../../domain/errors':{NewDesignError},'../../ai/runtime/errors':{AiExecutionError},'../runtime':{getNewDesignPool:async()=>pool}});
 const input={bookId:book,requestKey:key,subjectKind:'card',subjectId:id,stateKey:'age',value:23,expectedRevision:0,actor:'user',note:'确认初始值'},sources={requireStateKey:async()=>{if(failValidation)throw new NewDesignError('无此字段',422);},rebuildProjectionKey:async()=>{},getInitialState:async stateId=>{const state=storage.records.get(stateId)?.value;return {id:stateId,revision:state.revision,currentVersionId:state.current_version_id,versions:rowsOf('entity_initial_state_version')};}};
 return {save:value=>module.saveInitialStateWithReceipt(pool,value??input,sources),read:()=>module.readInitialStateWriteReceipt(book,key),input,calls,writes:storage.writes,get versions(){return new Map(rowsOf('entity_initial_state_version').map(row=>[row.id,row]));}};
}
test('initial state request UUID identifies one immutable version and repeated input adds no second version',async()=>{
 const fixture=initialFixture();await fixture.save();const proof=await fixture.read();assert.equal(proof.version.id,key);assert.equal(proof.inputHash,hash(initialWriteInput(fixture.input)));await fixture.save();assert.equal(fixture.versions.size,1);
 assert.equal(fixture.writes.filter(write=>write.operation==='create'&&write.type==='entity_initial_state_version').length,1);assert.equal(fixture.writes.filter(write=>write.operation==='replace'&&write.type==='entity_initial_state').length,1);assert.ok(fixture.calls.every(sql=>!/(?:INSERT INTO|UPDATE) new_design\.entity_initial_states?/.test(sql)));
 await assert.rejects(fixture.save({...fixture.input,value:99}),/另一输入/);assert.equal(fixture.versions.size,1);
});
test('lost initial commit acknowledgment is unknown and preserves the original version identity',async()=>{
 const fixture=initialFixture({failCommit:true});await assert.rejects(fixture.save(),error=>error.recovery.mutationOutcome==='unknown');assert.equal(fixture.versions.get(key).value_json,23);
});
test('initial source validation failure is proved not written and adds no version',async()=>{
 const fixture=initialFixture({failValidation:true});await assert.rejects(fixture.save(),error=>error.recovery.mutationOutcome==='not_written');assert.equal(fixture.versions.size,0);
});

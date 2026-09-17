const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {preparePrompt}=require('../src/server/ai/prompts/index.ts');
const {NewDesignError}=require('../src/server/domain/errors.ts');
const {AiExecutionError}=require('../src/server/ai/runtime/errors.ts');
const {canonicalWriteInput,writeInputHash}=require('../src/common/storyWorkspace/receipts.ts');
const {initialWriteInput}=require('../src/common/storyWorkspace/initialReceipts.ts');
const hash=value=>crypto.createHash('sha256').update(canonicalWriteInput(value)).digest('hex');
const book='41000000-0000-4000-8000-000000000002',key='91000000-0000-4000-8000-000000000001',id='92000000-0000-4000-8000-000000000001';
function load(file,mocks){const exports={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name in mocks)return mocks[name];throw Error('Unexpected source dependency '+name);},exports);return exports;}
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
function batchFixture(gateway){
 const rows=new Map(),calls=[];let executing=false;
 const query=async(sql,args=[])=>{calls.push(sql);if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:!executing}]};if(sql.includes('pg_advisory_lock('))executing=true;if(sql.includes('pg_advisory_unlock('))executing=false;if(sql.startsWith('SELECT * FROM new_design.ai_generation_batches'))return {rows:rows.has(args[0])?[rows.get(args[0])]:[]};
  if(sql.startsWith('INSERT INTO new_design.ai_generation_batches')){rows.set(args[0],{id:args[0],book_id:args[1],status:'running',stage:'generating',instruction:args[2],input_payload:JSON.parse(args[3]),output_payload:{},created_at:new Date(),error_message:''});return {rows:[]};}
  if(sql.startsWith('UPDATE new_design.ai_generation_batches')){const row=rows.get(args[0]);if(sql.includes("status='discarded'")){row.status='discarded';row.stage='ended_unknown';}else if(sql.includes("status='review'")){row.status='review';row.output_payload=JSON.parse(args[1]);}else if(sql.includes("status='failed'")){row.status='failed';row.error_message=args[1];row.output_payload=JSON.parse(args[2]);}else{row.stage=args[1];row.error_message=args[2];}return {rows:[row]};}return {rows:[]};};
 const pool={query,connect:async()=>({query,release(){}})},module=load('src/server/database/storyWorkspace/index.ts',{'zod':require('zod'),'../../ai/runtime/errors':{AiExecutionError},'../../ai/prompts':{preparePrompt},'../../domain/errors':{NewDesignError},'../runtime':{getNewDesignPool:async()=>pool},'../formAssist':{formHash:hash},'../../domain/formAssist':{},'./snapshot':{freezeStoryBatch:async()=>snapshot()}});
 const request={mode:'setting',requestKey:key,instruction:'',typeIds:[id],newTypeId:id,newCount:0};
 return {generate:input=>module.generateStoryBatch(book,input??request,gateway),read:()=>module.readStoryBatch(book,key),end:()=>module.endUnknownStoryBatch(book,key),rows,calls,request};
}
test('same original batch request invokes a model once and reads the retained candidates without saving cards',async()=>{
 let invocations=0;const fixture=batchFixture({generateStoryWorkspaceBatch:async()=>{invocations++;return {output:{candidates:{[id]:{age:23}}},promptSnapshot:{},modelSnapshot:{},usedTokens:20};}});
 const first=await fixture.generate(),second=await fixture.generate(),read=await fixture.read();assert.equal(invocations,1);assert.equal(first.id,second.id);assert.equal(read.status,'review');
 assert.equal(fixture.calls.filter(sql=>sql.startsWith('INSERT')).length,1);assert.ok(fixture.calls.some(sql=>sql.includes('pg_advisory_xact_lock')));
 assert.equal(fixture.calls.some(sql=>/INSERT INTO new_design\.(cards|planning_versions|entity_initial_states)/.test(sql)),false);
 await assert.rejects(fixture.generate({...fixture.request,instruction:'换输入'}),/原请求内容不匹配/);assert.equal(invocations,1);
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
 const versions=new Map(),calls=[];let revision=1,current=null;
 const query=async(sql,args=[])=>{calls.push(sql);
  if(sql.startsWith('SELECT version.*'))return {rows:versions.has(args[0])?[versions.get(args[0])]:[]};
  if(sql.startsWith('SELECT * FROM new_design.entity_initial_states'))return {rows:current?[{id,revision,current_version_id:current}]:[]};
  if(sql.startsWith('INSERT INTO new_design.entity_initial_states'))return {rows:[{id,revision:1,current_version_id:null}]};
  if(sql.startsWith('SELECT COALESCE(max(version)'))return {rows:[{version:versions.size+1}]};
  if(sql.startsWith('INSERT INTO new_design.entity_initial_state_versions')){versions.set(args[0],{id:args[0],initial_state_id:id,version:args[2],value_json:JSON.parse(args[3]),value_hash:args[4],source_fact_id:args[5],actor:args[6],note:args[7],created_at:new Date(),book_id:book,subject_kind:'card',subject_id:id,state_key:'age'});return {rows:[]};}
  if(sql.startsWith('UPDATE new_design.entity_initial_states')){revision=versions.size;current=args[1];return {rows:[]};}
  if(sql==='COMMIT'&&failCommit)throw Error('commit response lost');return {rows:[]};};
 const pool={connect:async()=>({query,release(){}})},module=load('src/server/database/initialStates/index.ts',{'node:crypto':crypto,'../../../common/storyWorkspace':{initialWriteInput,canonicalWriteInput},'../../domain/errors':{NewDesignError},'../../ai/runtime/errors':{AiExecutionError},'../runtime':{getNewDesignPool:async()=>pool}});
 const input={bookId:book,requestKey:key,subjectKind:'card',subjectId:id,stateKey:'age',value:23,expectedRevision:0,actor:'user',note:'确认初始值'},sources={requireStateKey:async()=>{if(failValidation)throw new NewDesignError('无此字段',422);},rebuildProjectionKey:async()=>{},getInitialState:async()=>({id,revision,currentVersionId:current,versions:[...versions.values()]})};
 return {save:value=>module.saveInitialStateWithReceipt(pool,value??input,sources),read:()=>module.readInitialStateWriteReceipt(book,key),input,calls,versions};
}
test('initial state request UUID identifies one immutable version and repeated input adds no second version',async()=>{
 const fixture=initialFixture();await fixture.save();const proof=await fixture.read();assert.equal(proof.version.id,key);assert.equal(proof.inputHash,hash(initialWriteInput(fixture.input)));await fixture.save();assert.equal(fixture.versions.size,1);
 await assert.rejects(fixture.save({...fixture.input,value:99}),/另一输入/);assert.equal(fixture.versions.size,1);
});
test('lost initial commit acknowledgment is unknown and preserves the original version identity',async()=>{
 const fixture=initialFixture({failCommit:true});await assert.rejects(fixture.save(),error=>error.recovery.mutationOutcome==='unknown');assert.equal(fixture.versions.get(key).value_json,23);
});
test('initial source validation failure is proved not written and adds no version',async()=>{
 const fixture=initialFixture({failValidation:true});await assert.rejects(fixture.save(),error=>error.recovery.mutationOutcome==='not_written');assert.equal(fixture.versions.size,0);
});

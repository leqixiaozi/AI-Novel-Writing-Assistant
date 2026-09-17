const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {stableHash}=require('../dist/server/database/aiContracts');
const {parseWorldConsistencyOutput,worldConsistencyInputSchema}=require('../dist/server/database/worldConsistency/policy');
const {worldReceipt}=require('../dist/server/database/worldConsistency/repository');
const {preparePrompt,listPromptAssets}=require('../dist/server/ai/prompts');
function fixture(){
 const field={key:'custom_limit',name:'世界约束',description:'作者正式约束，不按键猜用途',type:'short_text',required:false,defaultValue:null,options:[],group:'规则',order:0};
 const subject={kind:'card',id:randomUUID(),versionId:randomUUID(),revision:1,label:'禁海城',typeId:randomUUID(),typeLabel:'作者自定义设定',fields:[{key:field.key,label:field.name,specVersionId:randomUUID(),specHash:stableHash(field),specification:field,value:'不可飞行'}]};
 const payload={bookId:randomUUID(),subjects:[subject],dictionaryNodes:[]},catalog={...payload,hash:stableHash(payload)},f=subject.fields[0];
 const evidence={kind:subject.kind,id:subject.id,versionId:subject.versionId,fieldKey:f.key,specVersionId:f.specVersionId,specHash:f.specHash,valueHash:stableHash(f.value),note:'原资料明确限制飞行'};
 const fix={cardId:subject.id,cardVersionId:subject.versionId,fieldKey:f.key,specVersionId:f.specVersionId,specHash:f.specHash,beforeHash:stableHash(f.value),after:'禁海范围内不可飞行',reason:'明确地域范围，待作者审阅'};
 const output={summary:'发现一项精确资料矛盾',findings:[{stableKey:'local_rule_conflict',title:'城内飞行约束不一致',description:'两份设定需明确边界',severity:'medium',evidence:[evidence],fixes:[fix]}],recheckOutcome:'not_requested'};
 return{catalog,subject,field:f,evidence,fix,output};
}
test('dedicated world prompt is registered, without adding a composition task',()=>{
 assert.equal(listPromptAssets().find(a=>a.taskType==='world_consistency').assetId,'new_design.world.consistency');
 assert.equal(require('../dist/common/promptComposition').COMPOSITION_TASK_KEYS.length,6);
 assert.ok(!require('../dist/common/promptComposition').COMPOSITION_TASK_KEYS.includes('world_consistency'));
});
test('actual author-defined types and keys work without an English purpose heuristic',()=>{const f=fixture();assert.deepEqual(parseWorldConsistencyOutput(f.catalog,false,f.output),f.output);});
test('foreign identity, version, specification, and baseline hashes cannot become evidence or a fix',()=>{
 for(const patch of [{id:randomUUID()},{versionId:randomUUID()},{fieldKey:'invented'},{specVersionId:randomUUID()},{specHash:'b'.repeat(64)},{valueHash:'b'.repeat(64)}]){const f=fixture();Object.assign(f.output.findings[0].evidence[0],patch);assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));}
 for(const patch of [{cardId:randomUUID()},{cardVersionId:randomUUID()},{fieldKey:'invented'},{specVersionId:randomUUID()},{specHash:'b'.repeat(64)},{beforeHash:'b'.repeat(64)},{after:42},{after:{text:'不是正式标量'}}]){const f=fixture();Object.assign(f.output.findings[0].fixes[0],patch);assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));}
});
test('unchanged values and duplicate field positions across different issues do not create fake fixes',()=>{
 let f=fixture();f.output.findings[0].fixes[0].after=f.field.value;assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));
 f=fixture();f.output.findings.push({...structuredClone(f.output.findings[0]),stableKey:'different_issue'});assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));
});
test('hidden and conditional invisible fields cannot be repaired',()=>{
 for(const patch of [{hidden:true},{aiSuggestible:false},{visibleWhen:{fieldKey:'custom_limit',operator:'equals',value:'其他值'}}]){const f=fixture();Object.assign(f.field.specification,patch);f.field.specHash=stableHash(f.field.specification);f.output.findings[0].evidence[0].specHash=f.field.specHash;f.output.findings[0].fixes[0].specHash=f.field.specHash;assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));}
});
test('dictionary repair freezes true UUID, branch, parent and leaf rules; same labels do not substitute IDs',()=>{
 const f=fixture(),dictionaryId=randomUUID(),root=randomUUID(),leaf=randomUUID(),other=randomUUID();
 Object.assign(f.field.specification,{type:'select',optionSource:{kind:'dictionary_tree',dictionaryId,rule:{mode:'single',depthMode:'descendants',rootNodeId:root,relativeDepth:null,leafOnly:true,allowParentSelection:false,minSelections:1,maxSelections:1}}});
 f.catalog.dictionaryNodes=[{dictionaryId,id:root,parentId:null,versionId:randomUUID(),label:'地域',status:'active'},{dictionaryId,id:leaf,parentId:root,versionId:randomUUID(),label:'同名',status:'active'},{dictionaryId,id:other,parentId:null,versionId:randomUUID(),label:'同名',status:'active'}];
 f.field.specHash=stableHash(f.field.specification);f.output.findings[0].evidence[0].specHash=f.field.specHash;f.fix.specHash=f.field.specHash;f.fix.after=leaf;
 assert.deepEqual(parseWorldConsistencyOutput(f.catalog,false,f.output),f.output);
 for(const value of [root,other,'同名',randomUUID()]){const changed=structuredClone(f.output);changed.findings[0].fixes[0].after=value;assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,changed));}
});
test('recheck output cannot claim verified while reporting issues, or invent a recheck for a normal check',()=>{const f=fixture();f.output.recheckOutcome='supports_verified';assert.throws(()=>parseWorldConsistencyOutput(f.catalog,true,f.output));assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));f.output.findings=[];assert.deepEqual(parseWorldConsistencyOutput(f.catalog,true,f.output),f.output);});
test('relation evidence has an exact version and real specification hash, not a fake relation specification UUID',()=>{
 const f=fixture();Object.assign(f.subject,{kind:'relation',sourceId:randomUUID(),targetId:randomUUID()});f.field.specVersionId=null;Object.assign(f.evidence,{kind:'relation',specVersionId:null});f.output.findings[0].fixes=[];
 assert.deepEqual(parseWorldConsistencyOutput(f.catalog,false,f.output),f.output);f.evidence.specVersionId=randomUUID();assert.throws(()=>parseWorldConsistencyOutput(f.catalog,false,f.output));
});
test('input rejects no source, duplicate IDs, unbounded selections, and execution overrides',()=>{const f=fixture(),input={requestKey:randomUUID(),catalogHash:f.catalog.hash,cardIds:[f.subject.id],relationIds:[]};assert.deepEqual(worldConsistencyInputSchema.parse(input),input);for(const patch of [{cardIds:[]},{cardIds:[f.subject.id,f.subject.id]},{cardIds:Array.from({length:101},()=>randomUUID())},{provider:'fixture'}])assert.throws(()=>worldConsistencyInputSchema.parse({...input,...patch}));});
test('readonly receipts preserve original input and distinguish stale, saved reply, and expired unknown',()=>{
 const f=fixture(),input={requestKey:randomUUID(),catalogHash:f.catalog.hash,cardIds:[f.subject.id],relationIds:[]},row={id:randomUUID(),book_id:f.catalog.bookId,request_key:input.requestKey,request_hash:stableHash({bookId:f.catalog.bookId,input}),input_hash:'a'.repeat(64),input_payload:input,status:'running',model_request_state:'sent_unknown',frozen_plan:{catalog:f.catalog},lease_expired:true};
 let receipt=worldReceipt(row);assert.equal(receipt.canEndExpiredUnknown,true);assert.equal(receipt.modelResultSaved,false);assert.deepEqual(receipt.input,input);
 receipt=worldReceipt({...row,generated_output:f.output,model_request_state:'completed'});assert.equal(receipt.canImportSavedResult,false);assert.equal(receipt.canReleaseSavedResult,true);assert.equal(receipt.canEndExpiredUnknown,false);
 receipt=worldReceipt({...row,status:'succeeded',report_stale_at:new Date()});assert.equal(receipt.status,'stale');assert.equal(receipt.canReleaseSavedResult,false);
});
test('invalid model output identifies a Chinese formal field without exposing raw reply text',()=>{const f=fixture();f.fix.after={secret:'模型原始文本不得透出'};assert.throws(()=>preparePrompt('world_consistency',{contract:'world_consistency_v1',catalog:f.catalog,recheck:null}).parseOutput(f.output),error=>{assert.match(error.message,/禁海城.*世界约束/);assert.doesNotMatch(error.message,/secret|模型原始文本|custom_limit/);return true;});});

test('preparation not-written proof needs positive absence, unstarted COMMIT and acknowledged ROLLBACK',async()=>{
 const {worldTransaction,WorldConsistencyError}=require('../dist/server/database/worldConsistency/repository'),{withWorldConsistencyPool}=require('../dist/server/database/worldConsistency/pool');
 const bookId=randomUUID(),requestKey=randomUUID();
 for(const [label,mark,commitFail,rollbackFail,outcome] of [['unread original key',false,false,false,'unknown'],['positive absence and acknowledged rollback',true,false,false,'not_written'],['COMMIT acknowledgement lost',true,true,false,'unknown'],['ROLLBACK acknowledgement lost',true,false,true,'unknown']]){
  const queries=[],client={query:async sql=>{queries.push(sql);if(sql==='COMMIT'&&commitFail||sql==='ROLLBACK'&&rollbackFail)throw new Error('private SQL or raw path must not leak');return{rows:[],rowCount:0};},release(){}};
  await withWorldConsistencyPool({connect:async()=>client},()=>assert.rejects(worldTransaction(bookId,requestKey,async(_client,markAbsent)=>{if(mark)markAbsent();if(!commitFail)throw new Error('private SQL or raw path must not leak');return'ok';}),error=>{assert.equal(error.recovery.mutationOutcome,outcome,label);assert.doesNotMatch(error.message,/private SQL|raw path/);if(outcome==='not_written')assert.doesNotMatch(queries.join(','),/COMMIT/);return true;}));
 }
 const client={query:async()=>({rows:[],rowCount:0}),release(){}};
 await withWorldConsistencyPool({connect:async()=>client},()=>assert.rejects(worldTransaction(bookId,requestKey,async(_client,markAbsent)=>{markAbsent();throw new WorldConsistencyError(bookId,'核对原检查输入','原键用于不同完整输入','unknown',409);}),error=>error.recovery.mutationOutcome==='unknown'));
 await withWorldConsistencyPool({connect:async()=>client},()=>assert.rejects(worldTransaction(bookId,requestKey,async(_client,markAbsent)=>{markAbsent();throw new Error('private raw SQL');},'repair'),error=>{assert.equal(error.recovery.mutationOutcome,'not_written');assert.match(error.recovery.savedResult,/原资料已经正常保存/);assert.match(error.recovery.failedStep,/登记/);assert.doesNotMatch(error.recovery.savedResult,/未发送模型/);return true;}));
});

const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const build=process.env.ND_REFERENCE_TEST_BUILD;if(!build)throw new Error('ND_REFERENCE_TEST_BUILD is required');
const {resourceHistoryFocusSchemaFor,resourceHistoryEvidenceSources}=require(path.join(build,'common/characterResources/history'));
const {preparePrompt}=require(path.join(build,'server/ai/prompts'));
const {resourceFocusView}=require('./support/resourceBackfillClient.cjs').resourceBackfillClient('focusView');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const field={key:'holding',name:'持有',type:'boolean',hidden:false},text='角色把钥匙交给主角😀。',offset=6;
 const change={id:id(10),subjectKind:'relation',subjectId:id(2),stateKey:'holding',fieldAvailable:true,fieldLabel:'持有',before:true,after:false,beforeDisplay:'是',afterDisplay:'否',chapterOrder:2,bodyVersionId:id(11),available:true,original:{anchor:{start_offset:offset,end_offset:offset+text.length,excerpt:text},editingContract:{field:{field}},relationVersion:{properties:{}},resourceVersion:{values:{}}}};
 const selection={relationTypeId:id(3),holdingDimensionKey:'holding',specificationHash:'a'.repeat(64)},item={relationId:id(2),resourceId:id(4),name:'原钥匙',currentHolding:null,changes:[change]};
 const history={contract:'character_resource_history_v1',bookId:id(5),characterId:id(6),selection,items:[item],chapters:[],truncated:false};
 const proof={changeId:change.id,bodyVersionId:change.bodyVersionId,start:offset,end:offset+text.length,excerpt:text},output=[{relationId:item.relationId,resourceId:item.resourceId,status:'transferred',explanation:'原确认与正文明确转交，当前持有仍未知',evidence:[proof]}];
 const actorField={key:'role',name:'定位',type:'long_text',hidden:false},actor={id:history.characterId,versionId:id(7),revision:1,fields:[{field:actorField}],values:{role:'本人物是临时角色'},unavailableReason:null};
 const snapshot={contract:'character_resource_focus_v2',bookId:history.bookId,characterId:history.characterId,selection,ledger:{bookId:history.bookId,characterId:history.characterId,characterVersionId:actor.versionId,selection,truncated:false,items:[]},objects:[actor],evidenceSources:[{cardId:actor.id,versionId:actor.versionId,fieldKey:'role',text:actor.values.role}],history};
 const roleProof={cardId:actor.id,versionId:actor.versionId,fieldKey:'role',start:0,end:actor.values.role.length,excerpt:actor.values.role};
 const fullOutput={role:{value:'temporary',explanation:'原定位明确',evidence:[roleProof]},resources:[],history:output,notes:[]};
 return{history,change,proof,output,snapshot,fullOutput};
}
test('dedicated history asset uses the complete distinct v2 contract while old v1 remains separate',()=>{
 const f=fixture(),prompt=preparePrompt('character_resource_history_focus',{snapshot:f.snapshot,instruction:''});assert.equal(prompt.assetId,'new_design.character.resource_history_focus');assert.deepEqual(prompt.parseOutput(f.fullOutput),f.fullOutput);
 assert.throws(()=>preparePrompt('character_resource_focus',{snapshot:f.snapshot,instruction:''}));assert.throws(()=>prompt.parseOutput({...f.fullOutput,history:undefined}));
});
test('history evidence cites latest actual confirmation and absolute UTF-16 offsets rather than transfer plans or zero',()=>{
 const f=fixture(),schema=resourceHistoryFocusSchemaFor(f.history);assert.deepEqual(schema.parse(f.output),f.output);
 for(const proof of [{...f.proof,start:0},{...f.proof,bodyVersionId:id(30)},{...f.proof,changeId:id(31)},{...f.proof,end:f.proof.end-1}])assert.equal(schema.safeParse([{...f.output[0],evidence:[proof]}]).success,false);
 f.history.items[0].changes.unshift({...f.change,id:id(40)});assert.equal(resourceHistoryFocusSchemaFor(f.history).safeParse(f.output).success,false);
});
test('hidden, conditional, unavailable or unverified fields cannot provide history judgments; unknown does not invent proof',()=>{
 for(const edit of [f=>f.change.available=false,f=>f.change.fieldAvailable=false,f=>f.change.original.editingContract.field.field.hidden=true,f=>f.change.original.editingContract.field.field.visibleWhen={fieldKey:'flag',operator:'equals',value:true}]){
  const f=fixture();edit(f);
  assert.equal(resourceHistoryEvidenceSources(f.history).length,0);assert.equal(resourceHistoryFocusSchemaFor(f.history).safeParse(f.output).success,false);
  assert.equal(resourceHistoryFocusSchemaFor(f.history).safeParse([{...f.output[0],status:'unknown',evidence:[]}]).success,true);
 }
});
test('whole historical relation/resource scope is mandatory and truncated history cannot prepare a model',()=>{
 const f=fixture(),schema=resourceHistoryFocusSchemaFor(f.history);assert.equal(schema.safeParse([]).success,false);assert.equal(schema.safeParse([...f.output,...f.output]).success,false);assert.equal(schema.safeParse([{...f.output[0],resourceId:id(50)}]).success,false);f.history.truncated=true;assert.throws(()=>resourceHistoryFocusSchemaFor(f.history));
});
test('latest evidence preserves every distinct field and known classification must also account for the most recent confirmation',()=>{
 const f=fixture(),older=f.change,latest={...structuredClone(older),id:id(80),stateKey:'quantity',fieldLabel:'数量',after:0,afterDisplay:'0'};latest.original.editingContract.field.field={key:'quantity',name:'数量',type:'number',hidden:false};f.history.items[0].changes.unshift(latest);
 assert.equal(resourceHistoryEvidenceSources(f.history).length,2);assert.equal(resourceHistoryFocusSchemaFor(f.history).safeParse(f.output).success,false);
 const proof={...f.proof,changeId:latest.id};assert.equal(resourceHistoryFocusSchemaFor(f.history).safeParse([{...f.output[0],evidence:[...f.output[0].evidence,proof]}]).success,true);
});
test('invalid latest field confirmation cannot fall back to an older known confirmation of the same field',()=>{
 const f=fixture();f.history.items[0].changes.unshift({...structuredClone(f.change),id:id(90),available:false});assert.equal(resourceHistoryEvidenceSources(f.history).length,0);assert.equal(resourceHistoryFocusSchemaFor(f.history).safeParse(f.output).success,false);
});
test('managed model receives latest visible proof only, excluding full body, unrelated confirmations and hidden frozen fields',()=>{
 const f=fixture();f.history.chapters=[{basis:{bodyContent:'unrelated private body',original:{confirmedSources:{knowledge:['private knowledge']}}}}];f.change.original.editingContract.field.field.secret='private raw schema';
 const model=JSON.parse(preparePrompt('character_resource_history_focus',{snapshot:f.snapshot,instruction:''}).messages.at(-1).content).taskData.snapshot;
 assert.equal(model.history.sources.length,1);assert.equal(model.history.sources[0].afterDisplay,'否');assert.equal(model.history.sources[0].start,6);assert.equal(Object.hasOwn(model.history,'chapters'),false);assert.equal(JSON.stringify(model).includes('private raw schema'),false);assert.equal(JSON.stringify(model).includes('private knowledge'),false);
});
test('explicit adopted history prioritizes proven transfer for temporary role; long-term hides stale while full scope remains accessible',()=>{
 const f=fixture(),record={snapshot:f.snapshot,request:{expectedSourceHash:'b'.repeat(64)},output:f.fullOutput},controller={record,applied:true,verifiedHash:'b'.repeat(64)};
 let view=resourceFocusView(f.snapshot.ledger,controller);assert.equal(view.entries.length,1);assert.equal(view.entries[0].kind,'history');assert.equal(view.allEntries.length,1);assert.equal(view.limit,5);
 record.output.role.value='long_term';record.output.history[0].status='stale';view=resourceFocusView(f.snapshot.ledger,controller);assert.equal(view.entries.length,0);assert.equal(view.allEntries.length,1);
 const pending=resourceFocusView(f.snapshot.ledger,{...controller,applied:false});assert.equal(pending.role,'unknown');assert.equal(pending.entries.length,1);assert.equal(pending.entries[0].item.currentHolding,null);assert.equal(pending.entries[0].item.changes[0].available,true);const stale=resourceFocusView(f.snapshot.ledger,{...controller,verifiedHash:null});assert.equal(stale.allEntries.length,1);assert.equal(stale.entries[0].item.changes[0].available,false);
});

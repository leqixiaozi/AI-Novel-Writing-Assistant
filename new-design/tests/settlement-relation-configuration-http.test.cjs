const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {settlementRelationConfigurationRouter}=require('../dist/server/http/settlementRelationConfiguration');
const {settlementRelationDraftInputSchema}=require('../dist/server/database/chapterSettlement');
const {NewDesignError}=require('../dist/server/domain/errors');
const book='20000000-0000-4000-8000-000000000001';
const definition={name:'信任关系',description:'记录人物信任变化',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['character'],sourceMax:null,targetMax:null,
  fields:[{key:'trust',name:'信任程度',type:'number',required:false,defaultValue:null,options:[],description:'正文明确的信任程度',group:'关系状态',order:0,stateSettlement:'tracked'}],
  capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'trust',label:'信任程度',direction:'forward',policy:'tracked',mode:'absolute'}]};
const input={requestKey:'relation-original-request',expectedRelationTypeRevision:null,definition};
async function harness(t,dependencies={}){
  const app=express();app.use(express.json());app.use('/api',settlementRelationConfigurationRouter(dependencies));
  app.use((error,_request,response,_next)=>response.status(error.status??500).json({success:false,error:error.message,recovery:error.recovery,issues:error.issues}));
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api`;
}
const post=(url,value)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
test('relation draft preserves real typed field definition and exact formal source revision',()=>{
  const result=settlementRelationDraftInputSchema.parse(input);
  assert.equal(result.definition.fields[0].stateSettlement,'tracked');assert.equal(result.definition.fields[0].group,'关系状态');
  const missing={...input};delete missing.expectedRelationTypeRevision;assert.equal(settlementRelationDraftInputSchema.safeParse(missing).success,false);
  assert.equal(settlementRelationDraftInputSchema.safeParse({...input,sourceRoute:'https://attacker.invalid'}).success,false);
});
test('Chinese relation validation never invokes persistence and points to actual configuration',async t=>{
  let calls=0;const url=await harness(t,{saveSettlementRelationConfigurationDraft:async()=>{calls++;return{};}});
  const response=await post(`${url}/books/${book}/settlement-relation-configuration/drafts`,{...input,definition:{...definition,name:''}}),value=await response.json();
  assert.equal(response.status,422);assert.equal(calls,0);assert.match(value.issues['definition.name'],/关系名称/);
  assert.equal(value.recovery.mutationOutcome,'not_written');assert.equal(value.recovery.actionLabel,'打开关系配置');assert.match(value.recovery.sourceRoute,/view=relations&book=/);
});
test('unknown relation write preserves input and queries original receipt without republishing',async t=>{
  let writes=0,reads=0;const url=await harness(t,{saveSettlementRelationConfigurationDraft:async()=>{writes++;throw Error('private transport detail');},
    readSettlementRelationConfigurationReceipt:async(id,key)=>{reads++;assert.equal(id,book);assert.equal(key,input.requestKey);return null;}});
  const response=await post(`${url}/books/${book}/settlement-relation-configuration/drafts`,input),value=await response.json();
  assert.equal(response.status,503);assert.equal(value.recovery.mutationOutcome,'unknown');assert.doesNotMatch(value.error,/private transport/);
  const receipt=await fetch(`${url}/books/${book}/settlement-relation-configuration/receipts?requestKey=${input.requestKey}`);
  assert.equal(receipt.status,200);assert.equal((await receipt.json()).data,null);assert.equal(writes,1);assert.equal(reads,1);
});
test('acknowledged domain rollback retains concrete relation step and confirmed non-write outcome',async t=>{
  const route=`/new-design/structure/dictionaries-relations?view=relations&book=${book}`;
  const url=await harness(t,{saveSettlementRelationConfigurationDraft:async()=>{const error=new NewDesignError('信任程度：请核对数值字段。',422,{'definition.fields.0.type':'信任程度必须为数值。'});
    error.recovery={failedStep:'核对信任程度字段',summary:error.message,savedResult:'已回滚，草稿与正式关系保留。',sourceRoute:route,actionLabel:'打开关系配置',mutationOutcome:'not_written'};throw error;}});
  const value=await(await post(`${url}/books/${book}/settlement-relation-configuration/drafts`,input)).json();
  assert.equal(value.recovery.mutationOutcome,'not_written');assert.equal(value.recovery.failedStep,'核对信任程度字段');assert.equal(value.recovery.sourceRoute,route);
});
test('direct legacy relation or capability writes cannot bypass explicit draft publication',async t=>{
  const url=await harness(t);
  for(const [path,method] of [['relation-types','POST'],[`relation-types/${book}`,'PATCH'],[`spaces/${book}/state-capabilities/relations`,'PUT']]){
    const response=await fetch(`${url}/${path}`,{method,headers:{'content-type':'application/json'},body:'{}'}),value=await response.json();
    assert.equal(response.status,409);assert.equal(value.recovery.mutationOutcome,'not_written');assert.equal(value.recovery.actionLabel,'打开关系配置');
  }
});

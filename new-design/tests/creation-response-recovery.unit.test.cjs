const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {preparePrompt}=require('../dist/server/ai/prompts');
const {stableHash}=require('../dist/server/database/aiContracts');
const {hasRecoverableResponse,validateRetainedResponse}=require('../dist/server/database/creationDirector/responseRecovery');
const {creationPreparationReceipt}=require('../dist/server/database/creationDirector/preparation');
const id='10000000-0000-4000-8000-000000000001',card='20000000-0000-4000-8000-000000000001';
function fixture(){
 const input={contract:'creation_preparation_v1',sessionId:id,sessionRevision:1,specificationHash:'a'.repeat(64),stage:'project',mode:'all',method:'blank',bookName:'测试',sourceReference:'',sourceText:'',direction:null,
  schemaTypes:[{key:'theme',name:'主题',description:'',fields:[{key:'name',name:'主题',description:'',type:'short_text',required:true,options:[],defaultValue:null,group:'基本',order:0}]}],
  targets:[{reviewCardId:card,typeKey:'theme',isNew:true,title:'',values:{},allowTitle:true,fieldKeys:['name']}],contextCards:[],
  catalog:{templateVersionId:id,reviewCardsHash:'b'.repeat(64),dictionaries:[],relationSpecs:[],planningLevels:[]}};
 const p=preparePrompt('initial_content',input),output={candidates:[{reviewCardId:card,typeKey:'theme',isNew:true,titleSuggestion:'归还',values:{name:'承担代价'}}],directions:[],relations:[],plans:[],notes:[]},content=JSON.stringify(output);
 const batch={id:'batch',session_id:id,status:'failed',base_revision:1,preparation_request_key:'original-request',
  frozen_plan:{input,inputHash:stableHash(input),taskType:'initial_content',assetId:p.assetId,assetVersion:p.version,messages:p.messages,outputSchema:p.outputSchema,modelSnapshot:{id:'snapshot'},sourceBatches:[],carriedOutput:null},
  preparation_failure:{modelRequestState:'completed',failedStep:'读取模型输出'},preparation_execution:{knownTokens:15,attempts:[{requestSent:true,responseReceived:true,status:'failed'}],failedResponseEvidence:{content,contentBytes:Buffer.byteLength(content),retainedBytes:Buffer.byteLength(content),contentSha256:createHash('sha256').update(content).digest('hex'),truncated:false,finishReason:'stop'}}};
 const session={id,revision:3,status:'failed',input_payload:{creationDirector:{mode:'automatic',cursor:1,completedStages:['direction'],skippedStages:[],activeBatchId:null}}};
 return {batch,session,output};
}
test('retained reply is strictly revalidated without changing source text, usage or failed attempt history',()=>{
 const {batch,session,output}=fixture(),before=structuredClone(batch),result=validateRetainedResponse(batch,session);
 assert.deepEqual(result.output,output);assert.equal(result.execution.usedTokens,15);
 assert.deepEqual(result.execution.modelSnapshot.attempts,batch.preparation_execution.attempts);
 assert.equal(result.execution.modelSnapshot.failedResponseEvidence,undefined);
 assert.deepEqual(batch,before);
 const receipt=creationPreparationReceipt(batch);
 assert.equal(receipt.canRecoverSavedResult,true);assert.equal(receipt.modelResultSaved,false);
 assert.doesNotMatch(JSON.stringify(receipt),/failedResponseEvidence|承担代价/);
});
test('retained reply cannot bypass freshness, completion, immutable evidence or frozen schema checks',()=>{
 const mutations=[
  (b,s)=>s.revision++, (b,s)=>s.status='generating', (b,s)=>s.director_active_command_key='other',
  (b,s)=>s.input_payload.creationDirector.cursor++, (b,s)=>s.input_payload.creationDirector.mode='manual',
  b=>b.preparation_terminal='released',b=>b.preparation_superseded_by='next',b=>b.preparation_failure.modelRequestState='sent_unknown',
  b=>b.preparation_execution.failedResponseEvidence.truncated=true,b=>b.preparation_execution.failedResponseEvidence.finishReason='length',
  b=>b.preparation_execution.failedResponseEvidence.content+=' ',b=>b.preparation_execution.failedResponseEvidence.contentSha256='fake',
  b=>b.frozen_plan.input.bookName='changed',b=>b.frozen_plan.assetVersion='unavailable',b=>b.frozen_plan.messages=[],
  b=>{const e=b.preparation_execution.failedResponseEvidence;e.content='{}';e.contentBytes=e.retainedBytes=2;e.contentSha256=createHash('sha256').update(e.content).digest('hex');},
 ];
 for(const mutate of mutations){const {batch,session}=fixture();mutate(batch,session);assert.throws(()=>validateRetainedResponse(batch,session));}
 assert.equal(hasRecoverableResponse({}),false);
});
test('explicit recovery atomically saves candidates and advances once, without adoption or model calls',async t=>{
 const {batch,session,output}=fixture();let transactions=0,writes=0;
 const transaction=require('../dist/server/database/creationDirector/transaction'),repo=require('../dist/server/database/bookCreationProduction/repository'),prep=require('../dist/server/database/creationDirector/preparation');
 t.mock.method(transaction,'directorTransaction',async(_id,work)=>{transactions++;return work({});});
 t.mock.method(prep,'batchSessionId',async()=>id);
 t.mock.method(prep,'readOwnedCreationBatch',async()=>({...batch,current_session_revision:session.revision}));
 t.mock.method(repo,'lockCreationSession',async()=>session);
 t.mock.method(repo,'updateGenerationBatch',async(_db,_id,patch)=>{writes++;return Object.assign(batch,patch);});
 t.mock.method(repo,'updateCreationSession',async(_db,_s,patch)=>Object.assign(session,patch,{revision:session.revision+1}));
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('recovery must never call model');});
 const {recoverSavedCreationPreparation}=require('../dist/server/database/creationDirector/results');
 const result=await recoverSavedCreationPreparation('batch');
 assert.equal(transactions,1);assert.equal(result.status,'review');assert.equal(result.reviewSaved,false);
 assert.deepEqual(result.output,output);assert.equal(session.input_payload.creationDirector.cursor,2);
 assert.equal(batch.preparation_execution.usedTokens,15);
 const previousWrites=writes,revision=session.revision;
 const again=await recoverSavedCreationPreparation('batch');assert.deepEqual(again,result);
 assert.equal(writes,previousWrites);assert.equal(session.revision,revision);
});

const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {mountCreationPreparation}=require('../dist/server/http/creationDirector/preparation');
const {creationFailure}=require('../dist/server/http/creationDirector/recovery');
const {NewDesignError}=require('../dist/server/domain/errors');
const sessionId='85000000-0000-4000-8000-000000000001',batchId='85000000-0000-4000-8000-000000000002',key='original-preparation-001';
const receipt={sessionId,batchId,requestKey:key,status:'review',modelResultSaved:true,reviewSaved:false};
async function appFor(t,dependencies={}){
 const app=express(),router=express.Router();app.use(express.json());mountCreationPreparation(router,dependencies);app.use('/api',router);
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message,issues:error.issues,recovery:error.recovery}));
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 return async(path,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});return{status:response.status,value:await response.json()};};
}
test('selected blank AI preparation needs no invented title or required-field completion',async t=>{
 let calls=0;const request=await appFor(t,{runCreationReviewAi:async(id,input)=>{calls++;assert.equal(id,sessionId);assert.equal(input.mode,'required');assert.equal(input.reviewCardId,batchId);return receipt;}});
 const result=await request(`/book-creation/sessions/${sessionId}/review-ai/prepare`,'POST',{expectedSessionRevision:1,requestKey:key,mode:'required',reviewCardId:batchId});assert.equal(result.status,200);assert.equal(calls,1);
 const bad=await request(`/book-creation/sessions/${sessionId}/review-ai/prepare`,'POST',{expectedSessionRevision:1,requestKey:key,mode:'required',reviewCardId:batchId,title:'do not invent preconditions'});assert.equal(bad.status,422);assert.equal(calls,1);
});
test('original-key and saved-batch reads cannot execute a model or adopt data',async t=>{
 let reads=0,writes=0;const request=await appFor(t,{getCreationPreparationByKey:async(id,input)=>{reads++;assert.equal(id,sessionId);assert.equal(input,key);return null;},getCreationPreparationResult:async id=>{reads++;assert.equal(id,batchId);return receipt;},listCreationPreparationBatches:async id=>{reads++;assert.equal(id,sessionId);return[receipt];},runCreationReviewAi:async()=>{writes++;return receipt;},adoptSavedCreationPreparation:async()=>{writes++;return receipt;}});
 const absent=await request(`/book-creation/sessions/${sessionId}/review-ai/by-key/${key}`);assert.equal(absent.value.data,null);assert.equal(absent.value.recovery,undefined);
 assert.equal((await request(`/book-creation/creation-preparation-batches/${batchId}`)).value.data.modelResultSaved,true);
 assert.equal((await request(`/book-creation/sessions/${sessionId}/review-ai/batches`)).value.data.length,1);assert.equal(reads,3);assert.equal(writes,0);
});
test('explicit candidate adoption validates exact selections and preserves original key',async t=>{
 let calls=0;const request=await appFor(t,{adoptSavedCreationPreparation:async(id,input)=>{calls++;assert.equal(id,batchId);assert.equal(input.requestKey,key);return{sessionId,batchId,requestKey:key,repeated:false};}});
 const input={expectedSessionRevision:1,requestKey:key,selections:[{reviewCardId:sessionId,title:true,fieldKeys:['goal']}],relationIds:[],planIds:[]};
 assert.equal((await request(`/book-creation/creation-preparation-batches/${batchId}/adopt`,'POST',input)).status,200);
 assert.equal((await request(`/book-creation/creation-preparation-batches/${batchId}/adopt`,'POST',{...input,selections:[...input.selections,...input.selections]})).status,422);assert.equal(calls,1);
});
test('adoption lookup is read-only and is not an automatic retry command',async t=>{
 let reads=0,writes=0;const request=await appFor(t,{getCreationPreparationAdoptionReceipt:async(id,input)=>{reads++;assert.equal(id,batchId);assert.equal(input,key);return null;},adoptSavedCreationPreparation:async()=>{writes++;return receipt;}});
 const result=await request(`/book-creation/creation-preparation-batches/${batchId}/adoptions/by-key/${key}`);assert.equal(result.status,200);assert.equal(result.value.data,null);assert.equal(reads,1);assert.equal(writes,0);
});
test('explicit saved-result release and unknown-run ending are distinct strict commands',async t=>{
 let released=0,ended=0;const request=await appFor(t,{releaseSavedCreationPreparation:async()=>{released++;return{...receipt,status:'released'};},endExpiredUnknownCreationPreparation:async()=>{ended++;return{...receipt,status:'ended_unknown'};}});
 assert.equal((await request(`/book-creation/creation-preparation-batches/${batchId}/release-saved-result`,'POST',{})).value.data.status,'released');
 assert.equal((await request(`/book-creation/creation-preparation-batches/${batchId}/end-expired-unknown`,'POST',{})).value.data.status,'ended_unknown');
 assert.equal((await request(`/book-creation/creation-preparation-batches/${batchId}/end-expired-unknown`,'POST',{sourceRoute:'https://example.com'})).status,422);assert.equal(released,1);assert.equal(ended,1);
});
test('typed preparation failures retain step, saved output and canonical clickable source',()=>{
 const error=new NewDesignError('模型结果保存待核对',503);error.recovery={failedStep:'核对模型结果保存',summary:error.message,savedResult:'模型已返回，原表单保留。',nextAction:'读取原批次，有保存结果则采用旧结果。',mutationOutcome:'unknown',source:{kind:'book_creation',route:`/new-design/books/new?session=${sessionId}`,label:'返回本次开书'}};
 const result=creationFailure(undefined,'准备',error,'未确认');assert.equal(result.recovery.failedStep,'核对模型结果保存');assert.equal(result.recovery.sourceRoute,`/new-design/books/new?session=${sessionId}`);assert.equal(result.recovery.actionLabel,'返回本次开书');assert.match(result.recovery.savedResult,/采用旧结果/);assert.equal(result.recovery.mutationOutcome,'unknown');
 error.recovery.source.route='https://example.com';assert.equal(creationFailure(undefined,'准备',error,'未确认').recovery.sourceRoute,'/new-design/books/new');
});
test('saved-output recovery only continues the existing persistence step',async t=>{
 let saved=0,models=0;const request=await appFor(t,{recoverSavedCreationPreparation:async id=>{saved++;assert.equal(id,batchId);return receipt;},runCreationReviewAi:async()=>{models++;return receipt;}});
 const result=await request(`/book-creation/creation-preparation-batches/${batchId}/recover-saved-result`,'POST',{});assert.equal(result.status,200);assert.equal(saved,1);assert.equal(models,0);
});

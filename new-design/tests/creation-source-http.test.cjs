const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {mountCreationDirector}=require('../dist/server/http/creationDirector');
const {creationFailure}=require('../dist/server/http/creationDirector/recovery');
const {AiExecutionError}=require('../dist/server/ai');
const {NewDesignError}=require('../dist/server/domain/errors');
const sessionId='84000000-0000-4000-8000-000000000001',templateId='84000000-0000-4000-8000-000000000002',key='original-request-001';
const source=`/new-design/books/new?session=${sessionId}`;
const session={id:sessionId,revision:1,bookName:'',reviewCards:[],status:'review'};
async function appFor(t,store={}){
 const app=express(),router=express.Router();app.use(express.json());mountCreationDirector(router,undefined,store);app.use('/api',router);
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message,issues:error.issues,recovery:error.recovery}));
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 return async(path,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});return{status:response.status,value:await response.json()};};
}
test('blank creation accepts empty title and values but requires an original request key',async t=>{
 let calls=0;const request=await appFor(t,{createBookCreationSession:async input=>{calls++;assert.equal(input.requestKey,key);assert.equal(input.bookName,'');return session;}});
 const body={method:'blank',templateVersionId:templateId,bookName:'',inputPayload:{}};
 const invalid=await request('/book-creation/sessions','POST',body);assert.equal(invalid.status,422);assert.equal(invalid.value.recovery.mutationOutcome,'not_written');assert.equal(calls,0);
 const good=await request('/book-creation/sessions','POST',{...body,requestKey:key});assert.equal(good.status,201);assert.equal(calls,1);
});
test('creation key lookup is read-only and null is never classified as not executed',async t=>{
 let reads=0,writes=0;const request=await appFor(t,{getBookCreationSessionByRequest:async input=>{reads++;assert.equal(input,key);return null;},createBookCreationSession:async()=>{writes++;return session;}});
 const result=await request(`/book-creation/sessions/by-request/${key}`);assert.equal(result.status,200);assert.equal(result.value.data,null);assert.equal(reads,1);assert.equal(writes,0);
});
test('ordinary review keeps incomplete drafts and rejects request-supplied recovery routes',async t=>{
 let calls=0;const request=await appFor(t,{saveBookCreationReview:async(id,input)=>{calls++;assert.equal(id,sessionId);assert.equal(input.requireComplete,false);return session;}});
 const body={bookName:'',reviewCards:[],revision:1,requestKey:key};
 assert.equal((await request(`/book-creation/sessions/${sessionId}/review`,'PATCH',body)).status,200);
 const invalid=await request(`/book-creation/sessions/${sessionId}/review`,'PATCH',{...body,sourceRoute:'https://example.com/steal'});assert.equal(invalid.status,422);assert.equal(calls,1);assert.equal(invalid.value.recovery.sourceRoute,source);
});
test('unknown save and completion preserve scoped source and never auto retry',async t=>{
 let writes=0;const request=await appFor(t,{completeBookCreation:async()=>{writes++;throw new Error('private socket SQL password detail');}});
 const result=await request(`/book-creation/sessions/${sessionId}/complete`,'POST',{expectedRevision:1,requestKey:key});assert.equal(result.status,503);assert.equal(writes,1);assert.equal(result.value.recovery.mutationOutcome,'unknown');assert.equal(result.value.recovery.sourceRoute,source);assert.doesNotMatch(result.value.error,/private|SQL|password/);
});
test('original receipt GET uses exact key and does not recreate a book or proposals',async t=>{
 let reads=0,writes=0;const request=await appFor(t,{readBookCreationProductionReceipt:async(id,input)=>{reads++;assert.equal(id,sessionId);assert.equal(input,key);return null;},completeBookCreation:async()=>{writes++;return session;}});
 const result=await request(`/book-creation/sessions/${sessionId}/write-receipts?requestKey=${key}`);assert.equal(result.status,200);assert.equal(result.value.data,null);assert.equal(reads,1);assert.equal(writes,0);
});
test('invalid formal review never invokes store or installs an invented planning layer',async t=>{
 let writes=0;const request=await appFor(t,{saveBookCreationFormalReview:async()=>{writes++;return session;}});
 const result=await request(`/book-creation/sessions/${sessionId}/formal-review`,'PATCH',{expectedSessionRevision:1,expectedFormalRevision:null,requestKey:key,templateVersionId:templateId,reviewCardsHash:'a'.repeat(64),relations:[],plans:[{level:'event'}]});assert.equal(result.status,422);assert.equal(writes,0);assert.equal(result.value.recovery.mutationOutcome,'not_written');
});
test('legacy generation and direction writes cannot bypass source receipts',async t=>{
 let writes=0;const request=await appFor(t,{executeCreationDirector:async()=>{writes++;return session;}});
 for(const suffix of ['directions','initial-content','select-direction']){const result=await request(`/book-creation/sessions/${sessionId}/${suffix}`,'POST',{});assert.equal(result.status,409);assert.equal(result.value.recovery.mutationOutcome,'not_written');assert.equal(result.value.recovery.sourceRoute,source);}
 assert.equal(writes,0);
});
test('recovery follows explicit database outcome, never error status or string hints',()=>{
 const domain=new NewDesignError('草稿保存没有完成',503);domain.recovery={failedStep:'保存审阅草稿',summary:domain.message,savedResult:'输入保留，本次事务确认回滚',sourceRoute:source,actionLabel:'返回开书表单',mutationOutcome:'not_written'};
 assert.equal(creationFailure(sessionId,'保存',domain,'未确认').recovery.mutationOutcome,'not_written');
 assert.equal(creationFailure(sessionId,'保存',new NewDesignError('看起来回滚了',409),'未确认').recovery.mutationOutcome,'unknown');
 const typed=new AiExecutionError('核对模型结果','请核对',503);typed.recovery.sourceRoute='https://example.com/steal';assert.equal(creationFailure(sessionId,'生成',typed,'保留').recovery.sourceRoute,source);
});
test('director control and preparation receipts have separate original-key read contracts',async t=>{
 let reads=0,writes=0;const request=await appFor(t,{getCreationDirectorControlReceipt:async(id,input)=>{reads++;assert.equal(id,sessionId);assert.equal(input,key);return{sessionId,requestKey:key,operation:'director_control',session};},getCreationDirectorCommandReceipt:async(id,input)=>{reads++;assert.equal(id,sessionId);assert.equal(input,key);return{sessionId,requestKey:key,status:'review',session,receipts:[]};},executeCreationDirector:async()=>{writes++;return session;},controlCreationDirector:async()=>{writes++;return{session};}});
 const control=await request(`/book-creation/sessions/${sessionId}/director/commands/by-key/${key}`),prepared=await request(`/book-creation/sessions/${sessionId}/director/prepare/by-key/${key}`);assert.equal(control.value.data.operation,'director_control');assert.deepEqual(prepared.value.data.receipts,[]);assert.equal(reads,2);assert.equal(writes,0);
});

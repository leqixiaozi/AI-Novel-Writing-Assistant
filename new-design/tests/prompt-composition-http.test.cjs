const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createNewDesignRouter}=require('../dist/server/http/router');
const {COMPOSITION_ROUTE}=require('../dist/common/promptComposition');

test('real HTTP invalid preview names the failed stage and provides a safe source recovery',async t=>{
  const app=express();app.use(express.json());app.use('/api',createNewDesignRouter());
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/prompt-composition`;
  const response=await fetch(`${url}/previews`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({parameters:{rawSchema:{}}})});
  const envelope=await response.json();
  assert.equal(response.status,422);assert.equal(envelope.success,false);assert.equal(envelope.recovery.failedStep,'生成请求预览');
  assert.equal(envelope.recovery.sourceRoute,COMPOSITION_ROUTE);assert.equal(envelope.recovery.actionLabel,'返回提示词组合');
  assert.match(envelope.recovery.savedResult,/模型请求尚未发送/);assert.ok(Object.keys(envelope.issues).length);
});
test('invalid trial never claims a database attempt and tells the user where to return',async t=>{
  const app=express();app.use(express.json());app.use('/api',createNewDesignRouter());
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/prompt-composition/previews/not-a-preview/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,idempotencyKey:'valid-key'})});
  const envelope=await response.json();assert.equal(response.status,422);assert.equal(envelope.recovery.failedStep,'核对试运行请求');assert.equal(envelope.recovery.sourceRoute,COMPOSITION_ROUTE);assert.match(envelope.recovery.savedResult,/尚未发送/);
});

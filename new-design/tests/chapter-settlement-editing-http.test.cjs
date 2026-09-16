const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {chapterSettlementEditingRouter}=require('../dist/server/http/chapterSettlementEditing');
const {NewDesignError}=require('../dist/server/domain/errors');
const {settlementEditingCreateSchema,settlementEditingDecisionsSchema}=require('../dist/server/http/chapterSettlementEditing/validation');
const {COMPOSITION_TASK_KEYS,COMPOSITION_TASKS}=require('../dist/common/promptComposition');
const {taskSchema:compositionTaskSchema}=require('../dist/server/database/promptComposition/policy');
const session='10000000-0000-4000-8000-000000000001',subject='10000000-0000-4000-8000-000000000002';
const valid={expectedSessionRevision:1,requestKey:'test-original-request',draft:{category:'character_state',title:'修为提升',subjectKind:'card',subjectId:subject,
  stateKey:'cultivation',beforeValue:1,afterValue:2,riskLevel:'medium',evidenceStart:0,evidenceEnd:2,evidenceLabel:'原文',reason:'依据正文',specificationHash:'specification',baselineHash:'baseline'}};
async function harness(t,dependencies={}){
  const app=express();app.use(express.json());app.use('/api',chapterSettlementEditingRouter(dependencies));
  app.use((error,_request,response,_next)=>response.status(error.status??500).json({success:false,error:error.message,issues:error.issues,recovery:error.recovery}));
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api`;
}
const post=(url,input)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});

test('production settlement task does not silently gain a composition debug input contract',()=>{
  assert.equal(COMPOSITION_TASK_KEYS.length,6);assert.equal(COMPOSITION_TASKS.length,6);
  assert.equal(compositionTaskSchema.safeParse('chapter_settlement').success,false);
});

test('strict proposal input requires the exact specification and baseline, not raw keys alone',()=>{
  assert.equal(settlementEditingCreateSchema.safeParse(valid).success,true);
  for(const field of ['expectedSessionRevision','requestKey']){
    const input={...valid};delete input[field];assert.equal(settlementEditingCreateSchema.safeParse(input).success,false);
  }
  for(const field of ['specificationHash','baselineHash']){
    const input={...valid,draft:{...valid.draft}};delete input.draft[field];assert.equal(settlementEditingCreateSchema.safeParse(input).success,false);
  }
  assert.equal(settlementEditingCreateSchema.safeParse({...valid,rawSchema:{}}).success,false);
});
test('relation and knowledge object scope is explicit and evidence must have a valid range',()=>{
  assert.equal(settlementEditingCreateSchema.safeParse({...valid,draft:{...valid.draft,category:'relationship'}}).success,false);
  assert.equal(settlementEditingCreateSchema.safeParse({...valid,draft:{...valid.draft,category:'knowledge',holderKind:'character'}}).success,false);
  assert.equal(settlementEditingCreateSchema.safeParse({...valid,draft:{...valid.draft,evidenceEnd:0}}).success,false);
});
test('review decisions require original request and exact item revisions',()=>{
  assert.equal(settlementEditingDecisionsSchema.safeParse({expectedSessionRevision:1,requestKey:'review-original',decisions:[{itemId:subject,expectedRevision:1,decision:'confirm'}]}).success,true);
  assert.equal(settlementEditingDecisionsSchema.safeParse({expectedSessionRevision:1,decisions:[{itemId:subject,decision:'confirm'}]}).success,false);
});
test('HTTP validation identifies Chinese fields, retains input and never invokes the store',async t=>{
  let called=false;const url=await harness(t,{createChapterSettlementEditingItem:async()=>{called=true;throw Error('must not execute');}});
  const response=await post(`${url}/chapter-adoption-sessions/${session}/editing-items`,{...valid,draft:{...valid.draft,title:''}});
  const result=await response.json();assert.equal(response.status,422);assert.equal(called,false);
  assert.equal(result.recovery.failedStep,'保存章节变化提案');assert.match(result.issues['draft.title'],/变化标题/);
  assert.equal(result.recovery.mutationOutcome,'not_written');
  assert.match(result.recovery.savedResult,/未提交保存/);assert.match(result.error,/当前输入保留/);
});
test('unknown mutation is not presented as known failure or silently retried',async t=>{
  let calls=0;const url=await harness(t,{createChapterSettlementEditingItem:async()=>{calls++;throw Error('socket EOF private data');}});
  const response=await post(`${url}/chapter-adoption-sessions/${session}/editing-items`,valid),result=await response.json();
  assert.equal(response.status,503);assert.equal(calls,1);assert.match(result.recovery.savedResult,/尚未确认/);
  assert.equal(result.recovery.mutationOutcome,'unknown');
  assert.match(result.recovery.savedResult,/原请求/);assert.doesNotMatch(result.error,/socket|private/);
});
test('receipt read uses original opaque key and cannot perform a second mutation',async t=>{
  let reads=0,mutations=0;const url=await harness(t,{readChapterSettlementEditingReceipt:async(id,key)=>{reads++;assert.equal(id,session);assert.equal(key,'original-receipt');return null;},
    createChapterSettlementEditingItem:async()=>{mutations++;throw Error('must not run');}});
  const response=await fetch(`${url}/chapter-adoption-sessions/${session}/editing-receipts?requestKey=original-receipt`);
  assert.equal(response.status,200);assert.equal((await response.json()).data,null);assert.equal(reads,1);assert.equal(mutations,0);
});
test('body adoption failure preserves the server source and acknowledged rollback recovery',async t=>{
  const route=`/new-design/books/${subject}/writing?chapterDocument=${subject}&session=${session}`;
  const url=await harness(t,{startChapterAdoptionSession:async()=>{const error=new NewDesignError('采用准备已变化，请重新核对。',409);
    error.recovery={failedStep:'核对采用准备',summary:error.message,savedResult:'已回滚，原正文保留。',sourceRoute:route,actionLabel:'返回章节结算',mutationOutcome:'not_written'};throw error;}});
  const response=await post(`${url}/chapter-adoption-preparations/${session}/sessions`,{expectedRevision:1,idempotencyKey:'original-adoption-request'}),value=await response.json();
  assert.equal(response.status,409);assert.equal(value.recovery.mutationOutcome,'not_written');assert.equal(value.recovery.sourceRoute,route);
});
test('server-generated exact chapter source is preserved without accepting request routes',async t=>{
  const route=`/new-design/books/${subject}/writing?chapterDocument=${subject}&session=${session}`;
  const url=await harness(t,{createChapterSettlementEditingItem:async()=>{const error=new NewDesignError('修为：变化前状态已改变，请核对最新版本。',409,{'draft.afterValue':'请核对修为。'});
    error.recovery={failedStep:'核对修为基线',summary:error.message,savedResult:'旧提案与当前输入保留。',sourceRoute:route,actionLabel:'返回章节结算'};throw error;}});
  const response=await post(`${url}/chapter-adoption-sessions/${session}/editing-items`,valid),result=await response.json();
  assert.equal(response.status,409);assert.equal(result.recovery.sourceRoute,route);assert.equal(result.recovery.failedStep,'核对修为基线');
  const injection=await post(`${url}/chapter-adoption-sessions/${session}/editing-items`,{...valid,sourceRoute:'https://attacker.invalid'});
  assert.equal(injection.status,422);
});
test('legacy writes and arbitrary AI request/result entry cannot bypass the formal editor',async t=>{
  const url=await harness(t);
  for(const suffix of [`chapter-adoption-sessions/${session}/items`,`chapter-adoption-sessions/${session}/decisions`,`chapter-adoption-sessions/${session}/settle`,`books/${subject}/chapter-settlements`]){
    const response=await post(`${url}/${suffix}`,{}),result=await response.json();assert.equal(response.status,409);assert.match(result.recovery.savedResult,/未提交/);assert.equal(result.recovery.mutationOutcome,'not_written');
  }
  for(const suffix of [`chapter-adoption-sessions/${session}/extraction-requests`,`chapter-proposal-extraction-requests/${subject}/result`]){
    const response=await post(`${url}/${suffix}`,{}),result=await response.json();assert.equal(response.status,503);assert.match(result.recovery.savedResult,/模型请求未发送/);
  }
});
test('AI extraction requires exact session/catalog and saved-result import cannot accept replacement output',async t=>{
  const url=await harness(t);
  const extraction=await post(`${url}/chapter-adoption-sessions/${session}/editing/ai-extractions`,{requestKey:'original-ai-request',output:{}}),problem=await extraction.json();
  assert.equal(extraction.status,422);assert.equal(problem.recovery.mutationOutcome,'not_written');assert.match(problem.issues.catalogHash,/正式对象与字段范围/);
  const importing=await post(`${url}/chapter-proposal-extraction-requests/${subject}/import-saved-result`,{output:{items:[]}});
  assert.equal(importing.status,422);assert.equal((await importing.json()).recovery.mutationOutcome,'not_written');
});

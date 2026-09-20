const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyPayoffStatus,savePayoffWindowInputSchema}=require('../dist/common/payoffLedger');

test('only a formal paid_off state classifies a payoff as recovered',()=>{
  assert.equal(classifyPayoffStatus(undefined,1,2,3),'overdue');
  assert.equal(classifyPayoffStatus('planned',1,2,3),'overdue');
  assert.equal(classifyPayoffStatus('paid_off',1,2,3),'paid_off');
});

test('pressure uses only structured bounds and stable chapter progress',()=>{
  assert.equal(classifyPayoffStatus(undefined,null,null,20),'pending');
  assert.equal(classifyPayoffStatus(undefined,null,5,4),'urgent');
  assert.equal(classifyPayoffStatus(undefined,5,7,5),'urgent');
  assert.equal(classifyPayoffStatus(undefined,5,7,8),'overdue');
  assert.equal(classifyPayoffStatus(undefined,null,5,5),'urgent');
});

test('window writes require a version, stable request key, and ordered positive chapters',()=>{
  const base={startChapterOrder:2,endChapterOrder:4,expectedRevision:0,idempotencyKey:'00000000-0000-4000-8000-000000000001'};
  assert.equal(savePayoffWindowInputSchema.safeParse(base).success,true);
  assert.equal(savePayoffWindowInputSchema.safeParse({...base,endChapterOrder:1}).success,false);
  assert.equal(savePayoffWindowInputSchema.safeParse({...base,startChapterOrder:0}).success,false);
  assert.equal(savePayoffWindowInputSchema.safeParse({...base,expectedRevision:-1}).success,false);
  assert.equal(savePayoffWindowInputSchema.safeParse({...base,idempotencyKey:'new-key'}).success,false);
});

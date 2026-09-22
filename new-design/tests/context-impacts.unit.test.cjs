const test=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../dist/server/database/runtime');
const {getContextImpacts}=require('../dist/server/database/contextManagement');

test('context impact queries retain book scope and read card-backed status without writes',async t=>{
  const calls=[];
  t.mock.method(runtime,'getNewDesignPool',async()=>({query:async(sql,parameters)=>{
    calls.push({sql,parameters});
    return {rows:[
      {resource_id:'resource-one',state:'stale',reason:'来源已更新',created_at:new Date('2026-09-22T00:00:00Z')},
      {resource_id:'resource-two',state:'fresh',reason:null,created_at:null},
    ]};
  }}));
  assert.deepEqual(await getContextImpacts({bookId:'book-one',bindingId:'binding-one'}),[
    {resourceId:'resource-one',state:'stale',reason:'来源已更新',createdAt:'2026-09-22T00:00:00.000Z'},
    {resourceId:'resource-two',state:'fresh',reason:'',createdAt:''},
  ]);
  assert.deepEqual(calls[0].parameters,['book-one','context_binding_version','binding-one']);
  assert.match(calls[0].sql,/resource\.book_id=\$1/);
  assert.match(calls[0].sql,/new_design\.card_versions/);
  assert.doesNotMatch(calls[0].sql,/new_design\.(dependency_resource_states|dependency_stale_reasons)|\b(INSERT|UPDATE|DELETE|CREATE|DROP)\b/i);
  await getContextImpacts({bookId:'book-two',previewId:'preview-one'});
  assert.deepEqual(calls[1].parameters,['book-two','context_preview','preview-one']);
});

test('missing context selection rejects before acquiring a database connection',async t=>{
  const connection=t.mock.method(runtime,'getNewDesignPool',async()=>{throw new Error('must not connect');});
  await assert.rejects(getContextImpacts({bookId:'book-one'}),error=>error.status===422);
  assert.equal(connection.mock.callCount(),0);
});

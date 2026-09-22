const {compiled}=require('./support/isolatedDatabase.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {FieldWriteSession,FieldWriteError}=compiled('server/database/fieldExtensions/receipts');
const {NewDesignError}=compiled('server/domain/errors');
test('a lost COMMIT acknowledgement remains unknown even if a later rollback succeeds',async()=>{
 const client={query:async sql=>{if(sql==='COMMIT')throw new Error('ack lost');return{rows:[]};}},write=new FieldWriteSession(client,'book','create','key',{});
 await write.begin();try{await write.commit({id:'result'});assert.fail();}catch(error){await assert.rejects(write.fail(error),failure=>failure.recovery.mutationOutcome==='unknown');}
});
test('validation failure is not_written only after physically confirmed rollback',async()=>{
 const write=new FieldWriteSession({query:async()=>({rows:[]})},'book','create','key',{});await write.begin();
 await assert.rejects(write.fail(new NewDesignError('stale',409)),failure=>failure.status===409&&failure.recovery.mutationOutcome==='not_written');
 const disconnected=new FieldWriteSession({query:async sql=>{if(sql==='ROLLBACK')throw new Error('lost');return{rows:[]};}},'book','create','key',{});await disconnected.begin();
 await assert.rejects(disconnected.fail(new NewDesignError('stale',409)),failure=>failure.recovery.mutationOutcome==='unknown');
});
test('incomplete historical adoption never substitutes the latest definition as original success',async()=>{
 const calls=[],client={query:async(sql,params)=>{
  if(sql==='BEGIN'||sql==='ROLLBACK'){calls.push(sql);return{rows:[]};}
  if(sql.includes('pg_advisory_xact_lock')){assert.deepEqual(params,['field-write:key']);calls.push('request lock');return{rows:[]};}
  if(sql.includes('FROM new_design.cards card')){
   assert.match(sql,/JOIN new_design\.card_versions version/);
   assert.match(sql,/type\.type_key=\$1/);
   assert.deepEqual(params.slice(0,3),['field_scope_adoption',null,false]);
   assert.deepEqual(JSON.parse(params[3]),{idempotency_key:'key'});
   calls.push('historical adoption');
   return{rows:[{id:'adoption-card',space_id:'space',status:'active',revision:1,created_at:'2026-09-22T00:00:00.000Z',updated_at:'2026-09-22T00:00:00.000Z',values:{id:'adoption',field_definition_id:'field',to_version_id:'version',idempotency_key:'key',impact:{}}}]};
  }
  if(sql.startsWith('SELECT book.id FROM new_design.books book JOIN new_design.field_definitions definition')){
   assert.deepEqual(params,['field']);calls.push('book ownership');return{rows:[{id:'book'}]};
  }
  throw new Error(`Unexpected query: ${sql}`);
 }},write=new FieldWriteSession(client,'book','create','key',{});
 let historicalError;
 await assert.rejects(write.begin(),error=>{
  assert.ok(error instanceof FieldWriteError);
  assert.equal(error.status,409);
  assert.match(error.message,/原请求缺少完整输入与当次结果回执/);
  assert.equal(error.recovery.mutationOutcome,'unknown');
  historicalError=error;return true;
 });
 await assert.rejects(write.fail(historicalError),error=>error===historicalError&&error.recovery.mutationOutcome==='unknown');
 assert.deepEqual(calls,['BEGIN','request lock','historical adoption','book ownership','ROLLBACK']);
});

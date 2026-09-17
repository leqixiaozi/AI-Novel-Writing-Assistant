const {test}=require('node:test'),assert=require('node:assert/strict');
const {FieldWriteSession}=require('../dist/server/database/fieldExtensions/receipts');
const {NewDesignError}=require('../dist/server/domain/errors');
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
 const client={query:async sql=>({rows:sql.includes('field_scope_adoptions')?[{book_id:'book',field_definition_id:'field',to_version_id:'version',impact:{}}]:[]})},write=new FieldWriteSession(client,'book','create','key',{});
 try{await write.begin();assert.fail();}catch(error){await assert.rejects(write.fail(error),failure=>failure.recovery.mutationOutcome==='unknown');}
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizedRecord,assertHubMirror,mergedTopicValues,appendUpgradeVersion,defaultSpace}=require('../scripts/card-kernel-upgrade-records.cjs');

const id=n=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const createdAt='2026-09-22T01:02:03.000Z';
const updatedAt='2026-09-22T04:05:06.000Z';
test('normalization and topic merge append distinct immutable versions for the same record',async()=>{
 const inserts=[],updates=[];let revision=1;
 const db={query:async(sql,args)=>{
  if(sql.startsWith('SELECT coalesce(max(revision)'))return{rows:[{value:++revision}]};
  if(sql.startsWith('INSERT INTO new_design.card_versions')){inserts.push(args);return{rows:[]};}
  if(sql.startsWith('UPDATE new_design.cards SET')){updates.push(args);return{rows:[]};}
  throw Error('Unexpected mutation');
 }};
 const row={id:id(90),type_version_id:id(91),title:'handler'};
 await appendUpgradeVersion(db,row,{id:id(90)});
 await appendUpgradeVersion(db,row,{id:id(90),payload_contract:{referenceOnly:true}});
 assert.equal(new Set(inserts.map(args=>args[0])).size,2);
 assert.deepEqual(inserts.map(args=>args[2]),[2,3]);
 assert.equal(updates.length,2);assert.equal(row.current_version_id,inserts[1][0]);
});
function source(values,patch={}){
 return{id:id(90),type_key:'legacy.fixture_records',space_id:defaultSpace,values:structuredClone(values),current_values:values,...patch};
}
function freeze(value){
 if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}
 return value;
}

test('normalization preserves logical identity, business references and every payload value',()=>{
 const payload={id:id(1),card_id:id(2),space_id:id(3),status:'archived',revision:9,created_at:createdAt,updated_at:updatedAt,nested:{content:'完整原文\n保留空白 ',empty:null,ids:[id(4)]},__legacy_table:'fixture_records',__legacy_identity:{id:id(1)}};
 const row=freeze(source(payload)),before=structuredClone(row);
 const result=normalizedRecord(row,new Map());
 assert.equal(result.values.id,id(1));assert.notEqual(result.values.id,row.id);
 assert.equal(result.values.card_id,id(2));assert.equal(result.spaceId,id(3));
 assert.deepEqual(result.values,payload);assert.notEqual(result.values,row.current_values);
 assert.deepEqual(row,before);
});

test('records without a logical ID retain the stable physical source ID without new identity generation',()=>{
 const row=freeze(source({resource_id:id(3),book_id:id(4),state:'fresh',revision:7,last_event_id:null,updated_at:updatedAt}));
 const books=new Map([[id(4),id(5)]]),before=structuredClone(row);
 const first=normalizedRecord(row,books),second=normalizedRecord(row,books);
 assert.equal(first.values.id,row.id);assert.equal(first.values.resource_id,id(3));
 assert.equal(first.spaceId,id(5));assert.deepEqual(first,second);
 assert.deepEqual(row,before);assert.deepEqual([...books],[[id(4),id(5)]]);
});

test('an explicitly null public logical space stays null while physical ownership remains valid',()=>{
 const row=freeze(source({id:id(1),space_id:null,book_id:null,name:'公共表单',revision:2}));
 const result=normalizedRecord(row,new Map());
 assert.equal(result.values.space_id,null);assert.ok(Object.hasOwn(result.values,'space_id'));
 assert.equal(result.spaceId,defaultSpace);assert.equal(row.values.space_id,null);
 const owned=normalizedRecord(freeze(source({id:id(1),space_id:null,owner_space_id:id(6)})),new Map());
 assert.equal(owned.spaceId,id(6));assert.equal(owned.values.space_id,null);assert.equal(owned.values.owner_space_id,id(6));
});

test('book-scoped records resolve their exact book space without changing logical scope fields',()=>{
 const books=new Map([[id(10),id(11)]]);
 for(const scope of [{},{space_id:null},{space_id:id(11)},{owner_space_id:id(11)}]){
  const row=freeze(source({id:id(1),book_id:id(10),...scope}));
  const result=normalizedRecord(row,books);
  assert.equal(result.spaceId,id(11));assert.deepEqual(result.values,row.current_values);
 }
});

test('head divergence, invalid identity, absent books and explicit book-space conflicts block normalization',()=>{
 const books=new Map([[id(10),id(11)]]);
 assert.throws(()=>normalizedRecord(source({id:id(1)},{values:{id:id(2)}}),books),/Record head differs from card/);
 assert.throws(()=>normalizedRecord(source({id:'not-a-uuid'}),books),/Record identity is not a UUID/);
 assert.throws(()=>normalizedRecord(source({id:id(1),book_id:id(12)}),books),/Record refers to an absent book/);
 for(const scope of [{space_id:id(12)},{owner_space_id:id(12)},{space_id:null,owner_space_id:id(12)}]){
  assert.throws(()=>normalizedRecord(source({id:id(1),book_id:id(10),...scope}),books),/Record space differs from book/);
 }
});

function hubPair(){
 const binding={kind:'book',bookId:id(3),resource:{cardId:id(4),versionId:id(5)}};
 const legacy=source({id:id(1),title:'原对话',status:'active',revision:4,binding,created_at:createdAt,updated_at:updatedAt},{type_key:'legacy.creative_hub_threads'});
 const native={id:id(1),title:'原对话',status:'active',revision:12,current_values:{thread_revision:4,binding:structuredClone(binding)},created_at:new Date(createdAt),updated_at:new Date(updatedAt)};
 return{legacy,native};
}

test('matching native Hub record is reused by business revision rather than the kernel revision',()=>{
 const {legacy,native}=hubPair(),before=structuredClone({legacy,native});
 freeze(legacy);freeze(native);
 assert.doesNotThrow(()=>assertHubMirror(legacy,native));
 assert.deepEqual({legacy,native},before);
 const fallback=structuredClone(native);delete fallback.current_values.thread_revision;fallback.revision=4;
 assert.doesNotThrow(()=>assertHubMirror(legacy,fallback));
});

test('native Hub identity, title, status, business revision, binding and timestamp conflicts are rejected',()=>{
 const {legacy,native}=hubPair();
 const patches=[{id:id(2)},{title:'另一段对话'},{status:'archived'},{current_values:{...native.current_values,thread_revision:5}},{current_values:{...native.current_values,binding:{kind:'unbound'}}},{created_at:'2026-09-22T01:02:04.000Z'},{updated_at:'2026-09-22T04:05:07.000Z'},{created_at:'invalid'}];
 for(const patch of patches)assert.throws(()=>assertHubMirror(legacy,{...native,...patch}),/Creative Hub source and native mirror differ/);
 assert.throws(()=>assertHubMirror(legacy,null),/Creative Hub source and native mirror differ/);
});

test('Hub reuse must not accept different PostgreSQL timestamps merely because they share a millisecond',()=>{
 const {legacy,native}=hubPair();
 legacy.current_values.updated_at='2026-09-22T04:05:06.123456Z';
 native.updated_at='2026-09-22T04:05:06.123457Z';
 assert.throws(()=>assertHubMirror(legacy,native),/Creative Hub source and native mirror differ/);
});

function topicPair(){
 return{
  topic:source({topic:'fixture.requested',event_version:1,status:'active',payload_contract:{referenceOnly:true,required:['requestId']},description:'原主题合同',created_at:createdAt},{type_key:'legacy.outbox_event_topics'}),
  handler:source({id:id(20),handler_key:'fixture.handler',topic:'fixture.requested',event_version:1,status:'active',default_lease_ms:30000,max_attempts:2},{id:id(21),type_key:'legacy.background_job_handlers'}),
 };
}

test('topic merge preserves handler logical identity and operational payload while retaining exact topic contract',()=>{
 const {topic,handler}=topicPair(),before=structuredClone({topic,handler});
 freeze(topic);freeze(handler);
 const result=mergedTopicValues(topic,handler);
 assert.deepEqual(result,{...handler.current_values,payload_contract:topic.current_values.payload_contract,description:'原主题合同',topic_created_at:createdAt});
 assert.equal(result.id,id(20));assert.notEqual(result.id,handler.id);
 assert.deepEqual({topic,handler},before);
 const withoutId=structuredClone(handler);delete withoutId.current_values.id;
 assert.equal(mergedTopicValues(topic,withoutId).id,handler.id);
});

test('an already-matching topic contract merges without changing its contents',()=>{
 const {topic,handler}=topicPair();
 handler.current_values={...handler.current_values,payload_contract:structuredClone(topic.current_values.payload_contract),description:topic.current_values.description,topic_created_at:createdAt};
 assert.deepEqual(mergedTopicValues(topic,handler),handler.current_values);
});

test('topic identity, event version and status mismatches block merge',()=>{
 const {topic,handler}=topicPair();
 for(const patch of [{topic:'other.requested'},{event_version:2},{status:'disabled'}]){
  assert.throws(()=>mergedTopicValues(topic,{...handler,current_values:{...handler.current_values,...patch}}),/Outbox topic and handler contract differ/);
 }
});

test('existing conflicting or explicitly null topic contracts cannot be overwritten',()=>{
 const {topic,handler}=topicPair();
 for(const patch of [{payload_contract:{referenceOnly:false}},{payload_contract:null},{description:'另一份主题描述'},{description:null}]){
  assert.throws(()=>mergedTopicValues(topic,{...handler,current_values:{...handler.current_values,...patch}}),/Handler already contains a different topic contract/);
 }
});

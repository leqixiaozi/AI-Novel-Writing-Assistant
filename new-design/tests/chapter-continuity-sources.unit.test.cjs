const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {readChapterContinuitySources}=require('./support/isolatedDatabase.cjs').compiled('server/database/chapterProduction/continuitySources');
const book='69000000-0000-4000-8000-000000000001',space='69000000-0000-4000-8000-000000000002',chapter='69000000-0000-4000-8000-000000000003';
const id='69000000-0000-4000-8000-000000000004',version='69000000-0000-4000-8000-000000000005';
function client(respond=()=>[]){return {async query(sql,values){
 if(sql.includes('SELECT document.id,document.logical_order,book.space_id'))return {rows:[{id:chapter,logical_order:2,space_id:space}]};
 return {rows:respond(sql,values)};
}};}
test('continuity first chapter has no manufactured facts or previous chapter',async()=>{
 const result=await readChapterContinuitySources(client(),book,chapter);assert.deepEqual(result.sources,[]);assert.match(result.notes[0],/没有前章正文/);
});
test('continuity initial state keeps original source hash separate from metadata hash',async()=>{
 const formalHash='a'.repeat(64),source=client(sql=>{
  if(sql.includes('SELECT * FROM new_design.current_state_projections'))return [{subject_kind:'card',subject_id:id,state_key:'energy',value_json:0,source_initial_version_id:version,source_state_change_id:null,is_stale:false,projection_revision:1}];
  if(sql.includes('SELECT card.id,card.title'))return [{id,title:'主角',current_version_id:version,values:{},revision:1}];
  if(sql.includes('FROM new_design.entity_initial_states initial'))return [{initial:{id,book_id:book,current_version_id:version},version:{id:version,value_json:0,value_hash:formalHash,source_fact_id:null}}];
  if(sql.includes('resolve_dependency_resource'))return [{resolved_book_id:book,resolved_space_id:space,resolved_hash:formalHash}];
  return [];
 });
 const result=await readChapterContinuitySources(source,book,chapter);assert.equal(result.sources[0].type,'entity_initial_state');assert.equal(result.sources[0].versionId,version);assert.equal(result.sources[0].hash,formalHash);assert.notEqual(result.sources[0].content.metadataHash,formalHash);assert.equal(result.sources[0].content.version.value_json,0);assert.match(result.sources[0].content.meaning,/不是章节已结算事实/);
});
test('continuity over-limit and stale original sources reject rather than truncate/cache',async()=>{
 await assert.rejects(()=>readChapterContinuitySources(client(sql=>sql.includes('SELECT * FROM new_design.canonical_facts')?Array.from({length:301},()=>({id})):[]),book,chapter),error=>error.status===422);
 await assert.rejects(()=>readChapterContinuitySources(client(sql=>sql.includes('SELECT * FROM new_design.current_state_projections')?[{is_stale:true}]:[]),book,chapter),error=>error.status===409&&/原来源已失效/.test(error.message));
});
test('continuity unstabilized adjacent chapter never substitutes an older stable chapter',async()=>{
 const queries=[],source=client(sql=>{queries.push(sql);return sql.includes('logical_order<$2')?[{id,title:'第二章',adopted_version_id:version,logical_order:1}]:[];});
 const result=await readChapterContinuitySources(source,book,chapter);assert.deepEqual(result.sources,[]);assert.match(result.notes[0],/尚未稳定结算/);assert.equal(queries.filter(sql=>sql.includes('logical_order<$2')).length,1);
});

test('continuity retained state uses full merged confirmation membership, never a replacement settlement id',async()=>{
 const {createHash}=require('node:crypto'),stateId='69000000-0000-4000-8000-000000000006',oldSettlement='69000000-0000-4000-8000-000000000007',newSettlement='69000000-0000-4000-8000-000000000008',checkpoint='69000000-0000-4000-8000-000000000009',text='第一章原正文';
 const stateIds=[stateId],source=client(sql=>{
  if(sql.includes('SELECT * FROM new_design.current_state_projections'))return [{subject_kind:'card',subject_id:id,state_key:'energy',value_json:1,source_initial_version_id:null,source_state_change_id:stateId,is_stale:false,projection_revision:1}];
  if(sql.includes('SELECT card.id,card.title'))return [{id,title:'主角',current_version_id:version,values:{},revision:1}];
  if(sql.includes('FROM new_design.state_changes change'))return [{change:{id:stateId,chapter_document_id:id,body_version_id:version,subject_kind:'card',subject_id:id,state_key:'energy',settlement_id:oldSettlement,after_json:1,text_anchor_id:null,cause_event_card_id:null},proposal:{chapter_document_id:id,body_version_id:version,subject_kind:'card',subject_id:id,state_key:'energy',after_json:1}}];
  if(sql.includes('FROM new_design.chapter_body_versions body JOIN'))return [{id:version,chapter_document_id:id,logical_order:1,content:text,content_hash:createHash('sha256').update(text).digest('hex'),checkpoint_id:checkpoint,settlement_id:newSettlement,confirmed_summary:{confirmed:{facts:[],knowledge:[],states:stateIds}}}];
  if(sql.includes('resolve_dependency_resource'))return [{resolved_book_id:book,resolved_space_id:space,resolved_hash:'a'.repeat(64)}];
  return [];
 });
 const result=await readChapterContinuitySources(source,book,chapter);assert.equal(result.sources[0].content.change.settlement_id,oldSettlement);assert.equal(result.sources[0].content.stableCheckpointId,checkpoint);
 stateIds.length=0;await assert.rejects(readChapterContinuitySources(source,book,chapter),error=>error.status===409);
 stateIds.push(stateId,stateId);await assert.rejects(readChapterContinuitySources(source,book,chapter),error=>error.status===409);
});
test('continuity adapter is same-client readonly and uses exact schema/ledger contracts',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../src/server/database/chapterProduction/continuitySources.ts'),'utf8');
 assert.doesNotMatch(code,/getNewDesignPool|\b(?:INSERT\s+INTO|UPDATE\s+new_design|DELETE\s+FROM|DROP\s+TABLE)\b/i);
 assert.match(code,/new_design\.resolve_dependency_resource/);assert.match(code,/hash:sourceHash/);assert.match(code,/metadataHash:stableHash\(content\)/);
 assert.match(code,/document\.adopted_version_id=body\.id/);assert.match(code,/checkpoint\.status='stable'/);assert.match(code,/settlement\.status='committed'/);assert.match(code,/session\.settlement_id=checkpoint\.settlement_id/);assert.match(code,/proposal\.current_version_id=change\.proposal_version_id/);assert.match(code,/version\.card_relation_id=relation\.id/);assert.match(code,/source_card_version_id/);assert.match(code,/sha\(String\(row\.excerpt\)\)!==row\.fragment_hash/);assert.doesNotMatch(code,/adopted_body_version_id|current_state_projection\b|after_value_hash/);
});

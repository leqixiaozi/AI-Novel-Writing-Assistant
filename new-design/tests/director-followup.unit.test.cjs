const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const common=require('../dist/common/directorFollowup');
const {projectAuthorTask}=require('../dist/server/database/authorTasks/projection');
const {withDirectorFollowupPool,getDirectorFollowupWorkspace,getDirectorFollowupDetail}=require('../dist/server/database/directorFollowup');
const id=n=>`84000000-0000-4000-8000-${String(n).padStart(12,'0')}`,bookId=id(1),taskId=id(2);
const source=(patch={})=>({kind:'ai_task',id:taskId,domain:'execution',book_id:bookId,book_name:'守脉者',status:'running',title:'本章候选',updated_at:'2026-09-17T00:00:00.000Z',route:`/new-design/books/${bookId}/writing?chapterDocument=${id(3)}`,progress:null,meta:{saved:false,requestKey:id(4),leaseExpired:true,stage:'generate_candidate',error_summary:'PRIVATE SQL',providerOutput:{content:'PRIVATE BODY'}},...patch});
const book=(patch={})=>({id:bookId,name:'守脉者',revision:3,status:'active',updated_at:'2026-09-17T00:00:00.000Z',tasks_total:'4',tasks_running:'1',tasks_failed:'1',tasks_waiting:'1',directors_total:'2',directors_running:'1',directors_paused:'1',directors_recovery:'0',quality_total:'3',quality_unresolved:'2',quality_debt:'1',quality_stale:'1',...patch});
function fixture(handler=()=>undefined){
 const sql=[],args=[],state={connected:0,released:0,escaped:0};
 const client={query:async(statement,input=[])=>{sql.push(statement);args.push(input);const custom=handler(statement,input);if(custom!==undefined)return{rows:custom};if(/^(BEGIN|COMMIT|ROLLBACK)/.test(statement))return{rows:[]};if(statement.startsWith('SELECT book.id'))return{rows:[book()]};if(statement.startsWith('SELECT count(*) FROM new_design.books'))return{rows:[{count:'1'}]};if(statement.includes('jsonb_agg(page'))return{rows:[{total:'1',items:[source()]}]};if(statement.startsWith('WITH sources AS'))return{rows:[source()]};throw Error('Unexpected fixture read');},release(){state.released++;}};
 const pool={connect:async()=>{state.connected++;return client;},query:async()=>{state.escaped++;throw Error('Reading outside transaction is forbidden');}};
 return{pool,sql,args,state};
}
test('cross-book filters are strict and bounded without introducing task operations',()=>{
 assert.deepEqual(common.directorFollowupFilterSchema.parse({}),{limit:40,bookStatus:'active'});
 for(const input of [{limit:101},{bookId:'bad'},{bookStatus:'deleted'},{retry:true},{status:'cancel'},{search:'x'.repeat(121)}])assert.equal(common.directorFollowupFilterSchema.safeParse(input).success,false);
});
test('original source navigation rejects cross-book path/query and credentials without inventing a matching item',()=>{
 const record=projectAuthorTask(source());assert.deepEqual(common.followupSourceNavigation(record),{...record.source,available:true});
 for(const route of [`/new-design/books/${id(9)}/writing`,`/new-design/research?book=${id(9)}`,`/new-design/research?bookId=${id(9)}`,'https://example.com','/new-design/books?token=private','/new-design/books#execute']){
  const result=common.followupSourceNavigation({...record,source:{route,label:'原来源',exact:true}});assert.equal(result.available,false);assert.equal(result.exact,false);assert.equal(result.route,'/new-design/structure/maintenance');
 }
 const unresolved=common.followupSourceNavigation({...record,source:{route:'/new-design/operations/records',label:'按原名称核对',exact:false}});assert.equal(unresolved.exact,false);
});
test('workspace reuses original task projections in one read-only snapshot and reports record counts, not completion',async()=>{
 const f=fixture(),result=await withDirectorFollowupPool(f.pool,()=>getDirectorFollowupWorkspace({bookId,domain:'execution'}));
 assert.equal(result.selectedBook.id,bookId);assert.equal(result.books[0].name,'守脉者');assert.equal(result.records.items[0].id,`ai_task:${taskId}`);assert.equal(result.records.items[0].status,'unknown');assert.equal(result.batchRecovery.enabled,false);assert.match(result.batchRecovery.reason,/逐项原回执/);assert.equal(result.books[0].tasks.total,4);assert.equal(result.books[0].directors.total,2);assert.equal(result.books[0].quality.debt,1);
 assert.equal(f.sql[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.sql.at(-1),'COMMIT');assert.equal(f.state.connected,1);assert.equal(f.state.released,1);assert.equal(f.state.escaped,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 for(const statement of f.sql)assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|FOR UPDATE)\b/i);
 const taskQuery=f.sql.findIndex(statement=>statement.includes('jsonb_agg(page'));assert.equal(f.args[taskQuery][0],bookId);assert.equal(f.args[taskQuery][1],'execution');
});
test('missing selected book does not choose another book and read failure carries no mutation proof',async()=>{
 const f=fixture((sql,args)=>sql.startsWith('SELECT book.id')&&sql.includes('WHERE book.id=$1')?[]:undefined);
 await assert.rejects(()=>withDirectorFollowupPool(f.pool,()=>getDirectorFollowupWorkspace({bookId})),error=>{assert.equal(error.status,404);assert.match(error.message,/不选择其他书/);assert.equal(error.recovery.failedStep,'读取跨书导演汇总');assert.equal(error.recovery.mutationOutcome,undefined);assert.equal(error.recovery.actionLabel,'返回导演总控台');return true;});
 assert.equal(f.sql.at(-1),'ROLLBACK');assert.equal(f.state.released,1);
});
test('book directory truncation is explicit, while an exact selected book outside it remains separately readable',async()=>{
 const selected=id(250),rows=Array.from({length:101},(_,index)=>book({id:id(index+10)})),f=fixture((sql,args)=>{if(sql.startsWith('SELECT book.id'))return sql.includes('WHERE book.id=$1')?[book({id:args[0],name:'目录外的原书'})]:rows;if(sql.startsWith('SELECT count(*)'))return[{count:'250'}];if(sql.includes('jsonb_agg(page'))return[{total:'0',items:[]}];});
 const result=await withDirectorFollowupPool(f.pool,()=>getDirectorFollowupWorkspace({bookId:selected}));assert.equal(result.books.length,100);assert.equal(result.booksTotal,250);assert.equal(result.booksTruncated,true);assert.equal(result.selectedBook.id,selected);assert.equal(result.selectedBook.name,'目录外的原书');
});
test('task detail uses exact original version hashes and retains expired-lease uncertainty',async()=>{
 const hashes={contract:'a'.repeat(64),manifest:'b'.repeat(64),snapshot:'c'.repeat(64),recipe:'d'.repeat(64)},f=fixture(sql=>{if(sql.startsWith('SELECT task.book_id'))return[{book_id:bookId,task_contract_version_id:id(5),contract_id:id(6),content_hash:hashes.contract,version:2}];if(sql.startsWith('SELECT step.id'))return[{id:id(7),step_key:'generate_candidate',status:'running',revision:4,current_attempt_id:id(8),lease_expired:true,attempt_status:'running',error_category:'unknown',context_manifest_id:id(10),model_route_snapshot_id:id(11),prompt_recipe_version_id:id(12),result_version_id:null,manifest_hash:hashes.manifest,snapshot_hash:hashes.snapshot,recipe_hash:hashes.recipe}];});
 const result=await withDirectorFollowupPool(f.pool,()=>getDirectorFollowupDetail('ai_task',taskId));assert.equal(result.record.id,`ai_task:${taskId}`);assert.equal(result.book.id,bookId);assert.equal(result.steps[0].leaseExpired,true);assert.equal(result.batchRecovery.enabled,false);assert.match(result.notes.join(' '),/不证明模型未发送/);
 assert.equal(result.anchors.find(a=>a.label==='正式任务合同 v2').hash,hashes.contract);assert.equal(result.anchors.find(a=>a.stableId===id(10)).hash,hashes.manifest);assert.equal(result.anchors.find(a=>a.stableId===id(11)).hash,hashes.snapshot);assert.equal(result.anchors.find(a=>a.stableId===id(12)).hash,hashes.recipe);
 const q=f.sql.findIndex(sql=>sql.startsWith('SELECT step.id'));assert.deepEqual(f.args[q],[taskId,bookId,id(5)]);assert.match(f.sql[q],/manifest\.book_id IS NOT DISTINCT FROM \$2::uuid/);assert.match(f.sql[q],/snapshot\.book_id IS NOT DISTINCT FROM \$2::uuid/);assert.match(f.sql[q],/attempt\.task_contract_version_id=\$3::uuid/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('bounded step details mark incomplete display and never imply full frozen input',async()=>{
 const f=fixture(sql=>{if(sql.startsWith('SELECT task.book_id'))return[{book_id:bookId,task_contract_version_id:id(5),contract_id:id(6),content_hash:'a'.repeat(64),version:1}];if(sql.startsWith('SELECT step.id'))return Array.from({length:101},(_,index)=>({id:id(index+100),step_key:'history',status:'succeeded',revision:1,current_attempt_id:null}));});
 const result=await withDirectorFollowupPool(f.pool,()=>getDirectorFollowupDetail('ai_task',taskId));assert.equal(result.steps.length,100);assert.equal(result.stepsTruncated,true);assert.match(result.notes.join(' '),/不是全量冻结输入/);
});
test('quality detail preserves unavailable original scope and distinguishes detection-snapshot hash from material version content',async()=>{
 const f=fixture(sql=>{if(sql.startsWith('WITH sources AS'))return[source({kind:'quality_issue',domain:'quality',status:'warning',meta:{saved:true,qualityDebt:true},route:`/new-design/books/${bookId}/views?view=quality`})];if(sql.startsWith('SELECT issue.book_id'))return[{book_id:bookId,current_version_id:id(20),current_status:'open',revision:2,version:1,report_id:id(21),stale_at:null}];if(sql.startsWith('SELECT binding.chapter_document_id'))return[{chapter_document_id:id(22),body_version_id:id(23),content_hash:null,archived_at:null,adopted_version_id:null}];if(sql.startsWith('SELECT binding.planning_object_id'))return[];if(sql.startsWith('SELECT binding.subject_kind'))return[{subject_kind:'relation',subject_id:id(24),card_version_id:null,relation_version_id:id(25),snapshot_hash:'e'.repeat(64),available_version_id:id(25),current_version_id:id(26),status:'active'}];});
 const result=await withDirectorFollowupPool(f.pool,()=>getDirectorFollowupDetail('quality_issue',taskId)),unavailable=result.anchors.find(a=>a.stableId===id(22)),material=result.anchors.find(a=>a.stableId===id(24));assert.equal(unavailable.versionId,id(23));assert.equal(unavailable.hash,null);assert.match(unavailable.stateLabel,/不可用/);assert.equal(material.versionId,id(25));assert.equal(material.hash,'e'.repeat(64));assert.match(material.label,/检测范围校验值/);assert.match(material.stateLabel,/不是新版本结论/);
 const sql=f.sql.find(sql=>sql.startsWith('SELECT binding.subject_kind'));assert.match(sql,/relation_version\.card_relation_id=relation\.id/);assert.match(sql,/relation\.space_id=book\.space_id/);assert.doesNotMatch(sql,/card\.book_id|relation\.book_id|card_version\.content_hash|relation_version\.content_hash/);assert.match(result.notes.join(' '),/完整问题范围请回原质量来源/);
});
test('actual HTTP and page consumers expose reads and original navigation only, with explicit missing capabilities',()=>{
 const read=rel=>fs.readFileSync(path.join(__dirname,'../src',rel),'utf8'),http=read('server/http/directorFollowup/index.ts'),ui=read('client/directorFollowup/index.tsx'),application=read('server/application/directorFollowup/index.ts');
 assert.match(http,/router\.get\('\/workspace'/);assert.match(http,/router\.get\('\/records\/:kind\/:id'/);assert.doesNotMatch(http,/router\.(?:post|put|patch|delete)\(/);assert.doesNotMatch(ui,/api\.(?:retry|recover|cancel|adopt|run|create|archive)/);assert.match(ui,/不证明任务未提交或模型未调用/);assert.match(ui,/保留原详情与恢复来源，不自动切换另一条/);assert.match(ui,/目录状态仅控制/);assert.match(application,/getDirectorFollowupWorkspace,getDirectorFollowupDetail/);assert.doesNotMatch(application,/provider|modelManagement|runPrompt|execute/);
});

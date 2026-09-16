const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {projectAuthorTask}=require("../dist/server/database/authorTasks/projection");
const {authorTaskFilterSchema,listAuthorTasks,getAuthorTask,withAuthorTasksPool}=require("../dist/server/database/authorTasks");
const {isAuthorTaskSourceRoute}=require("../dist/common/authorTasks");
const id="79000000-0000-4000-8000-000000000001",bookId="79000000-0000-4000-8000-000000000002";
function row(patch={}){return{kind:"creation_batch",id,domain:"creation",book_id:null,book_name:null,status:"review",title:"开书候选",updated_at:"2026-09-16T00:00:00.000Z",route:`/new-design/books/new?session=${id}`,progress:null,meta:{saved:true,requestKey:"original-request-key",stage:"world"},...patch};}
test("projection retains exact source and public proofs without raw error or output",()=>{
 const r=projectAuthorTask(row({status:"failed",meta:{saved:true,stage:"world",resultId:id,error_message:"SQL-private-secret",providerOutput:{private:"reply"}}}));
 assert.equal(r.status,"attention");assert.equal(r.failedStep,"准备世界设定");assert.match(r.retainedResult,/保存结果/);assert.ok(r.proofs.some(proof=>proof.label==="保存版本"&&proof.id===id));assert.doesNotMatch(JSON.stringify(r),/SQL-private-secret|providerOutput|reply/);
});
test("expired running lease projects unknown without output and review with saved output, never mutates source state",()=>{
 for(const saved of [false,true]){const source=row({status:"running",meta:{saved,leaseExpired:true}}),r=projectAuthorTask(source);assert.equal(r.status,saved?"review":"unknown");assert.equal(source.status,"running");}
});
test("quality debt is a warning rather than global failure, including manual-origin issues",()=>{
 const r=projectAuthorTask(row({kind:"quality_issue",domain:"quality",status:"warning",meta:{saved:true,qualityDebt:true,manual:true}}));
 assert.equal(r.status,"warning");assert.equal(r.failedStep,null);assert.ok(r.tags.includes("quality_debt"));assert.ok(r.tags.includes("manual"));assert.match(r.retainedResult,/不代表整书运行失败/);
});
test("released saved output and ended-unknown receipts retain distinct true outcomes",()=>{
 const released=projectAuthorTask(row({status:"released",meta:{saved:true,failure:true}}));assert.equal(released.status,"ended");assert.ok(released.tags.includes("saved"));
 const unknown=projectAuthorTask(row({status:"ended_unknown",meta:{saved:false,failure:true,requestKey:"original-key"}}));assert.equal(unknown.status,"unknown");assert.match(unknown.recoveryGuidance,/原请求.*只读/);assert.match(unknown.retainedResult,/不.*推断模型未发送/);assert.equal(unknown.requestKey,"original-key");
 const superseded=projectAuthorTask(row({meta:{saved:true,superseded:true}}));assert.equal(superseded.status,"ended");assert.match(superseded.recoveryGuidance,/阶段历史/);
});
test("navigation guards external, protocol-relative and escaped sources; unresolved source stays truthful",()=>{
 for(const route of ["https://example.com/secret","//example.com/new-design/books","/new-design/\\evil","/new-design/%2f%2fevil","/new-design/books\n"]){assert.equal(isAuthorTaskSourceRoute(route),false);const r=projectAuthorTask(row({route}));assert.equal(r.source.route,"/new-design/structure/maintenance");assert.equal(r.source.exact,false);}
 assert.equal(isAuthorTaskSourceRoute(`/new-design/books/${bookId}/writing?chapterDocument=${id}&session=${id}`),true);
 const r=projectAuthorTask(row({meta:{saved:true,exact:false}}));assert.equal(r.source.exact,false);assert.match(r.consequence,/仅导航/);
});
test("filters are bounded and strict, with invalid cursor rejected before any database read",async()=>{
 for(const invalid of [{limit:101},{limit:0},{domain:"retry"},{status:"cancel"},{tag:"archive"},{search:"x".repeat(121)},{retry:true},{model:{}}])assert.equal(authorTaskFilterSchema.safeParse(invalid).success,false);
 let calls=0;await assert.rejects(()=>withAuthorTasksPool({query:async()=>{calls++;throw Error("unexpected");}},()=>listAuthorTasks({cursor:"bad-cursor"})),/分页凭证无效/);assert.equal(calls,0);
});
test("aggregate and detail perform SELECT only and return persisted source identity, never mutate",async()=>{
 const statements=[],fixture=row();const pool={query:async(sql,args)=>{statements.push({sql,args});return{rows:sql.includes("jsonb_agg(page")?[{total:"1",items:[fixture]}]:[fixture]};}};
 const page=await withAuthorTasksPool(pool,()=>listAuthorTasks({domain:"creation",tag:"saved",limit:1}));assert.equal(page.total,1);assert.equal(page.items[0].id,`creation_batch:${id}`);assert.equal(page.nextCursor,null);
 assert.equal((await withAuthorTasksPool(pool,()=>getAuthorTask("creation_batch",id))).source.route,fixture.route);
 assert.equal(statements.length,2);for(const {sql} of statements)assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|TRUNCATE|FOR UPDATE)\b/i);
 assert.equal(statements[0].args.at(-1),2);assert.match(statements[0].sql,/LIMIT \$9/);assert.match(statements[0].sql,/sources\.book_id=\$1/);
});
test("source SQL uses official records, omits duplicated execution entries and excludes raw technical payloads",()=>{
 const sql=fs.readFileSync(path.join(__dirname,"../src/server/database/authorTasks/sourceQuery.ts"),"utf8");
 for(const table of ["ai_tasks","book_creation_sessions","planning_objects","chapter_adoption_sessions","research_record_versions","publication_export_artifacts","quality_issues"])assert.ok(sql.includes(`new_design.${table}`));
 assert.match(sql,/WHERE r.ai_task_id=task.id/);assert.doesNotMatch(sql,/error_summary|error_message|last_error|storage_locator|credential|input_snapshot|providerOutput/i);
 const ui=fs.readFileSync(path.join(__dirname,"../src/client/authorTasks/index.tsx"),"utf8");assert.doesNotMatch(ui,/api\.(?:retry|continue|cancel|archive|recover|adopt|create)/);assert.match(ui,/role="alert"/);assert.match(ui,/aria-pressed=/);
});
test("composite pagination retains database microseconds rather than losing records within a millisecond",async()=>{
 const first=row({cursor_at:"2026-09-16T00:00:00.123456Z"}),second=row({id:bookId});let args;
 const page=await withAuthorTasksPool({query:async()=>({rows:[{total:"2",items:[first,second]}]})},()=>listAuthorTasks({limit:1}));
 assert.equal(JSON.parse(Buffer.from(page.nextCursor,"base64url").toString("utf8")).at,first.cursor_at);
 await withAuthorTasksPool({query:async(_sql,input)=>{args=input;return{rows:[{total:"2",items:[]}]};}},()=>listAuthorTasks({cursor:page.nextCursor}));assert.equal(args[5],first.cursor_at);
});
function director(patch={}){return row({kind:"production_director",domain:"writing",book_id:bookId,status:"running",route:`/new-design/books/${bookId}/director?run=${id}`,progress:50,meta:{saved:true,targetCount:4,candidateCount:2,modelReplyCount:2,ledgerPendingCount:0,replyPendingCount:0,unknownRequestCount:0,warningCount:1,requestKey:id,stage:"production_director",exact:true},...patch});}
test("director progress counts original saved candidates, not adoption or whole-book completion",()=>{
 const r=projectAuthorTask(director({status:"completed"}));assert.equal(r.status,"completed");assert.equal(r.progress,50);assert.ok(r.tags.includes("ai"));assert.ok(r.tags.includes("saved"));assert.ok(r.tags.includes("warning"));assert.match(r.retainedResult,/原冻结范围 4 章/);assert.match(r.retainedResult,/2 个原章候选/);assert.match(r.retainedResult,/不表示已采用、已结算或全书完成/);assert.equal(r.source.route,`/new-design/books/${bookId}/director?run=${id}`);assert.equal(r.source.exact,true);assert.match(r.consequence,/仅导航/);
});
test("director current expired unknown request is not hidden by prior saved chapter candidates",()=>{
 const source=director();source.meta={...source.meta,unknownRequestCount:1,leaseExpired:true};const r=projectAuthorTask(source);assert.equal(r.status,"unknown");assert.ok(r.tags.includes("saved"));assert.ok(r.tags.includes("unknown"));assert.match(r.recoveryGuidance,/其它章候选不证明当前章调用已完成/);assert.equal(source.status,"running");
});
test("director original saved reply and ledger recovery remain review, not a fresh model call",()=>{
 for(const patch of [{replyPendingCount:1},{ledgerPendingCount:1},{boundaryPendingCount:1}]){const source=director({status:"waiting_recovery"});source.meta={...source.meta,...patch};const r=projectAuthorTask(source);assert.equal(r.status,"review");assert.match(r.recoveryGuidance,/原回复.*不在记录中心继续执行/);if(patch.boundaryPendingCount)assert.match(r.retainedResult,/1 个原章边界待确认/);}
 const noReply=director({status:"waiting_recovery"});noReply.meta={...noReply.meta,saved:false,modelReplyCount:0,candidateCount:0};assert.equal(projectAuthorTask(noReply).status,"unknown");
});
test("director readiness, boundary pause and native failure retain source phase",()=>{
 assert.equal(projectAuthorTask(director({status:"ready"})).status,"pending");assert.equal(projectAuthorTask(director({status:"paused"})).status,"review");assert.equal(projectAuthorTask(director({status:"cancelled"})).status,"ended");
 const source=director({status:"failed"});source.meta={...source.meta,failedChapterTitle:"宗门夜雨",error_summary:"private SQL text",controlled_output:{content:"private body",warnings:["private text"]}};const r=projectAuthorTask(source);assert.equal(r.failedStep,"生成“宗门夜雨”的原候选与运行回执");assert.doesNotMatch(JSON.stringify(r),/private|controlled_output/);assert.ok(r.tags.includes("warning"));
});
test("original writing request exposes saved reply and pending receipt without copying body or warnings",()=>{
 const source=row({kind:"writing_request",domain:"writing",status:"running",meta:{saved:true,modelReplySaved:true,candidateSaved:false,warningCount:2,requestKey:id},route:`/new-design/books/${bookId}/writing?chapterDocument=${id}`});let r=projectAuthorTask(source);assert.equal(r.status,"review");assert.match(r.retainedResult,/原模型回复已保存.*入库尚无保存证明/);assert.match(r.retainedResult,/2 条警告/);assert.match(r.recoveryGuidance,/不换新凭证或重发模型/);
 source.meta={...source.meta,candidateSaved:true,ledgerPending:true,resultId:id};r=projectAuthorTask(source);assert.equal(r.status,"review");assert.match(r.retainedResult,/原章候选已保存，运行回执待完成/);assert.ok(r.proofs.some(p=>p.id===id&&p.label==="保存版本"));
});
test("director list/detail stay SELECT-only and source SQL reads original full-range pointers",async()=>{
 const sql=fs.readFileSync(path.join(__dirname,"../src/server/database/authorTasks/sourceQuery.ts"),"utf8"),projection=fs.readFileSync(path.join(__dirname,"../src/server/database/authorTasks/projection.ts"),"utf8"),block=sql.slice(sql.indexOf("SELECT 'production_director'"),sql.indexOf("SELECT 'writing_request'"));
 assert.match(block,/production_director_runs run CROSS JOIN LATERAL/);assert.match(block,/request\.id=chapter\.current_request_id/);assert.match(block,/candidate_count\*100\/summary\.total_count/);assert.match(block,/lease_expires_at<=now\(\)/);assert.doesNotMatch(block,/WHERE run\.status|\brun=\$|error_summary|controlled_output AS|content\b/);assert.match(projection,/unknownRequestCount.*unknown/);
 const fixture=director(),queries=[],pool={query:async(statement)=>{queries.push(statement);return{rows:statement.includes("jsonb_agg(page")?[{total:"1",items:[fixture]}]:[fixture]};}};
 const page=await withAuthorTasksPool(pool,()=>listAuthorTasks({domain:"writing",tag:"warning"}));assert.equal(page.items[0].kind,"production_director");assert.equal((await withAuthorTasksPool(pool,()=>getAuthorTask("production_director",id))).requestKey,id);for(const statement of queries)assert.doesNotMatch(statement,/\b(?:UPDATE|INSERT|DELETE|FOR UPDATE)\b/);
});
test("ended expired director request retains true unknown result and usage from original attempt",()=>{
 const source=director({status:"failed"});source.meta={...source.meta,endedUnknownCount:1};let r=projectAuthorTask(source);assert.equal(r.status,"unknown");assert.ok(r.tags.includes("unknown"));assert.match(r.retainedResult,/原过期运行已结束.*结果及用量仍未知/);assert.match(r.recoveryGuidance,/结束只释放原运行占用/);assert.equal(source.status,"failed");
 source.status="cancelled";r=projectAuthorTask(source);assert.equal(r.status,"ended");assert.ok(r.tags.includes("unknown"));assert.match(r.recoveryGuidance,/记录中心不执行/);
 const writer=row({kind:"writing_request",domain:"writing",status:"cancelled",meta:{saved:false,endedUnknown:true}});r=projectAuthorTask(writer);assert.equal(r.status,"ended");assert.ok(r.tags.includes("unknown"));assert.match(r.retainedResult,/不能认定未发送或已成功/);assert.match(r.recoveryGuidance,/不在记录中心重发/);
 const sql=fs.readFileSync(path.join(__dirname,"../src/server/database/authorTasks/sourceQuery.ts"),"utf8"),projection=fs.readFileSync(path.join(__dirname,"../src/server/database/authorTasks/projection.ts"),"utf8");assert.match(sql,/attempt\.status='discarded' AND attempt\.error_category='unknown'/);assert.match(sql,/attempt\.id=step\.current_attempt_id/);assert.match(projection,/meta->>'endedUnknown'='true'/);assert.doesNotMatch(sql,/error_summary|error_message/);
});

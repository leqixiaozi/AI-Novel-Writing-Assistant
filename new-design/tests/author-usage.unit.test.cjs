const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {authorUsageScope,presentAuthorUsageSummary}=require("../dist/common/authorUsage"),{AI_USAGE_SUMMARY_QUERY,projectAiUsageSummary}=require("../dist/server/database/aiTasks/usageProjection");
const id="76000000-0000-4000-8000-000000000001",bookId="76000000-0000-4000-8000-000000000002";
const record=(patch={})=>({id:`ai_task:${id}`,kind:"ai_task",domain:"execution",status:"running",statusLabel:"进行中",title:"原生成",bookId,bookName:"守脉者",tags:["ai"],updatedAt:"2026-09-17T00:00:00Z",source:{route:`/new-design/books/${bookId}/writing?chapterDocument=${id}`,label:"打开章节来源",exact:true},retainedResult:"原结果保留",failedStep:null,recoveryGuidance:"核对原键",consequence:"导航",progress:null,requestKey:id,proofs:[],...patch});
const row=(patch={})=>({task_count:"2",attempt_count:"2",total_attempt_count:"3",unrecorded_attempt_count:"1",unknown_cost_attempt_count:"2",input_tokens:"10",output_tokens:"20",cached_input_tokens:null,duration_ms:"100",estimated_cost:"0.12000000",currency:"USD",fallback_count:"1",unknown_count:"1",...patch});
test("usage scope is exact native task plus book, or explicitly whole-book, never an accidental global summary",()=>{
 assert.deepEqual(authorUsageScope(record()).filter,{bookId,taskId:id});assert.match(authorUsageScope(record()).label,/此原任务/);
 const director=authorUsageScope(record({kind:"production_director",id:`production_director:${id}`}));assert.deepEqual(director.filter,{bookId});assert.match(director.label,/不是此单条记录或导演范围/);
 assert.deepEqual(authorUsageScope(record({bookId:null})).filter,{taskId:id});
 for(const source of [record({kind:"creation_session",bookId:null}),record({id:"ai_task:bad"}),record({bookId:"bad"}),record({source:{route:"https://private.invalid",label:"external",exact:false}})])assert.equal(authorUsageScope(source),null);
});
test("original ledger projection separates missing usage rows and partial known tokens rather than zero",()=>{
 const summary=projectAiUsageSummary(row()),view=presentAuthorUsageSummary(summary);assert.equal(summary.totalAttemptCount,3);assert.equal(summary.unrecordedAttemptCount,1);assert.equal(summary.unknownUsageCount,1);assert.equal(summary.estimatedCost,.12);assert.equal(view.rows.find(r=>r.label.includes("缓存")).value,"尚无已确认数值");assert.match(view.usageNotice,/2 个原尝试.*不是全部实际用量/);assert.match(view.costNotice,/不能推断总费用/);
});
test("empty actual attempts preserve unknown tokens and prices and never prove no invocation",()=>{
 const summary=projectAiUsageSummary(row({task_count:"1",attempt_count:"0",total_attempt_count:"0",unrecorded_attempt_count:"0",unknown_cost_attempt_count:"0",input_tokens:null,output_tokens:null,duration_ms:null,estimated_cost:null,currency:null,fallback_count:"0",unknown_count:"0"})),view=presentAuthorUsageSummary(summary);assert.equal(summary.inputTokens,null);assert.equal(summary.outputTokens,null);assert.match(view.usageNotice,/空摘要不证明模型没有调用/);assert.match(view.costNotice,/不以零元表示未知/);assert.equal(view.rows.find(r=>r.label.includes("费用估算")).value,"尚无可合并的费用估算");
});
test("recorded real zero is distinct from unknown, no model price lookup or configured success fiction",()=>{
 const summary=projectAiUsageSummary(row({attempt_count:1,total_attempt_count:1,unrecorded_attempt_count:0,unknown_cost_attempt_count:0,input_tokens:0,output_tokens:0,estimated_cost:0,currency:"CNY",unknown_count:0})),view=presentAuthorUsageSummary(summary);assert.equal(view.rows.find(r=>r.label==="已知输入用量（Token）").value,"0");assert.match(view.usageNotice,/配置生效不等于真实模型调用已验收/);assert.match(view.costNotice,/实际费用以服务方账单/);
});
test("malformed or incomplete original counts reject safely without private errors or inferred corrections",()=>{
 for(const patch of [{input_tokens:"private SQL"},{total_attempt_count:9},{unknown_count:3},{unrecorded_attempt_count:-1}])assert.throws(()=>projectAiUsageSummary(row(patch)),error=>!error.message.includes("private"));
 const summary=projectAiUsageSummary(row({currency:"private-currency"}));assert.equal(summary.currency,null);assert.equal(presentAuthorUsageSummary(summary).rows.find(r=>r.label.includes("费用估算")).value,"尚无可合并的费用估算");
 const malformed=projectAiUsageSummary(row());delete malformed.unrecordedAttemptCount;assert.throws(()=>presentAuthorUsageSummary(malformed),/未完整读取/);
});
test("original summary is SELECT-only and joins precise original attempts instead of duplicate billing facts",()=>{
 assert.doesNotMatch(AI_USAGE_SUMMARY_QUERY,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|FOR UPDATE)\b/i);assert.match(AI_USAGE_SUMMARY_QUERY,/ai_task_attempts attempt ON attempt.task_id=task.id/);assert.match(AI_USAGE_SUMMARY_QUERY,/usage.attempt_id=attempt.id AND usage.task_id=task.id/);assert.match(AI_USAGE_SUMMARY_QUERY,/usage.id IS NULL/);assert.match(AI_USAGE_SUMMARY_QUERY,/task.book_id=\$1/);assert.match(AI_USAGE_SUMMARY_QUERY,/task.id=\$2/);assert.doesNotMatch(AI_USAGE_SUMMARY_QUERY,/COALESCE\(sum\(usage.input_tokens\)|model_route_snapshots|budget_policy|price/);
});
test("actual mounted consumer uses original summary API, preserves scope and avoids late overwrite or mutation",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/client/authorUsage/index.tsx"),"utf8"),center=fs.readFileSync(path.join(__dirname,"../src/client/authorTasks/index.tsx"),"utf8");assert.match(center,/<AuthorUsagePanel key=\{detail.id\} record=\{detail\}/);assert.match(source,/newDesignApi.summarizeAiUsage\(input\)/);assert.match(source,/api.summarizeAiUsage\(current.filter\)/);assert.match(source,/token===generation.current/);assert.match(source,/result\?\.scopeKey===scopeKey/);assert.match(source,/role="alert"/);assert.doesNotMatch(source,/api\.(?:retry|resume|continue|cancel|adopt|recover|recordAiAttemptUsage)|fetch\(|probeManaged|executeManaged/);
});

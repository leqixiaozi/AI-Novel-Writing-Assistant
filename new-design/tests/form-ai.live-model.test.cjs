const test=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const runtime=require("../dist/server/database/runtime");

test("configured product model returns a read-only business form observation",{skip:!process.env.FORM_AI_LIVE_API_ROOT,timeout:180000},async t=>{
 const pool=await runtime.getNewDesignPool();t.after(()=>pool.end());
 const row=(await pool.query(`SELECT book.id book_id,card.id card_id,card.card_type_id,card.revision,card.title,card.values,type.current_version_id
   FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id JOIN new_design.card_types type ON type.id=card.card_type_id
   WHERE book.book_key LIKE 'ai_verify_%' AND type.type_key LIKE 'verify_%' AND card.status='active' ORDER BY book.created_at DESC LIMIT 1`)).rows[0];assert.ok(row,"先运行 PostgreSQL/API 定向验收，以免使用作者资料。");
 const before=Number((await pool.query("SELECT count(*) value FROM new_design.card_versions WHERE card_id=$1",[row.card_id])).rows[0].value);
 const response=await fetch(`${process.env.FORM_AI_LIVE_API_ROOT}/books/${row.book_id}/form-ai`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({target:{bookId:row.book_id,cardTypeId:row.card_type_id,cardId:row.card_id,typeVersionId:row.current_version_id,cardRevision:Number(row.revision),formVersionId:null,title:row.title},action:"check",instruction:"检查所给验证资料中的矛盾。仅输出检查意见，说明依据与不确定性，不建议修改。",values:row.values,tagIds:[],fieldKeys:[],idempotencyKey:`live-model-${randomUUID()}`}),signal:AbortSignal.timeout(170000)});
 const result=await response.json();console.log("actual_model_api",response.status,"run_status",result.data?.status,"error",result.data?.error??result.error??null);
 assert.equal(response.status,200);assert.equal(result.data.status,"review",result.data.error??"真实模型未产生可审阅结果");assert.equal(result.data.candidates.length,0);assert.ok(result.data.observations.length);
 assert.equal(Number((await pool.query("SELECT count(*) value FROM new_design.card_versions WHERE card_id=$1",[row.card_id])).rows[0].value),before);
 console.log("actual_model_run",result.data.id,"observations",result.data.observations.length,"official_versions_unchanged",before);
});

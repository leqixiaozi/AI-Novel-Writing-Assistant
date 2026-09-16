const test=require("node:test"),assert=require("node:assert/strict"),express=require("express");
const {authorTasksRouter}=require("../dist/server/http/authorTasks");
async function fixture(run){const calls=[],app=express();app.use(express.json());app.use(authorTasksRouter({listAuthorTasks:async input=>{calls.push(input);return{items:[],total:0,nextCursor:null,readAt:"2026-09-16T00:00:00.000Z"};},getAuthorTask:async()=>{throw new Error("database-secret-SQL");}}));app.use((error,_request,response,_next)=>response.status(error.status||500).json({success:false,error:error.message,recovery:error.recovery}));const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));try{await run(`http://127.0.0.1:${server.address().port}`,calls);}finally{await new Promise(resolve=>server.close(resolve));}}
test("author record endpoints are strictly read-only, including command-shaped HTTP requests",async()=>fixture(async(url,calls)=>{
 const read=await fetch(`${url}/author-tasks?domain=creation&tag=saved&limit=20`);assert.equal(read.status,200);assert.equal(calls.length,1);assert.equal(calls[0].limit,20);
 for(const method of ["POST","PATCH","PUT","DELETE"]){const result=await fetch(`${url}/author-tasks`,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({retry:true})});assert.equal(result.status,405);}assert.equal(calls.length,1);
 for(const query of ["limit=101","domain=retry","tag=archive","continue=true","bookId=invalid"]){const result=await fetch(`${url}/author-tasks?${query}`);assert.equal(result.status,422);}assert.equal(calls.length,1);
}));
test("read failure identifies stage and retained results without SQL or invoking recovery",async()=>fixture(async(url)=>{
 const response=await fetch(`${url}/author-tasks/creation_batch/79000000-0000-4000-8000-000000000001`),body=await response.json();assert.equal(response.status,503);assert.equal(body.recovery.failedStep,"读取运行记录");assert.equal(body.recovery.mutationOutcome,"not_written");assert.match(body.recovery.savedResult,/不改变创作任务/);assert.doesNotMatch(JSON.stringify(body),/database-secret-SQL/);
}));

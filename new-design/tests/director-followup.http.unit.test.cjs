const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),http=require('node:http');
const runtime=require('../dist/server/database/runtime'),{directorFollowupRouter}=require('../dist/server/http/directorFollowup');
test('followup malformed read reports stage and actual return entry before database; task-operation routes do not exist',async()=>{
 let calls=0;const previous=runtime.getNewDesignPool;runtime.getNewDesignPool=async()=>{calls++;throw Error('Database forbidden in validation fixture');};
 const app=express();app.use('/director-followup',directorFollowupRouter());app.use((error,req,res,next)=>res.status(error.status??500).json({success:false,message:error.message,issues:error.issues,recovery:error.recovery}));const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const origin=`http://127.0.0.1:${server.address().port}/director-followup`;for(const route of ['/workspace?bookId=not-a-book','/workspace?retry=true','/records/ai_task/not-an-id']){const response=await fetch(origin+route),body=await response.json();assert.equal(response.status,422);assert.ok(Object.keys(body.issues).length);assert.match(body.recovery.failedStep,/读取/);assert.match(body.recovery.savedResult,/只读查询没有执行恢复或模型调用/);assert.equal(body.recovery.sourceRoute,'/new-design/operations/director');assert.equal(body.recovery.actionLabel,'返回导演总控台');assert.equal(body.recovery.mutationOutcome,undefined);}
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(origin+'/workspace',{method})).status,404);assert.equal(calls,0);
 }finally{runtime.getNewDesignPool=previous;server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});

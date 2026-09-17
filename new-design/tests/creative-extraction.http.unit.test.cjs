const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),http=require('node:http');
const runtime=require('../dist/server/database/runtime');
const {creativeExtractionRouter}=require('../dist/server/http/creativeExtraction');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('creative controlled HTTP validation returns Chinese stage/field/recovery and never reads database or sends model',async()=>{
 let pools=0,calls=0;const previous=runtime.getNewDesignPool;runtime.getNewDesignPool=async()=>{pools++;throw new Error('fixture forbids database');};
 const app=express();app.use(express.json());app.use('/creative-extraction',creativeExtractionRouter({fetcher:async()=>{calls++;throw new Error('fixture forbids model');}}));app.use((error,req,res,next)=>res.status(error.status??500).json({success:false,message:error.message,issues:error.issues,recovery:error.recovery}));
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const origin=`http://127.0.0.1:${server.address().port}/creative-extraction`,response=await fetch(`${origin}/${id(1)}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'adopt_title',requestKey:id(2),previewId:id(1),candidateId:null,expectedPreviewRevision:1,title:'新书名',expectedBookRevision:1,confirm:false})}),body=await response.json();assert.equal(response.status,422);assert.equal(body.recovery.failedStep,'明确保存或采用审阅候选');assert.equal(body.recovery.mutationOutcome,'not_written');assert.match(body.issues.confirm,/明确确认/);assert.equal(body.recovery.sourceRoute,'/new-design/structure/maintenance');assert.equal(body.recovery.actionLabel,'打开运行维护');assert.match(body.recovery.savedResult,/人工填写/);
 const read=await fetch(`${origin}/commands/by-key/x`),readonly=await read.json();assert.equal(read.status,422);assert.equal(readonly.recovery.mutationOutcome,undefined);assert.equal(pools,0);assert.equal(calls,0);
 }finally{runtime.getNewDesignPool=previous;server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});

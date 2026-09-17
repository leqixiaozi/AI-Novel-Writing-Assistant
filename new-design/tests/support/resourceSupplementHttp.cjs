const express=require('express'),{compiled}=require('./isolatedDatabase.cjs');
/** Real router and isolated pool. Only the provider fetcher may be controlled. */
exports.resourceSupplementHttp=async function(t,{runExtraction}={}){
 const app=express();app.use(express.json({limit:'1mb'}));
 if(runExtraction)app.use('/api/new-design',compiled('server/http/chapterSettlementEditing').chapterSettlementEditingRouter({runChapterSettlementAiExtraction:runExtraction}));
 app.use('/api/new-design',compiled('server/http/router').createNewDesignRouter());
 app.use((error,_request,response,_next)=>response.status(error.status??500).json({success:false,error:error.message,issues:error.issues,recovery:error.recovery}));
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`,base=`${origin}/api/new-design`;
 const raw=(method,path,input)=>fetch(`${base}${path}`,{method,...(input===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(input)})});
 const call=async(method,path,input)=>{const response=await raw(method,path,input),envelope=await response.json();if(!response.ok||!envelope.success)throw Object.assign(new Error(envelope.error),{status:response.status,recovery:envelope.recovery});return envelope.data;};
 return {app,server,origin,base,raw,get:path=>call('GET',path),post:(path,input)=>call('POST',path,input),query:input=>`?input=${encodeURIComponent(JSON.stringify(input))}`};
};

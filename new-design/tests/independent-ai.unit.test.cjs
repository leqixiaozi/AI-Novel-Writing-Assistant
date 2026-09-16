const test=require("node:test");
const assert=require("node:assert/strict");
const {createIndependentAiGateway,readModelConfiguration,probeModelConnection,AiExecutionError}=require("../dist/server/ai");
const env={NEW_DESIGN_AI_PROVIDER:"ollama",NEW_DESIGN_AI_MODEL:"controlled-test-model"};
const input={bookName:"测试书",formName:"人物",cardTitle:"人物草稿",currentValues:{},instruction:"准备姓名",fields:[{key:"name",name:"姓名",description:"人物姓名",type:"short_text",required:true,options:[],defaultValue:null,group:"基本信息",order:0}]};

test("independent configuration never borrows old model settings or accepts credentials in URLs",()=>{
 assert.throws(()=>readModelConfiguration({OLLAMA_MODEL:"old-model",API_KEY:"old-secret"}),AiExecutionError);
 assert.throws(()=>readModelConfiguration({...env,NEW_DESIGN_AI_BASE_URL:"http://user:secret@localhost:11434"}),AiExecutionError);
 assert.throws(()=>readModelConfiguration({...env,NEW_DESIGN_AI_BASE_URL:"http://remote.example"}),AiExecutionError);
 assert.throws(()=>readModelConfiguration({...env,NEW_DESIGN_AI_TIMEOUT_MS:"NaN"}),AiExecutionError);
 assert.equal(readModelConfiguration(env).model,"controlled-test-model");
});

test("governed form task sends independent structured schema and returns only validated suggestions",async()=>{
 let calls=0;
 const gateway=createIndependentAiGateway({environment:env,fetcher:async(url,init)=>{calls++;assert.equal(url,"http://127.0.0.1:11434/api/chat");const payload=JSON.parse(init.body);assert.equal(payload.stream,false);assert.equal(payload.format.additionalProperties,false);assert.match(payload.messages[0].content,/系统合同/);return new Response(JSON.stringify({message:{content:JSON.stringify({suggestions:{name:"沈青"}})},prompt_eval_count:10,eval_count:5}),{status:200});}});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});assert.equal(calls,1);
});

test("invalid model output and transport errors identify stages without retrying or leaking provider body",async()=>{
 for(const [response,step] of [[new Response(JSON.stringify({message:{content:"not JSON"}})),"解析创作结果"],[new Response(JSON.stringify({message:{content:JSON.stringify({suggestions:{unknown:"越界"}})}})),"核对创作结果"],[new Response("provider-private-secret",{status:401}),"生成创作候选"]]){
  let calls=0;const gateway=createIndependentAiGateway({environment:env,fetcher:async()=>{calls++;return response;}});
  await assert.rejects(()=>gateway.assistForm(input),error=>{assert.equal(error.recovery.failedStep,step);assert.equal(error.recovery.sourceRoute,"/new-design/structure/models");assert.doesNotMatch(error.message,/provider-private-secret/);return true;});assert.equal(calls,1);
 }
});

test("connection probe checks explicit model identity, not automatic first-model selection",async()=>{
 const config=readModelConfiguration(env);
 assert.equal((await probeModelConnection(config,async()=>new Response(JSON.stringify({models:[{name:config.model}]})))).modelFound,true);
 await assert.rejects(()=>probeModelConnection(config,async()=>new Response(JSON.stringify({models:[{name:"other-model"}]}))),error=>error.recovery.failedStep==="核对创作模型");
});

test("compatible transport preserves optional field schema and still enforces local strict output validation",async()=>{
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"openai-compatible",NEW_DESIGN_AI_BASE_URL:"http://127.0.0.1:11434/v1"},fetcher:async(url,init)=>{assert.equal(url,"http://127.0.0.1:11434/v1/chat/completions");const payload=JSON.parse(init.body);assert.equal(payload.response_format.type,"json_schema");assert.equal(payload.response_format.json_schema.strict,false);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({suggestions:{name:"沈青"}})}}]}));}});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

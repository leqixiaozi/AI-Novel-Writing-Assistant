const test=require("node:test");
const assert=require("node:assert/strict");
const {createIndependentAiGateway,readModelConfiguration,probeModelConnection,AiExecutionError}=require("../dist/server/ai");
const {embeddingConnectionInputSchema}=require("../dist/server/database/modelManagement");
const {createModelRequest,normalizeModelResponse,normalizeModelCatalog}=require("../dist/server/ai/runtime/transport");
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

test("MiniMax official endpoint separates reasoning so structured creative output remains parseable",async()=>{
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"openai-compatible",NEW_DESIGN_AI_BASE_URL:"https://api.minimax.cn/v1",NEW_DESIGN_AI_MODEL:"MiniMax-M3",NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(url,init)=>{
  assert.equal(url,"https://api.minimax.cn/v1/chat/completions");
  const payload=JSON.parse(init.body);
  assert.equal(payload.reasoning_split,true);
  assert.deepEqual(payload.thinking,{type:"disabled"});
  assert.equal(payload.response_format,undefined);
  assert.equal(payload.tool_choice.function.name,"submit_creative_result");
  return new Response(JSON.stringify({choices:[{message:{reasoning_details:[{text:"private reasoning"}],content:null,tool_calls:[{type:"function",function:{name:"submit_creative_result",arguments:JSON.stringify({suggestions:{name:"沈青"}})}}]}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
 }});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

test("official DeepSeek thinking-toggle models disable thinking for structured output",async()=>{
 for(const model of ["deepseek-flash","deepseek-pro","deepseek-v4-flash","deepseek-v4-pro","deepseek-reasoner"]){
  const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"openai-compatible",NEW_DESIGN_AI_BASE_URL:"https://api.deepseek.com/v1",NEW_DESIGN_AI_MODEL:model,NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(url,init)=>{
   assert.equal(url,"https://api.deepseek.com/v1/chat/completions");
   const payload=JSON.parse(init.body);
   assert.deepEqual(payload.thinking,{type:"disabled"});
   assert.equal(payload.response_format.type,"json_schema");
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({suggestions:{name:"沈青"}})}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
  }});
  assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
 }
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"openai-compatible",NEW_DESIGN_AI_BASE_URL:"https://example.com/v1",NEW_DESIGN_AI_MODEL:"deepseek-flash",NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(_url,init)=>{
  const payload=JSON.parse(init.body);
  assert.equal(payload.thinking,undefined);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({suggestions:{name:"沈青"}})}}]}));
 }});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

test("Anthropic-compatible connection uses Messages protocol and reads text blocks and usage",async()=>{
 const configuration={...env,NEW_DESIGN_AI_PROVIDER:"anthropic-compatible",NEW_DESIGN_AI_BASE_URL:"https://api.anthropic.com/v1",NEW_DESIGN_AI_MODEL:"claude-test",NEW_DESIGN_AI_API_KEY:"fixture-key"};
 const config=readModelConfiguration(configuration);
 assert.equal(config.provider,"anthropic-compatible");
 const listed=await probeModelConnection(config,async(url,init)=>{
  assert.equal(url,"https://api.anthropic.com/v1/models");
  assert.equal(init.headers["x-api-key"],"fixture-key");
  assert.equal(init.headers["anthropic-version"],"2023-06-01");
  return new Response(JSON.stringify({data:[{id:"claude-test"}]}));
 });
 assert.equal(listed.modelFound,true);
 const gateway=createIndependentAiGateway({environment:configuration,fetcher:async(url,init)=>{
  assert.equal(url,"https://api.anthropic.com/v1/messages");
  const payload=JSON.parse(init.body);
  assert.equal(payload.system.includes("系统合同"),true);
  assert.deepEqual(payload.messages.map(item=>item.role),["user"]);
  assert.equal(payload.max_tokens>0,true);
  assert.equal(payload.output_config.format.type,"json_schema");
  const sentSchema=JSON.stringify(payload.output_config.format.schema);
  assert.doesNotMatch(sentSchema,/"(?:minLength|maxLength|minimum|maximum|maxItems)"/);
  assert.equal(payload.output_config.format.schema.additionalProperties,false);
  assert.equal(init.headers["x-api-key"],"fixture-key");
  return new Response(JSON.stringify({content:[{type:"thinking",thinking:"hidden"},{type:"text",text:JSON.stringify({suggestions:{name:"沈青"}})}],usage:{input_tokens:10,output_tokens:5}}));
 }});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

test("OpenRouter structured requests require a compatible downstream model",async()=>{
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"openai-compatible",NEW_DESIGN_AI_BASE_URL:"https://openrouter.ai/api/v1",NEW_DESIGN_AI_MODEL:"example/model",NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(url,init)=>{
  assert.equal(url,"https://openrouter.ai/api/v1/chat/completions");
  const payload=JSON.parse(init.body);
  assert.equal(payload.response_format.type,"json_schema");
  assert.equal(payload.provider.require_parameters,true);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({suggestions:{name:"沈青"}})}}]}));
 }});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

test("Anthropic text protocol cannot be saved as an embedding connection",()=>{
 assert.equal(embeddingConnectionInputSchema.safeParse({provider:"anthropic-compatible",endpoint:"https://api.anthropic.com/v1",model:"claude-test",credentialId:null,timeoutMs:120000,maxRetries:0,retryDelayMs:1000,expectedConfigId:null,expectedRevision:null,idempotencyKey:"00000000-0000-4000-8000-000000000001"}).success,false);
});

test("all wire protocols become the same internal request and reply objects",()=>{
 const prompt={taskType:"form_assist",messages:[{role:"system",content:"rules"},{role:"user",content:"input"}],outputSchema:{type:"object"},temperature:0.2,maxTokens:300};
 const config={model:"model-id",maxTokens:256};
 assert.deepEqual(createModelRequest(config,prompt),{model:"model-id",messages:prompt.messages,outputSchema:prompt.outputSchema,taskType:"form_assist",temperature:0.2,maxOutputTokens:256});
 const text='{"suggestions":{"name":"沈青"}}';
 const expected={content:text,inputTokens:10,outputTokens:5,usedTokens:15,usageReported:true,responseId:null,responseModel:null,finishReason:"unknown",rawFinishReason:null};
 assert.deepEqual(normalizeModelResponse("ollama",{message:{content:text},prompt_eval_count:10,eval_count:5}),expected);
 assert.deepEqual(normalizeModelResponse("openai-compatible",{choices:[{message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}),expected);
 assert.deepEqual(normalizeModelResponse("anthropic-compatible",{content:[{type:"thinking",thinking:"hidden"},{type:"text",text}],usage:{input_tokens:10,output_tokens:5}}),expected);
 assert.deepEqual(normalizeModelCatalog("ollama",{models:[{name:"model-id"}]}),{models:["model-id"],hasMore:false});
 assert.deepEqual(normalizeModelCatalog("openai-compatible",{data:[{id:"model-id"}]}),{models:["model-id"],hasMore:false});
 assert.deepEqual(normalizeModelCatalog("anthropic-compatible",{data:[{id:"model-id"}],has_more:true}),{models:["model-id"],hasMore:true});
});

test("Anthropic exact model check finds an older model beyond the first catalog page",async()=>{
 const config=readModelConfiguration({...env,NEW_DESIGN_AI_PROVIDER:"anthropic-compatible",NEW_DESIGN_AI_BASE_URL:"https://api.anthropic.com/v1",NEW_DESIGN_AI_MODEL:"claude-older",NEW_DESIGN_AI_API_KEY:"fixture-key"});
 const calls=[];
 const result=await probeModelConnection(config,async(url)=>{
  calls.push(url);
  return new Response(JSON.stringify(url.endsWith("/models")?{data:[{id:"claude-newer"}],has_more:true}:{id:"claude-older"}));
 });
 assert.deepEqual(calls,["https://api.anthropic.com/v1/models","https://api.anthropic.com/v1/models/claude-older"]);
 assert.equal(result.modelFound,true);
});

test("Anthropic-compatible MiniMax endpoint uses protocol headers and its Messages path",async()=>{
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"anthropic-compatible",NEW_DESIGN_AI_BASE_URL:"https://api.minimax.cn/anthropic",NEW_DESIGN_AI_MODEL:"MiniMax-M3",NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(url,init)=>{
  assert.equal(url,"https://api.minimax.cn/anthropic/v1/messages");
  assert.equal(init.headers["x-api-key"],"fixture-key");
  assert.equal(init.headers.Authorization,undefined);
  assert.equal(JSON.parse(init.body).output_config,undefined);
  assert.equal(JSON.parse(init.body).tool_choice.name,"submit_creative_result");
  return new Response(JSON.stringify({content:[{type:"tool_use",name:"submit_creative_result",input:{suggestions:{name:"沈青"}}}],usage:{input_tokens:10,output_tokens:5}}));
 }});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

test("OpenRouter Messages gateway keeps bearer authentication",async()=>{
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"anthropic-compatible",NEW_DESIGN_AI_BASE_URL:"https://openrouter.ai/api/v1",NEW_DESIGN_AI_MODEL:"anthropic/example",NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(url,init)=>{
  assert.equal(url,"https://openrouter.ai/api/v1/messages");
  assert.equal(init.headers.Authorization,"Bearer fixture-key");
  assert.equal(init.headers["x-api-key"],undefined);
  return new Response(JSON.stringify({content:[{type:"text",text:JSON.stringify({suggestions:{name:"沈青"}})}],usage:{input_tokens:10,output_tokens:5}}));
 }});
 assert.deepEqual(await gateway.assistForm(input),{name:"沈青"});
});

test("Claude schema grammar is skipped for tasks exceeding its optional-field limit",async()=>{
 const fields=Array.from({length:25},(_,index)=>({...input.fields[0],key:`field_${index}`,name:`字段${index}`,required:false,order:index}));
 const gateway=createIndependentAiGateway({environment:{...env,NEW_DESIGN_AI_PROVIDER:"anthropic-compatible",NEW_DESIGN_AI_BASE_URL:"https://api.anthropic.com/v1",NEW_DESIGN_AI_MODEL:"claude-test",NEW_DESIGN_AI_API_KEY:"fixture-key"},fetcher:async(_url,init)=>{
  assert.equal(JSON.parse(init.body).output_config,undefined);
  return new Response(JSON.stringify({content:[{type:"text",text:'{"suggestions":{}}'}],usage:{input_tokens:10,output_tokens:5}}));
 }});
 assert.deepEqual(await gateway.assistForm({...input,fields}),{});
});

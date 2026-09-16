const test=require("node:test");
const assert=require("node:assert/strict");
const {preparePrompt}=require("../dist/server/ai/prompts");
const {executeManagedPrompt,reserveAttemptBudget,validateExecutionPolicy}=require("../dist/server/ai/runtime/managedExecution");
const {DEFAULT_MODEL_POLICY}=require("../dist/common/modelRouting");
const input={bookName:"测试",formName:"人物",cardTitle:"测试人物",currentValues:{},instruction:"填写姓名",fields:[{key:"name",name:"姓名",description:"姓名",type:"short_text",required:true,options:[],defaultValue:null,group:"基础",order:0}]};
const prompt=preparePrompt("form_assist",input);
const connection=model=>({provider:"ollama",endpoint:"http://127.0.0.1:11434",model,credentialId:null});
const route=()=>({primary:connection("primary"),fallbacks:[],policy:{...DEFAULT_MODEL_POLICY,maxTotalTokens:200000},sourceLayers:[{scope:"system_default",configId:"fixture-config",versionId:"fixture-version"}]});
const response=()=>new Response(JSON.stringify({message:{content:JSON.stringify({suggestions:{name:"沈青"}})},prompt_eval_count:10,eval_count:5}));
function dependencies(value,fetcher){return {routeResolver:async()=>value,snapshotWriter:async(taskType,route)=>({id:"fixture-snapshot",snapshotHash:"fixture-hash",taskType,route}),fetcher};}

test("published route is frozen before network and actual provenance survives success",async()=>{
 const value=route();let frozen=false;const deps=dependencies(value,async(_url,init)=>{assert.equal(frozen,true);assert.equal(JSON.parse(init.body).model,"primary");return response();});
 deps.snapshotWriter=async(taskType,route)=>{frozen=true;return {id:"fixture-snapshot",snapshotHash:"fixture-hash",taskType,route};};
 const result=await executeManagedPrompt("form_assist",prompt,deps);
 assert.deepEqual(result.output,{suggestions:{name:"沈青"}});assert.equal(result.modelSnapshot.fixture,false);assert.equal(result.modelSnapshot.routeSnapshotId,"fixture-snapshot");assert.equal(result.usedTokens,15);
});
test("explicit ordered technical fallback shares total budget and marks unreported failed usage",async()=>{
 const value=route();value.fallbacks=[{...connection("fallback-one"),failureCategories:["transport"]},{...connection("fallback-two"),failureCategories:["rate_limit"]}];
 const models=[];const result=await executeManagedPrompt("form_assist",prompt,dependencies(value,async(_url,init)=>{const model=JSON.parse(init.body).model;models.push(model);return model==="primary"?new Response("never expose private upstream body",{status:429}):response();}));
 assert.deepEqual(models,["primary","fallback-two"]);assert.equal(result.modelSnapshot.fallbackCount,1);assert.equal(result.modelSnapshot.usageReported,false);assert.equal(result.modelSnapshot.usageStatus,"partial_or_unavailable");assert.equal(result.modelSnapshot.attempts[0].category,"rate_limit");
});
test("invalid structured output never retries or selects configured fallback",async()=>{
 const value=route();value.policy.maxRetries=3;value.fallbacks=[{...connection("fallback"),failureCategories:["transport"]}];let calls=0;
 await assert.rejects(()=>executeManagedPrompt("form_assist",prompt,dependencies(value,async()=>{calls++;return new Response(JSON.stringify({message:{content:JSON.stringify({suggestions:{bad:"越界"}})}}));})),error=>error.recovery.failedStep==="核对创作结果");assert.equal(calls,1);
});
test("retry reservations are not reset after lost response and stop before second request",async()=>{
 const value=route();value.policy.maxTotalTokens=reserveAttemptBudget(prompt,200000,value.policy.maxOutputTokens).reservedTokens;value.policy.maxRetries=1;value.policy.retryDelayMs=0;let calls=0;
 await assert.rejects(()=>executeManagedPrompt("form_assist",prompt,dependencies(value,async()=>{calls++;throw new Error("private network message");})),error=>error.recovery.failedStep==="检查调用预算"&&/尚未发送/.test(error.message));assert.equal(calls,1);
});
test("snapshot and policy failures identify stage and send no model request",async()=>{
 const value=route();let calls=0;const deps=dependencies(value,async()=>{calls++;return response();});deps.snapshotWriter=async()=>{throw new Error("private database text");};
 await assert.rejects(()=>executeManagedPrompt("form_assist",prompt,deps),error=>error.recovery.failedStep==="记录模型配置快照"&&!/private/.test(error.message));assert.equal(calls,0);
 const invalid=route();invalid.policy.maxRetries=100;assert.throws(()=>validateExecutionPolicy(invalid),error=>error.recovery.failedStep==="检查调用策略");
});
test("authentication is not retried, and explicit credential reference is provider-bound",async()=>{
 const value=route();value.primary.credentialId="fixture-credential";value.policy.maxRetries=3;let calls=0;const deps=dependencies(value,async()=>{calls++;return response();});deps.credentialResolver=async(id,provider)=>{assert.equal(id,"fixture-credential");assert.equal(provider,"ollama");return "NEW_DESIGN_AI_FIXTURE_KEY";};deps.environment={};
 await assert.rejects(()=>executeManagedPrompt("form_assist",prompt,deps),error=>error.recovery.failedStep==="读取模型凭据");assert.equal(calls,0);
});

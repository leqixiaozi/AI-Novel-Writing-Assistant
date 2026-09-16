const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {preparePrompt,listPromptAssets}=require("../dist/server/ai/prompts");
const {executeManagedPrompt}=require("../dist/server/ai/runtime/managedExecution");
const {DEFAULT_MODEL_POLICY}=require("../dist/common/modelRouting");
const hash="a".repeat(64),id="73300000-0000-4000-8000-000000000001",bodyId="73300000-0000-4000-8000-000000000002",subjectId="73300000-0000-4000-8000-000000000003";
const field={key:"health",name:"体力",description:"人物体力",type:"number",required:true,options:[],defaultValue:null,group:"状态",order:0};
function input(){return{sessionId:id,bodyVersionId:bodyId,bodyContentHash:hash,bodyContent:"沈青受伤，体力从十降到八。",expectedChanges:[],catalog:{sessionId:id,bodyVersionId:bodyId,bodyContentHash:hash,sessionRevision:1,specificationHash:hash,subjects:[{id:subjectId,subjectKind:"card",label:"沈青",typeKey:"character",currentVersionId:bodyId,categories:["character_state","fact","knowledge"],unavailableReason:null,fields:[{key:field.key,label:field.name,field,mode:"delta",specificationHash:hash,typeVersionId:bodyId,relationTypeId:null,relationTypeRevision:null,capabilityRevision:1,dimensionRevision:null,dictionaryNodes:[],baseline:{known:true,value:10,display:"10",revision:1,sourceKind:"initial_state",sourceId:bodyId,hash,stale:false}}]}],objectChoices:[],holderChoices:[{id:subjectId,label:"沈青"}]}};}
function output(){return{items:[{category:"character_state",title:"沈青受伤损失体力",subjectKind:"card",subjectId,stateKey:"health",specificationHash:hash,baselineHash:hash,beforeValue:10,afterValue:8,changeValue:-2,riskLevel:"medium",confidence:.9,confidenceNote:"原文明确",planAlignment:"not_applicable",planExpectation:"",evidenceStart:0,evidenceEnd:14,evidenceLabel:"沈青受伤，体力从十降到八。",reason:"原文描述受伤"}],notes:[]};}
const prompt=()=>preparePrompt("chapter_settlement",input());
test("dedicated extraction asset is registered without silently expanding composition tasks",()=>{
  assert.equal(listPromptAssets().find(p=>p.taskType==="chapter_settlement").assetId,"new_design.chapter.settlement_candidates");
  const {COMPOSITION_TASK_KEYS}=require("../dist/common/promptComposition");
  assert.equal(COMPOSITION_TASK_KEYS.length,6);assert.ok(!COMPOSITION_TASK_KEYS.includes("chapter_settlement"));
});
test("governed extraction returns the same typed draft objects, with exact formal identities and original evidence",()=>{
  const original=output();original.items[0].evidenceEnd=input().bodyContent.length;
  assert.deepEqual(prompt().parseOutput(original),original);
  assert.match(prompt().messages[0].content,/候选.*作者.*审阅|作者.*审阅/);
  assert.ok(prompt().outputSchema.properties.items);
});
test("foreign object, unknown field, wrong spec, wrong baseline and unsupported state type are rejected",()=>{
  for(const patch of [{subjectId:bodyId},{stateKey:"story_timeline"},{specificationHash:"b".repeat(64)},{baselineHash:"b".repeat(64)},{afterValue:"八"},{beforeValue:9},{changeValue:-1}]){
    const value=output();value.items[0].evidenceEnd=input().bodyContent.length;Object.assign(value.items[0],patch);assert.throws(()=>prompt().parseOutput(value));
  }
});
test("output validation identifies the Chinese object and formal field without exposing raw model text",()=>{
  const value=output();value.items[0].evidenceEnd=input().bodyContent.length;value.items[0].afterValue="provider-private-response";
  assert.throws(()=>prompt().parseOutput(value),error=>{assert.equal(error.recovery.failedStep,"核对章节变化候选");assert.match(error.message,/沈青.*体力/);assert.doesNotMatch(error.message,/provider-private-response|health|73300000/);assert.ok(error.issues);return true;});
});
test("evidence must match precise UTF-16 offsets, duplicate subject fields are rejected",()=>{
  const value=output();value.items[0].evidenceEnd=input().bodyContent.length;
  for(const patch of [{evidenceStart:1},{evidenceEnd:9999},{evidenceLabel:"凭空编造"}]){const changed=structuredClone(value);Object.assign(changed.items[0],patch);assert.throws(()=>prompt().parseOutput(changed));}
  value.items.push(structuredClone(value.items[0]));assert.throws(()=>prompt().parseOutput(value));
});
test("unknown and stale state baselines cannot generate invented before values",()=>{
  for(const patch of [{known:false},{stale:true}]){const data=input();Object.assign(data.catalog.subjects[0].fields[0].baseline,patch);const prepared=preparePrompt("chapter_settlement",data);assert.deepEqual(prepared.parseOutput({items:[],notes:["请先核对初始状态"]}),{items:[],notes:["请先核对初始状态"]});assert.throws(()=>prepared.parseOutput(output()));}
});
test("dictionary extraction enforces exact node ids, active leaf policy and typed values",()=>{
  const data=input(),choice=data.catalog.subjects[0].fields[0],parent="73300000-0000-4000-8000-000000000004",leaf="73300000-0000-4000-8000-000000000005";
  choice.mode="absolute";choice.field={...field,type:"select",optionSource:{kind:"dictionary_tree",dictionaryId:bodyId,rule:{mode:"single",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:true,allowParentSelection:false,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:1,maxSelections:1}}};
  choice.dictionaryNodes=[{id:parent,parentId:null,label:"境界",path:["境界"],versionId:bodyId,status:"active"},{id:leaf,parentId:parent,label:"炼气",path:["境界","炼气"],versionId:bodyId,status:"active"}];
  choice.baseline.value=leaf;
  const value=output();value.items[0].beforeValue=leaf;value.items[0].afterValue=leaf;value.items[0].evidenceEnd=data.bodyContent.length;delete value.items[0].changeValue;
  const prepared=preparePrompt("chapter_settlement",data);assert.deepEqual(prepared.parseOutput(value),value);
  for(const afterValue of [parent,"炼气",bodyId]){const changed=structuredClone(value);changed.items[0].afterValue=afterValue;assert.throws(()=>prepared.parseOutput(changed));}
});
test("model execution uses actual governed route snapshot and measured usage, no automatic semantic retry",async()=>{
  const route={primary:{provider:"ollama",endpoint:"http://127.0.0.1:11434",model:"test-model",credentialId:null},fallbacks:[],policy:{...DEFAULT_MODEL_POLICY,maxTotalTokens:200000},sourceLayers:[]};let calls=0;
  const result=await executeManagedPrompt("chapter_settlement",prompt(),{routeResolver:async()=>route,snapshotWriter:async()=>({id:bodyId,snapshotHash:hash,taskType:"chapter_settlement",route}),fetcher:async()=>{calls++;const value=output();value.items[0].evidenceEnd=input().bodyContent.length;return new Response(JSON.stringify({message:{content:JSON.stringify(value)},prompt_eval_count:7,eval_count:9}));}});
  assert.equal(calls,1);assert.equal(result.modelSnapshot.routeSnapshotId,bodyId);assert.equal(result.modelSnapshot.inputTokens,7);assert.equal(result.modelSnapshot.outputTokens,9);assert.equal(result.modelSnapshot.attempts[0].requestSent,true);
});
test("preflight credential failure is not invoked and unknown result saving never authorizes a second model call",async()=>{
  const route={primary:{provider:"ollama",endpoint:"http://127.0.0.1:11434",model:"test-model",credentialId:bodyId},fallbacks:[],policy:{...DEFAULT_MODEL_POLICY,maxTotalTokens:200000},sourceLayers:[]};let calls=0;
  await assert.rejects(()=>executeManagedPrompt("chapter_settlement",prompt(),{routeResolver:async()=>route,snapshotWriter:async()=>({id:bodyId,snapshotHash:hash,taskType:"chapter_settlement",route}),credentialResolver:async()=>null,fetcher:async()=>{calls++;throw new Error("should not send");}}),error=>{assert.equal(error.executionSnapshot.usageStatus,"not_invoked");assert.equal(error.executionSnapshot.attempts[0].requestSent,false);return true;});
  assert.equal(calls,0);
  const source=fs.readFileSync(path.join(__dirname,"../src/server/ai/chapterSettlement/index.ts"),"utf8"),requests=fs.readFileSync(path.join(__dirname,"../src/server/ai/chapterSettlement/requests.ts"),"utf8");
  assert.match(source,/if\(prior\)return prior/);assert.match(source,/保存模型输出回执/);assert.match(source,/"unknown","completed"/);assert.match(requests,/currentCatalog.*getChapterSettlementEditingCatalogInTransaction/);
  const savedImport=source.slice(source.indexOf("async function importSaved("),source.indexOf("export async function importSavedChapterSettlementAiResult"));assert.doesNotMatch(savedImport,/executeManagedPrompt/);
});
test("expired unknown extraction has an explicit deadline-guarded source action and preserves unknown usage",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../src/server/ai/chapterSettlement/expiredUnknown.ts"),"utf8"),requests=fs.readFileSync(path.join(__dirname,"../src/server/ai/chapterSettlement/requests.ts"),"utf8");
  assert.match(source,/lockBook\(client/);assert.match(source,/row\.generated_output\|\|row\.lease_expired!==true/);assert.match(requests,/lease_expires_at<=now\(\)/);
  assert.match(source,/'unknown','unknown',NULL,NULL/);assert.match(source,/status='discarded'/);assert.doesNotMatch(source,/executeManagedPrompt|fetch\(/);
});
test("pure database claim preparation uses acknowledged rollback, not SQL text, to unlock known non-writes",async()=>{
  const {preparationDatabase,withChapterSettlementAiDatabasePool}=require("../dist/server/ai/chapterSettlement/database");
  const queries=[],client={query:async sql=>{queries.push(sql);return{rows:[]};},release(){}};
  await withChapterSettlementAiDatabasePool({connect:async()=>client},async()=>{
    await assert.rejects(()=>preparationDatabase(async()=>{throw new Error("private SQL error detail");}),error=>{assert.equal(error.status,503);assert.equal(error.recovery.mutationOutcome,"not_written");assert.equal(error.modelRequestState,"not_sent");assert.match(error.message,/事务已回滚/);assert.doesNotMatch(error.message,/private|SQL/);return true;});
  });
  assert.deepEqual(queries,["BEGIN","ROLLBACK"]);
});
test("claim commit started or rollback unacknowledged preserves unknown receipt without changing external-result transactions",async()=>{
  const {preparationDatabase,database,withChapterSettlementAiDatabasePool}=require("../dist/server/ai/chapterSettlement/database");
  for(const failed of ["COMMIT","ROLLBACK"]){
    const client={query:async sql=>{if(sql===failed)throw new Error("private socket loss");return{rows:[]};},release(){}};
    await withChapterSettlementAiDatabasePool({connect:async()=>client},async()=>{
      await assert.rejects(()=>preparationDatabase(async()=>{if(failed==="ROLLBACK")throw new Error("failure before commit");return"ready";}),error=>{assert.equal(error.recovery.mutationOutcome,"unknown");assert.equal(error.modelRequestState,"not_sent");assert.doesNotMatch(error.message,/private socket/);return true;});
    });
  }
  const original=new Error("external model result already exists"),client={query:async()=>({rows:[]}),release(){}};
  await withChapterSettlementAiDatabasePool({connect:async()=>client},async()=>{await assert.rejects(()=>database(async()=>{throw original;}),error=>error===original);});
});

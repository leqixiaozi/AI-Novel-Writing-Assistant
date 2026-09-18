const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {compiled}=require('./support/isolatedDatabase.cjs');
const {professionalCommandSchema,RESOURCE_KINDS}=compiled('common/professionalResources');
const id="65000000-0000-4000-8000-000000000011",versionId="65000000-0000-4000-8000-000000000012",bookId="65000000-0000-4000-8000-000000000013";
const ref=()=>({resourceId:id,versionId,expectedRevision:1}),read=file=>fs.readFileSync(path.join(__dirname,"../",file),"utf8");
test("professional commands retain exact resource and book provenance, rejecting overrides",()=>{
 const input={...ref(),operation:"adopt_title",requestKey:"original-title-key",bookId,expectedBookRevision:1};assert.deepEqual(professionalCommandSchema.parse(input),input);
 for(const patch of [{expectedBookRevision:0},{bookId:"other"},{versionId:""},{provider:"legacy"},{force:true}])assert.equal(professionalCommandSchema.safeParse({...input,...patch}).success,false);
});
test("combination bounds and published scope vocabulary stay exact",()=>{
 const base={operation:"install",requestKey:"original-install-key",bookId,expectedBookRevision:1};assert.equal(professionalCommandSchema.safeParse({...base,resources:[]}).success,false);assert.equal(professionalCommandSchema.safeParse({...base,resources:Array.from({length:21},ref)}).success,false);
 assert.equal(professionalCommandSchema.safeParse({...ref(),operation:"rule_settings",requestKey:"original-rule-key",enabled:false,scopes:["field","scene"]}).success,true);assert.equal(professionalCommandSchema.safeParse({...ref(),operation:"rule_settings",requestKey:"original-rule-key",enabled:true,scopes:["event"]}).success,false);
 assert.ok(RESOURCE_KINDS.includes("title_candidate"));
});
test("effect feedback requires exactly one real source reference, not synthetic success",()=>{
 const base={...ref(),operation:"feedback",requestKey:"original-feedback-key",effect:"neutral",note:"作者个人观察"};for(const [previewId,issueId,ok]of [[null,null,false],[id,id,false],[id,null,true],[null,id,true]])assert.equal(professionalCommandSchema.safeParse({...base,previewId,issueId}).success,ok);
 assert.equal(professionalCommandSchema.safeParse({...base,previewId:id,issueId:null,note:"x".repeat(2001)}).success,false);
});
test("resource input does not silently accept unknown command keys or unbounded draft",()=>{
 const base={operation:"create",requestKey:"original-create-key",typeId:id,title:"书名",values:{promise:"读者承诺"}};assert.equal(professionalCommandSchema.safeParse(base).success,true);assert.equal(professionalCommandSchema.safeParse({...base,values:{promise:"x".repeat(100001)}}).success,false);assert.equal(professionalCommandSchema.safeParse({...base,title:""}).success,false);
});
test("static original ledgers and atomic install remain primary, no second trial state",()=>{
 const code=read("src/server/database/professionalResources/index.ts"),sql=read("migrations/063_professional_resource_receipts.sql");assert.match(code,/INSERT INTO new_design\.resource_adoptions/);assert.match(code,/'install_snapshot'/);assert.match(code,/snapshotDictionaryTreeValues/);assert.match(code,/current_version_id!==source\.versionId/);assert.match(code,/input_hash!==inputHash/);assert.match(code,/!commitStarted&&rollbackAck/);assert.doesNotMatch(sql,/CREATE TABLE (professional_trials|professional_titles|professional_quality)/);assert.match(sql,/TG_OP <> 'INSERT'/);assert.match(sql,/REFERENCES ai_run_previews/);
});
test("static unknown operation reads original receipt without reissuing command",()=>{
 const code=read("src/client/professionalResources/index.tsx"),start=code.indexOf("const check=async"),end=code.indexOf("const completeOriginal=",start),check=code.slice(start,end);assert.match(check,/api\.receipt\(pending\.requestKey\)/);assert.doesNotMatch(check,/api\.command/);assert.match(code,/dirtyRef\.current/);assert.match(code,/setPendingSelection/);assert.match(code,/if\(saved\)await accept\(saved\);else/);
});
test("explicit completion only replays frozen original pure-DB payload with same key",()=>{
 const code=read("src/client/professionalResources/index.tsx"),start=code.indexOf("const completeOriginal="),end=code.indexOf("const save=",start),completion=code.slice(start,end);assert.match(completion,/const original=pending/);assert.match(completion,/api\.receipt\(original\.requestKey\)/);assert.match(completion,/api\.command\(original\)/);assert.match(completion,/writeAttempted&&outcome/);assert.doesNotMatch(completion,/randomUUID|api\.run|trialApi/);
});
test("static trial invokes once and unknown result reads original source only",()=>{
 const code=read("src/client/professionalResources/Trial.tsx"),start=code.indexOf("const check=async"),end=code.indexOf("return <section",start),check=code.slice(start,end);assert.match(code,/attempted\.current\.add\(preview\.id\)/);assert.match(check,/api\.previewByKey/);assert.match(check,/api\.result\(id\)/);assert.doesNotMatch(check,/api\.run/);assert.match(code,/data\.length>30000/);assert.match(code,/frozenResource\.current\?\.versionId===resource\?\.versionId/);assert.doesNotMatch(code,/adoptBody|updateCard|savePlanning/);
});
test("pure database resource write distinguishes acknowledged rollback from unknown COMMIT",async()=>{
 const {withProfessionalResourcesPool,executeProfessionalCommand}=compiled('server/database/professionalResources');
 const field={key:"promise",name:"读者承诺",description:"",type:"long_text",required:true,defaultValue:null,options:[],group:"标题比较",order:0};
 for(const failure of ["prepare-ack","prepare-lost","commit"]){
  const calls=[],connection={async query(sql){calls.push(sql);if(sql==="ROLLBACK"&&failure==="prepare-lost")throw Error("private rollback detail");if(sql.includes("SELECT * FROM new_design.professional_resource_receipts")){if(failure!=="commit")throw Error("private SQL detail");return{rows:[]};}if(sql.includes("SELECT t.id,t.type_key,v.id version_id,v.fields"))return{rows:[{id,type_key:"title_candidate",version_id:versionId,fields:[structuredClone(field)]}]};if(sql==="COMMIT"&&failure==="commit")throw Error("private commit detail");return{rows:[],rowCount:1};},release(){calls.push("RELEASE");}},pool={async connect(){return connection;}};
  await assert.rejects(withProfessionalResourcesPool(pool,()=>executeProfessionalCommand({operation:"create",requestKey:"frozen-pure-db-key",typeId:id,title:"原书名候选",values:{promise:"真实可编辑承诺"}})),error=>{assert.equal(error.recovery.mutationOutcome,failure==="prepare-ack"?"not_written":"unknown");assert.equal(error.recovery.requestKey,"frozen-pure-db-key");assert.doesNotMatch(error.message,/private|SQL detail|commit detail/);assert.match(error.recovery.savedResult,/保留/);return true;});
  assert.equal(calls.at(-1),"RELEASE");if(failure!=="commit")assert.ok(!calls.includes("COMMIT"));
 }
});

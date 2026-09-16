const test=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {getNewDesignPool}=require("../dist/server/database/runtime");
const composition=require("../dist/server/database/promptComposition");
const models=require("../dist/server/database/modelManagement");
const {preparePrompt}=require("../dist/server/ai/prompts");
const {supplementPreparedPrompt}=require("../dist/server/ai/composition/compile");
const {PROMPT_COMPONENT_RESOURCE_SPACE_ID:promptSpace}=require("../dist/common/contracts");
const {DEFAULT_DEBUG_PARAMETERS,COMPOSITION_ROUTE}=require("../dist/common/promptComposition");

// These tests prove PostgreSQL persistence, not model quality or a real model request.
// LIKE copies schema only; no production row or author's default model is copied/modified.
test("composition facts, explicit previews and single trial ledger use isolated PostgreSQL fixtures",{skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=="1",timeout:90000},async t=>{
  const pool=await getNewDesignPool(),client=await pool.connect(),schema=`model_route_test_composition_${randomUUID().replaceAll("-","")}`,context={client,schema};
  const originalDefault=(await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows;
  const tables=["card_spaces","card_types","card_type_versions","cards","card_versions","template_groups","template_group_versions","books","prompt_recipes","prompt_recipe_versions","prompt_recipe_slots","prompt_recipe_slot_components","task_contracts","task_contract_versions","ai_contract_publications","model_credential_refs","model_route_configs","model_route_versions","model_route_fallbacks","model_route_snapshots","model_route_snapshot_fallbacks","context_manifests","context_manifest_slots","context_manifest_entries","ai_run_previews","ai_run_prompt_sections","ai_run_submissions","ai_tasks","ai_task_steps","ai_task_attempts","ai_task_state_events","ai_attempt_usage"];
  t.after(async()=>{try{await client.query("ROLLBACK");await client.query(`UPDATE ${schema}.prompt_recipes SET status='archived' WHERE status='active'`);await client.query(`UPDATE ${schema}.model_route_configs SET status='archived',revision=revision+1 WHERE status='active'`);await client.query(`UPDATE ${schema}.books SET status='archived' WHERE status='active'`);}finally{client.release();await pool.end();}});
  await client.query(`CREATE SCHEMA ${schema}`);
  for(const name of tables)await client.query(`CREATE TABLE ${schema}.${name}(LIKE new_design.${name} INCLUDING ALL)`);
  const foreignKeys={
    card_types:[`FOREIGN KEY(space_id) REFERENCES ${schema}.card_spaces(id)`],
    card_type_versions:[`FOREIGN KEY(card_type_id) REFERENCES ${schema}.card_types(id)`],
    cards:[`FOREIGN KEY(space_id) REFERENCES ${schema}.card_spaces(id)`,`FOREIGN KEY(card_type_id) REFERENCES ${schema}.card_types(id)`,`FOREIGN KEY(type_version_id) REFERENCES ${schema}.card_type_versions(id)`],
    card_versions:[`FOREIGN KEY(card_id) REFERENCES ${schema}.cards(id)`,`FOREIGN KEY(type_version_id) REFERENCES ${schema}.card_type_versions(id)`],
    template_group_versions:[`FOREIGN KEY(template_id) REFERENCES ${schema}.template_groups(id)`],
    books:[`FOREIGN KEY(space_id) REFERENCES ${schema}.card_spaces(id)`,`FOREIGN KEY(template_id) REFERENCES ${schema}.template_groups(id)`,`FOREIGN KEY(template_version_id) REFERENCES ${schema}.template_group_versions(id)`],
    prompt_recipe_versions:[`FOREIGN KEY(recipe_id) REFERENCES ${schema}.prompt_recipes(id)`,`FOREIGN KEY(base_version_id,recipe_id) REFERENCES ${schema}.prompt_recipe_versions(id,recipe_id)`],
    prompt_recipes:[`FOREIGN KEY(current_version_id,id) REFERENCES ${schema}.prompt_recipe_versions(id,recipe_id)`,`FOREIGN KEY(published_version_id,id) REFERENCES ${schema}.prompt_recipe_versions(id,recipe_id)`],
    prompt_recipe_slots:[`FOREIGN KEY(recipe_version_id) REFERENCES ${schema}.prompt_recipe_versions(id)`],
    prompt_recipe_slot_components:[`FOREIGN KEY(slot_id,recipe_version_id) REFERENCES ${schema}.prompt_recipe_slots(id,recipe_version_id)`,`FOREIGN KEY(component_card_id) REFERENCES ${schema}.cards(id)`,`FOREIGN KEY(component_version_id,component_card_id) REFERENCES ${schema}.card_versions(id,card_id)`],
    task_contract_versions:[`FOREIGN KEY(contract_id) REFERENCES ${schema}.task_contracts(id)`,`FOREIGN KEY(prompt_recipe_version_id) REFERENCES ${schema}.prompt_recipe_versions(id)`],
    task_contracts:[`FOREIGN KEY(current_version_id,id) REFERENCES ${schema}.task_contract_versions(id,contract_id)`,`FOREIGN KEY(published_version_id,id) REFERENCES ${schema}.task_contract_versions(id,contract_id)`],
    model_route_versions:[`FOREIGN KEY(config_id) REFERENCES ${schema}.model_route_configs(id)`],
    model_route_configs:[`FOREIGN KEY(current_version_id,id) REFERENCES ${schema}.model_route_versions(id,config_id)`,`FOREIGN KEY(published_version_id,id) REFERENCES ${schema}.model_route_versions(id,config_id)`],
    model_route_fallbacks:[`FOREIGN KEY(route_version_id) REFERENCES ${schema}.model_route_versions(id)`],
    model_route_snapshots:[`FOREIGN KEY(book_id) REFERENCES ${schema}.books(id)`,`FOREIGN KEY(task_contract_version_id) REFERENCES ${schema}.task_contract_versions(id)`],
    model_route_snapshot_fallbacks:[`FOREIGN KEY(snapshot_id) REFERENCES ${schema}.model_route_snapshots(id)`],
    context_manifests:[`FOREIGN KEY(book_id) REFERENCES ${schema}.books(id)`,`FOREIGN KEY(task_contract_version_id) REFERENCES ${schema}.task_contract_versions(id)`,`FOREIGN KEY(prompt_recipe_version_id) REFERENCES ${schema}.prompt_recipe_versions(id)`,`FOREIGN KEY(model_route_snapshot_id) REFERENCES ${schema}.model_route_snapshots(id)`],
    context_manifest_slots:[`FOREIGN KEY(manifest_id) REFERENCES ${schema}.context_manifests(id)`],
    context_manifest_entries:[`FOREIGN KEY(slot_id,manifest_id) REFERENCES ${schema}.context_manifest_slots(id,manifest_id)`],
    ai_run_previews:[`FOREIGN KEY(book_id) REFERENCES ${schema}.books(id)`,`FOREIGN KEY(task_contract_version_id) REFERENCES ${schema}.task_contract_versions(id)`,`FOREIGN KEY(prompt_recipe_version_id) REFERENCES ${schema}.prompt_recipe_versions(id)`,`FOREIGN KEY(context_manifest_id) REFERENCES ${schema}.context_manifests(id)`,`FOREIGN KEY(model_route_snapshot_id) REFERENCES ${schema}.model_route_snapshots(id)`],
    ai_run_prompt_sections:[`FOREIGN KEY(preview_id) REFERENCES ${schema}.ai_run_previews(id)`],
    ai_tasks:[`FOREIGN KEY(space_id) REFERENCES ${schema}.card_spaces(id)`,`FOREIGN KEY(book_id) REFERENCES ${schema}.books(id)`,`FOREIGN KEY(task_contract_version_id) REFERENCES ${schema}.task_contract_versions(id)`],
    ai_task_steps:[`FOREIGN KEY(task_id) REFERENCES ${schema}.ai_tasks(id)`],
    ai_task_attempts:[`FOREIGN KEY(step_id,task_id) REFERENCES ${schema}.ai_task_steps(id,task_id)`,`FOREIGN KEY(task_contract_version_id) REFERENCES ${schema}.task_contract_versions(id)`,`FOREIGN KEY(prompt_recipe_version_id) REFERENCES ${schema}.prompt_recipe_versions(id)`,`FOREIGN KEY(context_manifest_id) REFERENCES ${schema}.context_manifests(id)`,`FOREIGN KEY(model_route_snapshot_id) REFERENCES ${schema}.model_route_snapshots(id)`],
    ai_run_submissions:[`FOREIGN KEY(preview_id) REFERENCES ${schema}.ai_run_previews(id)`,`FOREIGN KEY(ai_task_id) REFERENCES ${schema}.ai_tasks(id)`],
    ai_task_state_events:[`FOREIGN KEY(task_id) REFERENCES ${schema}.ai_tasks(id)`,`FOREIGN KEY(step_id) REFERENCES ${schema}.ai_task_steps(id)`,`FOREIGN KEY(attempt_id) REFERENCES ${schema}.ai_task_attempts(id)`],
    ai_attempt_usage:[`FOREIGN KEY(task_id) REFERENCES ${schema}.ai_tasks(id)`,`FOREIGN KEY(step_id) REFERENCES ${schema}.ai_task_steps(id)`,`FOREIGN KEY(attempt_id) REFERENCES ${schema}.ai_task_attempts(id)`],
  };
  for(const [name,constraints]of Object.entries(foreignKeys))await client.query(`ALTER TABLE ${schema}.${name} ${constraints.map(item=>`ADD ${item}`).join(",")}`);
  await client.query(`ALTER TABLE ${schema}.ai_task_steps ADD FOREIGN KEY(current_attempt_id,id) REFERENCES ${schema}.ai_task_attempts(id,step_id)`);
  const functions=["guard_ai_contract_immutable","guard_ai_task_transition","guard_ai_step_transition","guard_ai_attempt_update","validate_debug_attempt_insert","guard_ai_ledger_append_only","guard_ai_run_preview_update","guard_ai_run_prompt_section","validate_ai_task_book_space"];
  for(const name of functions){const definition=(await client.query("SELECT pg_get_functiondef(proc.oid) AS definition FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace WHERE ns.nspname='new_design' AND proc.proname=$1 AND proc.pronargs=0",[name])).rows[0].definition;await client.query(definition.replaceAll("new_design",schema));}
  const immutable=["prompt_recipe_versions","prompt_recipe_slots","prompt_recipe_slot_components","task_contract_versions","model_route_versions","model_route_fallbacks","model_route_snapshots","model_route_snapshot_fallbacks","context_manifests","context_manifest_slots","context_manifest_entries"];
  for(const name of immutable)await client.query(`CREATE TRIGGER fixture_immutable BEFORE UPDATE OR DELETE ON ${schema}.${name} FOR EACH ROW EXECUTE FUNCTION ${schema}.guard_ai_contract_immutable()`);
  for(const [name,fn,ops]of [["ai_tasks","guard_ai_task_transition","UPDATE"],["ai_tasks","validate_ai_task_book_space","INSERT OR UPDATE"],["ai_task_steps","guard_ai_step_transition","UPDATE"],["ai_task_attempts","guard_ai_attempt_update","UPDATE OR DELETE"],["ai_task_attempts","validate_debug_attempt_insert","INSERT"],["ai_run_previews","guard_ai_run_preview_update","UPDATE OR DELETE"],["ai_run_prompt_sections","guard_ai_run_prompt_section","UPDATE OR DELETE"],["ai_run_submissions","guard_ai_run_prompt_section","UPDATE OR DELETE"],["ai_task_state_events","guard_ai_ledger_append_only","UPDATE OR DELETE"],["ai_attempt_usage","guard_ai_ledger_append_only","UPDATE OR DELETE"]])await client.query(`CREATE TRIGGER fixture_${fn} BEFORE ${ops} ON ${schema}.${name} FOR EACH ROW EXECUTE FUNCTION ${schema}.${fn}()`);
  await client.query("BEGIN");
  const bookId=randomUUID(),bookSpace=randomUUID(),otherBookId=randomUUID(),otherSpace=randomUUID(),templateId=randomUUID(),templateVersion=randomUUID(),characterType=randomUUID(),characterTypeVersion=randomUUID(),componentType=randomUUID(),componentTypeVersion=randomUUID();
  for(const [id,key]of [[promptSpace,"fixture_prompt_resources"],[bookSpace,"fixture_book"],[otherSpace,"fixture_other_book"]])await client.query(`INSERT INTO ${schema}.card_spaces(id,space_key,name) VALUES($1,$2,$2)`,[id,key]);
  await client.query(`INSERT INTO ${schema}.template_groups(id,template_key,name) VALUES($1,'fixture_template','隔离空模板')`,[templateId]);
  await client.query(`INSERT INTO ${schema}.template_group_versions(id,template_id,version,payload) VALUES($1,$2,1,'{}')`,[templateVersion,templateId]);
  for(const [id,space,key]of [[bookId,bookSpace,"fixture_book"],[otherBookId,otherSpace,"fixture_other_book"]])await client.query(`INSERT INTO ${schema}.books(id,space_id,book_key,name,template_id,template_version_id,installed_payload) VALUES($1,$2,$3,$3,$4,$5,'{}')`,[id,space,key,templateId,templateVersion]);
  for(const [id,space,key,version]of [[characterType,bookSpace,"character",characterTypeVersion],[componentType,promptSpace,"prompt_component",componentTypeVersion]]){await client.query(`INSERT INTO ${schema}.card_types(id,space_id,type_key,name,status) VALUES($1,$2,$3,$3,'published')`,[id,space,key]);await client.query(`INSERT INTO ${schema}.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,1,'[]')`,[version,id]);}
  async function card(space,type,typeVersion,title,values){const id=randomUUID(),versionId=randomUUID();await client.query(`INSERT INTO ${schema}.cards(id,space_id,card_type_id,type_version_id,title,status,revision,current_version_id,values) VALUES($1,$2,$3,$4,$5,'active',1,$6,$7::jsonb)`,[id,space,type,typeVersion,title,versionId,JSON.stringify(values)]);await client.query(`INSERT INTO ${schema}.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')`,[versionId,id,typeVersion,title,JSON.stringify(values)]);return {cardId:id,versionId};}
  const component=await card(promptSpace,componentType,componentTypeVersion,"中文写作补充",{enabled:true,content:"用清楚的中文表达目标与阻力。",component_type:"optional_addition",task_families:["ideation"],trust_level:"system_instruction"});
  const source=await card(bookSpace,characterType,characterTypeVersion,"隔离人物",{goal:"寻找丢失的记忆"}),foreignSource=await card(otherSpace,characterType,characterTypeVersion,"其他书资料",{});
  const input={id:null,expectedRevision:null,name:"隔离测试组合",description:"真实结构，非真实模型",taskType:"directions",components:[{...component,enabled:true}],variables:[{key:"style",label:"表达风格",type:"select",options:["清晰","轻快"],defaultValue:"清晰"}],context:{bookId,sources:[{...source,role:"formal"}]},idempotencyKey:randomUUID()};
  let saved,blocked,ready,claim;
  const params={...DEFAULT_DEBUG_PARAMETERS,instruction:""};
  function previewInput(){return {recipeId:saved.recipe.id,recipeVersionId:saved.savedVersionId,parameters:params,variableValues:{style:"清晰"},idempotencyKey:randomUUID()};}
  async function bundle(){const loaded=await composition.loadCompositionRecipeVersion(saved.recipe.id,saved.savedVersionId,context),taskInput={method:"idea",bookName:"隔离测试书",sourceReference:"",sourceText:""},prepared=supplementPreparedPrompt("directions",taskInput,loaded,[{label:"表达风格",value:"清晰"}]);return {...loaded,taskInput,inputSchema:{type:"object",const:taskInput},messages:prepared.messages,outputSchema:prepared.outputSchema,assetId:prepared.assetId,assetVersion:prepared.version,contextPolicy:prepared.contextPolicy,temperature:prepared.temperature,maxTokens:prepared.maxTokens,variables:[{label:"表达风格",value:"清晰"}],estimatedInputUnits:Buffer.byteLength(JSON.stringify(prepared.messages),"utf8")+256};}
  async function rejectedStatement(work){await client.query("SAVEPOINT rejected_statement");await assert.rejects(work());await client.query("ROLLBACK TO SAVEPOINT rejected_statement");}
  await t.test("save atomically publishes immutable recipe, references and explicit variables",async()=>{
    saved=await composition.saveComposition(input,context);assert.equal(saved.active,true);assert.equal(saved.recipe.editable,true);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.prompt_recipe_versions`)).rows[0].count,1);
    assert.equal((await client.query(`SELECT enabled FROM ${schema}.prompt_recipe_slot_components`)).rows[0].enabled,true);
    const loaded=await composition.loadCompositionRecipeVersion(saved.recipe.id,saved.savedVersionId,context);assert.equal(loaded.components[0].content,"用清楚的中文表达目标与阻力。");assert.equal(loaded.sources[0].values.goal,"寻找丢失的记忆");
  });
  await t.test("receipt lookup and strict idempotency return exact old version",async()=>{
    assert.equal((await composition.readCompositionSaveByRequest(input.idempotencyKey,context)).savedVersionId,saved.savedVersionId);
    assert.equal((await composition.saveComposition(input,context)).repeated,true);
    await assert.rejects(composition.saveComposition({...input,name:"不同内容"},context),error=>error.status===409);
    assert.equal(await composition.readCompositionSaveByRequest(randomUUID(),context),null);
  });
  await t.test("cross-book context and undeclared/prototype variables are rejected",async()=>{
    await client.query("SAVEPOINT invalid_save");await assert.rejects(composition.saveComposition({...input,idempotencyKey:randomUUID(),context:{bookId,sources:[{...foreignSource,role:"formal"}]}},context),/其他书籍/);await client.query("ROLLBACK TO SAVEPOINT invalid_save");
    await assert.rejects(composition.saveComposition({...input,variables:[{...input.variables[0],key:"constructor"}],idempotencyKey:randomUUID()},context));
    await assert.rejects(composition.saveComposition({...input,variables:[{...input.variables[0],options:["清晰","清晰"]}],idempotencyKey:randomUUID()},context));
  });
  await t.test("missing model route stores inspectable blocked preview without environment fallback",async()=>{
    const request=previewInput();blocked=await composition.saveDebugPreview(await bundle(),request,context);assert.equal(blocked.status,"blocked");assert.equal(blocked.route,null);assert.equal(blocked.recovery.failedStep,"读取任务模型路由");assert.equal(blocked.recovery.actionLabel,"打开模型设置");
    assert.equal((await composition.readDebugPreviewByRequest(request.idempotencyKey,context)).id,blocked.id);assert.equal((await composition.saveDebugPreview(await bundle(),request,context)).id,blocked.id);
    await assert.rejects(composition.saveDebugPreview(await bundle(),{...request,parameters:{...params,instruction:"换内容"}},context),error=>error.status===409);
    assert.equal(await composition.readDebugResult(blocked.id,context),null);await assert.rejects(composition.claimDebugRun(blocked.id,1,randomUUID(),context),error=>error.status===409);
    const row=(await client.query(`SELECT context_preview_id,model_route_snapshot_id,prompt_plan FROM ${schema}.ai_run_previews WHERE id=$1`,[blocked.id])).rows[0];assert.equal(row.context_preview_id,null);assert.equal(row.model_route_snapshot_id,null);assert.deepEqual(row.prompt_plan.inputSchema,{type:"object",const:row.prompt_plan.taskInput});
    const userData=JSON.parse(blocked.messages.at(-1).content);assert.equal(userData.supplementaryData.components[0].content,"用清楚的中文表达目标与阻力。");assert.equal(blocked.messages.filter(message=>message.role==="system").length,1);assert.equal(blocked.messages[0].content.includes("用清楚的中文表达目标与阻力。"),false);
  });
  await t.test("nullable relaxation stays debug-only and ready requires real snapshot",async()=>{
    for(const patch of [{status:"ready"},{source_kind:"ordinary_production"}])await rejectedStatement(()=>client.query(`INSERT INTO ${schema}.ai_run_previews SELECT (jsonb_populate_record(NULL::${schema}.ai_run_previews,to_jsonb(preview)||$2::jsonb)).* FROM ${schema}.ai_run_previews preview WHERE id=$1`,[blocked.id,JSON.stringify({id:randomUUID(),idempotency_key:randomUUID(),...patch})]));
  });
  await t.test("ready preview freezes real model, contract and explicitly selected entries",async()=>{
    await models.saveManagedModelRoute({scope:"system_default",taskType:null,expectedConfigId:null,expectedRevision:null,idempotencyKey:randomUUID(),primary:{provider:"ollama",endpoint:"http://127.0.0.1:11434",model:"fixture-not-invoked",credentialId:null},fallbacks:[],policy:{maxOutputTokens:5000,maxTotalTokens:100000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}},context);
    ready=await composition.saveDebugPreview(await bundle(),previewInput(),context);assert.equal(ready.status,"ready");assert.equal(await composition.readDebugResult(ready.id,context),null);
    const row=(await client.query(`SELECT preview.*,snapshot.book_id AS snapshot_book,snapshot.task_contract_version_id AS snapshot_contract,snapshot.managed_task_key,contract.input_schema,contract.output_schema FROM ${schema}.ai_run_previews preview JOIN ${schema}.model_route_snapshots snapshot ON snapshot.id=preview.model_route_snapshot_id JOIN ${schema}.task_contract_versions contract ON contract.id=preview.task_contract_version_id WHERE preview.id=$1`,[ready.id])).rows[0];assert.equal(row.snapshot_book,bookId);assert.equal(row.snapshot_contract,row.task_contract_version_id);assert.equal(row.managed_task_key,null);assert.deepEqual(row.input_schema,row.prompt_plan.inputSchema);assert.deepEqual(row.output_schema,ready.outputSchema);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.context_manifest_entries WHERE manifest_id=$1`,[row.context_manifest_id])).rows[0].count,2);
  });
  await t.test("claim has one attempt, exact frozen bundle and retry returns prior running receipt",async()=>{
    const key=randomUUID();claim=await composition.claimDebugRun(ready.id,ready.revision,key,context);assert.ok(!("priorResult"in claim));assert.deepEqual(claim.frozenBundle.messages,ready.messages);assert.equal(claim.snapshot.route.primary.model,"fixture-not-invoked");
    const repeated=await composition.claimDebugRun(ready.id,ready.revision,key,context);assert.equal(repeated.priorResult.status,"running");assert.equal(repeated.priorResult.repeated,true);assert.ok(repeated.priorResult.failure.sourceRoute.includes(ready.id));
    await assert.rejects(composition.claimDebugRun(ready.id,ready.revision,randomUUID(),context),error=>error.status===409);
    assert.equal((await client.query(`SELECT max_attempts FROM ${schema}.ai_task_steps WHERE id=$1`,[claim.stepId])).rows[0].max_attempts,1);assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.ai_task_attempts WHERE task_id=$1`,[claim.taskId])).rows[0].count,1);
    await rejectedStatement(()=>client.query(`UPDATE ${schema}.ai_task_attempts SET status='succeeded',ended_at=now() WHERE id=$1`,[claim.attemptId]));
    await rejectedStatement(()=>client.query(`UPDATE ${schema}.ai_task_attempts SET status='failed',ended_at=now(),error_category='unknown',retry_eligibility='none' WHERE id=$1`,[claim.attemptId]));
  });
  const output={directions:[{id:"fixture-direction",title:"守忆人",premise:"少年追查记忆缺口",protagonist:"守门少年",centralConflict:"每次追查都会损失记忆",readerPromise:"解谜与成长",styleKeywords:["仙侠","悬疑"]}]};
  const measured={provider:"ollama",model:"fixture-not-invoked",inputTokens:null,outputTokens:null,knownTokens:120,usageStatus:"partial_or_unavailable",fallbackCount:0,attempts:[],fixture:true};
  await t.test("finish commits terminal ledger, trial result and unknown usage together, no canon writes",async()=>{
    preparePrompt("directions",claim.taskInput).parseOutput(output);const result=await composition.finishDebugRun(claim,{output,modelSnapshot:measured},context);assert.equal(result.status,"succeeded");assert.equal(result.usageRecorded,true);assert.deepEqual(result.output,output);
    assert.equal((await composition.finishDebugRun(claim,{output,modelSnapshot:measured},context)).repeated,true);await assert.rejects(composition.finishDebugRun(claim,{output:{directions:[]},modelSnapshot:measured},context),error=>error.status===409);
    const usage=(await client.query(`SELECT input_tokens,output_tokens,estimated_cost,currency,budget_decision FROM ${schema}.ai_attempt_usage WHERE attempt_id=$1`,[claim.attemptId])).rows[0];assert.deepEqual(usage,{input_tokens:null,output_tokens:null,estimated_cost:null,currency:null,budget_decision:"unknown"});
    assert.deepEqual((await client.query(`SELECT values FROM ${schema}.cards WHERE id=$1`,[source.cardId])).rows[0].values,{goal:"寻找丢失的记忆"});assert.equal((await composition.readDebugResult(ready.id,context)).status,"succeeded");
  });
  await t.test("frozen updates fail and deletion guard coverage is inspected without executing deletion",async()=>{
    await rejectedStatement(()=>client.query(`UPDATE ${schema}.ai_task_attempts SET debug_result='{}' WHERE id=$1`,[claim.attemptId]));
    await rejectedStatement(()=>client.query(`UPDATE ${schema}.prompt_recipe_slot_components SET enabled=false WHERE recipe_version_id=$1`,[saved.savedVersionId]));
    await rejectedStatement(()=>client.query(`UPDATE ${schema}.ai_run_previews SET prompt_plan='{}',revision=revision+1 WHERE id=$1`,[ready.id]));
    await rejectedStatement(()=>client.query(`UPDATE ${schema}.ai_attempt_usage SET input_tokens=0 WHERE attempt_id=$1`,[claim.attemptId]));
    const guards=(await client.query("SELECT relation.relname,pg_get_triggerdef(trg.oid) AS definition,pg_get_functiondef(trg.tgfoid) AS function FROM pg_trigger trg JOIN pg_class relation ON relation.oid=trg.tgrelid JOIN pg_namespace ns ON ns.oid=relation.relnamespace WHERE ns.nspname=$1 AND relation.relname=ANY($2::text[]) AND NOT trg.tgisinternal",[schema,["ai_task_attempts","ai_run_previews","ai_attempt_usage"]])).rows;
    for(const name of ["ai_task_attempts","ai_run_previews","ai_attempt_usage"]){const matching=guards.filter(item=>item.relname===name&&item.definition.includes("DELETE"));assert.ok(matching.length>0);assert.ok(matching.some(item=>item.function.includes("RAISE EXCEPTION")));}
    assert.ok(guards.some(item=>item.relname==="ai_task_attempts"&&/TG_OP\s*=\s*'DELETE'/.test(item.function)));
  });
  await t.test("preflight failure retains recovery location without inventing actual provider or token count",async()=>{
    const preview=await composition.saveDebugPreview(await bundle(),previewInput(),context),failedClaim=await composition.claimDebugRun(preview.id,1,randomUUID(),context),failure={failedStep:"核对冻结请求",summary:"合同不一致",savedResult:"未发送模型",actionLabel:"返回提示词组合",sourceRoute:COMPOSITION_ROUTE};
    const result=await composition.finishDebugRun(failedClaim,{failure,modelSnapshot:null,errorCategory:"data_integrity"},context);assert.equal(result.status,"failed");assert.equal(result.failure.failedStep,"核对冻结请求");assert.ok(result.failure.sourceRoute.endsWith(preview.id));assert.ok(result.failure.savedResult.includes("书内正本未修改"));
    const usage=(await client.query(`SELECT provider,model,input_tokens,output_tokens FROM ${schema}.ai_attempt_usage WHERE attempt_id=$1`,[failedClaim.attemptId])).rows[0];assert.deepEqual(usage,{provider:"not_invoked",model:"not_invoked",input_tokens:null,output_tokens:null});
  });
  await t.test("historical receipt remains exact after publishing a new version",async()=>{
    const latest=await composition.saveComposition({...input,id:saved.recipe.id,expectedRevision:saved.recipe.revision,name:"隔离新版",idempotencyKey:randomUUID()},context),old=await composition.readCompositionSaveByRequest(input.idempotencyKey,context);assert.equal(old.savedVersionId,saved.savedVersionId);assert.equal(old.active,false);assert.equal(latest.recipe.version,2);
    assert.equal((await composition.readDebugPreview(ready.id,context)).recipeVersionId,saved.savedVersionId);
  });
  await client.query("COMMIT");
  assert.deepEqual((await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows,originalDefault);
  console.log(`Preserved isolated composition fixtures (archived on completion): ${schema}`);
});

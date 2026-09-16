const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {getNewDesignPool}=require('../dist/server/database/runtime');
const settlement=require('../dist/server/database/chapterSettlement');
const {withSettlementDatabasePool}=require('../dist/server/database/chapterSettlement/transaction');
const {withChapterSettlementAiDatabasePool}=require('../dist/server/ai/chapterSettlement/database');
const settlementAi=require('../dist/server/ai/chapterSettlement');
const settlementAiRequests=require('../dist/server/ai/chapterSettlement/requests');
const models=require('../dist/server/database/modelManagement');
const hash=value=>createHash('sha256').update(value).digest('hex');

// Empty schema, real table/FK/trigger definitions, no author's row copied or rewritten.
// Fixtures remain archived for inspection. Never delete/drop/truncate test data.
test('typed settlement preserves formal facts, exact receipts and stable state in isolated PostgreSQL',
  {skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1',timeout:180000},async t=>{
  const pool=await getNewDesignPool(),client=await pool.connect(),schema=`chapter_settlement_test_${randomUUID().replaceAll('-','')}`;
  const sqlFailures=[];
  // Preserve the controlled asset identifier: it is a contract string, not a schema reference.
  const rewrite=sql=>sql.replace(/\bnew_design\b(?!\.chapter\.settlement_candidates)/g,schema);
  const scopedClient=new Proxy(client,{get(target,key){
    if(key==='release')return ()=>{};
    if(key==='query')return async(sql,values)=>{try{return await target.query(typeof sql==='string'?rewrite(sql):{...sql,text:rewrite(sql.text)},values);}catch(error){const entry=typeof sql==='string'&&sql.startsWith('INSERT INTO new_design.context_manifest_entries')?{sourceType:values[3],stableId:values[4],versionId:values[5]}:undefined;sqlFailures.push({code:error.code,message:error.message,routine:error.routine,entry});if(entry)error.cause=entry;throw error;}};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const scopedPool={query:scopedClient.query,connect:async()=>scopedClient};
  const originalDefault=(await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows;
  t.after(async()=>{try{await client.query('ROLLBACK');await client.query(`UPDATE ${schema}.books SET status='archived' WHERE status='active'`);}finally{client.release();await pool.end();}});
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='new_design' ORDER BY tablename")).rows.map(row=>row.tablename);
  for(const table of tables)await client.query(`CREATE TABLE ${schema}.${table}(LIKE new_design.${table} INCLUDING ALL)`);
  // pg_get_constraintdef and trigger functions are copied as definitions only; all qualified references resolve to this empty schema.
  const fks=(await client.query("SELECT relation.relname table_name,constraint_row.conname,pg_get_constraintdef(constraint_row.oid) definition FROM pg_constraint constraint_row JOIN pg_class relation ON relation.oid=constraint_row.conrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='new_design' AND constraint_row.contype='f' ORDER BY relation.relname,constraint_row.conname")).rows;
  for(const row of fks)await client.query(`ALTER TABLE ${schema}.${row.table_name} ADD CONSTRAINT ${row.conname} ${rewrite(row.definition)}`);
  const functions=(await client.query("SELECT DISTINCT function.oid,pg_get_functiondef(function.oid) definition FROM pg_proc function JOIN pg_namespace namespace ON namespace.oid=function.pronamespace JOIN pg_language language ON language.oid=function.prolang WHERE namespace.nspname='new_design' AND function.prokind='f' AND language.lanname IN ('sql','plpgsql') ORDER BY function.oid")).rows;
  for(const row of functions)await client.query(rewrite(row.definition));
  const triggers=(await client.query("SELECT pg_get_triggerdef(trigger.oid) definition FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='new_design' AND NOT trigger.tgisinternal ORDER BY relation.relname,trigger.tgname")).rows;
  for(const row of triggers)await client.query(rewrite(row.definition));
  // Migration-owned static runtime registry is infrastructure, not an author's data.
  // Real dependency triggers require these handlers; keep the triggers fully enabled.
  const runtimeMigration=require('node:fs').readFileSync(require('node:path').join(__dirname,'../migrations/030_postgres_outbox_job_runtime.sql'),'utf8');
  for(const table of ['outbox_event_topics','background_job_handlers','outbox_consumers']){
    const statement=runtimeMigration.match(new RegExp(`INSERT INTO ${table}\\([^;]+;`));
    assert.ok(statement,`versioned ${table} seed exists`);await scopedClient.query(statement[0]);
  }

  const space=randomUUID(),book=randomUUID(),template=randomUUID(),templateVersion=randomUUID();
  await scopedClient.query("INSERT INTO new_design.card_spaces(id,space_key,name) VALUES($1,$2,'隔离结算资料')",[space,space]);
  await scopedClient.query("INSERT INTO new_design.template_groups(id,template_key,name,status) VALUES($1,$2,'隔离模板','published')",[template,template]);
  await scopedClient.query("INSERT INTO new_design.template_group_versions(id,template_id,version,payload) VALUES($1,$2,1,'{}')",[templateVersion,template]);
  await scopedClient.query("INSERT INTO new_design.books(id,space_id,book_key,name,template_id,template_version_id,installed_payload) VALUES($1::uuid,$2,$1::uuid::text,'隔离小说',$3,$4,'{}')",[book,space,template,templateVersion]);
  const field={key:'cultivation',name:'修为',type:'number',required:true,defaultValue:null,options:[],description:'记录正式修为',group:'状态',order:0,stateSettlement:'tracked'};
  async function card(typeKey,title,fields=[]){
    const type=randomUUID(),typeVersion=randomUUID(),id=randomUUID(),version=randomUUID(),values=JSON.stringify(fields.length?{cultivation:1}:{});
    await scopedClient.query("INSERT INTO new_design.card_types(id,space_id,type_key,name,status) VALUES($1,$2,$3,$4,'published')",[type,space,typeKey,title]);
    await scopedClient.query("INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,1,$3)",[typeVersion,type,JSON.stringify(fields)]);
    await scopedClient.query("UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1",[type,typeVersion]);
    await scopedClient.query("INSERT INTO new_design.cards(id,space_id,card_type_id,type_version_id,title,status,revision,values) VALUES($1,$2,$3,$4,$5,'active',1,$6)",[id,space,type,typeVersion,title,values]);
    await scopedClient.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5,'create')",[version,id,typeVersion,title,values]);
    await scopedClient.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[id,version]);
    return {id,type,typeVersion,version};
  }
  const character=await card('character','隔离主角',[field]),volumeCard=await card('volume','第一卷'),chapterCard=await card('chapter','第一章');
  await scopedClient.query("INSERT INTO new_design.state_type_capabilities(space_id,type_key,settlement_capability,state_mode,default_field_policy) VALUES($1,'character','required','field_state','tracked')",[space]);
  const story=randomUUID(),volume=randomUUID(),plan=randomUUID(),planVersion=randomUUID();
  await scopedClient.query("INSERT INTO new_design.planning_objects(id,book_id,level,title) VALUES($1,$2,'story','总规划')",[story,book]);
  await scopedClient.query("INSERT INTO new_design.planning_objects(id,book_id,level,parent_object_id,card_id,title) VALUES($1,$2,'volume',$3,$4,'第一卷')",[volume,book,story,volumeCard.id]);
  await scopedClient.query("INSERT INTO new_design.planning_objects(id,book_id,level,parent_object_id,card_id,title) VALUES($1,$2,'chapter',$3,$4,'第一章')",[plan,book,volume,chapterCard.id]);
  await scopedClient.query("INSERT INTO new_design.planning_versions(id,object_id,book_id,version,source,status,content,content_hash) VALUES($1,$2,$3,1,'manual','adopted','{}',$4)",[planVersion,plan,book,hash('{}')]);
  await scopedClient.query("UPDATE new_design.planning_objects SET current_version_id=$2,adopted_version_id=$2 WHERE id=$1",[plan,planVersion]);
  const document=randomUUID(),body=randomUUID(),preparation=randomUUID(),session=randomUUID(),policy=randomUUID(),adoption=randomUUID(),content='陆沉修为从一层升到二层，同伴的信任也随之提升。';
  await scopedClient.query("INSERT INTO new_design.chapter_documents(id,book_id,chapter_card_id,logical_order,title) VALUES($1,$2,$3,1,'第一章')",[document,book,chapterCard.id]);
  await scopedClient.query("INSERT INTO new_design.chapter_body_versions(id,chapter_document_id,version,source,created_by_kind,content,content_hash,planning_object_id,planning_version_id) VALUES($1,$2,1,'manual','user',$3,$4,$5,$6)",[body,document,content,hash(content),plan,planVersion]);
  await scopedClient.query("INSERT INTO new_design.chapter_body_adoptions(id,chapter_document_id,to_version_id,action,document_revision,idempotency_key) VALUES($1,$2,$3,'adopt',1,$1::uuid::text)",[adoption,document,body]);
  await scopedClient.query("UPDATE new_design.chapter_documents SET adopted_version_id=$2 WHERE id=$1",[document,body]);
  await scopedClient.query("INSERT INTO new_design.chapter_adoption_preparations(id,book_id,chapter_document_id,body_version_id,expected_document_revision,planning_object_id,planning_version_id,planning_content_hash,dependency_hash,status,idempotency_key) VALUES($1,$2,$3,$4,1,$5,$6,$7,$7,'consumed',$1::uuid::text)",[preparation,book,document,body,plan,planVersion,hash('{}')]);
  await scopedClient.query("INSERT INTO new_design.settlement_policy_versions(id,book_id,version) VALUES($1,$2,1)",[policy,book]);
  await scopedClient.query("INSERT INTO new_design.chapter_adoption_sessions(id,book_id,chapter_document_id,body_version_id,preparation_id,adoption_id,policy_version_id,planning_object_id,planning_version_id,dependency_hash,adoption_kind,status,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'first_adoption','adopted_pending_proposals',$1::uuid::text)",[session,book,document,body,preparation,adoption,policy,plan,planVersion,hash('{}')]);

  await withSettlementDatabasePool(scopedPool,async()=>{
    let workspace=await settlement.getChapterSettlementEditingWorkspace(session),choice=workspace.catalog.subjects.find(item=>item.id===character.id).fields[0];
    assert.equal(choice.label,'修为');assert.equal(choice.baseline.known,false);
    const initial={expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),subjectId:character.id,subjectKind:'card',stateKey:'cultivation',specificationHash:choice.specificationHash,value:1,note:'作者明确建立本章之前的初始修为'};
    const initialReceipt=await settlement.establishChapterSettlementEditingInitialState(session,initial);workspace=initialReceipt.workspace;
    assert.equal(initialReceipt.operation,'initial');assert.equal((await settlement.establishChapterSettlementEditingInitialState(session,initial)).repeated,true);
    choice=workspace.catalog.subjects.find(item=>item.id===character.id).fields[0];assert.equal(choice.baseline.value,1);
    const input={expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),draft:{category:'character_state',title:'修为提升',subjectId:character.id,subjectKind:'card',stateKey:'cultivation',beforeValue:1,afterValue:2,riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:'正文证据',reason:'正文明确提升',specificationHash:choice.specificationHash,baselineHash:choice.baseline.hash}};
    await t.test('invalid typed value rolls back and leaves the original session editable',async()=>{
      await assert.rejects(settlement.createChapterSettlementEditingItem(session,{...input,requestKey:randomUUID(),draft:{...input.draft,afterValue:'二层'}}),error=>error.status===422);
      assert.equal((await settlement.getChapterSettlementEditingWorkspace(session)).session.revision,workspace.session.revision);
    });
    await t.test('acknowledged pre-commit SQL rollback preserves draft and permits explicit recovery without unknown lock',async()=>{
      let injected=false;
      const faultClient=new Proxy(scopedClient,{get(target,key){if(key==='query')return (sql,values)=>{
        if(!injected&&typeof sql==='string'&&/INSERT INTO new_design\.chapter_settlement_items/.test(sql)){injected=true;return scopedClient.query('SELECT 1/0');}
        return scopedClient.query(sql,values);
      };return Reflect.get(target,key);}});
      await withSettlementDatabasePool({connect:async()=>faultClient,query:faultClient.query},async()=>{
        await assert.rejects(settlement.createChapterSettlementEditingItem(session,{...input,requestKey:randomUUID()}),error=>error.status===503&&error.recovery?.mutationOutcome==='not_written');
      });
      assert.equal(injected,true);assert.equal((await settlement.getChapterSettlementEditingWorkspace(session)).items.length,0);
      assert.equal((await settlement.getChapterSettlementEditingWorkspace(session)).session.revision,workspace.session.revision);
    });
    let receipt;
    await t.test('proposal save yields a queryable atomic receipt and does not change official state',async()=>{
      receipt=await settlement.createChapterSettlementEditingItem(session,input);workspace=receipt.workspace;
      assert.equal(workspace.items.length,1);assert.equal(workspace.items[0].decision,'pending');
      assert.equal((await settlement.readChapterSettlementEditingReceipt(session,input.requestKey)).itemId,receipt.itemId);
      assert.equal((await scopedClient.query("SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2",[book,character.id])).rows[0].value_json,1);
    });
    await t.test('same request repeats only exact content; changed payload and stale revision cannot write',async()=>{
      assert.equal((await settlement.createChapterSettlementEditingItem(session,input)).repeated,true);
      await assert.rejects(settlement.createChapterSettlementEditingItem(session,{...input,draft:{...input.draft,title:'不同标题'}}),error=>error.status===409);
      await assert.rejects(settlement.createChapterSettlementEditingItem(session,{...input,requestKey:randomUUID()}),error=>error.status===409);
      assert.equal((await settlement.getChapterSettlementEditingWorkspace(session)).items.length,1);
    });
    await t.test('controlled model stub writes the same pending proposals and real AI ledger, never official state',async()=>{
      await models.saveManagedModelRoute({scope:'system_default',taskType:null,expectedConfigId:null,expectedRevision:null,idempotencyKey:randomUUID(),
        primary:{provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'fixture-stub-not-real-model',credentialId:null},fallbacks:[],
        policy:{maxOutputTokens:8000,maxTotalTokens:1000000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}},{client:scopedClient});
      await models.saveManagedModelRoute({scope:'task',taskType:'chapter_settlement',expectedConfigId:null,expectedRevision:null,idempotencyKey:randomUUID(),
        primary:{provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'fixture-stub-not-real-model',credentialId:null},fallbacks:[],
        policy:{maxOutputTokens:8000,maxTotalTokens:1000000,timeoutMs:30000,maxRetries:0,retryDelayMs:0}},{client:scopedClient});
      const aiInput={expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),catalogHash:workspace.catalog.specificationHash};let invocations=0;
      const output={items:[{...input.draft,title:'AI 修为变化提案',confidence:1,confidenceNote:'正文明确说明',planAlignment:'not_applicable',planExpectation:'',evidenceLabel:content}],notes:['原文明确记载修为提升，待作者核对。']};
      const fetcher=async()=>{invocations++;return new Response(JSON.stringify({message:{content:JSON.stringify(output)},prompt_eval_count:100,eval_count:50}),{status:200,headers:{'content-type':'application/json'}});};
      await withChapterSettlementAiDatabasePool(scopedPool,async()=>{
        const failureOffset=sqlFailures.length;
        const generated=await settlementAi.runChapterSettlementAiExtraction(session,aiInput,{fetcher}).catch(error=>{error.cause=sqlFailures.slice(failureOffset).find(item=>item.code!=='25P02');throw error;});
        assert.equal(generated.status,'succeeded');assert.equal(generated.modelResultSaved,true);assert.equal(generated.proposalsSaved,true);assert.equal(generated.proposalCount,1);
        assert.equal((await settlementAi.runChapterSettlementAiExtraction(session,aiInput,{fetcher})).repeated,true);assert.equal(invocations,1);
        assert.equal((await settlementAi.getChapterSettlementAiReceipt(session,aiInput.requestKey)).id,generated.id);
        assert.equal((await scopedClient.query("SELECT count(*)::int count FROM new_design.ai_task_attempts WHERE task_id=$1",[generated.taskId])).rows[0].count,1);
        assert.equal((await scopedClient.query("SELECT count(*)::int count FROM new_design.ai_attempt_usage WHERE task_id=$1",[generated.taskId])).rows[0].count,1);
      });
      workspace=await settlement.getChapterSettlementEditingWorkspace(session);const aiItem=workspace.items.find(item=>item.sourceKind==='ai');
      assert.ok(aiItem);assert.equal(aiItem.decision,'pending');assert.ok(aiItem.sourceTaskId);assert.ok(aiItem.sourceAttemptId);
      assert.equal((await scopedClient.query("SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2",[book,character.id])).rows[0].value_json,1);
      workspace=(await settlement.decideChapterSettlementEditingItems(session,{expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),decisions:[{itemId:aiItem.id,expectedRevision:aiItem.revision,decision:'reject'}]})).workspace;
    });
    await t.test('relation configuration stays draft until explicit publication and creates typed settlement dimensions',async()=>{
      const companion=randomUUID(),companionVersion=randomUUID();
      await scopedClient.query("INSERT INTO new_design.cards(id,space_id,card_type_id,type_version_id,title,status,revision,values) VALUES($1,$2,$3,$4,'隔离同伴','active',1,'{\"cultivation\":1}')",[companion,space,character.type,character.typeVersion]);
      await scopedClient.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,'隔离同伴','{\"cultivation\":1}','create')",[companionVersion,companion,character.typeVersion]);
      await scopedClient.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[companion,companionVersion]);
      const definition={name:'同伴信任',description:'记录本书人物之间的信任',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['character'],sourceMax:null,targetMax:null,
        fields:[{...field,key:'trust',name:'信任程度',required:false}],capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'trust',label:'信任程度',direction:'forward',policy:'tracked',mode:'absolute'}]};
      const draftInput={requestKey:randomUUID(),expectedRelationTypeRevision:null,definition};
      const saved=await settlement.saveSettlementRelationConfigurationDraft(book,draftInput);
      assert.equal(saved.operation,'save_draft');assert.equal(saved.workspace.published.length,0);
      assert.equal((await settlement.saveSettlementRelationConfigurationDraft(book,draftInput)).repeated,true);
      await assert.rejects(settlement.saveSettlementRelationConfigurationDraft(book,{...draftInput,definition:{...definition,name:'改内容复用凭证'}}),error=>error.status===409);
      const draft=saved.workspace.drafts.find(item=>item.id===saved.draftId);
      const publishing={requestKey:randomUUID(),draftId:draft.id,expectedRevision:draft.revision,confirmPublish:true,confirmInstanceRebind:false,rebindRelations:[],createRelations:[{sourceCardId:character.id,targetCardId:companion}]};
      await assert.rejects(settlement.publishSettlementRelationConfigurationDraft(book,{...publishing,requestKey:randomUUID(),confirmPublish:false}),error=>error.status===422);
      const published=await settlement.publishSettlementRelationConfigurationDraft(book,publishing);
      assert.ok(published.relationTypeId);assert.equal((await settlement.publishSettlementRelationConfigurationDraft(book,publishing)).repeated,true);
      assert.equal((await settlement.readSettlementRelationConfigurationReceipt(book,publishing.requestKey)).operation,'publish');
      const formal=published.workspace.published.find(item=>item.id===published.relationTypeId);
      assert.equal(formal.definition.fields[0].type,'number');assert.equal(formal.definition.dimensions[0].fieldKey,'trust');
      workspace=await settlement.getChapterSettlementEditingWorkspace(session);
      const relation=workspace.catalog.subjects.find(item=>item.subjectKind==='relation'&&item.fields.some(field=>field.key==='trust'));
      assert.ok(relation);assert.equal(relation.fields[0].baseline.known,false);
      workspace=(await settlement.establishChapterSettlementEditingInitialState(session,{expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),subjectId:relation.id,subjectKind:'relation',stateKey:'trust',specificationHash:relation.fields[0].specificationHash,value:10,note:'作者确认本章前信任状态'})).workspace;
      const current=workspace.catalog.subjects.find(item=>item.id===relation.id).fields[0];
      const proposal=await settlement.createChapterSettlementEditingItem(session,{expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),draft:{category:'relationship',title:'同伴信任提升',subjectKind:'relation',subjectId:relation.id,stateKey:'trust',beforeValue:10,afterValue:20,specificationHash:current.specificationHash,baselineHash:current.baseline.hash,riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:content,reason:'正文明确描述同伴信任提升'}});
      workspace=proposal.workspace;const item=workspace.items.find(item=>item.id===proposal.itemId);
      workspace=(await settlement.decideChapterSettlementEditingItems(session,{expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),decisions:[{itemId:item.id,expectedRevision:item.revision,decision:'confirm'}]})).workspace;
      assert.equal((await scopedClient.query("SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2 AND state_key='trust'",[book,relation.id])).rows[0].value_json,10);
    });
    await t.test('expired unknown extraction is explicitly ended with unknown usage and rejects late output',async()=>{
      await withChapterSettlementAiDatabasePool(scopedPool,async()=>{
        const claim=await settlementAiRequests.claimSettlementAi(workspace,{expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),catalogHash:workspace.catalog.specificationHash});
        assert.ok(claim.requestId);
        await assert.rejects(settlementAi.endExpiredUnknownChapterSettlementAiExtraction(claim.requestId),error=>error.status===409);
        await scopedClient.query("UPDATE new_design.ai_task_steps SET lease_expires_at=now()-interval '1 minute',revision=revision+1,updated_at=now() WHERE id=$1",[claim.stepId]);
        assert.equal((await settlementAi.getChapterSettlementAiResult(claim.requestId)).canEndExpiredUnknownRun,true);
        const result=await settlementAi.endExpiredUnknownChapterSettlementAiExtraction(claim.requestId);
        assert.equal(result.status,'ended_unknown');assert.equal(result.modelResultSaved,false);assert.equal(result.proposalsSaved,false);
        assert.equal((await settlementAi.endExpiredUnknownChapterSettlementAiExtraction(claim.requestId)).repeated,true);
        await assert.rejects(settlementAiRequests.saveSettlementModelOutput(claim,{items:[],notes:[]},{}),error=>error.status===409);
        const usage=(await scopedClient.query("SELECT provider,input_tokens,output_tokens,budget_decision FROM new_design.ai_attempt_usage WHERE attempt_id=$1",[claim.attemptId])).rows;
        assert.equal(usage.length,1);assert.equal(usage[0].input_tokens,null);assert.equal(usage[0].output_tokens,null);assert.equal(usage[0].budget_decision,'unknown');
        assert.notEqual(usage[0].provider,'not_invoked');
      });
    });
    await t.test('author confirms, then a single settlement updates the existing ledger and stable snapshot',async()=>{
      const item=workspace.items.find(item=>item.id===receipt.itemId);workspace=(await settlement.decideChapterSettlementEditingItems(session,{expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),decisions:[{itemId:item.id,expectedRevision:item.revision,decision:'confirm'}]})).workspace;
      const commit={expectedSessionRevision:workspace.session.revision,requestKey:randomUUID(),note:'作者明确结算'};
      const failureOffset=sqlFailures.length;
      const result=await settlement.commitChapterSettlementEditing(session,commit).catch(error=>{error.cause=sqlFailures.slice(failureOffset).find(item=>item.code!=='25P02');throw error;});assert.equal(result.workspace.session.status,'stable');
      assert.equal((await settlement.commitChapterSettlementEditing(session,commit)).repeated,true);
      assert.equal((await settlement.readChapterSettlementEditingReceipt(session,commit.requestKey)).workspace.session.status,'stable');
      assert.equal((await scopedClient.query("SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_id=$2",[book,character.id])).rows[0].value_json,2);
      assert.equal((await scopedClient.query("SELECT value_json FROM new_design.current_state_projections WHERE book_id=$1 AND subject_kind='relation' AND state_key='trust'",[book])).rows[0].value_json,20);
      assert.equal((await scopedClient.query("SELECT count(*)::int count FROM new_design.chapter_settlements WHERE book_id=$1",[book])).rows[0].count,1);
      assert.equal((await scopedClient.query("SELECT count(*)::int count FROM new_design.chapter_stable_checkpoints WHERE book_id=$1 AND status='stable'",[book])).rows[0].count,1);
    });
  });
  assert.deepEqual((await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows,originalDefault);
});

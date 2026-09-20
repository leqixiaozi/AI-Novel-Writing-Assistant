const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');
const {randomUUID}=require('node:crypto');

const migration=name=>fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8');

test('manual world scope and payoff window migrations preserve author rows and publish guarded lifecycle metadata',async t=>{
 const {pool}=await isolatedDatabase(t);
 const before=(await pool.query("SELECT count(*)::int cards FROM new_design.cards")).rows[0].cards;
 const systemBefore=(await pool.query("SELECT type.current_version_id,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.type_key='foreshadow'")).rows[0];
 assert.ok(systemBefore);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(migration('106_world_usage_scope.sql'));
  await client.query(migration('107_payoff_ledger_windows.sql'));
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 assert.equal((await pool.query("SELECT count(*)::int cards FROM new_design.cards")).rows[0].cards,before);
 assert.equal((await pool.query("SELECT operational FROM new_design.world_usage_capability WHERE contract='world_usage_scope_v1'")).rows[0].operational,false);
 const installed=(await pool.query("SELECT to_regclass('new_design.world_usage_adoptions') IS NOT NULL world_usage,to_regclass('new_design.payoff_windows') IS NOT NULL payoff")).rows[0];
 assert.equal(installed.world_usage,true);assert.equal(installed.payoff,true);
 const systemAfter=(await pool.query("SELECT type.current_version_id,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.type_key='foreshadow'")).rows[0];
 assert.notEqual(systemAfter.current_version_id,systemBefore.current_version_id);
 assert.equal(systemAfter.fields.find(field=>field.key==='status').stateSettlement,'lifecycle');
 assert.equal((await pool.query('SELECT count(*)::int count FROM new_design.card_type_versions WHERE id=$1',[systemBefore.current_version_id])).rows[0].count,1);
 const template=(await pool.query("SELECT version.payload FROM new_design.template_groups template JOIN new_design.template_group_versions version ON version.id=template.current_version_id WHERE template.template_key='long_novel_core'")).rows[0].payload;
 assert.equal(template.cardTypes.find(item=>item.key==='foreshadow').sourceVersionId,systemAfter.current_version_id);
 const source=(await pool.query("SELECT id book_id,space_id FROM new_design.books WHERE status='active' ORDER BY id LIMIT 1")).rows[0];
 assert.ok(source,'seed book exists');
 // The sample book predates world_overview, so it has neither that type nor a
 // root card. Create both through formal authoring APIs in this isolated DB.
 const catalog=(await pool.query("SELECT type.semantic_capabilities,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.type_key='world_overview' AND type.status='published' LIMIT 1")).rows[0];
 assert.ok(catalog);
 const cardStore=compiled('server/database/store');
 const draft=await cardStore.createCardType({key:'world_overview',name:'世界总览',description:'隔离测试世界根档案',semanticCapabilities:catalog.semantic_capabilities,fields:catalog.fields},source.space_id);
 const published=await cardStore.publishCardType(draft.id,draft.revision);
 const root=await cardStore.createCard({spaceId:source.space_id,cardTypeId:published.id,title:'隔离测试世界观',values:{name:'隔离世界',elevator_pitch:'仅用于验证世界使用范围。'}});
 source.root_id=root.id;
 const payoff=compiled('server/database/payoffLedger');
 const initialLedger=await payoff.getPayoffLedger(source.book_id);
 assert.equal(initialLedger.bookId,source.book_id);
 assert.ok(initialLedger.items.length>0,'seed book has a foreshadow card');
 const item=initialLedger.items[0],windowKey=randomUUID();
 const windowInput={startChapterOrder:2,endChapterOrder:4,expectedRevision:0,idempotencyKey:windowKey};
 const savedWindow=await payoff.savePayoffWindow(source.book_id,item.cardId,windowInput);
 assert.equal(savedWindow.version,1);
 assert.equal((await payoff.getPayoffWindowRequest(source.book_id,windowKey)).id,savedWindow.id);
 assert.equal((await payoff.savePayoffWindow(source.book_id,item.cardId,windowInput)).id,savedWindow.id);
 assert.equal((await payoff.getPayoffLedger(source.book_id)).items.find(entry=>entry.cardId===item.cardId).windowSource,'manual');
 await pool.query("UPDATE new_design.world_usage_capability SET operational=true WHERE contract='world_usage_scope_v1'");
 const world=compiled('server/database/worldUsage');
 const workspace=await world.getWorldUsageWorkspace(source.book_id,source.root_id);
 const rule=workspace.sources.cards.find(card=>card.slotKey==='rules');
 assert.ok(rule,'seed book has a formal rule source');
 const selection={primaryLocationId:null,factionIds:[],locationIds:[],ruleIds:[rule.cardId],boundary:'隔离测试范围'};
 const candidate=await world.prepareWorldUsageCandidate(source.book_id,source.root_id,{requestKey:randomUUID(),mode:'manual',expectedSourceHash:workspace.sources.sourceHash,selection,instruction:''});
 assert.equal(candidate.status,'review');
 const suggestionKey=randomUUID();let modelCalls=0;
 const ai={suggestWorldUsage:async input=>{modelCalls++;assert.equal(input.sources.sourceHash,workspace.sources.sourceHash);return{output:selection,promptSnapshot:{assetId:'new_design.world.usage_scope',version:'v1'},modelSnapshot:{routeSnapshotId:'isolated-fixture'},usedTokens:23};}};
 const suggestionInput={requestKey:suggestionKey,mode:'ai',expectedSourceHash:workspace.sources.sourceHash,instruction:'整理本书规则'};
 const suggestion=await world.prepareWorldUsageCandidate(source.book_id,source.root_id,suggestionInput,ai);
 assert.equal(suggestion.status,'review');assert.equal(suggestion.usedTokens,23);
 assert.equal((await world.prepareWorldUsageCandidate(source.book_id,source.root_id,suggestionInput,ai)).id,suggestion.id);
 assert.equal(modelCalls,1);
 assert.equal((await world.getWorldUsageWorkspace(source.book_id,source.root_id)).adopted,null,'AI candidate cannot become a formal adoption');
 const adopted=await world.adoptWorldUsageCandidate(source.book_id,source.root_id,{requestKey:randomUUID(),candidateId:candidate.id,expectedSourceHash:workspace.sources.sourceHash,expectedCurrentVersion:0});
 assert.equal(adopted.version,1);
 const reader=await pool.connect();
 try{assert.equal((await world.readActiveWorldUsageScopes(reader,source.book_id)).length,1);}finally{reader.release();}
});

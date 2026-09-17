const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs'),{resourceSupplementFixture}=require('./support/resourceSupplementFixture.cjs'),{resourceSupplementHttp}=require('./support/resourceSupplementHttp.cjs');
const key=()=>randomUUID();
test('real PostgreSQL / HTTP preserves confirmed resource history independently of current holding and archival',async t=>{
 const f=await resourceSupplementFixture(t),{pool,book,actor,settlement}=f,prop=await f.create('prop','原确认资源',{name:'原确认资源'});
 const definition={name:'历史核对持有',description:'实际隔离关系',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['prop'],sourceMax:null,targetMax:null,fields:[{key:'holding',name:'持有',type:'boolean',description:'',required:false,defaultValue:null,options:[],group:'资源',order:1,aiSuggestible:true}],capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'holding',label:'持有',direction:'forward',policy:'tracked',mode:'absolute'}]};
 const draft=await settlement.saveSettlementRelationConfigurationDraft(book.id,{requestKey:key(),expectedRelationTypeRevision:null,definition});
 await settlement.publishSettlementRelationConfigurationDraft(book.id,{requestKey:key(),draftId:draft.draftId,expectedRevision:1,confirmPublish:true,confirmInstanceRebind:false,rebindRelations:[],createRelations:[{sourceCardId:actor.id,targetCardId:prop.id}]});
 const ledgerApi=compiled('server/database/characterResources'),historyApi=compiled('server/database/characterResources/history'),ledger=await ledgerApi.getCharacterResources(book.id,actor.id),choice=ledger.choices.find(item=>item.holdingDimensionKey==='holding');
 const selection={relationTypeId:choice.relationTypeId,holdingDimensionKey:choice.holdingDimensionKey,specificationHash:choice.specificationHash},relation=(await ledgerApi.getCharacterResources(book.id,actor.id,selection)).items[0];
 await f.state.saveInitialState({bookId:book.id,subjectKind:'relation',subjectId:relation.relationId,stateKey:'holding',value:false,requestKey:key(),actor:'isolated_test',note:''});
 const extra=after=>(workspace,content)=>{const subject=workspace.catalog.subjects.find(item=>item.id===relation.relationId),field=subject.fields.find(item=>item.key==='holding');return[{category:'relationship',title:'实际持有确认',subjectKind:'relation',subjectId:relation.relationId,stateKey:'holding',specificationHash:field.specificationHash,baselineHash:field.baseline.hash,beforeValue:field.baseline.value,afterValue:after,valueKind:'boolean',riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:'原正文',reason:'作者核对原资源持有',holderKind:'reader',holderKey:'default',stance:'knows',acquisitionMethod:'narration'}];};
 const first=await f.chapter(1,1,false,extra(true)),second=await f.chapter(2,2,false,extra(false)),http=await resourceSupplementHttp(t),path=`/books/${book.id}/characters/${actor.id}/resource-history?${new URLSearchParams(selection)}`;
 const tables=['cards','card_versions','card_relations','card_relation_versions','chapter_documents','chapter_body_versions','chapter_stable_checkpoints','chapter_settlements','state_changes','state_change_proposals','current_state_projections','ai_generation_batches','story_time_proposals','story_event_timings'];
 const frame=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pool.query(`SELECT to_jsonb(row) value FROM new_design.${table} row ORDER BY to_jsonb(row)::text`)).rows])));
 let history;
 await t.test('actual confirmations retain both true and false, exact body evidence, original versions and whole stable sources',async()=>{
  const before=await frame();history=await http.get(path);assert.equal(history.contract,'character_resource_history_v1');assert.equal(history.items.length,1);assert.equal(history.items[0].changes.length,2);
  const [latest,old]=history.items[0].changes;assert.equal(latest.after,false);assert.equal(old.after,true);assert.equal(latest.available,true);assert.equal(old.available,true);assert.equal(latest.fieldLabel,'持有');assert.equal(latest.afterDisplay,'否');
  assert.equal(latest.original.anchor.excerpt,second.content);assert.equal(old.original.anchor.excerpt,first.content);assert.equal(old.original.relationVersion.id,relation.relationVersionId);assert.equal(old.original.resourceVersion.id,relation.resourceVersionId);
  assert.equal(history.chapters.length,2);assert.equal(history.chapters[0].basis.bodyVersionId,second.version.id);assert.equal(history.items[0].currentHolding.available,true);assert.equal(history.items[0].currentHolding.display,'否');assert.equal(history.truncated,false);assert.deepEqual(await frame(),before);
 });
 await t.test('readonly repeated HTTP, missing or foreign full scope and stale specification never create AI or formal changes',async()=>{
  const before=await frame();assert.deepEqual(await http.get(path),history);
  await assert.rejects(http.get(`/books/${book.id}/characters/${key()}/resource-history?${new URLSearchParams(selection)}`));
  await assert.rejects(http.get(`/books/${key()}/characters/${actor.id}/resource-history?${new URLSearchParams(selection)}`));
  await assert.rejects(http.get(`/books/${book.id}/characters/${actor.id}/resource-history`));
  await assert.rejects(historyApi.getCharacterResourceHistory(book.id,actor.id,{...selection,specificationHash:'0'.repeat(64)}));assert.deepEqual(await frame(),before);
 });
 await t.test('archived resource remains in actual old history, with current holding unknown rather than guessed transferred',async()=>{
  const originalChanges=history.items[0].changes,originalChapters=history.chapters;await f.cards.archiveCard(prop.id,prop.revision);
  const before=await frame(),archived=await http.get(path);assert.equal((await ledgerApi.getCharacterResources(book.id,actor.id,selection)).items.length,0);
  assert.equal(archived.items.length,1);assert.equal(archived.items[0].resourceStatus,'archived');assert.equal(archived.items[0].currentHolding,null);assert.deepEqual(archived.items[0].changes,originalChanges);assert.deepEqual(archived.chapters,originalChapters);assert.deepEqual(await frame(),before);
 });
 await t.test('invalid actual adopted-body source keeps both old records and refuses to substitute newest projection',async()=>{
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('UPDATE new_design.chapter_documents SET adopted_version_id=NULL WHERE id=$1',[second.document.id]);
   const invalid=await historyApi.readCharacterResourceHistoryInTransaction(db,book.id,actor.id,selection),changes=invalid.items[0].changes;
   assert.equal(changes.length,2);assert.equal(changes[0].available,false);assert.ok(changes[0].unavailableReason);assert.equal(changes[0].after,false);assert.equal(changes[1].available,true);assert.equal(changes[1].after,true);
  }finally{await db.query('ROLLBACK');db.release();}
 });
 await t.test('archiving the original relation keeps its exact active historical reference without claiming a transfer',async()=>{
  const db=await pool.connect();try{await db.query('BEGIN');
   const current=(await db.query('SELECT * FROM new_design.card_relations WHERE id=$1',[relation.relationId])).rows[0],version=key();
   await db.query("INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by) SELECT $1,relation.id,relation.revision+1,original.source_card_version_id,original.target_card_version_id,'archived',relation.properties,'isolated_test' FROM new_design.card_relations relation JOIN new_design.card_relation_versions original ON original.id=relation.current_version_id WHERE relation.id=$2",[version,relation.relationId]);
   await db.query("UPDATE new_design.card_relations SET status='archived',revision=revision+1,current_version_id=$2 WHERE id=$1",[relation.relationId,version]);
   const archived=await historyApi.readCharacterResourceHistoryInTransaction(db,book.id,actor.id,selection);
   assert.equal(archived.items[0].relationStatus,'archived');assert.equal(archived.items[0].currentHolding,null);assert.equal(archived.items[0].changes.length,2);
   assert.equal(archived.items[0].changes[0].available,true);assert.equal(archived.items[0].changes[0].original.relationVersion.id,current.current_version_id);assert.equal(archived.items[0].changes[0].original.relationVersion.status,'active');
  }finally{await db.query('ROLLBACK');db.release();}
 });
});

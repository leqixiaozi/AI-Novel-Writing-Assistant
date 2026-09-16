const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),express=require('express');
const creation=require('../dist/server/database/bookCreationStore'),production=require('../dist/server/database/bookCreationProduction');
const {mountCreationDirector}=require('../dist/server/http/creationDirector');
const {creationFixture,seedCreationTemplate}=require('./creationProduction/postgresFixture.cjs');
const card=(typeKey,title,values)=>({id:randomUUID(),typeKey,title,values,sourceKind:'manual',sourceId:null,sourceVersionId:null,originalTitle:title,originalValues:structuredClone(values)});
const plan=(level,parentDraftId,reviewCardId,title,decision='adopt',references=[])=>({id:randomUUID(),level,parentDraftId,reviewCardId,title,sortOrder:0,content:{goal:'保存真实规划目标',storyTime:'',mustHappen:[],mustPreserve:[],forbiddenBoundaries:[],expectedChanges:[],characterArc:'',notes:''},executionMode:'manual',references,decision});
test('creation source installs formal originals and exact receipts in isolated real PostgreSQL',
 {skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1',timeout:180000},async t=>{
 const fixture=await creationFixture(t),{db,scopedPool}=fixture,config=await seedCreationTemplate(db);
 const scope=run=>production.withBookCreationProductionPool(scopedPool,run);
 let session,review,receipt;
 const initial={method:'blank',templateVersionId:config.version,bookName:'',description:'',sourceReference:'',inputPayload:{creationDirector:{mode:'automatic',cursor:5}}},createKey=randomUUID();
 await scope(async()=>{
  await t.test('create request is original-key queryable and strips client director claims',async()=>{
   session=await creation.createBookCreationSession({...initial,requestKey:createKey});assert.equal(session.bookName,'');assert.equal(session.inputPayload.creationDirector,undefined);
   assert.equal((await creation.getBookCreationSessionByRequest(createKey)).id,session.id);
   assert.equal((await creation.createBookCreationSession({...initial,requestKey:createKey})).id,session.id);
   await assert.rejects(creation.createBookCreationSession({...initial,bookName:'different',requestKey:createKey}),error=>error.status===409);
  });
  await t.test('manual blank title and fields save without formal-create required gate',async()=>{
   const blank=card('character','',{}),input={bookName:'人工新书',description:'',reviewCards:[blank],revision:session.revision,requestKey:randomUUID(),requireComplete:false};
   session=await creation.saveBookCreationReview(session.id,input);assert.equal(session.reviewCards[0].title,'');assert.equal((await creation.readBookCreationProductionReceipt(session.id,input.requestKey)).session.revision,session.revision);
   await assert.rejects(creation.completeBookCreation(session.id,{expectedRevision:session.revision,requestKey:randomUUID()}),error=>error.status===422&&error.recovery?.mutationOutcome==='not_written');
  });
  await t.test('acknowledged precommit rollback preserves inputs and permits explicit source recovery',async()=>{
   let hit=false;const badDb=new Proxy(db,{get(target,key){if(key==='query')return(sql,values)=>{if(!hit&&typeof sql==='string'&&sql.startsWith('UPDATE new_design.book_creation_sessions SET book_name')){hit=true;return db.query('SELECT 1/0');}return db.query(sql,values);};return Reflect.get(target,key);}});
   await production.withBookCreationProductionPool({query:badDb.query,connect:async()=>badDb},()=>assert.rejects(creation.saveBookCreationReview(session.id,{bookName:'不应写入',description:'',reviewCards:session.reviewCards,revision:session.revision,requestKey:randomUUID()}),error=>error.recovery?.mutationOutcome==='not_written'));
   assert.equal(hit,true);assert.equal((await creation.getBookCreationSession(session.id)).bookName,'人工新书');
  });
  await t.test('manual ordinary review yields atomic exact-key receipt, changed payload cannot replay',async()=>{
   review=[card('character','陆沉',{name:'陆沉',notes:'作者保留备注'}),card('character','江宁',{name:'江宁'}),card('event','守阵夜',{name:'守阵夜'}),card('volume','第一卷',{name:'第一卷'}),card('chapter','第一章',{name:'第一章'}),card('scene','阵门相遇',{name:'阵门相遇'})];
   const input={bookName:'人工新书',description:'',reviewCards:review,revision:session.revision,requestKey:randomUUID()};session=await creation.saveBookCreationReview(session.id,input);
   assert.equal((await creation.saveBookCreationReview(session.id,input)).revision,session.revision);
   await assert.rejects(creation.saveBookCreationReview(session.id,{...input,bookName:'换参'}),error=>error.status===409);
  });
  await t.test('unfinished relation and planning selections save as pending review without becoming formal originals',async()=>{
   const workspace=await creation.getBookCreationProductionWorkspace(session.id),pending=plan('story',null,null,'','pending');pending.content.goal='';const input={expectedSessionRevision:session.revision,expectedFormalRevision:null,requestKey:randomUUID(),templateVersionId:config.version,reviewCardsHash:workspace.catalog.reviewCardsHash,relations:[{id:randomUUID(),relationTypeSourceId:'',sourceReviewCardId:'',targetReviewCardId:'',properties:{},decision:'pending'}],plans:[pending]};
   session=(await creation.saveBookCreationFormalReview(session.id,input)).session;assert.equal(session.formalReview.relations[0].relationTypeSourceId,'');assert.equal(session.formalReview.plans[0].title,'');assert.equal((await db.query('SELECT count(*)::int count FROM new_design.card_relations')).rows[0].count,0);
  });
  await t.test('formal relationship and actual four-layer plans remain review-only before explicit creation',async()=>{
   const workspace=await creation.getBookCreationProductionWorkspace(session.id);assert.deepEqual(workspace.catalog.planningLevels.map(level=>level.key),['story','volume','chapter','scene']);assert.equal(workspace.catalog.relationSpecs[0].label,'同伴关系');
   const story=plan('story',null,null,'故事总纲'),volume=plan('volume',story.id,review[3].id,'第一卷'),chapter=plan('chapter',volume.id,review[4].id,'第一章','adopt',[{role:'event',reviewCardId:review[2].id,action:null,note:'章节引用同一事件',sortOrder:0}]),scene=plan('scene',chapter.id,review[5].id,'阵门相遇');
   const input={expectedSessionRevision:session.revision,expectedFormalRevision:session.formalReview?.revision??null,requestKey:randomUUID(),templateVersionId:config.version,reviewCardsHash:workspace.catalog.reviewCardsHash,relations:[{id:randomUUID(),relationTypeSourceId:config.relation,sourceReviewCardId:review[0].id,targetReviewCardId:review[1].id,properties:{reason:'共同守阵'},decision:'include'}],plans:[story,volume,chapter,scene]};
   receipt=await creation.saveBookCreationFormalReview(session.id,input);session=receipt.session;assert.equal((await creation.saveBookCreationFormalReview(session.id,input)).repeated,true);
   assert.equal((await db.query('SELECT count(*)::int count FROM new_design.books')).rows[0].count,0);assert.equal((await db.query('SELECT count(*)::int count FROM new_design.planning_objects')).rows[0].count,0);
  });
  await t.test('final confirmation atomically creates originals, relation versions and exact event references',async()=>{
   const input={expectedRevision:session.revision,requestKey:randomUUID()};let lost=false;
   const lostAckDb=new Proxy(db,{get(target,key){if(key==='query')return async(sql,values)=>{const result=await db.query(sql,values);if(sql==='COMMIT'&&!lost){lost=true;throw new Error('fixture commit acknowledgement lost');}return result;};return Reflect.get(target,key);}});
   await production.withBookCreationProductionPool({query:lostAckDb.query,connect:async()=>lostAckDb},()=>assert.rejects(creation.completeBookCreation(session.id,input),error=>error.recovery?.mutationOutcome==='unknown'));
   assert.equal(lost,true);const installed=await creation.readBookCreationProductionReceipt(session.id,input.requestKey),completed=installed.session;assert.equal(completed.status,'completed');assert.ok(completed.bookId);assert.equal(installed.operation,'complete');assert.equal(installed.installed.relations.length,1);assert.equal(installed.installed.plans.length,4);
   const relation=(await db.query('SELECT relation.*,version.source_card_version_id,version.target_card_version_id FROM new_design.card_relations relation JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id')).rows[0];assert.ok(relation.current_version_id);assert.equal(relation.properties.reason,'共同守阵');
   const event=installed.installed.cards.find(item=>item.reviewCardId===review[2].id),ref=(await db.query("SELECT * FROM new_design.planning_version_references WHERE reference_role='event'")).rows[0];assert.equal(ref.card_id,event.cardId);assert.equal(ref.card_version_id,event.cardVersionId);
   assert.equal((await creation.completeBookCreation(session.id,input)).bookId,completed.bookId);assert.equal((await db.query('SELECT count(*)::int count FROM new_design.books')).rows[0].count,1);session=completed;
  });
  await t.test('empty manual book keeps its existing direct-create path without invented planning gate',async()=>{
   let blank=await creation.createBookCreationSession({...initial,inputPayload:{},bookName:'空白书籍',requestKey:randomUUID()});blank=await creation.saveBookCreationReview(blank.id,{bookName:blank.bookName,description:'',reviewCards:[],revision:blank.revision,requestKey:randomUUID()});const completed=await creation.completeBookCreation(blank.id,{expectedRevision:blank.revision,requestKey:randomUUID()});assert.equal(completed.status,'completed');assert.equal((await db.query('SELECT count(*)::int count FROM new_design.planning_objects WHERE book_id=$1',[completed.bookId])).rows[0].count,0);
  });
 });
 await t.test('independent source HTTP reads original committed receipt without mutating or recreating',async()=>{
  const app=express(),router=express.Router();app.use(express.json());app.use((_req,_res,next)=>scope(()=>next()));mountCreationDirector(router);app.use('/api/new-design',router);app.use((error,_req,res,_next)=>res.status(error.status||500).json({success:false,error:error.message,recovery:error.recovery}));
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/new-design/book-creation/sessions/${session.id}/write-receipts?requestKey=${receipt.requestKey}`);assert.equal(response.status,200);assert.equal((await response.json()).data.operation,'save_formal_review');assert.equal((await db.query('SELECT count(*)::int count FROM new_design.books')).rows[0].count,2);
 });
 await fixture.authorUnchanged();console.log('creation_fixture_retained',fixture.schema);
});

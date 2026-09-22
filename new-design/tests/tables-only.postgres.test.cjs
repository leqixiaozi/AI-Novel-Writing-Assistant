const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {finalCardKernelDatabase,compiled}=require('./support/isolatedDatabase.cjs');

const key=()=>randomUUID();
const defaultSpace='00000000-0000-4000-8000-000000000001';
function scopedUuid(seed){const hash=createHash('md5').update(seed).digest('hex');return`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20)}`;}
const conflict=error=>error.status===409;
const versionHistoryRejected=error=>error.code==='P0001'&&/版本|历史|不可/.test(error.message);

test('132 tables-only blank database supports real manual author workflows without compatibility views or a model',{
 skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1'&&!process.env.ND_REFERENCE_TEST_BUILD,
 timeout:300000,
},async t=>{
 // This is the only database entry: the support helper creates and retains a new named empty database.
 // It neither copies author rows nor calls ordinary startup. All writes below use that returned pool.
 const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('This manual baseline test must never request a real model or external HTTP.');});
 const {pool,database}=await finalCardKernelDatabase(t);
 assert.match(database,/^nd_reference_test_[a-f0-9]{32}$/);
 const identity=(await pool.query('SELECT current_database() AS database')).rows[0];
 assert.equal(identity.database,database);
 const physical=(await pool.query(`SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind='r') app_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design_projection' AND c.relkind='r') projection_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('new_design','new_design_projection') AND c.relkind IN('v','m')) views,
  (SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'new_design_compat%') compatibility_schemas,
  (SELECT count(*) FROM new_design.card_types WHERE type_key LIKE 'legacy.%') legacy_types`)).rows[0];
 assert.deepEqual(Object.fromEntries(Object.entries(physical).map(([name,value])=>[name,Number(value)])),{app_tables:79,projection_tables:4,views:0,compatibility_schemas:0,legacy_types:0});
 assert.deepEqual((await pool.query('SELECT id FROM new_design.schema_migrations ORDER BY id')).rows.map(row=>row.id),['132_card_kernel_tables_only']);
 const capability=(await pool.query("SELECT installed,operational,details->>'storage' AS storage FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2'")).rows[0];
 assert.deepEqual(capability,{installed:true,operational:true,storage:'tables_only'});
 assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.books')).rows[0].count,0);

 const records=compiled('server/database/recordCards');
 const templates=compiled('server/database/templateStore');
 const cards=compiled('server/database/store');
 const author=compiled('server/database/authorMaterials');
 const planning=compiled('server/database/planning');
 const bodies=compiled('server/database/chapterBodyStore');
 const writing=compiled('server/database/chapterWriting');
 const hub=compiled('server/database/creativeHub');

 // Deterministic published author sources must exist before any book or user data is created.
 const form=await records.requireRecordCard(pool,'34000000-0000-4000-8000-000000000001','card_group_form','Seeded event form missing');
 assert.equal(form.form_key,'event_planning');assert.equal(form.status,'published');assert.equal(form.space_id,null);
 assert.equal(form.current_version_id,'35000000-0000-4000-8000-000000000001');
 const formVersion=await records.requireRecordCard(pool,form.current_version_id,'card_group_form_version','Seeded form version missing');
 assert.equal(formVersion.form_id,form.id);assert.equal(formVersion.definition.primaryTypeKey,'event');
 assert.ok(Array.isArray(formVersion.definition.tabs)&&formVersion.definition.tabs.length>0);
 const dictionary=await records.requireRecordCard(pool,'31000000-0000-4000-8000-000000000001','dictionary_definition','Seeded story-role dictionary missing');
 assert.equal(dictionary.dictionary_key,'story_role');assert.equal(dictionary.scope,'system');assert.equal(dictionary.status,'published');
 const dictionaryItems=await records.listRecordCards(pool,'dictionary_item',{where:{dictionary_id:dictionary.id,status:'active'}});
 assert.deepEqual(dictionaryItems.map(row=>row.item_key).sort(),['antagonist','mentor','protagonist','supporting']);
 for(const item of dictionaryItems){
  assert.equal(item.current_version_id,scopedUuid(`dictionary-item-version:${item.id}:1`));
  const version=await records.requireRecordCard(pool,item.current_version_id,'dictionary_item_version','Seeded dictionary version missing');
  assert.equal(version.item_id,item.id);assert.equal(version.label,item.label);
 }
 const defaultTypes=await cards.listCardTypes(defaultSpace),characterDefault=defaultTypes.find(type=>type.key==='character');
 assert.ok(characterDefault);assert.ok(defaultTypes.some(type=>type.key==='chapter'));assert.ok(defaultTypes.some(type=>type.key==='project_rule'));
 const field=(await pool.query(`SELECT field.id,field.field_key,field.current_version_id,version.field_schema
  FROM new_design.field_definitions field JOIN new_design.field_definition_versions version ON version.id=field.current_version_id AND version.field_definition_id=field.id
  WHERE field.card_type_id=$1 AND field.field_key='name' AND field.status='active'`,[characterDefault.id])).rows[0];
 assert.ok(field);assert.equal(field.id,scopedUuid(`${characterDefault.id}:name`));assert.equal(field.field_schema.key,'name');
 assert.equal(field.field_schema.required,true);

 // Open a book only through the current template repository, preserving installed field/form sources.
 let template=await templates.saveTemplate({key:`tables_${key().replaceAll('-','')}`,name:'纯表隔离验收模板',description:'人工流程隔离测试',draftConfig:{},requestKey:key()});
 template=await templates.publishTemplate(template.id,template.revision,key());
 const book=await templates.createBook({key:`tables_${key().replaceAll('-','')}`,name:'纯表隔离验收作品',description:'虚构测试资料，不调用模型',templateVersionId:template.currentVersionId},{includeTemplateSeed:false});
 assert.notEqual(book.spaceId,defaultSpace);
 const bookTypes=await cards.listCardTypes(book.spaceId),characterType=bookTypes.find(type=>type.key==='character');
 assert.ok(characterType);assert.ok(bookTypes.find(type=>type.key==='volume'));assert.ok(bookTypes.find(type=>type.key==='chapter'));
 const exposedTypeIds=bookTypes.map(type=>type.id);
 assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.card_types WHERE id=ANY($1::uuid[]) AND is_internal',[exposedTypeIds])).rows[0].count,0);
 assert.ok((await pool.query("SELECT count(*)::integer AS count FROM new_design.field_definitions WHERE space_id=$1 AND status='active' AND current_version_id IS NOT NULL",[book.spaceId])).rows[0].count>0);
 const createMaterial=async(typeKey,title,values)=>{
  const type=bookTypes.find(type=>type.key===typeKey);assert.ok(type,`installed ${typeKey} type`);
  return author.createAuthorMaterial(book.id,{requestKey:key(),cardTypeId:type.id,title,values,formVersionId:null,formResolutionKind:'type_schema'});
 };

 const originalInput={requestKey:key(),cardTypeId:characterType.id,title:'沈舟',values:{name:'沈舟',story_role:'supporting',age:0,personality:'谨慎'},formVersionId:null,formResolutionKind:'type_schema'};
 const original=await author.createAuthorMaterial(book.id,originalInput);
 const replayed=await author.createAuthorMaterial(book.id,originalInput);
 assert.equal(replayed.card.id,original.card.id);assert.equal(replayed.cardVersionId,original.cardVersionId);assert.equal(replayed.repeated,true);
 await assert.rejects(author.createAuthorMaterial(book.id,{...originalInput,title:'同键的另一个人物'}),conflict);
 const changed=await author.updateAuthorMaterial(book.id,original.card.id,{...originalInput,requestKey:key(),revision:original.card.revision,values:{...originalInput.values,personality:'谨慎但愿意求证'}});
 assert.equal((await cards.getCard(original.card.id)).values.personality,'谨慎但愿意求证');
 assert.equal((await author.readAuthorMaterialWriteReceipt(book.id,originalInput.requestKey)).cardVersionId,original.cardVersionId);
 await assert.rejects(author.updateAuthorMaterial(book.id,original.card.id,{...originalInput,requestKey:key(),revision:original.card.revision,title:'过期页面写入'}),conflict);
 const materialHistory=await cards.listCardVersions(original.card.id);
 assert.equal(materialHistory.length,2);
 assert.equal(materialHistory.find(version=>version.id===original.cardVersionId).values.personality,'谨慎');
 await assert.rejects(pool.query("UPDATE new_design.card_versions SET values=jsonb_set(values,'{personality}','\"篡改历史\"'::jsonb) WHERE id=$1",[original.cardVersionId]),versionHistoryRejected);
 assert.equal((await cards.getCard(original.card.id)).revision,changed.card.revision);

 // A caller-owned transaction rolls back the real author writer, its receipt, and all physical versions.
 const rollbackInput={...originalInput,requestKey:key(),title:'只应存在于回滚事务',values:{...originalInput.values,name:'回滚人物'}};
 const transaction=await pool.connect();let rolledBackCardId,rolledBackVersionId;
 try{
  await transaction.query('BEGIN');
  const pending=await author.createAuthorMaterialInTransaction(transaction,book.id,rollbackInput);
  rolledBackCardId=pending.card.id;rolledBackVersionId=pending.cardVersionId;
  assert.equal((await transaction.query('SELECT count(*)::integer AS count FROM new_design.cards WHERE id=$1',[rolledBackCardId])).rows[0].count,1);
  await transaction.query('ROLLBACK');
 }catch(error){await transaction.query('ROLLBACK');throw error;}finally{transaction.release();}
 assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.cards WHERE id=$1',[rolledBackCardId])).rows[0].count,0);
 assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.card_versions WHERE id=$1',[rolledBackVersionId])).rows[0].count,0);
 assert.equal(await author.readAuthorMaterialWriteReceipt(book.id,rollbackInput.requestKey),null);

 const content={goal:'送达原信',mustHappen:[],mustPreserve:[],forbiddenBoundaries:[],expectedChanges:[],characterArc:'',notes:''};
 const storyInput={bookId:book.id,level:'story',parentObjectId:null,cardId:null,title:'故事总纲',sortOrder:0,content,source:'manual',executionMode:'manual',references:[],idempotencyKey:key()};
 let story=await planning.createPlanningObject(storyInput);
 assert.equal(story.adoptedVersionId,null);assert.equal(story.currentVersion.source,'manual');
 assert.equal((await planning.createPlanningObject(storyInput)).id,story.id);
 await assert.rejects(planning.createPlanningObject({...storyInput,content:{...content,goal:'同键更改总纲'}}),conflict);
 const firstPlanVersion=story.currentVersionId;
 story=await planning.adoptPlanningVersion(story.id,{versionId:firstPlanVersion,expectedRevision:story.revision,idempotencyKey:key()});
 assert.equal(story.adoptedVersionId,firstPlanVersion);
 const nextPlanInput={expectedRevision:story.revision,content:{...content,goal:'先求证再送达原信'},source:'manual',executionMode:'manual',references:[],idempotencyKey:key()};
 const oldPlanRevision=story.revision;
 story=await planning.addPlanningVersion(story.id,nextPlanInput);
 assert.equal(story.adoptedVersionId,firstPlanVersion);assert.notEqual(story.currentVersionId,firstPlanVersion);
 await assert.rejects(planning.addPlanningVersion(story.id,{...nextPlanInput,idempotencyKey:key(),expectedRevision:oldPlanRevision}),conflict);
 story=await planning.adoptPlanningVersion(story.id,{versionId:story.currentVersionId,expectedRevision:story.revision,idempotencyKey:key()});
 const retainedStory=await planning.getPlanningObject(story.id);
 assert.equal(retainedStory.versions.length,2);assert.equal(retainedStory.versions.find(version=>version.id===firstPlanVersion).content.goal,'送达原信');
 assert.equal(retainedStory.adoptions.length,2);
 const oldPlanRecord=await records.requireRecordCard(pool,firstPlanVersion,'planning_version','Original planning version missing');
 const oldPlanPhysical=(await pool.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[oldPlanRecord.recordCardId])).rows[0].current_version_id;
 await assert.rejects(pool.query("UPDATE new_design.card_versions SET values=jsonb_set(values,'{content,goal}','\"篡改规划\"'::jsonb) WHERE id=$1",[oldPlanPhysical]),versionHistoryRejected);

 async function childPlan(level,parent,card,title){
  let object=await planning.createPlanningObject({bookId:book.id,level,parentObjectId:parent.id,basedOnParentVersionId:parent.adoptedVersionId,cardId:card.id,title,sortOrder:1,content,source:'manual',executionMode:'manual',references:[],idempotencyKey:key()});
  assert.equal(object.adoptedVersionId,null);
  object=await planning.adoptPlanningVersion(object.id,{versionId:object.currentVersionId,expectedRevision:object.revision,idempotencyKey:key()});
  return object;
 }
 const volumeCard=(await createMaterial('volume','求证卷',{volume_name:'求证卷',major_goal:'送达原信'})).card;
 const volume=await childPlan('volume',story,volumeCard,'求证卷');
 const chapterCard=(await createMaterial('chapter','第一封信',{chapter_name:'第一封信',chapter_goal:'送达原信'})).card;
 const chapterPlan=await childPlan('chapter',volume,chapterCard,'第一封信');
 let document=await bodies.createChapterDocument({bookId:book.id,chapterCardId:chapterCard.id,logicalOrder:1,title:'第一封信'});
 const draft={content:'沈舟把原信藏在斗篷里，决定先问清来处。',operationKind:'manual_draft',expectedRevision:document.revision,idempotencyKey:key(),createdBy:'isolated-author'};
 document=await writing.saveChapterCandidate(document.id,draft);
 const firstBody=document.versions[0];assert.equal(firstBody.planningVersionId,chapterPlan.adoptedVersionId);assert.equal(document.adoptedVersionId,null);
 assert.equal((await writing.saveChapterCandidate(document.id,draft)).versions.length,1);
 await assert.rejects(writing.saveChapterCandidate(document.id,{...draft,content:'同键不能替换原稿。'}),conflict);
 const bodyAdoption={versionId:firstBody.id,expectedRevision:document.revision,idempotencyKey:key(),actor:'isolated-author'};
 document=await bodies.adoptChapterBodyVersion(document.id,bodyAdoption);
 assert.equal(document.adoptedVersionId,firstBody.id);
 assert.equal((await bodies.adoptChapterBodyVersion(document.id,bodyAdoption)).adoptions.length,1);
 const priorDocumentRevision=document.revision;
 document=await writing.saveChapterCandidate(document.id,{...draft,content:'沈舟核对封蜡后，才把原信交给守门人。',expectedRevision:document.revision,idempotencyKey:key()});
 const secondBody=document.versions[0];assert.equal(document.adoptedVersionId,firstBody.id);
 await assert.rejects(bodies.adoptChapterBodyVersion(document.id,{versionId:secondBody.id,expectedRevision:priorDocumentRevision,idempotencyKey:key(),actor:'isolated-author'}),conflict);
 await assert.rejects(bodies.adoptChapterBodyVersion(document.id,{...bodyAdoption,versionId:secondBody.id}),conflict);
 document=await bodies.adoptChapterBodyVersion(document.id,{versionId:secondBody.id,expectedRevision:document.revision,idempotencyKey:key(),actor:'isolated-author'});
 assert.equal(document.adoptedVersionId,secondBody.id);assert.equal(document.versions.length,2);assert.equal(document.adoptions.length,2);
 assert.equal(document.versions.find(version=>version.id===firstBody.id).content,draft.content);
 await assert.rejects(pool.query('UPDATE new_design.chapter_body_versions SET content=$2 WHERE id=$1',[firstBody.id,'不可覆盖的正文历史']),error=>error.code==='23514');
 assert.equal((await bodies.getChapterDocument(document.id)).versions.find(version=>version.id===firstBody.id).content,draft.content);

 await hub.withCreativeHubPool(pool,async()=>{
  const available=await hub.getCreativeHubCapability();assert.equal(available.installed,true);assert.equal(available.operational,true);
  const thread=await hub.createCreativeHubThread({title:'无绑定创作中枢',binding:{}});
  assert.deepEqual(thread.binding,{});assert.equal(thread.status,'active');
  const renamed=await hub.updateCreativeHubThread(thread.id,{title:'保留历史的无绑定会话',expectedRevision:thread.revision});
  await assert.rejects(hub.archiveCreativeHubThread(thread.id,thread.revision),conflict);
  const archived=await hub.archiveCreativeHubThread(thread.id,renamed.revision);
  const read=await hub.getCreativeHubThread(thread.id);
  assert.equal(read.status,'archived');assert.equal(read.revision,archived.revision);assert.deepEqual(read.binding,{});
  assert.equal((await hub.listCreativeHubThreads()).some(item=>item.id===thread.id),false);
  assert.equal((await hub.listCreativeHubThreads({includeArchived:true})).some(item=>item.id===thread.id),true);
  assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.card_versions WHERE card_id=$1',[thread.id])).rows[0].count,3);
 });
 assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.ai_tasks')).rows[0].count,0);
 assert.equal((await pool.query('SELECT count(*)::integer AS count FROM new_design.model_route_snapshots')).rows[0].count,0);
 assert.equal(network.mock.callCount(),0);
 t.diagnostic('Assertions executed only against the newly-created isolated database; manual repository paths, immutable history and rollback, zero AI tasks and zero HTTP calls.');
});

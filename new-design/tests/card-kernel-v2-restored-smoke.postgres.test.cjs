const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');

test('restored author snapshot remains writable through the final card-kernel workflows',{skip:!process.env.ND_CARD_KERNEL_RESTORE_DATABASE,timeout:120000},async t=>{
 const local=JSON.parse(fs.readFileSync(path.join(__dirname,'../.data/runtime.json'),'utf8'));
 const pool=new Pool({...local,host:'127.0.0.1',port:Number(process.env.ND_CARD_KERNEL_RESTORE_PORT),database:process.env.ND_CARD_KERNEL_RESTORE_DATABASE,max:8,application_name:'card_kernel_v2_restored_smoke'});
 t.after(()=>pool.end());
 const runtime=require('../dist/server/database/runtime');
 runtime.getNewDesignPool=async()=>pool;
 runtime.getInitializedNewDesignPool=async()=>pool;

 const counts=(await pool.query("SELECT (SELECT count(*) FROM new_design.schema_migrations) migrations,(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind='r') tables")).rows[0];
 assert.deepEqual({migrations:Number(counts.migrations),tables:Number(counts.tables)},{migrations:128,tables:79});

 const templates=require('../dist/server/database/templateStore');
 const template=(await templates.listTemplates()).find(item=>item.currentVersionId);
 assert.ok(template);
 const createdBook=await templates.createBook({key:`kernel_${randomUUID().replaceAll('-','')}`,name:'卡片内核恢复演练',description:'隔离副本验收',templateVersionId:template.currentVersionId});
 assert.equal(createdBook.name,'卡片内核恢复演练');

 const creative=require('../dist/server/database/creativeHub');
 const thread=await creative.createCreativeHubThread({title:'恢复演练会话',binding:{bookId:createdBook.id}});
 const archived=await creative.archiveCreativeHubThread(thread.id,thread.revision);
 assert.equal((await creative.restoreCreativeHubThread(thread.id,archived.revision)).status,'active');

 const comic=require('../dist/server/database/comicProjects');
 const comicProject=await comic.createComicProject({requestKey:randomUUID(),title:'恢复演练漫画',sourceType:'original',sourceText:'雨夜相遇。',comicFormat:'webtoon',stylePreset:'webtoon_color'});
 assert.equal((await comic.getComicProject(comicProject.project.id)).source.content,'雨夜相遇。');

 const drama=require('../dist/server/database/dramaProjects');
 const dramaProject=await drama.createDramaProject({requestKey:randomUUID(),title:'恢复演练短剧',sourceType:'original',sourceText:'旧友重逢。',track:'都市情感',targetEpisodes:12,episodeDurationSec:120});
 assert.equal((await drama.getDramaWorkspace(dramaProject.workspace.project.id)).project.title,'恢复演练短剧');

 const world=require('../dist/server/database/worldGeneration');
 const session=await world.createWorldGenerationSession({requestKey:randomUUID(),name:'恢复演练世界',blueprint:{inspiration:'漂浮群岛',templateKey:'fantasy',references:[],properties:{tone:'冒险'},layers:['overview','rules','factions','locations','relations','tensions']}});
 const candidate={title:'潮忆群岛',elevatorPitch:'以记忆维持群岛浮航。',era:'群岛历三百年',spatialStructure:'七座主岛迁徙。',coreOrder:'议会征收记忆。',ordinaryLife:'居民以刻痕保存往事。',rules:[{name:'记忆守恒',summary:'缴纳的记忆进入潮库。',cost:'遗忘亲人',boundary:'不可复制',enforcement:'欠税留下潮痕'}],factions:[{name:'潮税议会',position:'维持航线',doctrine:'秩序优先',goals:['维持七岛'],methods:['征税']}],locations:[{name:'无灯港',summary:'永不点灯的贸易港。',risk:'潮库泄漏',entryConstraint:'交出记忆'}],relations:[{source:'潮税议会',target:'无灯港',relation:'控制',tension:'反抗加剧'}],tensions:['生存正在侵蚀身份。'],sixLayers:{overview:'迁徙群岛。',rules:'记忆与浮力守恒。',factions:'议会与港民。',locations:'七岛与潮库。',relations:'征税与反抗。',tensions:'生存代价。'}};
 const saved=await world.saveWorldGenerationCandidate(session.session.id,{requestKey:randomUUID(),expectedSessionRevision:1,source:'manual',candidate});
 const published=await world.publishWorldCandidate(session.session.id,{requestKey:randomUUID(),candidateId:saved.candidate.id,expectedSessionRevision:2});
 assert.ok(published.package.rootCardId);
});

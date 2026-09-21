const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');
function blueprint(){return{inspiration:'漂浮在永夜海上的群岛，以记忆缴税。',templateKey:'fantasy',references:[],properties:{tone:'幽暗冒险',power:['潮汐术','记忆契约']},layers:['overview','rules','factions','locations','relations','tensions']};}
function candidate(){return{title:'潮忆群岛',elevatorPitch:'居民以记忆换取浮岛继续航行。',era:'群岛历三百年',spatialStructure:'七座主岛沿永夜潮汐迁徙。',coreOrder:'潮税议会登记并征收记忆。',ordinaryLife:'居民用刻痕和见证人弥补记忆缺口。',rules:[{name:'记忆守恒',summary:'被缴纳的记忆会进入潮库。',cost:'失去一段亲密关系',boundary:'不可凭空复制',enforcement:'潮痕会公开显示欠税'}],factions:[{name:'潮税议会',position:'维持航线',doctrine:'秩序优先',goals:['维持七岛'],methods:['征收潮税']}],locations:[{name:'无灯港',summary:'永不点灯的贸易港。',risk:'潮库泄漏',entryConstraint:'交出一段真实记忆'}],relations:[{source:'潮税议会',target:'无灯港',relation:'控制',tension:'港民反抗加剧'}],tensions:['记忆税维持世界，也持续抹去共同历史。'],sixLayers:{overview:'永夜海上的迁徙群岛。',rules:'记忆与浮力守恒。',factions:'议会和港民对立。',locations:'七岛与潮库。',relations:'征税、庇护与反抗。',tensions:'生存依赖正在摧毁身份。'}};}

test('world wizard versions candidates and publishes only the explicitly selected version',{skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1',timeout:180000},async t=>{
  const {pool}=await isolatedDatabase(t,[{id:'084_world_packages',fileName:'084_world_packages.sql'},{id:'115_creative_hub',fileName:'115_creative_hub.sql'},{id:'116_world_generation_sessions',fileName:'116_world_generation_sessions.sql'}]);
  await pool.query("UPDATE new_design.world_package_capability SET operational=true WHERE contract='public_world_package_v1'");
  const world=compiled('server/database/worldGeneration');
  await world.withWorldGenerationPool(pool,async()=>{
    const created=await world.createWorldGenerationSession({requestKey:randomUUID(),name:'潮忆群岛',blueprint:blueprint()});
    assert.equal(created.session.publicRootCardId,null);assert.equal(created.session.candidates.length,0);
    const first=await world.saveWorldGenerationCandidate(created.session.id,{requestKey:randomUUID(),expectedSessionRevision:1,source:'manual',candidate:candidate()});
    const revised={...candidate(),ordinaryLife:'港民用公共歌谣保存被征走的共同记忆。'};
    const second=await world.saveWorldGenerationCandidate(created.session.id,{requestKey:randomUUID(),expectedSessionRevision:2,basedOnCandidateId:first.candidate.id,source:'manual',candidate:revised});
    assert.equal(second.session.candidates.length,2);assert.equal(second.candidate.version,2);assert.equal(second.session.publicRootCardId,null);
    const request={requestKey:randomUUID(),candidateId:second.candidate.id,expectedSessionRevision:3};
    const published=await world.publishWorldCandidate(created.session.id,request),repeated=await world.publishWorldCandidate(created.session.id,request);
    assert.ok(published.session.publicRootCardId);assert.equal(published.candidate.id,second.candidate.id);assert.equal(published.candidate.status,'published');assert.equal(repeated.repeated,true);assert.equal(repeated.package.id,published.package.id);assert.equal(published.package.frame.relations.length,1);
    assert.equal(Number((await pool.query("SELECT count(*) n FROM new_design.cards WHERE space_id='60000000-0000-4000-8000-000000000001' AND status='active'")).rows[0].n)>0,true);
    assert.equal(Number((await pool.query('SELECT count(*) n FROM new_design.world_package_versions WHERE root_card_id=$1',[published.session.publicRootCardId])).rows[0].n),1);
  });
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');

test('comic AI creates review candidates and old-outline panels become stale without adoption',async t=>{
 await isolatedDatabase(t,[{id:'109_comic_projects',fileName:'109_comic_projects.sql'},{id:'110_comic_episodes',fileName:'110_comic_episodes.sql'},{id:'111_comic_panels',fileName:'111_comic_panels.sql'},{id:'113_comic_source_bundle',fileName:'113_comic_source_bundle.sql'}]);
 const projects=compiled('server/database/comicProjects'),sources=compiled('server/database/comicSourceBundle'),episodes=compiled('server/database/comicEpisodes'),generation=compiled('server/application/comicGeneration');
 const project=(await projects.createComicProject({requestKey:randomUUID(),title:'AI 漫画候选',sourceType:'original',sourceText:'雨夜里，林青收到一封错投的信。',comicFormat:'webtoon',stylePreset:'webtoon_color'})).project;
 let calls=0;const ai={generateComicCandidate:async input=>{calls++;if(input.operation==='source_extract')return{output:{operation:'source_extract',content:{synopsis:'错投来信引发相遇。',beats:[{order:1,summary:'林青收到错投来信'}],characters:[{name:'林青',role:'主角',visualAnchor:'黑发、蓝色雨衣'}]}},promptSnapshot:{assetId:'comic'},modelSnapshot:{route:'planning'},usedTokens:10};if(input.operation==='episode_outline')return{output:{operation:'episode_outline',content:{title:'第一话 雨夜来信',outline:'林青追查来信来源。',hookType:'mystery',cliffhanger:'信封内还有一张旧照片',isPaywalled:false,sourceText:'雨夜里收到错投的信'}},promptSnapshot:{assetId:'comic'},modelSnapshot:{route:'planning'},usedTokens:12};return{output:{operation:'panel_script',panels:[{order:1,panelType:'establishing',action:'林青站在雨夜街道',dialogues:[],characterRefs:['林青'],sceneRef:'街道',visualPrompt:'黑发青年穿蓝色雨衣站在雨夜街道',densityLevel:'low',focus:'错投的信',layoutData:null}]},promptSnapshot:{assetId:'comic'},modelSnapshot:{route:'planning'},usedTokens:15};}};
 const sourceKey=randomUUID(),sourceReceipt=await generation.startComicSourceExtraction(project.id,{requestKey:sourceKey,expectedRevision:0,instruction:''},ai),sourceWorkspace=await sources.getComicSourceBundleWorkspace(project.id),sourceCandidate=sourceWorkspace.versions.find(item=>item.id===sourceReceipt.candidateVersionId);
 assert.equal(sourceCandidate.sourceKind,'ai_candidate');assert.equal(sourceWorkspace.adoptedVersionId,null);
 await sources.adoptComicSourceBundle(project.id,{requestKey:randomUUID(),versionId:sourceCandidate.id,expectedRevision:0});
 const outlineKey=randomUUID(),outlineReceipt=await generation.startComicEpisodeOutline(project.id,{requestKey:outlineKey,order:1,expectedRevision:0,instruction:''},ai),episodeWorkspace=await episodes.getComicEpisodeWorkspace(project.id),episode=episodeWorkspace.episodes[0],outlineV1=episode.versions.find(item=>item.id===outlineReceipt.candidateVersionId);
 assert.equal(outlineV1.sourceKind,'ai_candidate');assert.equal(episode.adoptedVersionId,null);
 await episodes.adoptComicEpisode(project.id,episode.id,{requestKey:randomUUID(),versionId:outlineV1.id,expectedRevision:0});
 const panelKey=randomUUID(),panelReceipt=await generation.startComicPanelScript(project.id,episode.id,{requestKey:panelKey,expectedScriptRevision:0,episodeVersionId:outlineV1.id,densityMode:'balanced',instruction:''},ai);
 assert.equal(panelReceipt.adopted,false);
 const outlineV2=await episodes.proposeComicEpisode(project.id,{requestKey:randomUUID(),order:1,expectedRevision:1,content:{...outlineV1.content,outline:'林青发现来信其实是诱饵。'}});
 await episodes.adoptComicEpisode(project.id,episode.id,{requestKey:randomUUID(),versionId:outlineV2.version.id,expectedRevision:1});
 const stale=await generation.readComicGenerationOriginal(project.id,panelKey);
 assert.equal(stale.readiness,'stale_source');assert.equal(stale.adopted,false);assert.equal(stale.candidateVersionId,panelReceipt.candidateVersionId);
 assert.equal((await generation.startComicPanelScript(project.id,episode.id,{requestKey:panelKey,expectedScriptRevision:0,episodeVersionId:outlineV1.id,densityMode:'balanced',instruction:''},ai)).repeated,true);
 assert.equal(calls,3);
});

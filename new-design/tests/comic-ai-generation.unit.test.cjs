const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs');

test('comic generation prompt has three bounded candidate-only operations',()=>{
 const {preparePrompt,listPromptAssets}=compiled('server/ai/prompts'),projectId=randomUUID(),sourceVersionId=randomUUID(),bundleVersionId=randomUUID(),episodeId=randomUUID(),episodeVersionId=randomUUID();
 assert.ok(listPromptAssets().some(asset=>asset.assetId==='new_design.comic.text_generation'&&asset.taskType==='comic_generation'));
 const source=preparePrompt('comic_generation',{operation:'source_extract',projectId,sourceVersionId,sourceText:'雨夜里收到一封错投的信。',sourceManifest:{kind:'original'},instruction:''});
 assert.deepEqual(source.parseOutput({operation:'source_extract',content:{synopsis:'错投来信引发相遇。',beats:[{order:1,summary:'收到信'}],characters:[]}}).operation,'source_extract');
 const episode=preparePrompt('comic_generation',{operation:'episode_outline',projectId,sourceVersionId,sourceBundleVersionId:bundleVersionId,sourceBundle:{synopsis:'错投来信引发相遇。',beats:[{order:1,summary:'收到信'}],characters:[]},order:1,instruction:''});
 assert.equal(episode.parseOutput({operation:'episode_outline',content:{title:'第一话',outline:'雨夜来信',hookType:'mystery',cliffhanger:'署名被撕掉',isPaywalled:false,sourceText:'收到信'}}).operation,'episode_outline');
 const panel=preparePrompt('comic_generation',{operation:'panel_script',projectId,episodeId,episodeVersionId,episode:{title:'第一话',outline:'雨夜来信',hookType:null,cliffhanger:null,isPaywalled:false,sourceText:null},densityMode:'balanced',continuity:{characters:[],synopsis:null},instruction:''});
 assert.equal(panel.parseOutput({operation:'panel_script',panels:[{order:1,panelType:'establishing',action:'雨夜街道',dialogues:[],characterRefs:[],sceneRef:'街道',visualPrompt:'雨夜街道远景',densityLevel:'low',focus:'路灯',layoutData:null}]}).operation,'panel_script');
 assert.throws(()=>source.parseOutput({operation:'episode_outline',content:{}}));
});

test('comic generation UI retains original keys and never adopts generated output',()=>{
 const root=path.join(__dirname,'../src/client/comicProjects');
 for(const file of ['ComicSourceBundleEditor.tsx','ComicEpisodePlanner.tsx','ComicPanelEditor.tsx']){
  const code=fs.readFileSync(path.join(root,file),'utf8');
  assert.match(code,/generationKey/);assert.match(code,/generationOriginal/);assert.match(code,/尚未采用|未自动采用/);const generation=code.slice(code.indexOf('async function generate()'),code.indexOf('async function checkGeneration()'));assert.doesNotMatch(generation,/\.adopt\(/);
 }
});

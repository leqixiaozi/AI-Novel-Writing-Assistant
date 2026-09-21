const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const domain=require('../dist/common/worldGeneration');
const {preparePrompt,listPromptAssets}=require('../dist/server/ai/prompts');

function blueprint(){return{inspiration:'漂浮在永夜海上的群岛，以记忆缴税。',templateKey:'fantasy',references:[],properties:{tone:'幽暗冒险',power:['潮汐术','记忆契约']},layers:[...domain.WORLD_GENERATION_LAYERS]};}
function candidate(){return{title:'潮忆群岛',elevatorPitch:'居民以记忆换取浮岛继续航行。',era:'群岛历三百年',spatialStructure:'七座主岛沿永夜潮汐迁徙。',coreOrder:'潮税议会登记并征收记忆。',ordinaryLife:'居民用刻痕和见证人弥补记忆缺口。',rules:[{name:'记忆守恒',summary:'被缴纳的记忆会进入潮库。',cost:'失去一段亲密关系',boundary:'不可凭空复制',enforcement:'潮痕会公开显示欠税'}],factions:[{name:'潮税议会',position:'维持航线',doctrine:'秩序优先',goals:['维持七岛'],methods:['征收潮税']}],locations:[{name:'无灯港',summary:'永不点灯的贸易港。',risk:'潮库泄漏',entryConstraint:'交出一段真实记忆'}],relations:[{source:'潮税议会',target:'无灯港',relation:'控制',tension:'港民反抗加剧'}],tensions:['记忆税维持世界，也持续抹去共同历史。'],sixLayers:{overview:'永夜海上的迁徙群岛。',rules:'记忆与浮力守恒。',factions:'议会和港民对立。',locations:'七岛与潮库。',relations:'征税、庇护与反抗。',tensions:'生存依赖正在摧毁身份。'}};}

test('world blueprint keeps references and all six deliberate layers',()=>{
  const input={requestKey:randomUUID(),name:'潮忆群岛',blueprint:blueprint()};
  assert.deepEqual(domain.worldGenerationStartSchema.parse(input),input);
  assert.deepEqual(domain.worldGenerationCandidateSchema.parse(candidate()),candidate());
  assert.throws(()=>domain.worldGenerationStartSchema.parse({...input,blueprint:{...input.blueprint,layers:['overview']}}));
});

test('world generation prompt is dedicated and candidate output stays unpublished',()=>{
  assert.ok(listPromptAssets().some(asset=>asset.assetId==='new_design.world.generation'&&asset.taskType==='world_generation'));
  const prompt=preparePrompt('world_generation',{mode:'generate',name:'潮忆群岛',blueprint:blueprint(),previous:null,instruction:''}),output=candidate();
  assert.deepEqual(prompt.parseOutput(output),output);
  assert.equal(Object.hasOwn(output,'publicRootCardId'),false);
  assert.throws(()=>prompt.parseOutput({...output,rules:[]}));
});

test('world generation exposes controlled application and HTTP commands',()=>{
  const application=join(__dirname,'../src/server/application/worldGeneration/index.ts');
  const http=join(__dirname,'../src/server/http/worldGeneration/index.ts');
  assert.equal(existsSync(application),true,'world generation application is missing');
  assert.equal(existsSync(http),true,'world generation HTTP router is missing');
  const applicationSource=readFileSync(application,'utf8'),httpSource=readFileSync(http,'utf8');
  assert.match(applicationSource,/generateWorldCandidate/);
  assert.match(applicationSource,/readWorldGenerationOriginal/);
  assert.match(httpSource,/\/world-generation\/sessions/);
  assert.match(httpSource,/\/regenerate/);
  assert.match(httpSource,/\/publish/);
});

test('world generator and workspace are reachable from the world catalog',()=>{
  const routeSource=readFileSync(join(__dirname,'../src/client/NewDesignPage.tsx'),'utf8');
  const catalogSource=readFileSync(join(__dirname,'../src/client/worldCatalog/WorldCatalogPage.tsx'),'utf8');
  const generator=join(__dirname,'../src/client/worldGenerator/WorldGeneratorPage.tsx');
  const workspace=join(__dirname,'../src/client/worldGenerator/WorldWorkspacePage.tsx');
  assert.equal(existsSync(generator),true,'world generator page is missing');
  assert.equal(existsSync(workspace),true,'world workspace page is missing');
  assert.match(routeSource,/resources\/worlds\/new/);
  assert.match(routeSource,/WorldWorkspacePage rootCardId=/);
  assert.match(catalogSource,/创建世界样本/);
  assert.match(readFileSync(generator,'utf8'),/明确发布/);
  assert.match(readFileSync(workspace,'utf8'),/六层/);
});

module.exports={blueprint,candidate};

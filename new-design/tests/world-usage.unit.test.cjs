const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {worldUsageSourcesSchema,worldUsageSelectionSchema,worldUsagePrepareInputSchema,validateWorldUsageSelection,worldUsageCreativeScopes}=require('../src/common/worldUsage/index.ts');
const {preparePrompt}=require('../src/server/ai/prompts/index.ts');

const bookId='51000000-0000-4000-8000-000000000001';
const rootCardId='51000000-0000-4000-8000-000000000002';
const factionId='51000000-0000-4000-8000-000000000003';
const locationId='51000000-0000-4000-8000-000000000004';
const ruleId='51000000-0000-4000-8000-000000000005';
const outsiderId='51000000-0000-4000-8000-000000000006';
const requestKey='51000000-0000-4000-8000-000000000007';
const sourceHash='a'.repeat(64);
const card=(cardId,slotKey,typeKey)=>({cardId,versionId:cardId,typeKey,title:typeKey,values:{name:typeKey},slotKey,mountId:null,mountRevision:null});
const sources=worldUsageSourcesSchema.parse({bookId,rootCardId,rootVersionId:rootCardId,rootTitle:'本书世界',rootValues:{name:'本书世界'},formVersionId:null,instanceId:null,instanceRevision:null,associationSources:[],cards:[card(factionId,'factions','faction'),card(locationId,'locations','location'),card(ruleId,'rules','world_rule')],sourceHash});
const selection={primaryLocationId:locationId,factionIds:[factionId],locationIds:[locationId],ruleIds:[ruleId],boundary:'故事只在本书已采用的地点发生。'};

test('world usage selections require exact same-book source IDs and a selected primary stage',()=>{
 assert.doesNotThrow(()=>validateWorldUsageSelection(sources,worldUsageSelectionSchema.parse(selection)));
 assert.throws(()=>validateWorldUsageSelection(sources,{...selection,factionIds:[outsiderId]}),/来源以外/);
 assert.throws(()=>validateWorldUsageSelection(sources,{...selection,factionIds:[factionId,factionId]}),/重复/);
 assert.throws(()=>validateWorldUsageSelection(sources,{...selection,locationIds:[]}),/主舞台/);
 assert.throws(()=>validateWorldUsageSelection(sources,{primaryLocationId:null,factionIds:[],locationIds:[],ruleIds:[],boundary:'任意文字'}),/至少明确保留/);
});

test('plain boundary text cannot be submitted as an adopted scope',()=>{
 const textOnly=worldUsagePrepareInputSchema.parse({requestKey,mode:'manual',expectedSourceHash:sourceHash,instruction:'',selection:{primaryLocationId:null,factionIds:[],locationIds:[],ruleIds:[],boundary:'一句建议'}});
 assert.throws(()=>validateWorldUsageSelection(sources,textOnly.selection),/至少明确保留/);
 assert.throws(()=>worldUsagePrepareInputSchema.parse({requestKey,mode:'manual',expectedSourceHash:sourceHash,instruction:''}));
 assert.throws(()=>worldUsagePrepareInputSchema.parse({requestKey,mode:'ai',expectedSourceHash:sourceHash,instruction:'',selection}));
});

test('creative input carries only the explicit adopted versions and their original values',()=>{
 const scopes=worldUsageCreativeScopes([{id:requestKey,bookId,rootCardId,candidateId:requestKey,requestKey,inputHash:sourceHash,version:2,sources,selection,createdAt:new Date(0).toISOString()}]);
 assert.equal(scopes.length,1);
 assert.equal(scopes[0].adoptionId,requestKey);
 assert.equal(scopes[0].rootVersionId,rootCardId);
 assert.deepEqual(scopes[0].factions,[{cardId:factionId,versionId:factionId,title:'faction',values:{name:'faction'}}]);
 assert.deepEqual(scopes[0].locations.map(item=>item.cardId),[locationId]);
 assert.deepEqual(scopes[0].rules.map(item=>item.cardId),[ruleId]);
 assert.equal(scopes[0].boundary,selection.boundary);
});

test('existing planning and chapter prompt inputs retain the exact adopted scope without granting adoption to text',()=>{
 const worldUsage=worldUsageCreativeScopes([{id:requestKey,bookId,rootCardId,candidateId:requestKey,requestKey,inputHash:sourceHash,version:1,sources,selection,createdAt:new Date(0).toISOString()}]);
 const planning=preparePrompt('planning_candidate',{bookName:'本书',bookDescription:'',target:{level:'story',title:'总纲',currentContent:null,parentContent:null},materials:[],adoptedPlans:[],instruction:'',worldUsage});
 assert.deepEqual(JSON.parse(planning.messages[1].content).taskData.worldUsage,worldUsage);
 const chapter=preparePrompt('chapter_generation',{bookId,bookName:'本书',chapterCardId:rootCardId,chapterTitle:'第一章',operation:'regenerate',plans:[{objectId:rootCardId,versionId:rootCardId,level:'story',contentHash:sourceHash,content:{},executionMode:'manual',references:[]}],materials:[],worldUsage,continuity:{sources:[],notes:[]},knowledge:[],body:null,selection:null,instruction:'',issuePolicy:'completion_first'});
 assert.deepEqual(JSON.parse(chapter.messages[1].content).taskData.worldUsage,worldUsage);
 assert.equal(chapter.version,'v2');
});

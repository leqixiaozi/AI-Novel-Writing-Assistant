const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'../src/client');
const source=name=>readFileSync(join(root,name),'utf8');

test('guide derives five milestones from real new-design state',()=>{
 const path=join(root,'guide/NewDesignGuidePage.tsx');assert.equal(existsSync(path),true,'new-design guide page is missing');const value=readFileSync(path,'utf8');
 for(const label of ['创作环境','灵感与方向','开书准备','生产方式','首章成稿'])assert.match(value,new RegExp(label));
 assert.match(value,/getHomeSnapshot/);assert.match(value,/getHomeModels/);assert.doesNotMatch(value,/useState\([^)]*completed/);
 assert.match(value,/推荐下一步/);
});

test('global routes expose the guide, aggregate settings and all resource sources',()=>{
 const route=source('NewDesignPage.tsx'),navigation=source('navigation.ts'),resources=source('ResourceCenterPage.tsx');
 assert.match(route,/\/new-design\/guide/);assert.match(route,/\/new-design\/structure\/settings/);assert.match(navigation,/创作向导/);assert.match(navigation,/系统设置/);
 const entries=[['题材基底','strategies\\?type=genre_strategy'],['推进模式','strategies\\?type=progression_mode'],['写法','strategies\\?type=writing_config'],['反 AI','strategies\\?type=quality_rule'],['标题','resources\/titles'],['知识','new-design\/knowledge'],['世界','resources\/worlds'],['人物','resources\/characters'],['视觉','resources\/visual-assets'],['提示词','resources\/prompts'],['市场雷达','research\/market-radar'],['拆书','research\/book-analysis'],['研究记录','research\/records'],['参考包','research\/reference-packs']];
 for(const [label,href] of entries){assert.match(resources,new RegExp(label));assert.match(resources,new RegExp(href));}
});

test('research and knowledge retain exact-version completion operations',()=>{
 const market=source('MarketRadarPage.tsx'),analysis=source('BookAnalysisPage.tsx'),records=source('ResearchRecordsPage.tsx'),packs=source('ReferencePacksPage.tsx'),knowledge=source('knowledgeReference/index.tsx');
 assert.match(market,/selectedItems/);assert.match(analysis,/getBookAnalysisByKey/);assert.match(records,/归档记录/);assert.match(packs,/来源版本已冻结/);assert.match(packs,/目标书籍/);
 for(const label of ['上传并保存','解析正文','索引与检索','保存使用位置','确认归档'])assert.match(knowledge,new RegExp(label));
 assert.match(knowledge,/回执不属于本书/);
});

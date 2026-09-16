const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {marketAnalysisMatchesSelection,researchCandidateValueLabel}=require("../dist/common/researchInputReview");
const {marketAnalysisInputHash}=require("../dist/server/database/marketStore");
const scan={record:{id:"scan"},version:{id:"scan-version"}};
function report(){return{type:"market_analysis",currentVersion:{sourceScope:{scanRecordId:"scan",scanVersionId:"scan-version",itemIds:["a","b"]},inputSnapshot:{focus:"重点"},budgetTokens:5000}};}

test("market retry matches exact original selection, version, focus and budget",()=>{
 assert.equal(marketAnalysisMatchesSelection(report(),scan,["a","b"],"重点",5000),true);
 for(const [ids,focus,budget]of [[["b"],"重点",5000],[["b","a"],"重点",5000],[["a","b"],"新重点",5000],[["a","b"],"重点",8000]])assert.equal(marketAnalysisMatchesSelection(report(),scan,ids,focus,budget),false);
 const changed=report();changed.currentVersion.sourceScope.scanVersionId="other";assert.equal(marketAnalysisMatchesSelection(changed,scan,["a","b"],"重点",5000),false);
});
test("original preparation hash binds complete input but not the transport key",()=>{
 const input={scanRecordId:"scan",scanVersionId:"v1",itemIds:["a","b"],focus:"重点",budgetTokens:5000,recordId:"original",parentVersionId:"parent"},hash=marketAnalysisInputHash(input);
 assert.equal(hash,marketAnalysisInputHash({...input,requestKey:"another"}));
 for(const change of [{scanRecordId:"other"},{scanVersionId:"v2"},{itemIds:["b","a"]},{focus:"新重点"},{budgetTokens:8000},{recordId:"other"},{parentVersionId:"other"}])assert.notEqual(hash,marketAnalysisInputHash({...input,...change}));
});
test("candidate values display published options and exact scoped dictionary nodes",()=>{
 const field={type:"select",options:[{value:"internal",label:"中文选项"}]};assert.equal(researchCandidateValueLabel(field,"internal",new Map()),"中文选项");assert.match(researchCandidateValueLabel(field,"unknown",new Map()),/原值保留/);
 const tree={...field,optionSource:{kind:"dictionary_tree",dictionaryId:"dict"}},labels=new Map([["dict:node","父项／中文节点"],["other:node","错误来源"]]);assert.equal(researchCandidateValueLabel(tree,"node",labels),"父项／中文节点");assert.match(researchCandidateValueLabel(tree,"missing",labels),/未匹配字典项/);
});
test("unknown objects and UUID references never pretend to be author-readable labels",()=>{
 assert.equal(researchCandidateValueLabel(undefined,true,new Map()),"是");assert.equal(researchCandidateValueLabel(undefined,0,new Map()),"0");assert.match(researchCandidateValueLabel(undefined,{internal:"retained"},new Map()),/结构化来源内容/);assert.match(researchCandidateValueLabel(undefined,"00000000-0000-4000-8000-000000000001",new Map()),/资料引用/);
});
test("dictionary control retains exact UUID and never chooses a same-name fallback",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/client/DynamicForm.tsx"),"utf8");assert.match(source,/saved\.items\.find\(item=>item\.id===id\)/);assert.doesNotMatch(source,/saved\.items\.find\(item=>item\.label===/);assert.match(source,/generation\.current/);assert.match(source,/disabledRef\.current\|\|inFlight\.current\|\|pendingId/);assert.match(source,/只读核对原字典项/);assert.match(source,/sessionStorage\.setItem/);
});
test("unknown market preparation only checks original key and exact version without invoking a retry",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/client/MarketRadarPage.tsx"),"utf8"),check=source.slice(source.indexOf("const checkAnalysis="),source.indexOf("const beginAnalysis ="));assert.match(check,/getMarketAnalysisByKey/);assert.doesNotMatch(check,/startMarketAnalysis|retryMarketAnalysis/);assert.match(check,/version\.parentVersionId!==original\.expectedVersionId/);assert.match(source,/按当前选择新建 AI 分析/);
 const server=fs.readFileSync(path.join(__dirname,"../src/server/research/marketService.ts"),"utf8"),read=server.slice(server.indexOf("export async function getMarketAnalysisByKey"),server.indexOf("export async function startMarketAnalysis"));assert.doesNotMatch(read,/ensureResearchRecovery|executeAnalysis/);assert.match(server,/if\(run\.created\)/);
});
test("report switches clear active selections while retaining original version choices",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/client/BookAnalysisPage.tsx"),"utf8");assert.match(source,/savedSelections\.current\.set/);assert.match(source,/reportSequence\.current/);assert.match(source,/setSelectedCandidates\(\[\]\)/);assert.match(source,/明确恢复本报告原版本的勾选/);assert.match(source,/publishedProposalFields/);assert.match(source,/candidate\.researchVersionId===next\.currentVersion\.id/);
});

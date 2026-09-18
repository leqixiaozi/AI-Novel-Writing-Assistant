const test=require('node:test');
const assert=require('node:assert/strict');
const {compiled}=require('./support/isolatedDatabase.cjs');
const {preparePrompt,listPromptAssets}=compiled('server/ai/prompts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={bookId:id(1),bookName:'测试书',chapterCardId:id(2),chapterTitle:'第1章',chapterDocumentId:id(3),operation:'fix',plans:[{objectId:id(4),versionId:id(5),level:'chapter',contentHash:'a'.repeat(64),content:{goal:'守住门口'},executionMode:'manual',references:[]}],materials:[],continuity:{sources:[],notes:[]},knowledge:[],body:{versionId:id(6),contentHash:'b'.repeat(64),content:'他站在门口。她走过来。'},selection:null,instruction:'',issuePolicy:'completion_first',recheck:null};
const finding={stableKey:'goal-unmet',category:'plan_obligation',severity:'medium',confidence:0.8,title:'目标未兑现',description:'本章未写出守门行动。',suggestedAction:'补齐守门行动，保留其他文字。',evidence:[{startOffset:0,endOffset:6,excerpt:'他站在门口。',note:'没有后续行动。'}],planningVersionIds:[id(5)]};
const result={summary:'有一项计划义务待核对',findings:[finding],recheckOutcome:'not_requested',recheckEvidence:[],tensionAssessment:null};
test('chapter diagnosis is a registered asset with exact body and planning evidence',()=>{
 assert.ok(listPromptAssets().some(asset=>asset.taskType==='quality_audit'&&asset.assetId==='new_design.chapter.quality_audit'));
 const prompt=preparePrompt('quality_audit',input);assert.deepEqual(prompt.parseOutput(result),result);
 for(const invalid of [{...result,findings:[{...finding,evidence:[{...finding.evidence[0],excerpt:'伪造'}]}]},{...result,findings:[{...finding,evidence:[{...finding.evidence[0],startOffset:1}]}]},{...result,findings:[{...finding,planningVersionIds:[id(99)]}]},{...result,findings:[finding,finding]},{...result,recheckOutcome:'supports_verified'}])assert.throws(()=>prompt.parseOutput(invalid));
 assert.throws(()=>preparePrompt('quality_audit',{...input,body:null}));
});
test('recheck cannot verify without current body evidence or while the original issue remains',()=>{
 const prompt=preparePrompt('quality_audit',{...input,recheck:{issueId:id(7),issueVersionId:id(8),stableKey:finding.stableKey,title:finding.title,description:finding.description,originalBodyVersionId:id(9),originalBody:'他站在门口。',originalEvidence:[{note:'原目标未兑现',excerpt:'他站在门口。'}]}});
 const verified={summary:'原问题修复证据待作者核对',findings:[],recheckOutcome:'supports_verified',recheckEvidence:finding.evidence,tensionAssessment:null};
 assert.deepEqual(prompt.parseOutput(verified),verified);
 assert.throws(()=>prompt.parseOutput({...verified,recheckEvidence:[]}));
 assert.throws(()=>prompt.parseOutput({...verified,findings:[finding]}));
 assert.throws(()=>prompt.parseOutput(result));
 assert.deepEqual(prompt.parseOutput({...verified,recheckOutcome:'inconclusive',recheckEvidence:[]}).recheckOutcome,'inconclusive');
});

const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');

test('one frozen book-analysis request creates one run and can be read by its original key',async t=>{
 const {pool}=await isolatedDatabase(t);
 const store=compiled('server/database/researchStore'),analysis=compiled('server/database/bookAnalysisStore');
 const source=await store.createResearchDocument({title:'测试原文',content:'一段足够长的测试原文，用于核对同一拆书请求不会重复创建运行。',sourceKind:'paste',sourceUrl:''});
 const requestKey=randomUUID(),inputHash='frozen-input-a';
 const input={title:'稿件诊断',type:'diagnosis',sourceDocumentVersionId:source.currentVersion.id,sourceScope:{documentId:source.id,documentVersionId:source.currentVersion.id,requestKey,inputHash},plan:{purpose:'diagnosis',preset:'quick',dimensions:[],targetForms:[],targets:[],evidenceRequired:true,candidateLimit:0},focus:'检查开篇',budgetTokens:3000};
 const first=await analysis.beginBookAnalysisRun(input),second=await analysis.beginBookAnalysisRun(input);
 assert.equal(first.created,true);assert.equal(second.created,false);
 assert.equal(second.recordId,first.recordId);assert.equal(second.versionId,first.versionId);
 assert.equal((await pool.query("SELECT count(*)::int AS count FROM new_design.research_record_versions WHERE source_scope->>'requestKey'=$1",[requestKey])).rows[0].count,1);
 assert.deepEqual(await store.getBookAnalysisRequestByKey(requestKey),{recordId:first.recordId,versionId:first.versionId,version:1,inputHash});
 await assert.rejects(()=>analysis.beginBookAnalysisRun({...input,sourceScope:{...input.sourceScope,inputHash:'changed-input'}}),/原请求|冻结输入/);
 const retry=await analysis.beginBookAnalysisRun({...input,recordId:first.recordId,parentVersionId:first.versionId,sourceScope:{...input.sourceScope,requestKey:randomUUID(),inputHash:'frozen-retry'}});
 assert.equal(retry.created,true);
 await assert.rejects(()=>analysis.beginBookAnalysisRun({...input,recordId:first.recordId,parentVersionId:first.versionId,sourceScope:{...input.sourceScope,requestKey:randomUUID(),inputHash:'stale-retry'}}),/原拆书版本已变化/);
});

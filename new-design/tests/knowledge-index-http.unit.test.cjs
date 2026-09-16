const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
test('knowledge index original reads mount before mutating research recovery',()=>{
 const router=source('server/http/router.ts');
 assert.ok(router.indexOf('router.use(knowledgeIndexRouter())')>=0);
 assert.ok(router.indexOf('router.use(knowledgeIndexRouter())')<router.indexOf('void ensureResearchRecovery()'));
 const http=source('server/http/knowledgeIndex/index.ts');
 assert.match(http,/if\(req\.method==="GET"\)delete recovery\.mutationOutcome/);
 assert.match(http,/const validated=error instanceof KnowledgeInputError/);
 assert.doesNotMatch(http,/const validated=error instanceof z\.ZodError/);
});
test('knowledge profile, indexing and semantic routes have real typed API consumers',()=>{
 const api=source('client/api.ts'),http=source('server/http/knowledgeIndex/index.ts');
 for(const name of ['getKnowledgeIndexWorkspace','createKnowledgeProfile','getKnowledgeProfileByKey','prepareKnowledgeIndex','getKnowledgeIndexByKey','executeKnowledgeEmbedding','getKnowledgeEmbeddingResult','completeSavedKnowledgeEmbedding','endExpiredKnowledgeEmbedding','buildKnowledgeIndex','getKnowledgeGenerationByKey','searchKnowledgeSemantic','getKnowledgeSemanticByKey','getKnowledgeSemanticResult','completeSavedKnowledgeSemantic','endExpiredKnowledgeSemantic']){
  assert.match(api,new RegExp(`${name}:`));assert.ok(http.includes(`knowledge.${name}(`));
 }
 assert.match(http,/input\(empty,req\.body\)/);
 assert.match(http,/pureWrite&&error instanceof knowledge\.KnowledgeEmbeddingError/);
 assert.match(http,/error instanceof knowledge\.KnowledgePreparationError&&error\.preparationNotWritten/);
});
test('generation APIs retain original-key full-input receipts instead of narrowing to a generation',()=>{
 const api=source('client/api.ts');
 assert.match(api,/buildKnowledgeIndex:[^\n]+request<KnowledgeGenerationReceipt>/);
 assert.match(api,/getKnowledgeGenerationByKey:[^\n]+request<KnowledgeGenerationReceipt\|null>/);
});
test('original preparation rollback proof requires positive original-absence evidence under its lock',()=>{
 const repository=source('server/database/knowledgeIndex/repository.ts');
 assert.match(repository,/wholeOperationNotWritten=safe&&originalAbsentVerified/);
 assert.match(repository,/initialPreparation&&wholeOperationNotWritten/);
 assert.ok(repository.indexOf('await lockIndex(client,bookId,key)')<repository.indexOf('originalAbsentVerified=true'));
 assert.doesNotMatch(repository,/if\(initialPreparation&&safe\)/);
});

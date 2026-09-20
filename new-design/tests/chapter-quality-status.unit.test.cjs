const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/client/chapterQuality/status.ts'),'utf8');
const status={};new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(status);

test('no record is not a passing quality check',()=>{
 const chapter={chapterDocumentId:'doc',adoptedBodyVersionId:'body'};
 assert.equal(status.chapterQualityStatus(chapter,[],[]).action,'diagnose');
 assert.match(status.chapterQualityStatus(chapter,[],[]).label,/未检查不代表通过/);
});

test('a current succeeded report with an open issue enters existing repair flow',()=>{
 const chapter={chapterDocumentId:'doc',adoptedBodyVersionId:'body'};
 const receipts=[{status:'succeeded',input:{bodyVersionId:'body'},reportId:'report'}];
 const issues=[{issueId:'issue',chapterDocumentId:'doc',bodyVersionId:'body',status:'open',reportStale:false}];
 const result=status.chapterQualityStatus(chapter,receipts,issues);
 assert.equal(result.action,'repair');assert.equal(result.issueId,'issue');
 assert.match(result.label,/1 项待处理/);
 assert.equal(status.chapterQualityStatus(chapter,[],issues).action,'repair');
 assert.equal(status.chapterQualityStatus(chapter,[{...receipts[0],input:{bodyVersionId:'old'}}],[]).action,'diagnose');
 assert.equal(status.chapterQualityStatus(chapter,[{...receipts[0],status:'stale'},receipts[0]],[]).action,'diagnose');
});

test('quality page keeps an exact chapter entry and existing repair source',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../src/client/BookViewsPage.tsx'),'utf8');
 const writing=fs.readFileSync(path.join(__dirname,'../src/client/chapterWriting/ChapterWritingPage.tsx'),'utf8');
 assert.match(page,/listChapterQuality\(bookId,chapter\.chapterDocumentId\)/);
 assert.match(page,/selectedCard\.id}\/write\?diagnose=1/);
 assert.match(page,/qualityIssue=\$\{encodeURIComponent\(status\.issueId/);
 assert.match(page,/views\/quality\?selected=\$\{encodeURIComponent\(selected\.id\)\}/);
 assert.match(writing,/chapter-quality-diagnosis/);
 assert.match(writing,/chapter-quality-repair/);
});

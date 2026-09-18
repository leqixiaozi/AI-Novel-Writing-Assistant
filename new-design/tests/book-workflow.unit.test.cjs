const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const exportsObject={};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/client/bookNavigation/workflow.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exportsObject);
const {BOOK_WORKFLOW_STEPS,currentBookWorkflowStep}=exportsObject;
test('shared setting workspace distinguishes world and character query states',()=>{
 assert.equal(currentBookWorkflowStep('story-setting',new URLSearchParams('tab=world'),'/story-setting'),2);
 assert.equal(currentBookWorkflowStep('story-setting',new URLSearchParams('tab=characters'),'/story-setting'),3);
});
test('shared planning distinguishes macro and volume entry; quality belongs to step eight',()=>{
 assert.equal(currentBookWorkflowStep('planning',new URLSearchParams(),'/planning'),1);
 assert.equal(currentBookWorkflowStep('planning',new URLSearchParams('tab=chapters&scope=book'),'/planning'),4);
 assert.equal(currentBookWorkflowStep('views',new URLSearchParams(),'/views/quality'),7);
 assert.equal(currentBookWorkflowStep('views',new URLSearchParams(),'/views/chapters'),-1);
 assert.equal(BOOK_WORKFLOW_STEPS.length,8);
});

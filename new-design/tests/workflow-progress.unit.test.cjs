const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const stageFields={};new Function('exports',compile('src/common/planningRhythm/stageFields.ts'))(stageFields);
const progress={};new Function('require','exports',compile('src/client/bookNavigation/progress.ts'))(name=>name==='../../common/planningRhythm/stageFields'?stageFields:(()=>{throw Error(name);})(),progress);

test('workflow progress uses only adopted dedicated fields, never generic planning text',()=>{
 const objects=[{level:'story',status:'active',title:'全书',adoptedVersion:{version:1,content:{goal:'写完一部长篇'}}}];
 const states=progress.workflowProgress(objects,[],[]);
 assert.equal(states[1].adopted,'已采用 1/1 项');
 assert.equal(states[1].ready,false);
 assert.match(states[1].detail,/核心卖点/);
 assert.equal(states[4].ready,false);
 assert.equal(states[5].ready,false);
});

test('formal project card, dedicated plan and adopted body have distinct readiness',()=>{
 const content=Object.fromEntries(stageFields.LEGACY_PLANNING_FIELDS.story_macro.flatMap(group=>group.fields).map(field=>[field.key,'已填写']));
 const states=progress.workflowProgress([{level:'story',status:'active',title:'全书',adoptedVersion:{version:2,content}}],[{typeKey:'project_rule',status:'active',values:{reader_promise:'热血成长',target_length:500000}}],[{hasAdoptedPlan:true,adoptedBodyVersionId:'body'}]);
 assert.equal(states[0].ready,true);
 assert.equal(states[1].ready,true);
 assert.equal(states[6].ready,true);
 assert.equal(states[7].ready,null);
 assert.match(states[7].detail,/按所选章节/);
});

test('failed sources remain unknown without hiding other formal progress',()=>{
 const states=progress.workflowProgress(null,[{typeKey:'character',status:'active',values:{identity:'已填写'}}],null);
 assert.equal(states[0].ready,false);
 assert.equal(states[1].ready,null);
 assert.match(states[1].detail,/暂不可用/);
 assert.equal(states[3].ready,true);
 assert.equal(states[6].ready,null);
 assert.equal(states[7].ready,null);
});

test('book navigation rereads after successful in-book writes and keeps partial sources',()=>{
 const navigation=fs.readFileSync(path.join(__dirname,'../src/client/bookNavigation/index.tsx'),'utf8');
 const api=fs.readFileSync(path.join(__dirname,'../src/client/api.ts'),'utf8');
 assert.match(navigation,/Promise\.allSettled/);
 assert.match(navigation,/new-design:book-workflow-changed/);
 assert.match(navigation,/item\.ready===false/);
 assert.match(api,/dispatchEvent\(new CustomEvent\('new-design:book-workflow-changed'/);
});

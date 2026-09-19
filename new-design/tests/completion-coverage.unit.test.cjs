const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const file=path.join(__dirname,'../src/server/database/completionExport/coverage.ts');
function load(){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports',code)(module,module.exports);return module.exports;}

test('completion coverage blocks planned chapters without adopted bodies and empty planned volumes',()=>{
  const {missingPlannedContent}=load();
  const rows=[
    {id:'volume-a',level:'volume',cardId:'volume-card',title:'第一卷',parentId:null,adoptedVersionId:'v1',documentId:null,childCount:2},
    {id:'chapter-a',level:'chapter',cardId:'chapter-card-a',title:'第1章',parentId:'volume-a',adoptedVersionId:'c1',documentId:'document-a',adoptedBodyVersionId:'body-a',childCount:0},
    {id:'chapter-b',level:'chapter',cardId:'chapter-card-b',title:'第2章',parentId:'volume-a',adoptedVersionId:'c2',documentId:null,childCount:0},
    {id:'volume-b',level:'volume',cardId:'volume-card-b',title:'第二卷',parentId:null,adoptedVersionId:'v2',documentId:null,childCount:0},
  ];
  assert.deepEqual(missingPlannedContent(rows).map(issue=>[issue.kind,issue.id]),[['chapter_body_missing','chapter-b'],['volume_chapters_missing','volume-b']]);
});

test('unadopted chapter plan is a blocker even before a body exists',()=>{
  const {missingPlannedContent}=load();
  assert.deepEqual(missingPlannedContent([{id:'chapter-c',level:'chapter',cardId:'card-c',title:'第3章',parentId:null,adoptedVersionId:null,documentId:null,childCount:0}]).map(issue=>issue.kind),['chapter_plan_unadopted']);
});

test('a document without an adopted body still blocks its planned chapter',()=>{
  const {missingPlannedContent}=load();
  assert.deepEqual(missingPlannedContent([{id:'chapter-d',level:'chapter',cardId:'card-d',title:'第4章',parentId:'volume-a',adoptedVersionId:'plan-d',documentId:'document-d',adoptedBodyVersionId:null,childCount:0}]).map(issue=>issue.kind),['chapter_body_unadopted']);
});

test('planned blockers affect full-book export but only their selected partial range',()=>{
  const {plannedBlockerAffectsRange}=load();
  const rows=[
    {id:'volume-a',level:'volume',cardId:'volume-card-a',title:'第一卷',parentId:null,adoptedVersionId:'v1',documentId:null,childCount:2},
    {id:'chapter-a',level:'chapter',cardId:'card-a',title:'第1章',parentId:'volume-a',adoptedVersionId:'c1',documentId:'doc-a',adoptedBodyVersionId:'body-a',childCount:0},
    {id:'chapter-b',level:'chapter',cardId:'card-b',title:'第2章',parentId:'volume-a',adoptedVersionId:'c2',documentId:null,childCount:0},
    {id:'volume-b',level:'volume',cardId:'volume-card-b',title:'第二卷',parentId:null,adoptedVersionId:'v2',documentId:null,childCount:0},
  ];
  const selected=new Set(['card-a']);
  assert.equal(plannedBlockerAffectsRange('planning_chapter','chapter-b',rows,'book',selected,null),true);
  assert.equal(plannedBlockerAffectsRange('planning_chapter','chapter-b',rows,'chapters',selected,null),false);
  assert.equal(plannedBlockerAffectsRange('planning_volume','volume-b',rows,'chapters',selected,null),false);
  assert.equal(plannedBlockerAffectsRange('planning_chapter','chapter-b',rows,'volume',selected,'volume-a'),true);
  assert.equal(plannedBlockerAffectsRange('planning_volume','volume-b',rows,'volume',selected,'volume-a'),false);
});

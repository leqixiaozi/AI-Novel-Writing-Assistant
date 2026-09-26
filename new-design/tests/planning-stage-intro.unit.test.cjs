const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

const source=fs.readFileSync(path.join(__dirname,'../src/client/planningCenter/PlanningStageIntro.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const fieldsSource=fs.readFileSync(path.join(__dirname,'../src/common/planningRhythm/stageFields.ts'),'utf8');
const fields={};new Function('exports',ts.transpileModule(fieldsSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(fields);
const component={};
new Function('require','exports',compiled)(name=>name==='react/jsx-runtime'?require(name):name==='./legacyPlanningFields'?fields:(()=>{throw Error(`Unexpected dependency: ${name}`);})(),component);

test('story macro opens with its story task and truthful adopted coverage',()=>{
 const objects=[{level:'story',status:'active',adoptedVersion:{id:'v1',content:{}}},{level:'story',status:'active',adoptedVersion:null},{level:'chapter',status:'active',adoptedVersion:{id:'v2',content:{}}}];
 const html=renderToStaticMarkup(React.createElement(component.default,{presentation:'story_macro',objects}));
 assert.match(html,/核心卖点/);
 assert.match(html,/核心冲突/);
 assert.match(html,/已采用 1\/2 项/);
 assert.match(html,/href="#plan-editor-title"/);
 assert.doesNotMatch(html,/前三章准备/);
});

test('stage intro names the selected plan, missing adopted fields, and prerequisite',()=>{
 const selected={id:'volume',level:'volume',title:'第一卷',status:'active',adoptedVersion:{id:'v1',content:{openingHook:'开卷'}}};
 const html=renderToStaticMarkup(React.createElement(component.default,{presentation:'outline',objects:[{level:'story',status:'active',adoptedVersion:{id:'story',content:{}}},selected],selected}));
 assert.match(html,/当前编辑：第一卷/);
 assert.match(html,/主承诺/);
 assert.match(html,/当前阶段待补/);
 const blocked=renderToStaticMarkup(React.createElement(component.default,{presentation:'structured',objects:[],selected:null}));
 assert.match(blocked,/先建立并采用卷计划/);
});

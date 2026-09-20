const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

const source=fs.readFileSync(path.join(__dirname,'../src/client/planningCenter/PlanningStageIntro.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const component={};
new Function('require','exports',compiled)(name=>name==='react/jsx-runtime'?require(name):(()=>{throw Error(`Unexpected dependency: ${name}`);})(),component);

test('story macro opens with its story task and truthful adopted coverage',()=>{
 const objects=[{level:'story',status:'active',adoptedVersion:{id:'v1'}},{level:'story',status:'active',adoptedVersion:null},{level:'chapter',status:'active',adoptedVersion:{id:'v2'}}];
 const html=renderToStaticMarkup(React.createElement(component.default,{presentation:'story_macro',objects}));
 assert.match(html,/核心卖点/);
 assert.match(html,/核心冲突/);
 assert.match(html,/已采用 1\/2 项/);
 assert.match(html,/href="#plan-editor-title"/);
 assert.doesNotMatch(html,/前三章准备/);
});

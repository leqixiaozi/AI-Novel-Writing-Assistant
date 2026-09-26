const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

const source=fs.readFileSync(path.join(__dirname,'../src/client/DynamicForm.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const formModule={};
new Function('require','exports',compiled)(name=>{
 if(name==='react'||name==='react/jsx-runtime')return require(name);
 if(name==='./api')return {newDesignApi:{}};
 if(name==='./tree')return {TreeSelector:()=>null};
 if(name==='./businessForms/aiAssist')return {FormAiPanel:()=>null};
 if(name==='../common/treePolicy')return {};
 if(name==='./storyWorkspace/Help')return {default:()=>null};
 if(name==='../common/formPresentation')return {fieldInCharacterSection:()=>true};
 if(name.endsWith('.css'))return {};
 throw Error(`Unexpected dependency: ${name}`);
},formModule);

const field=(key,group,order)=>({key,name:key,description:'',type:'short_text',required:false,options:[],defaultValue:null,order,group});
test('project setup can lead with reader promise without changing saved field definitions',()=>{
 const fields=[field('perspective','叙事口径',10),field('reader_promise','创作目标',40)];
 const normal=renderToStaticMarkup(React.createElement(formModule.default,{fields,values:{}}));
 const guided=renderToStaticMarkup(React.createElement(formModule.default,{fields,values:{},preferredFieldKeys:['reader_promise']}));
 assert.ok(normal.indexOf('叙事口径')<normal.indexOf('创作目标'));
 assert.ok(guided.indexOf('创作目标')<guided.indexOf('叙事口径'));
 assert.equal(fields[0].order,10);
});

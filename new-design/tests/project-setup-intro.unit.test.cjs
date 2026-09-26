const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

test('project setup explains the reader promise before form details',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/client/bookNavigation/ProjectSetupIntro.tsx'),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const component={};
 new Function('require','exports',compiled)(name=>name==='react/jsx-runtime'?require(name):(()=>{throw Error(`Unexpected dependency: ${name}`);})(),component);
 const html=renderToStaticMarkup(React.createElement(component.default));
 assert.ok(html.indexOf('读者承诺')<html.indexOf('叙事口径'));
 assert.match(html,/本书作品约定/);
});

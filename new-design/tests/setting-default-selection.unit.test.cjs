const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

const source=fs.readFileSync(path.join(__dirname,'../src/client/storyWorkspace/model.ts'),'utf8');
const model={};
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(model);

test('setting selects the first valid object only without an explicit deep link',()=>{
 const cards=[{id:'a'},{id:'b'}];
 assert.equal(model.defaultSettingSelection(new URLSearchParams('tab=world'),cards,false,'world'),'a');
 assert.equal(model.defaultSettingSelection(new URLSearchParams('selected=b'),cards,false,'world'),'b');
 assert.equal(model.defaultSettingSelection(new URLSearchParams('selected=missing'),cards,false,'world'),'missing');
 assert.equal(model.defaultSettingSelection(new URLSearchParams('new=1'),cards,true,'world'),'');
 assert.equal(model.defaultSettingSelection(new URLSearchParams('tab=props'),cards,false,'props'),'');
});

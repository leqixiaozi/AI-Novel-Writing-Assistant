const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/client/comicProjects/navigation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const model={};new Function('exports',source)(model);

test('comic project tabs retain explicit deep links and reject invalid tabs',()=>{
 assert.equal(model.resolveComicProjectTab(new URLSearchParams()),'outline');
 assert.equal(model.resolveComicProjectTab(new URLSearchParams('tab=panels')),'panels');
 assert.equal(model.resolveComicProjectTab(new URLSearchParams('tab=export')),null);
 assert.equal(model.resolveComicProjectTab(new URLSearchParams('tab=outline&tab=panels')),null);
});
test('an invalid or unadopted comic episode deep link never silently selects another episode',()=>{
 const episodes=[{id:'first',adoptedVersionId:'version-one'},{id:'second',adoptedVersionId:null}];
 assert.equal(model.selectComicPanelEpisode(episodes,new URLSearchParams()).id,'first');
 assert.equal(model.selectComicPanelEpisode(episodes,new URLSearchParams('episode=first')).id,'first');
 assert.equal(model.selectComicPanelEpisode(episodes,new URLSearchParams('episode=second')),null);
 assert.equal(model.selectComicPanelEpisode(episodes,new URLSearchParams('episode=missing')),null);
 assert.equal(model.selectComicPanelEpisode(episodes,new URLSearchParams('episode=first&episode=first')),null);
});

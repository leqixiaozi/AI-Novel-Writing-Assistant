const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/client/resourceBrowser/catalog.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const api={};
new Function('require','exports',compiled)(()=>({PROMPT_COMPONENT_RESOURCE_SPACE_ID:'prompt-space',RESEARCH_RESOURCE_SPACE_ID:'research-space'}),api);
const empty=()=>({strategies:[],prompts:[],signals:[],dictionaries:[],dimensions:[],books:[]});
const card={id:'original-id',cardTypeId:'type',title:'仙侠成长与谜团',typeKey:'genre_strategy',updatedAt:'2026-09-17',values:{}};
test('strategy catalog reaches the original resource without a page jump',()=>{
 const input=empty();input.strategies=[card];const nodes=api.buildResourceCatalog(input);
 const node=nodes.find(item=>item.id==='strategies').children.find(item=>item.id==='strategy:genre_strategy').children[0];
 assert.equal(node.name,card.title);assert.equal(node.selection.card,card);assert.equal(node.selection.editable,true);
 assert.equal(api.findResourceSelection(nodes,'card:original-id').card.id,'original-id');
});
test('search retains ancestor path and does not change original selection identity',()=>{
 const input=empty();input.strategies=[card];const nodes=api.filterResourceNodes(api.buildResourceCatalog(input),'成长');
 assert.equal(nodes[0].id,'strategies');assert.equal(nodes[0].children[0].id,'strategy:genre_strategy');
 assert.equal(nodes[0].children[0].children[0].id,'card:original-id');
});
test('dictionary preserves multiple levels, sibling order and archive exclusion',()=>{
 const input=empty();input.dictionaries=[{id:'dict',name:'地点',status:'published',description:'',items:[{id:'root',parentId:null,label:'大陆',status:'active',sortOrder:1,description:''},{id:'child',parentId:'root',label:'宗门',status:'active',sortOrder:1,description:''},{id:'leaf',parentId:'child',label:'山门',status:'active',sortOrder:1,description:''},{id:'archived',parentId:null,label:'旧地点',status:'archived',sortOrder:0,description:''}]}];
 const nodes=api.buildResourceCatalog(input),dict=nodes.find(item=>item.id==='options').children[0].children[0];
 assert.equal(dict.children.length,1);assert.equal(dict.children[0].children[0].children[0].name,'山门');
 assert.equal(api.findResourceSelection(nodes,'dictionary:dict:leaf').dictionary.id,'dict');
});
test('prompt and research previews cannot use strategy write path',()=>{
 const input=empty();input.prompts=[{...card,id:'prompt'}];input.signals=[{...card,id:'signal'}];
 const nodes=api.buildResourceCatalog(input);
 assert.equal(api.findResourceSelection(nodes,'card:prompt').editable,false);
 assert.equal(api.findResourceSelection(nodes,'card:signal').editable,false);
});
test('public worlds can be opened from the independent resource catalog',()=>{
 const nodes=api.buildResourceCatalog(empty());
 const entry=api.findResourceSelection(nodes,'public-world-library');
 assert.equal(entry.kind,'category');
 assert.equal(entry.href,'/new-design/resources/worlds');
});
test('resource organization uses the real strategy space and does not merge book data',()=>{
 const input=empty();input.books=[{id:'book-one',name:'守脉者',cardCount:24}];const nodes=api.buildResourceCatalog(input);
 assert.equal(api.findResourceSelection(nodes,'organize:strategy:groups').spaceId,'60000000-0000-4000-8000-000000000001');
 assert.equal(api.findResourceSelection(nodes,'book:book-one').kind,'book');
 assert.equal(api.findResourceSelection(nodes,'missing'),null);
 input.dictionaries=[{id:'private',name:'本书独立',status:'published',scope:'book',items:[]}];
 input.dimensions=[{id:'private',name:'本书独立',status:'active',scope:'book',nodes:[]}];
 const scoped=api.buildResourceCatalog(input);
 assert.equal(api.findResourceSelection(scoped,'dictionary:private'),null);
 assert.equal(api.findResourceSelection(scoped,'tag:private'),null);
});
test('resource editor uses exact version fields and retains explicit recovery guards',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/client/resourceBrowser/ResourceCardDetail.tsx'),'utf8');
 assert.match(source,/item\.id===card\.typeVersionId/);assert.doesNotMatch(source,/draftFields/);
 assert.match(source,/setUncertain\(true\)/);assert.match(source,/onGuard\(busy\|\|dirty\|\|uncertain\)/);
 assert.match(source,/读取服务器内容/);assert.match(source,/保留填写，按核对后的修订继续/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

function model(){
 const file=path.join(__dirname,'../src/client/worldCatalog/model.ts');
 if(!fs.existsSync(file))assert.fail('公共世界目录缺少可读取的版本投影');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports',source)(exports);return exports;
}

const packageVersion=(id,rootCardId,version,title,createdAt)=>({
 id,rootCardId,rootVersionId:`root-version-${version}`,version,frameHash:`hash-${id}`,createdAt,
 frame:{contract:'public_world_package_v1',rootCardId,rootVersionId:`root-version-${version}`,
  cards:[{cardId:rootCardId,versionId:`root-version-${version}`,section:'profile',title,values:{},fields:[],localFields:[]}],
  types:[],relations:[],forms:[],dictionaries:[]},
});

test('public world catalog groups immutable versions by source and shows the newest version first',()=>{
 const {buildWorldCatalog}=model();
 const older=packageVersion('first-v1','first',1,'旧名','2026-09-18T00:00:00Z');
 const latest=packageVersion('first-v2','first',2,'新名','2026-09-20T00:00:00Z');
 const other=packageVersion('second-v1','second',1,'另一世界','2026-09-19T00:00:00Z');
 const entries=buildWorldCatalog([older,other,latest]);
 assert.deepEqual(entries.map(entry=>[entry.rootCardId,entry.title,entry.latest.id]),[
  ['first','新名','first-v2'],['second','另一世界','second-v1'],
 ]);
 assert.deepEqual(entries[0].versions.map(version=>version.id),['first-v2','first-v1']);
 assert.equal(older.frame.cards[0].title,'旧名');
});

test('invalid public world deep link is reported instead of silently selecting a different version',()=>{
 const {buildWorldCatalog,resolveWorldCatalogVersion}=model();
 const entries=buildWorldCatalog([packageVersion('first-v1','first',1,'第一世界','2026-09-20T00:00:00Z')]);
 assert.equal(resolveWorldCatalogVersion(entries,'missing'),null);
 assert.equal(resolveWorldCatalogVersion(entries,'first-v1')?.id,'first-v1');
 assert.equal(resolveWorldCatalogVersion(entries,null)?.id,'first-v1');
});

test('world catalog hands an exact fixed version to the selected book root',()=>{
 const {bookWorldRoots,worldImportRoute}=model();
 const bookId='10000000-0000-4000-8000-000000000001',rootId='20000000-0000-4000-8000-000000000002',packageId='30000000-0000-4000-8000-000000000003';
 const roots=bookWorldRoots([{id:rootId,typeKey:'world_setting',status:'active',title:'本书世界'},{id:'other',typeKey:'world_rule',status:'active',title:'规则'},{id:'archived',typeKey:'world_overview',status:'archived',title:'旧世界'}]);
 assert.deepEqual(roots.map(item=>item.id),[rootId]);
 assert.equal(worldImportRoute(bookId,packageId,rootId),`/new-design/books/${bookId}/story-setting?tab=world&selected=${rootId}&detail=sync&source=import&worldPackage=${packageId}`);
 assert.equal(worldImportRoute(bookId,packageId,null),`/new-design/books/${bookId}/story-setting?tab=world&new=1&source=import&worldPackage=${packageId}`);
});

test('public world management opens the existing book publication flow without publishing on navigation',()=>{
 const {worldPublishRoute}=model();
 const bookId='10000000-0000-4000-8000-000000000001',rootId='20000000-0000-4000-8000-000000000002';
 assert.equal(worldPublishRoute(bookId,rootId),`/new-design/books/${bookId}/story-setting?tab=world&selected=${rootId}&detail=sync`);
 assert.equal(worldPublishRoute(bookId,null),`/new-design/books/${bookId}/story-setting?tab=world&new=1`);
 const {WorldPublishTargetView}=catalogPage();
 assert.equal(typeof WorldPublishTargetView,'function');
 const props={books:[{id:bookId,name:'本书',status:'active'}],selectedBookId:bookId,loading:false,error:'',onSelect:()=>{}};
 const withRoot=renderToStaticMarkup(React.createElement(WorldPublishTargetView,{...props,roots:[{id:rootId,title:'本书世界',status:'active',typeKey:'world_setting'}]})).replaceAll('&amp;','&');
 assert.match(withRoot,/打开本书发布与同步/);
 assert.match(withRoot,new RegExp(`href="/new-design/books/${bookId}/story-setting\\?tab=world&selected=${rootId}&detail=sync"`));
 const withoutRoot=renderToStaticMarkup(React.createElement(WorldPublishTargetView,{...props,roots:[]})).replaceAll('&amp;','&');
 assert.match(withoutRoot,/先建立本书世界档案/);
 assert.match(withoutRoot,new RegExp(`href="/new-design/books/${bookId}/story-setting\\?tab=world&new=1"`));
 const withoutBooks=renderToStaticMarkup(React.createElement(WorldPublishTargetView,{...props,books:[],selectedBookId:''}));
 assert.match(withoutBooks,/还没有可用书籍/);
 assert.match(withoutBooks,/href="\/new-design\/books\/new"/);
 const catalog=renderCatalog([packageVersion('first-v1','first',1,'紫霞界','2026-09-20T00:00:00Z')],null);
 assert.match(catalog,/从本书发布或更新世界样本/);
});

test('world import deep link rejects duplicate package parameters without replacing the author choice',()=>{
 const {worldPackageDeepLink}=model(),id='30000000-0000-4000-8000-000000000003';
 assert.deepEqual(worldPackageDeepLink(`?source=import&worldPackage=${id}`),{kind:'selected',packageId:id});
 assert.deepEqual(worldPackageDeepLink(`?worldPackage=${id}&worldPackage=other`),{kind:'invalid'});
 assert.deepEqual(worldPackageDeepLink('?source=import'),{kind:'none'});
});

function catalogPage(){
 const file=path.join(__dirname,'../src/client/worldCatalog/WorldCatalogPage.tsx');
 if(!fs.existsSync(file))assert.fail('公共世界样本还没有独立浏览页面');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};
 const load=name=>{
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='./model')return model();
  if(name==='../ResourceShell')return {default:({children})=>React.createElement(React.Fragment,null,children)};
  if(name==='../api')return {newDesignApi:{worldPackages:{catalog:async()=>({capability:{installed:true,operational:true},items:[]})}}};
  if(name==='../../common/worldPackages')return {WORLD_SECTIONS:['profile','rules','factions','forces','locations','relations'],WORLD_SECTION_LABELS:{profile:'世界概要',rules:'核心规则',factions:'阵营',forces:'势力',locations:'地点',relations:'关系网络'}};
  if(name==='../../common/formPresentation')return {fieldDisplay:(_field,value)=>String(value)};
  if(name.endsWith('.css'))return {};
  throw new Error(`Unexpected dependency: ${name}`);
 };
 new Function('require','exports',source)(load,exports);
 return exports;
}
function renderCatalog(items,requested){
 return renderToStaticMarkup(React.createElement(catalogPage().WorldCatalogContent,{entries:model().buildWorldCatalog(items),requested,operational:true}));
}

test('public world page exposes published sections and exact version history',()=>{
 const item=packageVersion('first-v2','first',2,'紫霞界','2026-09-20T00:00:00Z');
 item.frame.cards.push({cardId:'rule-one',versionId:'rule-v1',section:'rules',title:'灵气守恒',values:{},fields:[],localFields:[]});
 const html=renderCatalog([packageVersion('first-v1','first',1,'旧版紫霞界','2026-09-18T00:00:00Z'),item],null);
 assert.match(html,/紫霞界/);
 assert.match(html,/核心规则/);
 assert.match(html,/灵气守恒/);
 assert.match(html,/第 1 版/);
 assert.match(html,/第 2 版/);
 assert.match(html,/aria-label="世界样本详情"/);
});

test('public world page does not replace an invalid version deep link with the newest package',()=>{
 const html=renderCatalog([packageVersion('first-v1','first',1,'紫霞界','2026-09-20T00:00:00Z')],'not-found');
 assert.match(html,/role="alert"/);
 assert.doesNotMatch(html,/aria-label="世界样本详情"/);
});

test('public world handoff requires an explicit book and root before starting the existing import flow',()=>{
 const {WorldImportTargetView}=catalogPage();
 assert.equal(typeof WorldImportTargetView,'function','缺少公共世界到本书导入的目标选择');
 const bookId='10000000-0000-4000-8000-000000000001',rootId='20000000-0000-4000-8000-000000000002',packageId='30000000-0000-4000-8000-000000000003';
 const props={packageId,books:[{id:bookId,name:'本书',status:'active'}],selectedBookId:bookId,loading:false,error:'',onSelect:()=>{}};
 const existing=renderToStaticMarkup(React.createElement(WorldImportTargetView,{...props,roots:[{id:rootId,title:'本书世界',status:'active',typeKey:'world_setting'}]})).replaceAll('&amp;','&');
 assert.match(existing,new RegExp(`href="/new-design/books/${bookId}/story-setting\\?tab=world&selected=${rootId}&detail=sync&source=import&worldPackage=${packageId}"`));
 const empty=renderToStaticMarkup(React.createElement(WorldImportTargetView,{...props,roots:[]})).replaceAll('&amp;','&');
 assert.match(empty,/先建立本书世界档案/);
 assert.match(empty,new RegExp(`href="/new-design/books/${bookId}/story-setting\\?tab=world&new=1&source=import&worldPackage=${packageId}"`));
});

test('public world handoff reports book catalog failures before a target is selected',()=>{
 const {WorldImportTargetView}=catalogPage();
 const html=renderToStaticMarkup(React.createElement(WorldImportTargetView,{packageId:'version',books:[],selectedBookId:'',roots:[],loading:false,error:'书籍目录读取失败。',onSelect:()=>{}}));
 assert.match(html,/role="alert"/);
 assert.match(html,/书籍目录读取失败/);
});

test('new-design route opens its own world library instead of the old system',()=>{
 const file=path.join(__dirname,'../src/client/NewDesignPage.tsx');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};
 const load=name=>{
  if(name==='react/jsx-runtime')return require(name);
  if(name==='./api')return {newDesignApi:{}};
  if(name==='./worldCatalog/WorldCatalogPage')return {default:()=>React.createElement('main',{'data-world-catalog':'new-design'},'新版世界样本库')};
  if(name.endsWith('.css'))return {};
  return {default:()=>null};
 };
 new Function('require','exports',source)(load,exports);
 const html=renderToStaticMarkup(React.createElement(exports.default,{pathname:'/new-design/resources/worlds'}));
 assert.match(html,/data-world-catalog="new-design"/);
 assert.doesNotMatch(html,/页面不存在/);
});

test('resource navigation keeps a direct entry to the independent world library',()=>{
 const file=path.join(__dirname,'../src/client/ResourceShell.tsx');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};
 const load=name=>name==='react/jsx-runtime'?require(name):{default:()=>null};
 new Function('require','exports',source)(load,exports);
 const html=renderToStaticMarkup(React.createElement(exports.default,{active:'worlds',children:React.createElement('div',null,'catalog')}));
 assert.match(html,/href="\/new-design\/resources\/worlds"/);
 assert.match(html,/世界样本库/);
});

test('book import panel asks for confirmation before preparing a selected public version',()=>{
 const file=path.join(__dirname,'../src/client/worldPackages/Import.tsx');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};
 const load=name=>{
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='../api')return {newDesignApi:{}};
  if(name==='../../common/worldPackages')return {WORLD_SECTIONS:['profile'],WORLD_SECTION_LABELS:{profile:'世界概要'}};
  if(name==='../../common/worldCharacterMaintenance')return {WORLD_PROFESSIONAL_TYPE_KEYS:[]};
  if(name==='../../common/formPresentation')return {fieldDisplay:()=>''};
  return {default:()=>null};
 };
 new Function('require','exports',source)(load,exports);
 const id='30000000-0000-4000-8000-000000000003',book={id:'10000000-0000-4000-8000-000000000001',spaceId:'space'};
 const html=renderToStaticMarkup(React.createElement(exports.default,{book,rootCardId:'root',packages:[packageVersion(id,'first',1,'紫霞界','2026-09-20T00:00:00Z')],locked:false,initialPackageId:id,onState:()=>{},onConfirm:async()=>true}));
 assert.match(html,/准备导入此版本/);
 assert.doesNotMatch(html,/确认导入本书/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>准备导入此版本<\/button>/);
});

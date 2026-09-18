const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const read=file=>fs.readFileSync(path.join(__dirname,'../',file),'utf8');
function compile(file,load=require){
 const result={};new Function('require','exports',ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(load,result);return result;
}
const navigation=compile('src/client/navigation.ts');
const {BOOK_NAV_GROUPS,BOOK_TASK_NAV,bookNavigationGroup,bookNavigationPage}=navigation;
const {buildBookFunctionTree}=compile('src/client/bookNavigation/catalog.ts',name=>{if(name==='../navigation')return navigation;throw Error('Unexpected dependency '+name);});
const Flow=compile('src/client/bookNavigation/BookFlowNavigation.tsx').default;
const bookId='41000000-0000-4000-8000-000000000002';
const collect=items=>items.flatMap(item=>[item,...collect(item.children??[])]);

test('directory presents seven creative steps with only planning nested',()=>{
 assert.deepEqual(BOOK_NAV_GROUPS.map(group=>group.label),['创作概览','创作方向','② 故事设定','③ 故事规划','查看与分析','全书导演','完本与导出']);
 const nodes=buildBookFunctionTree(bookId);
 assert.equal(nodes.length,7);
 assert.deepEqual(nodes.filter(node=>node.children).map(node=>node.id),['group:production']);
 assert.equal(nodes[3].children[0].name,'规划与正文');
 assert.deepEqual(nodes[3].children[0].children.map(node=>node.name),['故事规划','全书编排','章节创作']);
 const leaves=collect(nodes).filter(node=>node.href);
 assert.equal(new Set(leaves.map(node=>node.id)).size,leaves.length);
 for(const node of leaves){const source=BOOK_TASK_NAV.find(item=>'page:'+item.key===node.id);assert.equal(node.href,'/new-design/books/'+bookId+'/'+source.path);}
});

test('auxiliary pages select their owning creative step without extra directory entries',()=>{
 for(const key of ['world','characters','materials','knowledge','character-dialogue','visual-assets']){
  assert.equal(bookNavigationPage(key),'story-setting');assert.equal(bookNavigationGroup(key).key,'setting');
 }
 assert.equal(bookNavigationPage('professional-views'),'views');
 assert.equal(bookNavigationGroup('professional-views').key,'analysis');
 assert.equal(bookNavigationGroup('director').key,'director');
 assert.equal(bookNavigationGroup('settings'),undefined);
});

test('direct planning child entry exposes both ancestors and exactly one current page',()=>{
 for(const key of ['planning','composition','writing']){
  const html=renderToStaticMarkup(React.createElement(Flow,{nodes:buildBookFunctionTree(bookId),selectedId:'page:'+key,label:'本书目录'}));
  assert.equal((html.match(/aria-expanded="true"/g)??[]).length,2);
  assert.equal((html.match(/aria-current="page"/g)??[]).length,1);
  assert.match(html,new RegExp('href="/new-design/books/'+bookId+'/'+key+'" aria-current="page"'));
  assert.doesNotMatch(html,/<div hidden/);
 }
});

test('direct setting entry remains flat and does not expand planning by default',()=>{
 const html=renderToStaticMarkup(React.createElement(Flow,{nodes:buildBookFunctionTree(bookId),selectedId:'page:story-setting',label:'本书目录'}));
 assert.equal((html.match(/aria-expanded="false"/g)??[]).length,2);
 assert.equal((html.match(/aria-current="page"/g)??[]).length,1);
 assert.match(html,/③ 故事规划/);
 assert.doesNotMatch(html,/设定档案|辅助工具|人物对话模拟|视觉资产/);
});

test('composition still preserves shared body editing and original planning selection',()=>{
 const composition=read('src/client/bookComposition/BookCompositionPage.tsx');
 assert.match(composition,/TreeNavigation,flatNavigation/);
 assert.match(composition,/if\(!preserve\(\)\|\|object.bookId!==bookId/);
 assert.match(composition,/ChapterWritingPage key=\{bookId\}/);
});

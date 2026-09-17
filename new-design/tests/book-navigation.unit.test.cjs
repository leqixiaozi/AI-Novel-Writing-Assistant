const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const read=file=>fs.readFileSync(path.join(__dirname,'../',file),'utf8');
const exportsObject={};
new Function('exports',ts.transpileModule(read('src/client/navigation.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exportsObject);
const {BOOK_NAV_GROUPS,BOOK_TASK_NAV,bookNavigationGroup}=exportsObject;

test('setting and planning entries keep one visible source per task while legacy specialized deep links remain compatible',()=>{
 assert.deepEqual(BOOK_NAV_GROUPS.map(group=>group.label),['创作概览','创作方向','② 故事设定','③ 故事规划','完本与导出']);
 const keys=BOOK_NAV_GROUPS.flatMap(group=>group.sections.flatMap(section=>section.items));
 assert.equal(new Set(keys).size,keys.length);
 assert.deepEqual([...keys].sort(),BOOK_TASK_NAV.filter(item=>!['settings','world','characters','materials'].includes(item.key)).map(item=>item.key).sort());
 for(const key of keys)assert.ok(bookNavigationGroup(key));
 assert.equal(bookNavigationGroup('settings'),undefined);
});

test('chapter tools and material tools belong to their source task group',()=>{
 for(const key of ['composition','writing','views','professional-views','director'])assert.equal(bookNavigationGroup(key).key,'production');
 for(const key of ['story-setting','knowledge','character-dialogue','visual-assets'])assert.equal(bookNavigationGroup(key).key,'setting');
 assert.equal(bookNavigationGroup('planning').key,'production');assert.equal(bookNavigationGroup('direction').key,'direction');
 for(const key of ['world','characters','materials'])assert.ok(BOOK_TASK_NAV.some(item=>item.key===key));
});

test('shell keeps editing children mounted, original settings path, and keyed book navigation',()=>{
 const shell=read('src/client/BookShell.tsx');
 assert.match(shell,/BookNavigation key=\{book.id\}/);
 assert.match(shell,/href=\{`\$\{root\}\/fields`\}/);
 assert.match(shell,/\{children\}/);
 assert.doesNotMatch(shell,/BOOK_TASK_NAV\.map/);
});

test('sidebar directly shows shared tree and collapse keeps source content mounted',()=>{
 const navigation=read('src/client/bookNavigation/index.tsx'),tree=read('src/client/tree/TreeNavigation.tsx'),shell=read('src/client/BookShell.tsx'),catalog=read('src/client/bookNavigation/catalog.ts');
 assert.match(navigation,/TreeNavigation/);
 assert.match(catalog,/href:`\/new-design\/books\/\$\{bookId\}\/\$\{item.path\}`/);
 assert.match(navigation,/hidden=\{collapsed\}/);
 assert.match(navigation,/aria-expanded=\{!collapsed\}/);
 assert.match(navigation,/sessionStorage.setItem\(preferenceKey,String\(next\)\)/);
 assert.match(navigation,/new-design:book-navigation:\$\{bookId\}:collapsed/);
 assert.match(navigation,/aria-controls=\{bodyId\}/);
 assert.match(shell,/className="nd-book-layout"/);
 assert.match(shell,/className="nd-book-content">\{children\}/);
 assert.doesNotMatch(navigation,/openGroup|nd-book-navigation-panel|closeOutside/);
 assert.doesNotMatch(navigation,/newDesignApi|location\.assign|history\.replaceState/);
 assert.match(tree,/<a className="nd-nav-tree-label" href=/);
});

test('function tree preserves original routes and reduces single-page groups to direct links',()=>{
 const builder={};
 new Function('require','exports',ts.transpileModule(read('src/client/bookNavigation/catalog.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name==='../navigation')return exportsObject;throw Error(`Unexpected dependency ${name}`);},builder);
 const bookId='41000000-0000-4000-8000-000000000002',nodes=builder.buildBookFunctionTree(bookId);
 assert.equal(nodes.length,5);
 assert.equal(nodes[0].id,'page:overview');assert.equal(nodes[0].href,`/new-design/books/${bookId}/overview`);assert.equal(nodes[0].children,undefined);
 assert.equal(nodes[1].id,'page:direction');assert.equal(nodes[2].id,'group:setting');assert.equal(nodes[3].id,'group:production');
 assert.equal(nodes[4].id,'page:completion');assert.equal(nodes[4].children,undefined);
 const collect=items=>items.flatMap(item=>[item,...collect(item.children??[])]);
 const leaves=collect(nodes).filter(item=>item.id.startsWith('page:'));
 for(const item of BOOK_TASK_NAV.filter(item=>!['settings','world','characters','materials'].includes(item.key)))assert.equal(leaves.find(node=>node.id===`page:${item.key}`).href,`/new-design/books/${bookId}/${item.path}`);
 assert.equal(leaves.length,BOOK_TASK_NAV.length-4);
 assert.equal(collect(nodes).some(node=>node.href?.startsWith('/new-design/resources')),false);
});

test('sidebar shrink releases layout width without floating overlays or editor unmounts',()=>{
 const css=read('src/client/bookNavigation/navigation.css'),navigation=read('src/client/bookNavigation/index.tsx');
 assert.match(css,/\.nd-book-navigation\.is-collapsed\{width:44px;padding:0\}/);
 assert.match(css,/grid-template-columns:auto minmax\(0,1fr\)/);
 assert.match(css,/@container\(min-width:800px\)/);
 assert.match(css,/\.nd-book-navigation-body\[hidden\]\{display:none\}/);
 assert.doesNotMatch(css,/position:absolute|box-shadow|z-index|nd-book-module-tabs|nd-book-tools/);
 assert.doesNotMatch(navigation,/collapsed&&.*TreeNavigation|!collapsed&&.*TreeNavigation/);
 assert.match(read('src/client/bookComposition/composition.css'),/@container nd-book-content \(min-width:900px\)/);
});

test('collapse only hides navigation and preserves the editor subtree and branch instances',()=>{
 const shell=read('src/client/BookShell.tsx'),navigation=read('src/client/bookNavigation/index.tsx');
 assert.doesNotMatch(shell,/collapsed|key=\{active\}/);
 assert.doesNotMatch(navigation,/setItem.*(?:draft|request)|newDesignApi|location\.|history\./);
 assert.match(navigation,/useMemo\(\(\)=>buildBookFunctionTree\(bookId\),\[bookId\]\)/);
 assert.match(navigation,/catch\{\/\* Navigation remains usable/);
});

test('composition directory shares the tree without replacing selection or body persistence',()=>{
 const composition=read('src/client/bookComposition/BookCompositionPage.tsx');
 assert.match(composition,/TreeNavigation,flatNavigation/);
 assert.match(composition,/parentId:object.parentObjectId/);
 assert.match(composition,/onSelect:\(\)=>select\(object\)/);
 assert.match(composition,/if\(!preserve\(\)\|\|object.bookId!==bookId/);
 assert.match(composition,/ChapterWritingPage key=\{bookId\}/);
 assert.doesNotMatch(composition,/role="treeitem"|const renderNodes=/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const read=file=>fs.readFileSync(path.join(__dirname,'../',file),'utf8');
function load(file,dependencies={}){const exports={};const compiled=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',compiled)(name=>{if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name];},exports);return exports;}
const kinds=['title_candidate','writing_config','quality_rule','genre_strategy','progression_mode'];
const labels={title_candidate:'标题候选',writing_config:'写法资源',quality_rule:'质量规则',genre_strategy:'题材策略',progression_mode:'推进模式'};
const {buildProfessionalResourceTree}=load('src/client/professionalResources/catalog.ts',{'../../common/professionalResources':{RESOURCE_KINDS:kinds,RESOURCE_LABELS:labels}});
const {filterNavigation,navigationAncestors,flatNavigation}=load('src/client/tree/navigationPolicy.ts');
const filters=(patch={})=>({search:'',favoritesOnly:false,includeArchived:false,...patch});
const resource=(patch={})=>({id:'original-resource',versionId:'original-version',kind:'quality_rule',title:'避免空泛总结',revision:3,status:'active',favorite:false,...patch});
test('professional tree uses original resources underneath each Chinese category',()=>{
 const original=resource(),tree=buildProfessionalResourceTree([original],filters());
 assert.equal(tree.length,5);const parent=tree.find(node=>node.kind==='quality_rule');
 assert.equal(parent.count,1);assert.equal(parent.children[0].id,'resource:original-resource');assert.equal(parent.children[0].resource,original);assert.match(parent.children[0].description,/修订 3/);
});
test('name search crosses categories, keeps ancestors and preserves source identity',()=>{
 const original=resource({kind:'writing_config',title:'仙侠慢热对白'}),tree=buildProfessionalResourceTree([resource({id:'other-resource'}),original],filters({search:'慢热'}));
 assert.equal(tree.length,1);assert.equal(tree[0].id,'kind:writing_config');assert.equal(tree[0].children[0].resource,original);
 assert.deepEqual(navigationAncestors(tree,new Set(['resource:original-resource'])),['kind:writing_config']);
 assert.equal(filterNavigation(tree,'慢热')[0].children[0].resource,original);
});
test('Chinese category search respects both favorites and archive filters',()=>{
 const current=resource({favorite:true}),archived=resource({id:'archived',favorite:true,status:'archived'}),other=resource({id:'uncollected'});
 const normal=buildProfessionalResourceTree([current,archived,other],filters({search:'质量规则',favoritesOnly:true}));assert.equal(normal[0].count,1);assert.equal(normal[0].children[0].resource,current);
 const history=buildProfessionalResourceTree([current,archived,other],filters({search:'质量规则',favoritesOnly:true,includeArchived:true}));assert.equal(history[0].count,2);assert.match(history[0].children[1].description,/已归档，只读/);
});
test('empty directories have zero count and no synthetic resource placeholders',()=>{
 const tree=buildProfessionalResourceTree([],filters());assert.ok(tree.every(node=>node.count===0&&node.children.length===0));assert.deepEqual(buildProfessionalResourceTree([],filters({search:'不存在'})),[]);
});
test('shared tree retains module sibling ordering and safely displays broken parent chains',()=>{
 const nodes=[{id:'second',name:'乙',parentId:null,sortOrder:0},{id:'first',name:'甲',parentId:null,sortOrder:0},{id:'child',name:'子',parentId:'first'},{id:'orphan',name:'孤',parentId:'missing'},{id:'cycle-a',name:'环甲',parentId:'cycle-b'},{id:'cycle-b',name:'环乙',parentId:'cycle-a'}];
 const tree=flatNavigation(nodes,node=>({...node}),(a,b)=>nodes.indexOf(a)-nodes.indexOf(b));assert.equal(tree[0].id,'second');assert.equal(tree[1].id,'first');assert.equal(tree[1].children[0].id,'child');
 const ids=[],walk=branch=>branch.forEach(node=>{ids.push(node.id);walk(node.children??[]);});walk(tree);assert.equal(new Set(ids).size,6);assert.equal(ids.length,6);assert.equal(nodes[3].parentId,'missing');
});
test('both resource pages reuse shared navigation and preserve original write guards',()=>{
 const page=read('src/client/professionalResources/index.tsx'),browser=read('src/client/resourceBrowser/ResourceCatalogTree.tsx'),shared=read('src/client/tree/TreeNavigation.tsx');
 assert.match(page,/<TreeNavigation/);assert.match(browser,/<TreeNavigation/);assert.doesNotMatch(browser,/const render=/);
 assert.match(page,/onClick=\{\(\)=>choose\(null,category\.kind\)\}/);assert.match(page,/if\(locked\)return;if\(dirtyRef\.current\)/);assert.match(page,/selected&&!selectedActive/);assert.match(page,/setPendingSelection/);
 assert.match(shared,/if\(opening&&!disabled&&!node\.disabled\)/);assert.match(shared,/if\(!node\.onSelect\)node\.onExpand/);assert.doesNotMatch(shared,/api\.|role="tree"/);
});

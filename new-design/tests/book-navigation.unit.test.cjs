const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

const bookId='41000000-0000-4000-8000-000000000002';
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const workflow={};
new Function('exports',compile('src/client/bookNavigation/workflow.ts'))(workflow);

function render(active,pathname,search=''){
 const module={};
 const load=name=>{
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='./workflow')return workflow;
  if(name==='./progress')return {workflowProgress:()=>[]};
  if(name==='../api')return {newDesignApi:{}};
  if(name==='./BookRouteShell')return {default:()=>null};
  if(name.endsWith('.css'))return {};
  throw new Error(`Unexpected dependency: ${name}`);
 };
 new Function('require','exports','location','sessionStorage',compile('src/client/bookNavigation/index.tsx'))(load,module,{pathname,search},{getItem:()=>null});
 return renderToStaticMarkup(React.createElement(module.default,{book:{id:bookId,name:'测试书'},active}));
}

function currentLinks(html){return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"[^>]*>/g)].map(match=>match[1]);}

test('live book sidebar presents eight workflow steps and auxiliary routes',()=>{
 const html=render('overview',`/new-design/books/${bookId}/overview`);
 assert.equal((html.match(/class="nd-production-step-number"/g)??[]).length,8);
 for(const route of ['overview','composition','planning','director','views/chapters','history','completion','fields'])assert.match(html,new RegExp(`href="/new-design/books/${bookId}/${route}"`));
 assert.deepEqual(currentLinks(html),[`/new-design/books/${bookId}/overview`]);
});

test('workflow step and auxiliary tool never claim the same current page',()=>{
 const cases=[
  ['planning','planning?stage=structured','planning?stage=structured'],
  ['composition','composition','planning?stage=structured'],
  ['views','views/quality','views/quality'],
  ['views','views/chapters','views/chapters'],
  ['director','director','director'],
  ['history','history','history'],
  ['completion','completion','completion'],
  ['settings','fields','fields'],
 ];
 for(const [active,route,selected] of cases){
  const [page,query]=route.split('?');
  const html=render(active,`/new-design/books/${bookId}/${page}`,query?`?${query}`:'');
  assert.deepEqual(currentLinks(html),[`/new-design/books/${bookId}/${selected}`],`${active}: ${route}`);
 }
});

test('auxiliary routes are tucked away during eight-step creation and expanded when selected',()=>{
 const step=render('direction',`/new-design/books/${bookId}/setting`);
 assert.match(step,/<details class="nd-production-tools"/);
 assert.doesNotMatch(step,/<details class="nd-production-tools" open=""/);
 const tool=render('history',`/new-design/books/${bookId}/history`);
 assert.match(tool,/<details class="nd-production-tools" open=""/);
});

test('project navigation wins the collapsed book grid in both hosts',()=>{
 const workbench=fs.readFileSync(path.join(__dirname,'../src/client/bookNavigation/workbench.css'),'utf8');
 const standalone=fs.readFileSync(path.join(__dirname,'../src/client/standalone/theme.css'),'utf8');
 assert.match(workbench,/\[data-new-design-nav-mode="project"\] \.nd-book-shell \.nd-book-layout:has\(>\.nd-book-navigation\.is-collapsed\)\{grid-template-columns:minmax\(0,1fr\)\}/);
 assert.match(standalone,/\.is-project-navigation \.nd-book-shell \.nd-book-layout:has\(>\.nd-book-navigation\.is-collapsed\) \{ grid-template-columns: minmax\(0, 1fr\); \}/);
 assert.match(standalone,/\.nd-independent-layout\.is-book-workspace\.is-project-navigation \.nd-independent-sidebar \{ display: block; \}/);
 assert.match(standalone,/\.nd-independent-layout\.is-book-workspace \.nd-independent-menu \{ display: none; \}/);
});

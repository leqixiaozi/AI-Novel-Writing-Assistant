const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.join(__dirname,'../src'),cache=new Map(),noop=()=>null;
function load(relative){
 const file=path.join(root,relative);if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 let source=fs.readFileSync(file,'utf8');if(relative==='client/bookshelf/index.tsx')source+='\nexport { BookCard };';
 const requireLocal=name=>{
  if(name.endsWith('.css'))return {};
  if(relative==='client/bookshelf/index.tsx'){
   if(name==='../api')return {newDesignApi:{},ApiError:Error};
   if(['./BookDialog','./BookDetails','./DirectorQuickAction','../storyWorkspace/Help'].includes(name))return {__esModule:true,default:noop};
   if(name==='./download')return {downloadBookText:noop};
  }
  if(!name.startsWith('.'))return require(name);
  const candidate=path.resolve(path.dirname(file),name),resolved=['.ts','.tsx','/index.ts'].map(extension=>candidate+extension).find(item=>fs.existsSync(item));
  if(!resolved)throw Error('Missing fixture dependency: '+name);
  return load(path.relative(root,resolved));
 };
 new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,requireLocal);return exports;
}
const panels=load('client/home/panels.tsx'),presentation=load('common/home/presentation.ts'),workflow=load('client/bookNavigation/workflow.ts'),{BookCard}=load('client/bookshelf/index.tsx');
function book(overrides={}){return {id:'41000000-0000-4000-8000-000000000002',name:'Fixture',description:'',createdAt:'2026-09-16T00:00:00Z',updatedAt:'2026-09-17T00:00:00Z',characterCount:1,worldCount:1,writtenChapterCount:1,stableChapterCount:0,adoptedChapterPlanCount:3,writableChapterPlanCount:1,runningTasks:0,queuedTasks:0,waitingTasks:0,pendingFacts:0,pendingChanges:0,latestTask:null,latestDirector:null,lastChapterCardId:null,revision:1,candidateCount:0,wordCount:20,cover:null,...overrides};}
const render=props=>renderToStaticMarkup(React.createElement(BookCard,{book:book(props),layout:'workbench',locked:false,onArchive:noop,onOpen:noop,onDownload:noop,downloading:false,onChanged:noop}));
test('first-book entry renders actionable short and manual creation links with the actual parameters',()=>{
 const html=renderToStaticMarkup(React.createElement(panels.HomeHero,{book:null,draft:null}));
 assert.match(html,/href="\/new-design\/books\/new\?method=idea&amp;mode=automatic&amp;form=short_story"/);
 assert.match(html,/href="\/new-design\/books\/new\?method=blank&amp;mode=manual"/);
});
test('quality guidance targets the existing quality view',()=>{assert.equal(presentation.homeStages(book()).at(-1).href,'/new-design/books/41000000-0000-4000-8000-000000000002/views/quality');});
test('completed director does not capture the next-action writing link',()=>{
 const html=render({latestDirector:{id:'original',status:'completed',savedCandidateCount:2,leaseExpired:false}});
 assert.match(html,/class="nd-button nd-button-primary[^"]*" href="[^\"]*\/writing"/);
});
test('live director exposes the inspect action while rendering every shared workflow route',()=>{
 const html=render({latestDirector:{id:'original',status:'running',savedCandidateCount:0,leaseExpired:false}});
 assert.match(html,/<button class="nd-button nd-button-primary[^"]*"/);
 assert.equal(workflow.BOOK_WORKFLOW_STEPS.length,8);
 const nav=html.match(/<nav class="nd-shelf-steps"[^>]*>(.*?)<\/nav>/)[1];
 assert.equal((nav.match(/<a /g)||[]).length,8);
 for(const step of workflow.BOOK_WORKFLOW_STEPS)assert.ok(nav.includes('/'+step.path.replaceAll('&','&amp;')));
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.join(__dirname,'..');
function load(file,mocks={}){const exports={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{if(name in mocks)return mocks[name];throw Error(`Unexpected dependency: ${name}`);},exports);return exports;}
const model=load('src/client/storyWorkspace/model.ts');
const plan=(id,level,parent=null,refs=[],extras={})=>({id,level,parentObjectId:parent,status:'active',cardId:null,currentVersion:{references:refs,content:extras}});

test('volume and chapter scopes include descendants, exclude siblings and archived plans, reject absent scopes',()=>{
 const all=[plan('s','story'),plan('v1','volume','s'),plan('v2','volume','s'),plan('c1','chapter','v1'),plan('c2','chapter','v2'),plan('scene','scene','c1'),{...plan('old','chapter','v1'),status:'archived'}];
 assert.deepEqual(model.plansInScope(all,'v1').map(row=>row.id),['v1','c1','scene']);
 assert.deepEqual(model.plansInScope(all,'c1').map(row=>row.id),['c1','scene']);
 assert.deepEqual(model.plansInScope(all,'absent'),[]);
 assert.equal(model.plansInScope(all,'book').length,6);
});
test('scope traversal terminates for corrupt cycles without selecting another scope',()=>{
 const cyclic=[plan('a','volume','b'),plan('b','chapter','a'),plan('outside','chapter')];
 assert.deepEqual(model.plansInScope(cyclic,'a').map(row=>row.id),['a','b']);
});
test('planned relationship endpoints and referenced objects retain actual identities without reading settled facts',()=>{
 const row=plan('c','chapter',null,[{cardId:'person1'}],{relationshipPlans:[{sourceId:'person1',targetId:'person2',description:'计划决裂'}]});
 assert.deepEqual([...model.planningCardIds([row])],['person1','person2']);
 assert.deepEqual(model.plannedRelations(plan('empty','chapter',null,[],{relationshipPlans:[null,{sourceId:4}]})),[]);
});
test('story occurrence and narration stay separate; an unassigned occurrence never invents a numeric order',()=>{
 const row=plan('chapter','chapter',null,[],{storyTime:'旧计划时间',eventSchedule:{e:{occurrenceOrder:7,timeLabel:'入山前'}}});
 assert.equal(model.plannedTime(row,'e'),'发生顺序 7 · 入山前');
 assert.equal(model.plannedTime(row,'other'),'旧计划时间');
 assert.equal(model.plannedTime(plan('blank','chapter'),'e'),'未安排发生顺序／时间');
});
test('setting links return to exact same-book planning filters and preserve legacy plan hashes',()=>{
 const link=model.settingHref('book',{id:'person',typeKey:'character'},'/new-design/books/book/planning?tab=characters&scope=volume&plan=chapter#plan-chapter');
 const query=new URL(link,'http://workspace.local').searchParams;
 assert.equal(query.get('tab'),'characters');assert.equal(query.get('selected'),'person');
 assert.equal(model.safePlanningReturn('book',query.get('returnTo')),'/new-design/books/book/planning?tab=characters&scope=volume&plan=chapter#plan-chapter');
 for(const unsafe of ['https://evil.test/new-design/books/book/planning','//evil.test/new-design/books/book/planning','/new-design/books/other/planning','/new-design/books/book/writing','javascript:alert(1)'])assert.equal(model.safePlanningReturn('book',unsafe),null);
 assert.equal(model.writingHref('book','chapter'),'/new-design/books/book/chapters/chapter/write');
 assert.equal(model.writingHref('book'),'/new-design/books/book/writing');
});
test('ambiguous source parameters are rejected while search text does not become a source identity',()=>{
 assert.equal(model.hasAmbiguousNavigation(new URLSearchParams('plan=a&plan=b')),true);
 assert.equal(model.hasAmbiguousNavigation(new URLSearchParams('tab=characters&selected=p&scope=book')),false);
});

function hooks(states=[]){const slots=[];let cursor=0,stateCursor=0;return {react:{useState(initial){const i=cursor++,state=stateCursor++;if(!(i in slots))slots[i]=state in states?states[state]:typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useCallback(callback){cursor++;return callback;},useEffect(){cursor++;},useMemo(factory){cursor++;return factory();}},render(run){cursor=0;stateCursor=0;return run();}};}
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
function flatten(node){if(!node||typeof node!=='object')return [];return [node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(flatten)];}
function button(node,label){return flatten(node).find(item=>item.type==='button'&&item.props.children===label);}
function guardFixture(states){const h=hooks();const {useWorkspaceGuard}=load('src/client/storyWorkspace/useGuard.tsx',{'react':h.react,'react/jsx-runtime':jsx});return {render:()=>h.render(()=>useWorkspaceGuard(()=>states))};}

test('clean navigation executes once; a dirty editor offers save, discard and cancel without navigating',()=>{
 let moves=0;const state={dirty:false,locked:false},fixture=guardFixture([state]);
 fixture.render().request(()=>moves++);assert.equal(moves,1);
 state.dirty=true;fixture.render().request(()=>moves++);let view=fixture.render();assert.equal(moves,1);
 assert.ok(button(view.dialog,'保存并继续'));assert.ok(button(view.dialog,'放弃修改并继续'));
 button(view.dialog,'取消，继续编辑').props.onClick();view=fixture.render();assert.equal(moves,1);assert.equal(button(view.dialog,'保存并继续'),undefined);
});
test('failed or unknown save leaves the original navigation pending and does not retry',async()=>{
 let moves=0,saves=0;const fixture=guardFixture([{dirty:true,locked:false,save:async()=>{saves++;return false;}}]);
 fixture.render().request(()=>moves++);await button(fixture.render().dialog,'保存并继续').props.onClick();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(saves,1);assert.equal(moves,0);assert.ok(button(fixture.render().dialog,'保存并继续'));
});
test('save-before-leave waits for every dirty editor and executes the intended transition once',async()=>{
 let moves=0;const order=[],a={dirty:true,locked:false,save:async()=>{order.push('form');a.dirty=false;return true;}},b={dirty:true,locked:false,save:async()=>{order.push('initial');b.dirty=false;return true;}};
 const fixture=guardFixture([a,b]);fixture.render().request(()=>moves++);button(fixture.render().dialog,'保存并继续').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(order,['form','initial']);assert.equal(moves,1);assert.equal(button(fixture.render().dialog,'保存并继续'),undefined);
});
test('explicit discard invokes draft clearing; locked original requests cannot leave or discard',()=>{
 let moves=0,discards=0;const state={dirty:true,locked:false,discard:()=>{discards++;state.dirty=false;return true;}},fixture=guardFixture([state]);
 fixture.render().request(()=>moves++);button(fixture.render().dialog,'放弃修改并继续').props.onClick();assert.equal(discards,1);assert.equal(moves,1);
 state.locked=true;fixture.render().request(()=>moves++);assert.equal(moves,1);assert.equal(button(fixture.render().dialog,'保存并继续'),undefined);
});

function planningEditorFixture(context,failure=false){
 const previous=Object.fromEntries(['location','history','sessionStorage'].map(key=>[key,global[key]])),store=new Map();
 global.location={search:'?plan=chapter',hash:''};global.history={replaceState(){}};global.sessionStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
 context.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}});
 const material=(id,typeKey)=>({cardId:id,typeKey,cardVersionId:`version-${id}`,title:id});
 const base={goal:'原目标'},draft={title:'本章',level:'chapter',parentObjectId:'volume',cardId:'chapter-card',goal:'新的章节目标',storyTime:'',mustHappen:'',mustPreserve:'',forbiddenBoundaries:'',expectedChanges:'',characterArc:'',notes:'',executionMode:'manual',viewpointId:'',locationId:'',participantIds:['person1'],eventIds:['event1'],itemIds:[],organizationIds:[],foreshadowActions:{},baseVersionId:'old-version',contentExtras:{...base,customAuthorData:{keep:true}},referenceNotes:{'participant:person1':'在本章做出牺牲'},eventSchedule:{event1:{occurrenceOrder:'3',timeLabel:'昨日'}},relationshipPlans:[{sourceId:'person1',targetId:'person2',description:'计划建立信任'}]};
 const chapter={...plan('chapter','chapter','volume'),bookId:'book',title:'本章',revision:4,cardId:'chapter-card',adoptedVersionId:'adopted',currentVersion:{id:'old-version',version:1,source:'manual',status:'draft',executionMode:'manual',createdAt:'2026-01-01',content:base,references:[]},versions:[]};
 const workspace={bookId:'book',objects:[{...plan('volume','volume'),adoptedVersionId:'volume-version',currentVersion:{...chapter.currentVersion}},chapter],materials:[material('person1','character'),material('person2','character'),material('event1','event'),material('chapter-card','chapter')],settlementSummary:{},aiCapability:{configured:false}},book={id:'book'},calls=[];
 const api={addPlanningVersion:async(id,input)=>{calls.push({id,input});if(failure)throw Error('connection interrupted');return {...chapter,revision:5,currentVersion:{...chapter.currentVersion,id:'saved',content:input.content,references:input.references}};},getBook:async()=>book,getPlanningCenter:async()=>workspace};
 const h=hooks([book,workspace,'chapter',draft,'all',false,'','',false,'','',false,false]);
 const module=load('src/client/planningCenter/PlanningCenterPage.tsx',{'react':h.react,'react/jsx-runtime':jsx,'../api':{newDesignApi:new Proxy(api,{get(target,key){if(!(key in target)&&key!==Symbol.toStringTag)throw Error(`Forbidden side effect ${String(key)}`);return target[key];}}),ApiError:class ApiError extends Error{}},'../BookShell':{default:()=>null},'./AiPlanningPanel':{default:()=>null},'../storyWorkspace/Help':{default:()=>null}});
 return {render:()=>h.render(()=>module.default({bookId:'book',embedded:true})),calls,store};
}
test('actual shared planning save preserves custom content and writes plans/references without adopting or settling facts',async context=>{
 const fixture=planningEditorFixture(context);button(fixture.render(),'另存新候选').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fixture.calls.length,1);const {id,input}=fixture.calls[0];assert.equal(id,'chapter');assert.equal(input.expectedRevision,4);
 assert.deepEqual(input.content.customAuthorData,{keep:true});assert.deepEqual(input.content.eventSchedule.event1,{occurrenceOrder:3,timeLabel:'昨日'});
 assert.equal(input.content.relationshipPlans[0].description,'计划建立信任');
 assert.equal(input.references.find(ref=>ref.cardId==='person1').note,'在本章做出牺牲');assert.ok(input.references.some(ref=>ref.cardId==='person2'&&ref.role==='participant'));
 assert.equal(fixture.store.size,0);
});
test('an interrupted actual planning save retains the same request and locks a second submission',async context=>{
 const fixture=planningEditorFixture(context,true);button(fixture.render(),'另存新候选').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fixture.calls.length,1);assert.equal(fixture.store.size,1);
 const pending=JSON.parse([...fixture.store.values()][0]);assert.equal(pending.input.idempotencyKey,fixture.calls[0].input.idempotencyKey);
 const next=button(fixture.render(),'另存新候选');assert.equal(next.props.disabled,true);next.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(fixture.calls.length,1);
});

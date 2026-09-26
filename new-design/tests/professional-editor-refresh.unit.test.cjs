const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs');
const contract=compiled('common/professionalResources');
// Drive the actual editor against asynchronous catalog changes without a model,
// service, author database or browser. This is a race test, not browser QA.
function fixture(resource=null){
 const slots=[],effects=[],storage=new Map();let cursor=0,scheduled=[],dirty=false,catalog;
 const originals=['window','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(global,key)]);
 Object.defineProperty(global,'window',{configurable:true,value:{location:{search:''},addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(global,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;dirty=true;}];},useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useCallback:(callback,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={value:callback,deps};return slots[index].value;},useMemo:(callback,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={value:callback(),deps};return slots[index].value;},useEffect:(effect,deps)=>{const index=cursor++;if(!effects[index]||!same(effects[index].deps,deps))scheduled.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:effect()};});}};
 const DynamicForm=()=>null,TreeNavigation=()=>null,noop=()=>null,jsx=(type,props)=>({type,props});
 function load(relative){const module={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/client',relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(module,module.exports,id=>id==='react'?react:id==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:id==='../../common/professionalResources'?contract:id==='./catalog'?load('professionalResources/catalog.ts'):id==='../DynamicForm'?{default:DynamicForm}:id==='../tree'?{TreeNavigation}:id.endsWith('.css')?{}:{default:noop});return module.exports;}
 const Page=load('professionalResources/index.tsx').default,fields=[{key:'name',name:'名字',type:'text',required:true,options:[]}],type={id:randomUUID(),typeVersionId:randomUUID(),kind:'character',fields};
 catalog={resources:resource?[resource]:[],types:[type],books:[],feedback:[],publicCharactersCapability:{installed:true,operational:true}};
 const calls=[],api={catalog:async()=>structuredClone(catalog),command:async input=>{calls.push(structuredClone(input));const error=Error('acknowledged rollback');error.recovery={mutationOutcome:'not_written'};throw error;},receipt:async()=>null};
 const props={api,trialApi:{},initialKind:'character',kinds:['character']};
 function render(){let tree;for(let count=0;count<6;count++){dirty=false;cursor=0;scheduled=[];tree=Page(props);for(const effect of scheduled)effect();if(!dirty)return tree;}throw Error('Editor fixture did not settle');}
 function all(tree){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(all);return[tree,...all(tree.props?.children)];}
 function text(tree){return typeof tree==='string'?tree:Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';}
 const button=(tree,label)=>all(tree).find(node=>node.type==='button'&&text(node)===label);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();return render();};
 return{type,calls,render,flush,button,all,DynamicForm,TreeNavigation,setCatalog:next=>catalog=next,get catalog(){return catalog;},restore:()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(global,key,descriptor);else delete global[key];}}};
}
test('refresh retains the exact creation specification until the author explicitly accepts the new specification',async()=>{
 const f=fixture();try{f.render();let tree=await f.flush();f.all(tree).find(node=>node.type===f.TreeNavigation).props.nodes[0].actions.props.onClick();tree=f.render();f.all(tree).find(node=>node.type==='input'&&node.props.maxLength===240).props.onChange({target:{value:'人工样本'}});f.all(tree).find(node=>node.type===f.DynamicForm).props.onChange({name:'保留人工名字'});
 const latest={...f.catalog,types:[{...f.type,typeVersionId:randomUUID()}]};f.setCatalog(latest);tree=f.render();f.button(tree,'只读刷新资源目录').props.onClick();tree=await f.flush();assert.equal(f.all(tree).find(node=>node.type===f.DynamicForm).props.values.name,'保留人工名字');f.button(tree,'保存到原资源库').props.onClick();tree=await f.flush();assert.equal(f.calls[0].expectedTypeVersionId,f.type.typeVersionId);
 f.button(tree,'核对后使用新版，保留当前填写').props.onClick();tree=f.render();f.button(tree,'保存到原资源库').props.onClick();await f.flush();assert.equal(f.calls[1].expectedTypeVersionId,latest.types[0].typeVersionId);assert.equal(f.calls[1].values.name,'保留人工名字');
 }finally{f.restore();}
});
test('refresh cannot turn an old edit into a write using a concurrently changed resource version',async()=>{
 const resource={id:randomUUID(),versionId:randomUUID(),typeId:randomUUID(),typeVersionId:randomUUID(),kind:'character',title:'原角色',revision:1,values:{name:'原名字'},fields:[{key:'name',name:'名字',type:'text',required:true,options:[]}],favorite:false,status:'active'},f=fixture(resource);
 try{f.render();let tree=await f.flush();f.all(tree).find(node=>node.type===f.TreeNavigation).props.nodes[0].children[0].onSelect();tree=f.render();f.all(tree).find(node=>node.type===f.DynamicForm).props.onChange({name:'当前人工修改'});const latest={...resource,versionId:randomUUID(),revision:2,values:{name:'另一作者修改'}};f.setCatalog({...f.catalog,resources:[latest]});tree=f.render();f.button(tree,'只读刷新资源目录').props.onClick();tree=await f.flush();f.button(tree,'保存到原资源库').props.onClick();tree=await f.flush();assert.equal(f.calls[0].versionId,resource.versionId);assert.equal(f.calls[0].expectedRevision,1);assert.equal(f.calls[0].values.name,'当前人工修改');
 f.button(tree,'核对后使用新版，保留当前填写').props.onClick();tree=f.render();f.button(tree,'保存到原资源库').props.onClick();await f.flush();assert.equal(f.calls[1].versionId,latest.versionId);assert.equal(f.calls[1].expectedRevision,2);assert.equal(f.calls[1].values.name,'当前人工修改');
 }finally{f.restore();}
});

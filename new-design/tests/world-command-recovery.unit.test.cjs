const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs');
const contract=compiled('common/worldPackages');
function fixture(){
 const values=new Map(),slots=[],effects=[],held=new Set();let cursor=0,scheduled=[],dirty=false,writes=0,reads=0,accepted=0,write=async()=>{throw Error('acknowledgement lost');},read=async()=>null;
 const originals=['localStorage','window','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(global,key)]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 Object.defineProperty(global,'localStorage',{configurable:true,value:storage});
 Object.defineProperty(global,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(global,'navigator',{configurable:true,value:{locks:{request:async(key,_options,callback)=>{if(held.has(key))return callback(null);held.add(key);try{return await callback({name:key});}finally{held.delete(key);}}}});
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;dirty=true;}];},
  useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},
  useCallback:(callback,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={value:callback,deps};return slots[index].value;},
  useEffect:(effect,deps)=>{const index=cursor++;if(!effects[index]||!same(effects[index].deps,deps)){scheduled.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:effect()};});}}
 };
 class ApiError extends Error{constructor(message,outcome){super(message);this.recovery={mutationOutcome:outcome};}}
 const api={libraryPublish:async(_book,input)=>{writes++;return write(input);},libraryOriginal:async(_book,input)=>{reads++;return read(input);}};
 const module={exports:{}},source=fs.readFileSync(path.join(__dirname,'../src/client/worldPackages/command.ts'),'utf8');
 new Function('module','exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports,id=>id==='react'?react:id==='../api'?{ApiError,newDesignApi:{worldPackages:api}}:contract);
 const book=randomUUID(),root=randomUUID(),input={requestKey:randomUUID(),candidateId:randomUUID(),publicRequestKey:randomUUID(),previewHash:'a'.repeat(64)},command={kind:'libraryPublish',bookId:book,input},key=`new-design:world-command:${book}:${root}`;
 const accept=async()=>{accepted++;};
 return{values,storage,book,root,command,key,ApiError,get writes(){return writes;},get reads(){return reads;},get accepted(){return accepted;},setWrite:callback=>write=callback,setRead:callback=>read=callback,
  result:original=>({bookId:book,requestKey:original.requestKey,input:structuredClone(original),candidate:null,package:null,installation:null,repeated:false}),
  render:(scopeBook=book,scopeRoot=root)=>{let hook;for(let count=0;count<5;count++){dirty=false;cursor=0;scheduled=[];hook=module.exports.useWorldCommand(scopeBook,scopeRoot,accept);for(const effect of scheduled)effect();if(!dirty)return hook;}throw Error('Fixture render did not settle');},
  restore:()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(global,key,descriptor);else delete global[key];}}
 };
}
test('world publication keeps exact lost request and recovers through reads without resending',async()=>{
 const f=fixture(),original=structuredClone(f.command);
 try{assert.equal(await f.render().perform(f.command),false);f.command.input.publicRequestKey=randomUUID();assert.deepEqual(JSON.parse(f.values.get(f.key)),original);assert.equal(await f.render().perform(f.command),false);assert.equal(f.writes,1);assert.equal(await f.render().verify(),false);f.setRead(input=>f.result(input));assert.equal(await f.render().verify(),true);assert.equal(f.writes,1);assert.equal(f.reads,2);assert.equal(f.accepted,1);assert.equal(f.values.has(f.key),false);assert.deepEqual(JSON.parse(f.values.get(`${f.key}:confirmed`)).command,original);}finally{f.restore();}
});
test('silent failure to persist the original world command sends zero writes',async()=>{
 const f=fixture();try{f.storage.setItem=()=>{};assert.equal(await f.render().perform(f.command),false);assert.equal(f.writes,0);assert.equal(f.render().blocked,true);}finally{f.restore();}
});
test('confirmed rollback cannot unlock a world request when local cleanup silently fails',async()=>{
 const f=fixture();try{f.setWrite(()=>{throw new f.ApiError('rolled back','not_written');});f.storage.removeItem=()=>{};assert.equal(await f.render().perform(f.command),false);assert.equal(f.values.has(f.key),true);assert.equal(f.render().blocked,true);}finally{f.restore();}
});
test('world receipt for another full input cannot clear the original command',async()=>{
 const f=fixture();try{f.setWrite(input=>({...f.result(input),input:{...input,publicRequestKey:randomUUID()}}));assert.equal(await f.render().perform(f.command),false);assert.equal(f.accepted,0);assert.equal(f.values.has(f.key),true);assert.equal(f.values.has(`${f.key}:confirmed`),false);}finally{f.restore();}
});
test('failed confirmed-result storage keeps the world command for read-only recovery',async()=>{
 const f=fixture();try{const save=f.storage.setItem;f.storage.setItem=(key,value)=>{if(!key.endsWith(':confirmed'))save(key,value);};f.setWrite(input=>f.result(input));assert.equal(await f.render().perform(f.command),false);assert.equal(f.values.has(f.key),true);assert.equal(f.accepted,0);f.storage.setItem=save;f.setRead(input=>f.result(input));assert.equal(await f.render().verify(),true);assert.equal(f.writes,1);assert.equal(f.reads,1);}finally{f.restore();}
});
test('late world result after scope switch preserves the original source and leaves the new source unlocked',async()=>{
 const f=fixture();let resolve;
 try{f.setWrite(()=>new Promise(done=>resolve=done));const request=f.render().perform(f.command);assert.equal(typeof resolve,'function');const other=f.render(randomUUID(),randomUUID());assert.equal(other.locked,false);resolve(f.result(f.command.input));assert.equal(await request,false);assert.equal(f.accepted,0);assert.equal(f.values.has(f.key),true);f.setRead(input=>f.result(input));assert.equal(await f.render().verify(),true);assert.equal(f.writes,1);assert.equal(f.accepted,1);}finally{f.restore();}
});

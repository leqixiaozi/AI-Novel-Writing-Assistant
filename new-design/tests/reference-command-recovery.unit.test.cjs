const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function fixture(){
 const values=new Map(),refs=[],effects=[],original=global.localStorage;let cursor=0,scheduled=[];
 global.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const react={useState:v=>{cursor++;return[v,()=>{}];},useRef:v=>{const i=cursor++;return refs[i]??(refs[i]={current:v});},useEffect:(fn,deps)=>{const i=cursor++,previous=effects[i];if(!previous||deps.some((v,n)=>v!==previous[n])){scheduled.push(fn);effects[i]=deps;}}};
 class ApiError extends Error{constructor(message,outcome){super(message);this.recovery={mutationOutcome:outcome};}}
 const module={exports:{}},source=fs.readFileSync(path.join(__dirname,'../src/client/referenceParity/useCommand.ts'),'utf8');
 new Function('module','exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports,id=>id==='react'?react:{ApiError});
 return{values,ApiError,render:(scope,options)=>{cursor=0;scheduled=[];const hook=module.exports.useReferenceCommand(scope,options);for(const effect of scheduled)effect();return hook;},restore:()=>global.localStorage=original};
}
test('lost acknowledgements freeze the full original input and recover only through reads',async()=>{
 const f=fixture();let writes=0,reads=0,accepted,receipt=null;const input={key:'original',values:{purpose:'原填写'}},frozen=structuredClone(input);
 try{const h=f.render('scope',{valid:v=>!!v.key,write:async()=>{writes++;throw new Error('lost');},read:async v=>{reads++;assert.deepEqual(v,frozen);return receipt;},accept:async v=>accepted=v});
  assert.equal(await h.perform(input),false);input.values.purpose='changed';assert.equal(h.isLocked(),true);assert.equal(await h.perform(input),false);assert.equal(writes,1);assert.equal(await h.verify(),false);assert.equal(h.isLocked(),true);receipt={saved:'original'};assert.equal(await h.verify(),true);assert.deepEqual(accepted,receipt);assert.equal(reads,2);assert.equal(writes,1);assert.equal(f.values.size,0);
 }finally{f.restore();}
});
test('confirmed write followed by failed refresh retains original request even if refresh says not_written',async()=>{
 const f=fixture();let writes=0,accepts=0;
 try{const h=f.render('scope',{valid:()=>true,write:async()=>{writes++;return{ok:true};},read:async()=>({ok:true}),accept:async()=>{if(++accepts===1)throw new f.ApiError('refresh failed','not_written');}});
 assert.equal(await h.perform({key:'x'}),false);assert.equal(h.isLocked(),true);assert.equal(f.values.size,1);assert.equal(await h.verify(),true);assert.equal(writes,1);assert.equal(accepts,2);
 }finally{f.restore();}
});
test('restored complete command is read only; corrupt credentials block writes',async()=>{
 const f=fixture();let writes=0,restored;
 try{f.values.set('scope',JSON.stringify({format:1,storage:'scope',input:{key:'old'}}));const options={valid:v=>typeof v.key==='string',write:async()=>{writes++;return{};},read:async()=>null,accept:async()=>{},restore:v=>restored=v};
 let h=f.render('scope',options);assert.deepEqual(restored,{key:'old'});assert.equal(await h.perform({key:'new'}),false);assert.equal(writes,0);assert.equal(await h.verify(),false);
 f.values.set('other','bad json');h=f.render('other',options);assert.equal(h.isLocked(),true);assert.equal(await h.perform({key:'new'}),false);assert.equal(writes,0);
 }finally{f.restore();}
});
test('late responses cannot adopt data or clear a receipt after the page scope changes',async()=>{
 const f=fixture();let resolve,accepted=0;const options={valid:()=>true,write:()=>new Promise(r=>resolve=r),read:async()=>({ok:true}),accept:async()=>{accepted++;}};
 try{const h=f.render('old',options),request=h.perform({key:'old'});const other=f.render('new',options);resolve({ok:true});assert.equal(await request,false);assert.equal(accepted,0);assert.equal(f.values.has('old'),true);assert.equal(other.isLocked(),false);const restored=f.render('old',options);assert.equal(restored.isLocked(),true);assert.equal(await restored.verify(),true);assert.equal(accepted,1);assert.equal(f.values.has('old'),false);
 }finally{f.restore();}
});
test('selection honors a historical pinned version and rejects ambiguous forms regardless of ordering',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/common/referenceParity/selection.ts'),'utf8'),module={exports:{}};
 new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
 const select=module.exports.selectPublishedBusinessForm,forms=[{id:'one',status:'published',currentVersionId:'new'},{id:'two',status:'published',currentVersionId:'other'}],versions=new Map([['one',[{id:'new',definition:{primaryTypeKey:'character'}},{id:'old',definition:{primaryTypeKey:'character'}}]],['two',[{id:'other',definition:{primaryTypeKey:'character'}}]]]);
 assert.equal(select('character',forms,versions).needsSelection,true);assert.equal(select('character',[...forms].reverse(),versions).needsSelection,true);assert.equal(select('character',forms,versions,'old').version.id,'old');assert.equal(select('character',forms,versions,'missing').needsSelection,true);
});

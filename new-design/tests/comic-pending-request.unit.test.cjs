const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/client/comicProjects/pendingRequest.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const pending={};new Function('exports',source)(pending);
const schema={parse:value=>{if(typeof value?.requestKey!=='string'||typeof value?.body!=='string')throw Error('invalid');return value;}};
function memory(){const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test('comic retries require the exact retained input, not only an old request key',()=>{
 const store=memory(),input={requestKey:'original',body:'原填写'};
 assert.equal(pending.savePendingRequest(store,'key','payload',input),true);
 assert.deepEqual(pending.readPendingRequest(store,'key','payload',schema),{key:'original',input});
 store.setItem('payload',JSON.stringify({...input,requestKey:'other'}));
 assert.deepEqual(pending.readPendingRequest(store,'key','payload',schema),{key:'original',input:null});
 pending.clearPendingRequest(store,'key','payload');
 assert.deepEqual(pending.readPendingRequest(store,'key','payload',schema),{key:null,input:null});
});
test('a storage write failure cannot leave a retry key after a partial save',()=>{
 const store=memory();store.setItem=(key,value)=>{if(key==='key')throw Error('quota');store.values.set(key,value);};
 assert.equal(pending.savePendingRequest(store,'key','payload',{requestKey:'original',body:'text'}),false);
 assert.deepEqual(pending.readPendingRequest(store,'key','payload',schema),{key:null,input:null});
});

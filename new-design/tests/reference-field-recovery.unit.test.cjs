const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function fixture(api){
 const storage=new Map(),original=global.localStorage,effects=[];
 global.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const react={useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:callback=>effects.push(callback)};
 class ApiError extends Error{constructor(message,recovery){super(message);this.recovery=recovery;this.issues={};}}
 const module={exports:{}},source=fs.readFileSync(path.join(__dirname,'../src/client/businessForms/fieldWrites/index.ts'),'utf8');
 new Function('module','exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports,id=>id==='react'?react:id==='../../api'?{newDesignApi:api,ApiError}:(()=>{throw new Error(id)})());
 return{storage,effects,use:module.exports.useFieldWriteRecovery,ApiError,restore:()=>{global.localStorage=original;}};
}
test('lost field acknowledgement retains the frozen request and blocks another write; verification is read only',async()=>{
 let writes=0,reads=0,refreshes=0,received;
 const command={operation:'book',input:{cardTypeId:'type',expectedTypeRevision:1,field:{name:'原字段'},backfillStrategy:'none',idempotencyKey:'original-key'}},frozen=structuredClone(command);
 const result={cardTypeId:'type',scope:'book_type'},f=fixture({createBookFieldExtension:async()=>{writes++;throw new Error('lost response');},verifyFieldWriteReceipt:async(book,input)=>{reads++;received=structuredClone(input);return{bookId:book,requestKey:'original-key',operation:'book_field_create',result};}});
 try{const hook=f.use('book','type',{},()=>{},async()=>{refreshes++;});f.effects.forEach(effect=>effect());assert.equal(await hook.perform(command,{name:'原字段'}),false);assert.equal(hook.isLocked(),true);assert.equal(f.storage.size,1);command.input.field.name='后来的填写';assert.equal(await hook.perform(command,{}),false);assert.equal(writes,1);assert.equal(await hook.verify(),true);assert.deepEqual(received,frozen);assert.equal(reads,1);assert.equal(refreshes,1);assert.equal(writes,1);assert.equal(f.storage.size,0);}finally{f.restore();}
});
test('catalog refresh failure after confirmed save cannot clear the original receipt or enable duplicate creation',async()=>{
 let writes=0,reads=0,refreshes=0,f;
 const command={operation:'book',input:{cardTypeId:'type',expectedTypeRevision:1,field:{name:'原字段'},backfillStrategy:'none',idempotencyKey:'original-key'}},result={cardTypeId:'type',scope:'book_type'};
 f=fixture({createBookFieldExtension:async()=>{writes++;return result;},verifyFieldWriteReceipt:async(book)=>{reads++;return{bookId:book,requestKey:'original-key',operation:'book_field_create',result};}});
 try{const hook=f.use('book','type',{},()=>{},async()=>{if(++refreshes===1)throw new f.ApiError('read failed',{mutationOutcome:'not_written'});});f.effects.forEach(effect=>effect());assert.equal(await hook.perform(command,{}),false);assert.equal(hook.isLocked(),true);assert.equal(f.storage.size,1);assert.equal(await hook.verify(),true);assert.equal(writes,1);assert.equal(reads,1);assert.equal(refreshes,2);}finally{f.restore();}
});

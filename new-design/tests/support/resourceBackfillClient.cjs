const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{compiled}=require('./isolatedDatabase.cjs');
const cache=new Map();
exports.resourceBackfillClient=function load(name){
 if(cache.has(name))return cache.get(name);
 const relative=name==='api'?'resourceSupplements/api':name==='focusView'?'characterResources/focus/view':name==='focusRecovery'?'characterResources/focus/recovery':`characterResources/backfillSeries/${name}`;
 const file=path.join(__dirname,'../../src/client',`${relative}.ts`),value={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>id==='./preflight'?load('preflight'):id.startsWith('../../../common/')?compiled(`common/${id.slice('../../../common/'.length)}`):(()=>{throw new Error(id);})(),value,value.exports);
 cache.set(name,value.exports);return value.exports;
};

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/client/planningCenter/overviewNext.ts'),'utf8');
const exportsBag={};new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exportsBag);

test('overview points to a real attention source before an unknown source',()=>{
 const metrics=[{state:'ready',label:'故事',sourceRoute:'/ready'},{state:'unknown',label:'上下文',sourceRoute:'/unknown'},{state:'attention',label:'正文',sourceRoute:'/writing'}];
 assert.equal(exportsBag.nextOverviewMetric(metrics)?.sourceRoute,'/writing');
 assert.equal(exportsBag.nextOverviewMetric(metrics.slice(0,2))?.sourceRoute,'/unknown');
 assert.equal(exportsBag.nextOverviewMetric(metrics.slice(0,1)),null);
});

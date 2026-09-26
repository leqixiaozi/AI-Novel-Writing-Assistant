const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {readWorldUsageFrame,writeWorldUsageFrame}=require('../src/client/worldUsage/storage.ts');

const key='new-design:world-usage:v1:52000000-0000-4000-8000-000000000001:52000000-0000-4000-8000-000000000002';
const selection={primaryLocationId:null,factionIds:[],locationIds:[],ruleIds:[],boundary:''};

test('world usage AI instruction and original request survive a reload without replacing the draft',()=>{
 const values=new Map();global.sessionStorage={getItem:name=>values.get(name)??null,setItem:(name,value)=>values.set(name,value)};
 try{
  const pending={kind:'prepare',input:{requestKey:'52000000-0000-4000-8000-000000000003',mode:'ai',expectedSourceHash:'a'.repeat(64),instruction:'保留南城主舞台'}};
  writeWorldUsageFrame(key,selection,pending,'保留南城主舞台');
  assert.deepEqual(readWorldUsageFrame(key),{selection,pending,instruction:'保留南城主舞台',broken:false,hasFrame:true});
  values.set(key,JSON.stringify({selection,pending,instruction:{unsafe:true}}));
  assert.equal(readWorldUsageFrame(key).broken,true);
 }finally{delete global.sessionStorage;}
});

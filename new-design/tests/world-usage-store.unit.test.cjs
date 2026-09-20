const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const crypto=require('node:crypto');
require('../node_modules/tsx/dist/cjs/index.cjs');
const contract=require('../src/common/worldUsage/index.ts');
const errors=require('../src/server/domain/errors.ts');
const {AiExecutionError}=require('../src/server/ai/runtime/errors.ts');

const ids={book:'52000000-0000-4000-8000-000000000001',root:'52000000-0000-4000-8000-000000000002',faction:'52000000-0000-4000-8000-000000000003',location:'52000000-0000-4000-8000-000000000004',rule:'52000000-0000-4000-8000-000000000005',request:'52000000-0000-4000-8000-000000000006',adopt:'52000000-0000-4000-8000-000000000007',newVersion:'52000000-0000-4000-8000-000000000008'};
const stableHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(){
 const state={candidate:null,adoption:null,cards:[{id:ids.faction,title:'东盟',current_version_id:ids.faction,type_key:'faction',values:{name:'东盟'}},{id:ids.location,title:'南城',current_version_id:ids.location,type_key:'location',values:{name:'南城'}},{id:ids.rule,title:'禁飞',current_version_id:ids.rule,type_key:'world_rule',values:{name:'禁飞'}}],sql:[],modelCalls:0};
 const query=async(sql,args=[])=>{
  state.sql.push(sql);
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
  if(sql.includes("to_regclass('new_design.world_usage_capability')"))return{rows:[{installed:true}]};
  if(sql.includes('SELECT operational FROM new_design.world_usage_capability'))return{rows:[{operational:true}]};
  if(sql.includes('FROM new_design.books book JOIN new_design.cards card'))return{rows:[{space_id:ids.book,id:ids.root,title:'本书世界',current_version_id:ids.root,values:{name:'本书世界'},type_key:'world_overview'}]};
  if(sql.includes('FROM new_design.cards card JOIN new_design.card_types type'))return{rows:state.cards};
  if(sql.includes('FROM new_design.card_group_form_instances instance'))return{rows:[]};
  if(sql.startsWith('SELECT * FROM new_design.world_usage_candidates WHERE book_id=$1 AND root_card_id=$2 AND request_key=$3'))return{rows:state.candidate?.request_key===args[2]?[state.candidate]:[]};
  if(sql.startsWith('SELECT * FROM new_design.world_usage_candidates WHERE book_id=$1 AND request_key=$2'))return{rows:state.candidate?.request_key===args[1]?[state.candidate]:[]};
  if(sql.startsWith('SELECT * FROM new_design.world_usage_candidates WHERE id=$1'))return{rows:state.candidate?.id===args[0]?[state.candidate]:[]};
  if(sql.startsWith('SELECT * FROM new_design.world_usage_candidates WHERE book_id=$1 AND root_card_id=$2 ORDER BY'))return{rows:state.candidate?[state.candidate]:[]};
  if(sql.startsWith('INSERT INTO new_design.world_usage_candidates')){state.candidate={id:args[0],book_id:args[1],root_card_id:args[2],request_key:args[3],input_hash:args[4],mode:args[5],status:args[6],source_hash:args[7],sources:JSON.parse(args[8]),selection:JSON.parse(args[9]),result_payload:null,message:'',created_at:new Date(0)};return{rows:[state.candidate]};}
  if(sql.startsWith("UPDATE new_design.world_usage_candidates SET status='review'")){if(state.candidate?.request_key!==args[2]||state.candidate.status!=='running')return{rows:[]};Object.assign(state.candidate,{status:'review',selection:JSON.parse(args[3]),result_payload:JSON.parse(args[4])});return{rows:[state.candidate]};}
  if(sql.startsWith("UPDATE new_design.world_usage_candidates SET status='failed'")){if(state.candidate?.request_key!==args[2]||state.candidate.status!=='running')return{rows:[]};Object.assign(state.candidate,{status:'failed',message:args[3],result_payload:JSON.parse(args[4])});return{rows:[state.candidate]};}
  if(sql.startsWith('UPDATE new_design.world_usage_candidates SET message=')){if(state.candidate?.request_key===args[2])state.candidate.message=args[3];return{rows:[]};}
  if(sql.startsWith('SELECT * FROM new_design.world_usage_adoptions WHERE book_id=$1 AND request_key=$2'))return{rows:state.adoption?.request_key===args[1]?[state.adoption]:[]};
  if(sql.startsWith('SELECT * FROM new_design.world_usage_adoptions WHERE book_id=$1 AND root_card_id=$2 AND request_key=$3'))return{rows:state.adoption?.request_key===args[2]?[state.adoption]:[]};
  if(sql.startsWith('SELECT * FROM new_design.world_usage_adoptions WHERE book_id=$1 AND root_card_id=$2 ORDER BY'))return{rows:state.adoption?[state.adoption]:[]};
  if(sql.startsWith('SELECT max(version) version FROM new_design.world_usage_adoptions'))return{rows:[{version:state.adoption?.version??null}]};
  if(sql.startsWith('INSERT INTO new_design.world_usage_adoptions')){state.adoption={id:args[0],book_id:args[1],root_card_id:args[2],candidate_id:args[3],request_key:args[4],input_hash:args[5],version:args[6],source_hash:args[7],sources:JSON.parse(args[8]),selection:JSON.parse(args[9]),created_at:new Date(0)};return{rows:[state.adoption]};}
  if(sql.startsWith('SELECT DISTINCT ON (root_card_id) * FROM new_design.world_usage_adoptions'))return{rows:state.adoption?[state.adoption]:[]};
  throw Error('Unexpected world usage SQL: '+sql);
 };
 const pool={connect:async()=>({query,release(){}}),query};
 const imports={'node:crypto':crypto,'../runtime':{getNewDesignPool:async()=>pool},'../aiContracts':{stableHash},'../../domain/errors':errors,'../../ai/runtime/errors':{AiExecutionError},'../../../common/worldUsage':contract};
 const source=fs.readFileSync(path.join(__dirname,'../src/server/database/worldUsage/index.ts'),'utf8');
 const module={exports:{}};
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name in imports)return imports[name];throw Error('Unexpected import '+name);},module,module.exports);
 return{state,store:module.exports,query};
}

test('manual world scope requires an explicit candidate and adoption, then blocks a changed source',async()=>{
 const {state,store,query}=fixture();
 const workspace=await store.getWorldUsageWorkspace(ids.book,ids.root);
 assert.equal(workspace.adopted,null);
 const selection={primaryLocationId:ids.location,factionIds:[ids.faction],locationIds:[ids.location],ruleIds:[ids.rule],boundary:'只在南城展开。'};
 const proposal=await store.prepareWorldUsageCandidate(ids.book,ids.root,{requestKey:ids.request,mode:'manual',expectedSourceHash:workspace.sources.sourceHash,selection,instruction:''});
 assert.equal(proposal.status,'review');
 assert.equal((await store.getWorldUsageCandidateByKey(ids.book,ids.root,ids.request)).id,proposal.id);
 assert.equal((await store.prepareWorldUsageCandidate(ids.book,ids.root,{requestKey:ids.request,mode:'manual',expectedSourceHash:workspace.sources.sourceHash,selection,instruction:''})).id,proposal.id);
 assert.equal(state.sql.filter(sql=>sql.startsWith('INSERT INTO new_design.world_usage_candidates')).length,1);
 assert.equal((await store.getWorldUsageWorkspace(ids.book,ids.root)).adopted,null);
 const input={requestKey:ids.adopt,candidateId:proposal.id,expectedSourceHash:workspace.sources.sourceHash,expectedCurrentVersion:0};
 const adopted=await store.adoptWorldUsageCandidate(ids.book,ids.root,input);
 assert.equal(adopted.version,1);
 assert.equal((await store.getWorldUsageAdoptionByKey(ids.book,ids.root,ids.adopt)).id,adopted.id);
 assert.equal((await store.adoptWorldUsageCandidate(ids.book,ids.root,input)).id,adopted.id);
  assert.equal(state.sql.filter(sql=>sql.startsWith('INSERT INTO new_design.world_usage_adoptions')).length,1);
  assert.equal((await store.readActiveWorldUsageScopes({query},ids.book)).length,1);
  const frozen=contract.worldUsageCreativeScopes([adopted]);
  await store.assertWorldUsageScopesCurrent({query},ids.book,frozen);
  state.cards[1].current_version_id=ids.newVersion;
  assert.equal((await store.getWorldUsageWorkspace(ids.book,ids.root)).stale,true);
  await assert.rejects(store.readActiveWorldUsageScopes({query},ids.book),/已变化/);
  await assert.rejects(store.assertWorldUsageScopesCurrent({query},ids.book,frozen),/已变化/);
 assert.equal(state.modelCalls,0);
});

test('AI world suggestion is frozen under one request key, then requires explicit adoption',async()=>{
 const {state,store}=fixture();
 const workspace=await store.getWorldUsageWorkspace(ids.book,ids.root);
 const selection={primaryLocationId:ids.location,factionIds:[],locationIds:[ids.location],ruleIds:[],boundary:'南城主舞台'};
 const ai={suggestWorldUsage:async input=>{state.modelCalls++;assert.equal(input.sources.sourceHash,workspace.sources.sourceHash);return{output:selection,promptSnapshot:{assetId:'new_design.world.usage_scope',version:'v1'},modelSnapshot:{routeSnapshotId:'route-1'},usedTokens:31};}};
 const input={requestKey:ids.request,mode:'ai',expectedSourceHash:workspace.sources.sourceHash,instruction:'整理主舞台'};
 const proposal=await store.prepareWorldUsageCandidate(ids.book,ids.root,input,ai);
 assert.equal(proposal.status,'review');
 assert.equal(proposal.usedTokens,31);
 assert.equal(state.candidate.result_payload.promptSnapshot.assetId,'new_design.world.usage_scope');
 assert.equal((await store.getWorldUsageWorkspace(ids.book,ids.root)).adopted,null);
 assert.equal((await store.prepareWorldUsageCandidate(ids.book,ids.root,input,ai)).id,proposal.id);
 assert.equal(state.modelCalls,1);
});

test('unknown AI receipt keeps the original key and does not call the model again',async()=>{
 const {state,store}=fixture();
 const workspace=await store.getWorldUsageWorkspace(ids.book,ids.root);
 const input={requestKey:ids.request,mode:'ai',expectedSourceHash:workspace.sources.sourceHash,instruction:''};
 const ai={suggestWorldUsage:async()=>{state.modelCalls++;throw Error('connection lost');}};
 await assert.rejects(store.prepareWorldUsageCandidate(ids.book,ids.root,input,ai),/connection lost/);
 assert.equal((await store.getWorldUsageCandidateByKey(ids.book,ids.root,ids.request)).status,'running');
 assert.equal((await store.prepareWorldUsageCandidate(ids.book,ids.root,input,ai)).status,'running');
 assert.equal(state.modelCalls,1);
});

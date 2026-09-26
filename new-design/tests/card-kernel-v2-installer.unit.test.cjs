const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {options}=require('../scripts/initialize-card-kernel.cjs');

test('pure-table initialization requires a named independent empty database and explicit confirmation',()=>{
 assert.deepEqual(options(['--database','nd_empty_check','--confirm-empty-database']),{database:'nd_empty_check',port:null,confirmed:true});
 assert.deepEqual(options(['--database','nd_empty_check','--port','55585','--confirm-empty-database']),{database:'nd_empty_check',port:55585,confirmed:true});
 for(const values of [[],['--database','nd_empty_check'],['--confirm-empty-database'],['--database','bad-name','--confirm-empty-database'],['--database','postgres','--confirm-empty-database'],['--database','template0','--confirm-empty-database'],['--database','template1','--confirm-empty-database'],['--database','safe','--port','1','--confirm-empty-database'],['--database','safe','--confirm-empty-database','--again'],['--database','safe','--confirm-empty-database','--confirm-empty-database']])assert.throws(()=>options(values));
});

test('superseded destructive cutover entry refuses instead of applying historical migrations',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/install-card-kernel-v2.cjs'),'--database','ai_novel_new_design','--confirm-atomic-cutover'],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/132|纯表|空库/);
 assert.doesNotMatch(result.stdout,/password|secret_envelope/i);
});

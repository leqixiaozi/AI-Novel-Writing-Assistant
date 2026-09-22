const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,migrationFiles}=require('../scripts/install-card-kernel-v2.cjs');

test('card kernel v2 installer locks the complete atomic migration set',()=>{
 assert.deepEqual(migrationFiles.map(name=>name.slice(0,3)),['123','124','125','126','127','128','129','130','131']);
 assert.deepEqual(parse(['--database','ai_novel_new_design','--confirm-atomic-cutover']),{database:'ai_novel_new_design',port:null,confirm:true});
 assert.deepEqual(parse(['--database','ai_novel_new_design','--port','55585','--confirm-atomic-cutover']),{database:'ai_novel_new_design',port:55585,confirm:true});
 for(const values of [[],['--database','ai_novel_new_design'],['--confirm-atomic-cutover'],['--database','bad-name','--confirm-atomic-cutover'],['--database','safe','--port','1','--confirm-atomic-cutover'],['--database','safe','--confirm-atomic-cutover','--again']])assert.throws(()=>parse(values));
});

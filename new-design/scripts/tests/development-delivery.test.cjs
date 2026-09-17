const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {safeRelative,parseArguments}=require('../development-data.cjs');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('backup requires explicit quiescence and absolute new target, verify has no write flag',()=>{
 assert.throws(()=>parseArguments(['backup','--package',path.join(root,'backups','one')]));
 assert.throws(()=>parseArguments(['backup','--package',root,'--confirm-quiescent']));
 assert.throws(()=>parseArguments(['backup','--package',path.join(root,'data','one'),'--confirm-quiescent']));
 const target=path.join(root,'backups','one');assert.equal(parseArguments(['backup','--package',target,'--confirm-quiescent']).directory,target);
 assert.throws(()=>parseArguments(['verify','--package',target,'--confirm-quiescent']));
});
test('safe paths reject traversal, Windows devices, URLs and unsafe names',()=>{
 for(const value of ['../a','a/../b','C:/a','/a','a\\b','a/con.txt','a/foo.','a/foo ','a//b','https://x/a','a/<x>'])assert.equal(safeRelative(value),false,value);
 assert.equal(safeRelative('data/assets/knowledge-123.utf8'),true);assert.equal(safeRelative('data/ai-receipts/123/file.json'),true);
});
test('original target guarded, no destructive or startup commands in snapshot tool',()=>{
 const source=read('scripts/development-data.cjs');assert.match(source,/com\.docker\.compose\.project/);assert.match(source,/target\.Mounts/);assert.match(source,/HostIp!==\x27127\.0\.0\.1\x27/);assert.match(source,/shell:false/);assert.match(source,/new_design\.schema_migrations/);assert.match(source,/restoreVerified:false/);assert.match(source,/metadata\.database!==config\.database/);assert.match(source,/sourceFiles/);assert.doesNotMatch(source,/pg_restore|TRUNCATE|DROP DATABASE|docker.*down|\x27up\x27|\x27start\x27/);
});
test('new initialization never overwrites existing configuration/volume/container',()=>{
 const source=read('scripts/initialize-development.cjs');assert.match(source,/if\(exists\)throw/);assert.match(source,/volume','ls/);assert.match(source,/container','ls/);assert.match(source,/fs\.open\(config,'wx',0o600\)/);assert.doesNotMatch(source,/console\.log\(.*password|docker.*(rm|down)|unlink/);
});
test('restore drill has isolated tmpfs and port, never the existing dev volume',()=>{
 const source=read('docker/compose.restore-drill.yml');assert.match(source,/127\.0\.0\.1:55584:5432/);assert.match(source,/tmpfs:/);assert.doesNotMatch(source,/55432|ai-novel-new-design-pg17-data|container_name:|volumes:/);
});

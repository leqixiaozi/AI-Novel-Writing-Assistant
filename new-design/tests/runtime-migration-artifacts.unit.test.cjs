const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {validateRuntimeMigrationFiles}=require('../src/server/runtime/manifest.ts'),{migrations}=require('../src/server/database/migrations.ts');
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'../runtime/runtime-package.spec.json'),'utf8'));
const manifest=()=>({migrationRange:{...spec.migrationRange},files:spec.requiredFiles.filter(name=>name.startsWith('app/migrations/')).map(name=>({path:name}))});

test('new installations declare only the complete pure-table baseline, not historical cutovers',()=>{
 assert.deepEqual(migrations,[{id:'132_card_kernel_tables_only',fileName:'132_card_kernel_tables_only.sql'}]);
 assert.deepEqual(spec.defaultMigrationFiles,migrations.map(item=>item.fileName));
 assert.deepEqual(spec.manualMigrationFiles,[]);
 validateRuntimeMigrationFiles(manifest());
 assert.equal(fs.existsSync(path.join(__dirname,'../migrations',migrations[0].fileName)),true);
});

test('package rejects missing, renamed, duplicated and accidentally reenabled historical migrations',()=>{
 for(const alter of [value=>value.files.pop(),value=>value.files[0].path='app/migrations/001_card_kernel.sql',value=>value.files.push({...value.files[0]}),value=>value.files.push({path:'app/migrations/manual/131_card_kernel_v2_cutover.sql'}),value=>value.migrationRange={first:'001_card_kernel.sql',last:'083_character_dialogue.sql',count:81}]){
  const value=manifest();alter(value);assert.throws(()=>validateRuntimeMigrationFiles(value),error=>error.status===503);
 }
});

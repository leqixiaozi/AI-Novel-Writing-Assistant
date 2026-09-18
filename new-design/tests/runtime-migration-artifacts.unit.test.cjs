const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {validateRuntimeMigrationFiles}=require('../src/server/runtime/manifest.ts'),{migrations}=require('../src/server/database/migrations.ts');
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'../runtime/runtime-package.spec.json'),'utf8'));
const manifest=()=>({migrationRange:spec.migrationRange,files:spec.requiredFiles.filter(name=>name.startsWith('app/migrations/')).map(name=>({path:name}))});
test('package migration set includes real registered gaps and default-off manual artifacts',()=>{
 assert.equal(migrations.length,81);assert.equal(migrations.at(-1).fileName,'083_character_dialogue.sql');assert.equal(migrations.some(item=>item.fileName.startsWith('064_')||item.fileName.startsWith('082_')),false);
 assert.deepEqual(spec.defaultMigrationFiles,migrations.map(item=>item.fileName));assert.equal(spec.manualMigrationFiles.includes('101_character_author_trials.sql'),true);validateRuntimeMigrationFiles(manifest());
 for(const name of [...spec.defaultMigrationFiles,...spec.manualMigrationFiles])assert.equal(fs.existsSync(path.join(__dirname,'../migrations',name)),true,name);
});
test('package rejects missing, renamed, duplicated and accidentally enabled manual migrations',()=>{
 for(const alter of [value=>value.files.pop(),value=>value.files.splice(value.files.findIndex(item=>item.path.endsWith('081_knowledge_reference_segments.sql')),1),value=>value.files.push({...value.files[0]}),value=>value.files.find(item=>item.path.endsWith('101_character_author_trials.sql')).path='app/migrations/101_character_author_trials.sql',value=>value.migrationRange={first:'001_card_kernel.sql',last:'045_planning_ai_candidates.sql',count:45}]){const value=manifest();alter(value);assert.throws(()=>validateRuntimeMigrationFiles(value),error=>error.status===503);}
});

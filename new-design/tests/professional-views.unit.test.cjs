const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('src/common/professionalViews/index.ts');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleValue={exports:{}};new Function('module','exports','require',compiled)(moduleValue,moduleValue.exports,require);
const helpers=moduleValue.exports;
const book='11111111-1111-4111-8111-111111111111',type='22222222-2222-4222-8222-222222222222',version='33333333-3333-4333-8333-333333333333',objectId='44444444-4444-4444-8444-444444444444';
test('book scoped preferences reject malformed/crossbook coordinates and retain selected/search',()=>{
 const input=helpers.emptyProfessionalPreferences(book);input.search='宗门';input.selectedId=objectId;input.positions[objectId]={x:0,y:80};
 assert.deepEqual(helpers.parseProfessionalPreferences(JSON.stringify(input),book),input);
 assert.equal(helpers.parseProfessionalPreferences(JSON.stringify(input),type),null);
 assert.equal(helpers.parseProfessionalPreferences('{',book),null);
 input.positions[objectId].x=-1;assert.equal(helpers.parseProfessionalPreferences(JSON.stringify(input),book),null);
});
test('map requires explicit exact formal fields, preserves zero and excludes text/old spec',()=>{
 const binding={typeId:type,x:{key:'map_x',versionId:version},y:{key:'map_y',versionId:version}};
 const object={id:objectId,title:'青山',typeId:type,typeKey:'location',versionId:version,unavailableReason:null,fields:[{field:{key:'map_x',type:'number'},versionId:version},{field:{key:'map_y',type:'number'},versionId:version}],values:{map_x:0,map_y:-3}};
 assert.deepEqual(helpers.professionalMapPoints([object],binding),[{id:objectId,label:'青山',x:0,y:-3}]);
 assert.deepEqual(helpers.professionalMapPoints([object],null),[]);
 assert.deepEqual(helpers.professionalMapPoints([{...object,values:{map_x:'0',map_y:2}}],binding),[]);
 assert.deepEqual(helpers.professionalMapPoints([object],{...binding,x:{...binding.x,versionId:type}}),[]);
 assert.deepEqual(helpers.professionalMapPoints([{...object,typeKey:'character'}],binding),[]);
});
test('world time orders unknown last without mutating originals',()=>{
 const list=[{id:'unknown',normalizedStart:null,sequence:1},{id:'late',normalizedStart:8,sequence:3},{id:'zero',normalizedStart:0,sequence:2}];
 assert.deepEqual(helpers.sortedProfessionalTimings(list).map(item=>item.id),['zero','late','unknown']);assert.equal(list[0].id,'unknown');
});
test('professional projection reads original ledgers, no fact writes or AGE dependence',()=>{
 const db=read('src/server/database/professionalViews/index.ts');assert.match(db,/REPEATABLE READ READ ONLY/);assert.match(db,/new_design\.state_changes/);assert.match(db,/document\.adopted_version_id=change\.body_version_id/);assert.match(db,/object\?\.versionId===row\.exact_card_version/);assert.match(db,/validateDictionaryTreeValues/);assert.doesNotMatch(db,/INSERT INTO|UPDATE new_design|DELETE FROM|cypher\(/);
});
test('shared editor protects unknown/dirty, malformed preference does not overwrite',()=>{
 const ui=read('src/client/professionalViews/index.tsx');assert.match(ui,/BusinessFormWorkspace/);assert.match(ui,/initialCardId=\{object\.id\}/);assert.match(ui,/state\?\.locked/);assert.match(ui,/state\?\.dirty&&!state\.preserveDraft\(\)/);assert.match(ui,/raw!==null/);assert.match(ui,/if\(!restored\)\{storageBlocked\.current=true/);assert.match(ui,/!ready\.current\|\|storageBlocked\.current/);assert.match(ui,/sequence\.current===current/);assert.match(ui,/key=\{props\.bookId\}/);assert.match(ui,/structure\/maintenance/);
});
test('only readonly HTTP, error has precise stage and no mutation outcome',()=>{
 const http=read('src/server/http/professionalViews/index.ts');assert.match(http,/professional-views\/workspace/);assert.match(http,/Promise\.resolve\(\)\.then/);assert.doesNotMatch(http,/router\.(post|patch|put|delete)|mutationOutcome/);
});

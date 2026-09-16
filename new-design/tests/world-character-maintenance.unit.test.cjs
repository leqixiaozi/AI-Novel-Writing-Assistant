const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {professionalFields,professionalDisplay}=require('../dist/server/database/worldCharacterMaintenance');
const {professionalObjectsForMode}=require('../dist/common/worldCharacterMaintenance');
const {professionalWritingAction}=require('../dist/server/database/worldCharacterMaintenance/presentation');
const id='68000000-0000-4000-8000-000000000001',other='68000000-0000-4000-8000-000000000002';
test('professional fields require real FieldDefinition, preserve zero/false and never guess by field names',()=>{
 const fields=professionalFields([{key:'voice',name:'声音',type:'long_text',order:0},{name:'动机',value:'不是规格'}]);assert.equal(fields.length,1);assert.equal(fields[0].defaultValue,null);
 assert.equal(professionalDisplay(0,fields[0],new Map(),new Map()),'0');assert.equal(professionalDisplay(false,fields[0],new Map(),new Map()),'否');assert.equal(professionalFields({voice:'正文'}).length,0);
});
test('professional reference values use exact Chinese identities, not raw UUID or JSON',()=>{
 const field={key:'role',name:'身份',type:'select',options:[{value:'leader',label:'首领'}]};assert.equal(professionalDisplay('leader',field,new Map(),new Map()),'首领');assert.match(professionalDisplay('unknown',field,new Map(),new Map()),/历史选项/);
 assert.equal(professionalDisplay(id,undefined,new Map([[id,'守脉者']]),new Map()),'守脉者');assert.match(professionalDisplay(other,undefined,new Map(),new Map()),/引用不可用/);assert.match(professionalDisplay({secret:'内部结构'},undefined,new Map(),new Map()),/来源表单/);
 const dictionary={...field,optionSource:{kind:'dictionary_tree',dictionaryId:id}};assert.equal(professionalDisplay(other,dictionary,new Map(),new Map([[`${id}:${other}`,'宗门 / 掌门']])),'宗门 / 掌门');
});
test('professional categories are explicit identities and do not classify title keywords',()=>{
 const objects=[{id,title:'世界人物',typeKey:'research_note'},{id:other,title:'档案',typeKey:'character'},{id:'world',typeKey:'world_overview'}];assert.deepEqual(professionalObjectsForMode(objects,'character').map(item=>item.id),[other]);assert.deepEqual(professionalObjectsForMode(objects,'world').map(item=>item.id),['world']);
});
test('source actions include only actual exact chapter session and subject references',()=>{
 const action=professionalWritingAction(id,other,id,other),query=new URL(action.route,'http://local').searchParams;assert.equal(query.get('chapterDocument'),other);assert.equal(query.get('session'),id);assert.equal(query.get('subject'),other);
 assert.equal(new URL(professionalWritingAction(id,null,null,other).route,'http://local').searchParams.has('subject'),false);
});
test('professional projection has no new facts/writes, validates adopted sources and unique origin sessions',()=>{
 const read=name=>fs.readFileSync(path.join(__dirname,'../src/server/database/worldCharacterMaintenance',name),'utf8'),sql=read('index.ts')+read('sources.ts');assert.doesNotMatch(sql,/\b(?:INSERT\s+INTO|UPDATE\s+new_design|DELETE\s+FROM|CREATE\s+TABLE)\b/i);
 assert.match(sql,/REPEATABLE READ READ ONLY/);assert.match(sql,/document\.adopted_version_id=change\.body_version_id/);assert.match(sql,/initial_version\.id=initial\.current_version_id/);assert.match(sql,/session\.settlement_id=settlement\.id/);assert.match(sql,/item\.knowledge_proposal_id=proposal\.id/);assert.match(sql,/proposal\.current_version_id=version\.id/);assert.match(sql,/version\.text_anchor_id/);assert.doesNotMatch(sql,/COALESCE\([^)]*state[^)]*'fresh'/i);
});
test('professional UI reuses editor and source selection does not overwrite dirty drafts or decisions',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../src/client/worldCharacterMaintenance/index.tsx'),'utf8'),editor=fs.readFileSync(path.join(__dirname,'../src/client/chapterWriting/settlementEditing/EditorForm.tsx'),'utf8'),items=fs.readFileSync(path.join(__dirname,'../src/client/chapterWriting/settlementEditing/ItemReview.tsx'),'utf8');assert.match(page,/BusinessFormWorkspace/);assert.match(page,/state\?\.locked/);assert.match(page,/state\.preserveDraft\(\)/);assert.match(editor,/settlementDraftDirty\(form,editingId\)/);assert.match(editor,/workspace\.catalog\.subjects\.find/);assert.match(items,/items\.filter\(item=>item\.subjectId===values\[0\]\)/);assert.match(items,/scrollIntoView/);
});

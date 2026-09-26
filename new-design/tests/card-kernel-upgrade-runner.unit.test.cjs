'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const ts=require('typescript');
const {splitSqlStatements}=require('../scripts/sql-statements.cjs');

const runnerPath=path.resolve(__dirname,'../scripts/upgrade-card-kernel.cjs');
const source=fs.readFileSync(runnerPath,'utf8');
const localRequire=createRequire(runnerPath);

// Evaluate the real exports, never the CLI. No pool or filesystem operation is
// available to the runner; catalog queries below use an explicit read-only fake.
function loadRunner(){
  const module={exports:{}};
  const requireMock=id=>{
    if(id==='pg')return{Pool:class{constructor(){throw new Error('Database access is forbidden in this unit test');}}};
    if(id==='node:fs/promises')return new Proxy({}, {get(){throw new Error('Runner filesystem access is forbidden in this unit test');}});
    if(id==='./inspect-card-kernel-upgrade.cjs')return{nativeTypes(){throw new Error('Upgrade preparation is outside this unit test');}};
    return localRequire(id);
  };
  new Function('require','module','exports','__dirname','__filename',source)(requireMock,module,module.exports,path.dirname(runnerPath),runnerPath);
  return module.exports;
}
const {options,planRows,adapterDropOrder,preservationProof}=loadRunner();
const sha='ab'.repeat(32);
test('preservation proof freezes old history identities while allowing explicitly counted appended history',async()=>{
 const tables=['books','text_anchors','cards','card_types','card_type_versions','card_versions','card_version_actions','schema_migrations','system_capabilities'];
 const db={query:async(sql,args)=>{
  assert.match(sql,/^SELECT /);
  if(sql.includes('FROM pg_tables'))return{rows:tables.map(tablename=>({tablename}))};
  if(sql.includes('information_schema.columns'))return{rows:[{table_schema:'new_design',column_name:'id'}]};
  if(sql.startsWith('SELECT id FROM')||sql.startsWith('SELECT c.id FROM'))return{rows:[{id:'20000000-0000-0000-0000-000000000001'}]};
  if(sql.startsWith('SELECT count(*)'))return{rows:[{count:1,hash:'saved'}]};
  throw Error('Unexpected proof query');
 }};
 const proof=await preservationProof(db);
 for(const name of ['cards','card_types','card_type_versions','card_versions','card_version_actions']){
  const item=proof.find(p=>p.name===name);assert.ok(item,name);assert.match(item.sql,/WHERE id=ANY\(\$1::uuid\[\]\)/);assert.equal(item.params[0].length,1);
 }
 assert.match(proof.find(p=>p.name==='card_types').sql,/-ARRAY\['type_key','is_internal'\]/);
 assert.equal(proof.filter(p=>p.name==='card_version_actions').length,1);
 assert.equal(proof.some(p=>p.name==='system_capabilities'),false);
 assert.match(proof.find(p=>p.name==='schema_migrations').sql,/WHERE id<>\$1/);
 for(const name of ['books','text_anchors'])assert.match(proof.find(p=>p.name===name).sql,/FROM \(SELECT "id" FROM/);
});
function validArgs(){return['--database','development','--backup','C:/protected/dev.dump','--backup-sha256',sha,'--manifest','C:/protected/dev.json','--confirm-in-place-upgrade'];}

test('options requires explicit in-place confirmation and all verified-backup arguments',()=>{
  assert.deepEqual(options(validArgs()),{database:'development',backup:'C:/protected/dev.dump','backup-sha256':sha,manifest:'C:/protected/dev.json',confirmed:true});
  for(const key of ['--database','--backup','--backup-sha256','--manifest','--confirm-in-place-upgrade']){
    const args=validArgs(),index=args.indexOf(key);
    args.splice(index,key==='--confirm-in-place-upgrade'?1:2);
    assert.throws(()=>options(args),undefined,key);
  }
  const upper=validArgs();upper[upper.indexOf('--backup-sha256')+1]=sha.toUpperCase();
  assert.equal(options(upper)['backup-sha256'],sha.toUpperCase());
});

test('options rejects malformed hashes, unknown arguments, duplicates and missing values',()=>{
  for(const hash of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]){
    const args=validArgs();args[args.indexOf('--backup-sha256')+1]=hash;
    assert.throws(()=>options(args),undefined,`invalid SHA length ${hash.length}`);
  }
  assert.throws(()=>options([...validArgs(),'--force']));
  assert.throws(()=>options([...validArgs(),'--confirm-in-place-upgrade']));
  for(const key of ['--database','--backup','--backup-sha256','--manifest']){
    assert.throws(()=>options([...validArgs(),key,'duplicate']),undefined,key);
    const args=validArgs(),index=args.indexOf(key);args.splice(index,2);args.push(key);
    assert.throws(()=>options(args),undefined,`missing ${key}`);
    assert.throws(()=>options([key,'',...validArgs()]),undefined,`empty duplicate ${key}`);
    const flagValue=validArgs();flagValue[flagValue.indexOf(key)+1]='--not-a-value';
    assert.throws(()=>options(flagValue),undefined,`option consumed as ${key}`);
  }
  for(const input of [null,undefined,{},42,'--database development'])assert.throws(()=>options(input));
  const nonString=validArgs();nonString[1]=123;
  assert.throws(()=>options(nonString));
});

function row(type_key){return{id:'10000000-0000-4000-8000-000000000001',type_key,current_values:{id:'20000000-0000-4000-8000-000000000001',revision:3,status:'active'}};}
const types=new Set(['research_candidate','chapter_adoption_session','background_job_handler','world_package_snapshot']);

test('planRows keeps supported records/actions/mirrors without changing their payloads',()=>{
  const rows=['legacy.research_candidates','legacy.chapter_settlement_events','legacy.prompt_command_receipts','legacy.material_management_events','legacy.creative_hub_threads','legacy.outbox_event_topics','legacy.asset_mounts'].map(row);
  const before=structuredClone(rows),plan=planRows(rows,types);
  assert.deepEqual(plan.map(item=>item.mapping.kind),['record','action','action','action','hub_mirror','merged','physical']);
  assert.equal(plan[0].mapping.targetType,'research_candidate');
  assert.equal(plan[6].mapping.targetTable,'asset_links');
  for(let index=0;index<rows.length;index++)assert.equal(plan[index].row,rows[index]);
  assert.deepEqual(rows,before);
  assert.deepEqual(planRows([],types),[]);
});

test('planRows fails closed for unknown, ambiguous, complex and unimplemented transformations',()=>{
  const cases=[
    ['legacy.unknown_source',types,/No lossless upgrade transformer/],
    ['legacy.research_candidates',new Set(),/No lossless upgrade transformer/],
    ['legacy.research_candidates',new Set(['research_candidate','research_candidates']),/No lossless upgrade transformer/],
    ['legacy.world_generation_candidates',types,/No lossless upgrade transformer/],
    ['legacy.world_package_versions',types,/Unimplemented structured merge/],
    ['legacy.professional_resource_receipts',types,/Unimplemented historical action/],
    ['legacy.embedding_vectors',types,/Physical content transform required/],
    ['legacy.embedding_chunks',types,/Physical content transform required/],
    ['legacy.semantic_retrieval_runs',types,/Physical content transform required/],
  ];
  for(const [key,catalog,pattern] of cases){
    const rows=[row(key)],before=structuredClone(rows);
    assert.throws(()=>planRows(rows,catalog),pattern,key);
    assert.deepEqual(rows,before);
  }
  const mixed=[row('legacy.research_candidates'),row('legacy.unknown_source')],before=structuredClone(mixed);
  assert.throws(()=>planRows(mixed,types),/No lossless upgrade transformer/);
  assert.deepEqual(mixed,before,'a supported prefix must not be changed before rejecting the rest');
  assert.throws(()=>planRows([row('legacy.completion_rule_sets')],types),/incomplete|differs/);
});

const fn=(id,signature)=>({kind:'pg_proc',id,sql:`DROP FUNCTION new_design.${signature} RESTRICT`});
const view=(id,name)=>({kind:'pg_class',id,sql:`DROP VIEW new_design.${name} RESTRICT`});
const composite=(id,name)=>({kind:'pg_type',id,sql:`DROP TYPE new_design_compat.${name} RESTRICT`});
const dependency=(child_class,child,parent_class,parent)=>({child_class,child,parent_class,parent});
const keep=['outbox_payload_is_reference_only(jsonb)','transfer_json_is_safe(jsonb)','transfer_locator_is_safe(text)'];

function catalogMock({objects,rewrites=[],rowtypes=[],dependencies=[]}){
  const calls=[];
  const stages=[[/FROM pg_proc/,objects],[/FROM pg_rewrite/,rewrites],[/FROM pg_type WHERE typrelid/,rowtypes],[/FROM pg_depend/,dependencies]];
  return{calls,async query(sql,params){
    assert.match(sql,/^SELECT\b/,'ordering only reads the catalog; it must not execute a DROP');
    const stage=stages[calls.length];assert.ok(stage,'unexpected catalog query');
    assert.match(sql,stage[0]);calls.push({sql,params});
    if(calls.length===1){
      assert.deepEqual(params,[keep]);
      assert.match(sql,/oidvectortypes\(p\.proargtypes\)/,'CHECK preservation must match the full signature, not only proname');
      assert.match(sql,/p\.oid::regprocedure::text/,'DROP must identify the exact overload');
      assert.match(sql,/ANY\(\$1::text\[\]\)/);
    }
    if(calls.length===2||calls.length===3)assert.deepEqual(params,[objects.filter(item=>item.kind==='pg_class').map(item=>item.id)]);
    return{rows:stage[1]};
  }};
}

test('adapterDropOrder removes functions before the views whose rowtypes they consume',async()=>{
  const consumer=fn('11','read_old(new_design.old_records)'),records=view('21','old_records');
  const db=catalogMock({objects:[records,consumer],rowtypes:[{id:'31',owner:'21'}],dependencies:[dependency('pg_proc','11','pg_type','31')]});
  assert.deepEqual(await adapterDropOrder(db),[consumer.sql,records.sql]);
  assert.equal(db.calls.length,4);
  assert.ok(db.calls[3].params[0].includes('31'),'view rowtype OID participates in dependency discovery');
});

test('adapterDropOrder removes a view before the function used by its rewrite rule',async()=>{
  const producer=fn('11','legacy_value()'),records=view('21','old_records');
  const db=catalogMock({objects:[producer,records],rewrites:[{id:'41',owner:'21'}],rowtypes:[{id:'31',owner:'21'}],dependencies:[
    dependency('pg_rewrite','41','pg_proc','11'),
    dependency('pg_rewrite','41','pg_class','21'),
  ]});
  assert.deepEqual(await adapterDropOrder(db),[records.sql,producer.sql]);
  assert.ok(db.calls[3].params[0].includes('41'),'rewrite OID participates in dependency discovery');
});

test('adapterDropOrder follows a mixed function/view/compat-type chain and distinguishes catalog OIDs',async()=>{
  const type=composite('21','old_shape'),records=view('21','old_records'),consumer=fn('11','read_old(new_design.old_records)');
  const db=catalogMock({objects:[type,records,consumer],rewrites:[{id:'41',owner:'21'}],rowtypes:[{id:'31',owner:'21'}],dependencies:[
    dependency('pg_proc','11','pg_type','31'),dependency('pg_rewrite','41','pg_type','21'),
  ]});
  assert.deepEqual(await adapterDropOrder(db),[consumer.sql,records.sql,type.sql]);
});

test('adapterDropOrder rejects dependency cycles and never issues destructive fallback queries',async()=>{
  const db=catalogMock({objects:[fn('11','old_a()'),fn('12','old_b()')],dependencies:[
    dependency('pg_proc','11','pg_proc','12'),dependency('pg_proc','12','pg_proc','11'),
  ]});
  await assert.rejects(()=>adapterDropOrder(db),/cycle; no CASCADE/);
  assert.equal(db.calls.length,4);
  assert.deepEqual(await adapterDropOrder(catalogMock({objects:[]})),[]);
});

test('adapterDropOrder drops old same-name overloads instead of preserving them by proname',async()=>{
  const objects=[fn('11','reconcile_chapter_revision_after_checkpoint()'),fn('12','reconcile_chapter_revision_after_checkpoint(uuid)'),fn('13','transfer_json_is_safe(text)')];
  const db=catalogMock({objects});
  assert.deepEqual(await adapterDropOrder(db),objects.map(item=>item.sql));
  assert.ok(!db.calls[0].params[0].some(signature=>signature.startsWith('reconcile_chapter_revision_after_checkpoint(')));
  assert.ok(!db.calls[0].params[0].includes('transfer_json_is_safe(text)'));
  assert.ok(db.calls[0].params[0].includes('transfer_json_is_safe(jsonb)'));
});

test('upgrade SQL contains no database creation, cascading drops or fictitious 132 ledger entry',()=>{
  const ast=ts.createSourceFile(runnerPath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const literals=[],queries=[];
  let migrationId;
  function visit(node){
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))literals.push(node.text);
    if(ts.isTemplateExpression(node))literals.push(node.head.text+node.templateSpans.map(span=>'__EXPRESSION__'+span.literal.text).join(''));
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='migration')migrationId=node.initializer?.text;
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='query')queries.push(node);
    ts.forEachChild(node,visit);
  }
  visit(ast);
  const sql=fs.readFileSync(path.resolve(__dirname,'../migrations/133_card_kernel_tables_only_upgrade.sql'),'utf8');
  const statements=splitSqlStatements(sql);
  assert.ok(statements.length>0,'inspect the real incremental migration, not an empty fixture');
  for(const text of [...literals,...statements]){
    assert.doesNotMatch(text,/\bCREATE\s+DATABASE\b/i);
    assert.doesNotMatch(text,/\bDROP\s+(?:FUNCTION|VIEW|TYPE|SCHEMA|TABLE|TRIGGER|INDEX|CONSTRAINT)\b[^;]*\bCASCADE\b/i);
  }
  assert.equal(migrationId,'133_card_kernel_tables_only_upgrade');
  const ledgerWrites=queries.filter(node=>/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+new_design\.schema_migrations\b/i.test(node.arguments[0]?.text??''));
  assert.equal(ledgerWrites.length,1,'the runner must only append its own real migration');
  assert.equal(ledgerWrites[0].arguments[0].text,'INSERT INTO new_design.schema_migrations(id) VALUES($1)');
  const params=ledgerWrites[0].arguments[1];
  assert.ok(ts.isArrayLiteralExpression(params));
  assert.equal(params.elements.length,1);
  assert.equal(params.elements[0].getText(ast),'migration');
  for(const statement of statements)assert.doesNotMatch(statement,/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:new_design\.)?schema_migrations\b/i,'133 structural SQL must not fabricate ledger history');
});

test('runtime SQL gates accept the real 132 baseline or 133 upgrade, never 132 alone',()=>{
  const serverRoot=path.resolve(__dirname,'../src/server');
  const checked=new Set();
  function scan(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const filename=path.join(directory,entry.name);
      if(entry.isDirectory()){scan(filename);continue;}
      if(!entry.isFile()||!entry.name.endsWith('.ts'))continue;
      const text=fs.readFileSync(filename,'utf8');
      if(!text.includes('132_card_kernel_tables_only'))continue;
      const ast=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
      function visit(node){
        if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='query'){
          const argument=node.arguments[0];
          const sql=argument&&(ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument))?argument.text
            :argument&&ts.isTemplateExpression(argument)?argument.head.text+argument.templateSpans.map(span=>'__EXPRESSION__'+span.literal.text).join(''):'';
          if(sql.includes('schema_migrations')&&sql.includes('132_card_kernel_tables_only')){
            const location=path.relative(serverRoot,filename).replaceAll('\\','/');
            checked.add(location);
            assert.match(sql,/\bid\s+IN\s*\(\s*'132_card_kernel_tables_only'\s*,\s*'133_card_kernel_tables_only_upgrade'\s*\)/i,`${location}: readiness must accept either real migration`);
            assert.doesNotMatch(sql,/\bid\s*=\s*'132_card_kernel_tables_only'/i,`${location}: an additional 132-only predicate still blocks upgraded databases`);
          }
        }
        ts.forEachChild(node,visit);
      }
      visit(ast);
    }
  }
  scan(serverRoot);
  for(const filename of [
    'database/worldPackages/capability.ts',
    'database/resourceSupplements/commands.ts',
    'database/resourceSupplements/committing/index.ts',
    'database/resourceSupplements/correctiveCommitting/index.ts',
    'database/resourceSupplements/correcting/index.ts',
    'database/resourceSupplements/reviewing/index.ts',
    'database/resourceSupplements/integrity/index.ts',
    'database/chapterSettlement/supplementRead/settlementPreview.ts',
    'database/chapterSettlement/supplementRead/candidates.ts',
    'ai/chapterSettlement/requests.ts',
  ])assert.ok(checked.has(filename),`the source assertion must inspect ${filename}`);
});

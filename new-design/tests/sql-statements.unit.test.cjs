'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {splitSqlStatements,stripLeadingComments}=require('../scripts/sql-statements.cjs');

test('top-level delimiters split statements, discard empty pieces, and trim only outer whitespace/comments',()=>{
 assert.deepEqual(splitSqlStatements(' \uFEFF; -- leading ;\r\n SELECT 1; /* next */ SELECT 2 ; ; -- tail'),['SELECT 1','SELECT 2']);
 assert.deepEqual(splitSqlStatements('SELECT 1'),['SELECT 1']);
 assert.deepEqual(splitSqlStatements(''),[]);
 assert.deepEqual(splitSqlStatements('/* only /* nested */ comments */ -- EOF'),[]);
});

test('single/double quotes preserve repeated-quote escapes, delimiters, and comment-looking text',()=>{
 const first=`SELECT 'it''s; -- not a comment /* neither */', "a"";--b"`;
 assert.deepEqual(splitSqlStatements(`${first}; SELECT '";';`),[first,`SELECT '";'`]);
 assert.deepEqual(splitSqlStatements(`SELECT ''; SELECT "";`),[`SELECT ''`,`SELECT ""`]);
});

test('explicit E strings handle escaped quotes and backslashes without changing standard strings',()=>{
 const escaped=String.raw`SELECT E'one\';still inside', e'two\\'; SELECT 2;`;
 assert.deepEqual(splitSqlStatements(escaped),[String.raw`SELECT E'one\';still inside', e'two\\'`,'SELECT 2']);
 assert.deepEqual(splitSqlStatements(String.raw`SELECT 'ordinary\'; SELECT 2;`),[String.raw`SELECT 'ordinary\'`,'SELECT 2']);
 assert.deepEqual(splitSqlStatements(String.raw`SELECT "quoted\"; SELECT 2;`),[String.raw`SELECT "quoted\"`,'SELECT 2']);
});

test('line comments and nested block comments preserve body text but never produce statements',()=>{
 const first='SELECT /* outer ; /* nested ; */ still outer */ 1 -- retained ;\r\n + 2';
 assert.deepEqual(splitSqlStatements(`-- prefix\r${first}; /* between */ SELECT 3;`),[first,'SELECT 3']);
 assert.equal(stripLeadingComments(' /* first /* inner */ */\n-- second\n SELECT 1 /* retain */ '),'SELECT 1 /* retain */');
 const trailing='SELECT 1 -- retained';
 assert.deepEqual(splitSqlStatements(`${trailing}\n;SELECT 2;`),[trailing,'SELECT 2']);
 assert.deepEqual(splitSqlStatements([trailing,'SELECT 2'].join('\n;\n')),[trailing,'SELECT 2']);
});

test('untagged/tagged dollar quotes retain function bodies, alternate tags, and case-sensitive delimiters',()=>{
 const body=`CREATE FUNCTION sample() RETURNS void LANGUAGE plpgsql AS $Body_1$
 BEGIN
  PERFORM ';'; -- a body semicolon;
  PERFORM $other$inner; $$; ' ;$other$;
  /* body ; /* nested ; */ */
  PERFORM '$body_1$';
 END;
 $Body_1$`;
 assert.deepEqual(splitSqlStatements(`${body}; DO $$ BEGIN PERFORM 1; END; $$;`),[body,'DO $$ BEGIN PERFORM 1; END; $$']);
 assert.deepEqual(splitSqlStatements('SELECT $中文$内容;--原文$中文$;'),['SELECT $中文$内容;--原文$中文$']);
 assert.deepEqual(splitSqlStatements('SELECT $$$$;'),['SELECT $$$$']);
});

test('dollar signs within identifiers and parameter references are not quote delimiters',()=>{
 assert.deepEqual(splitSqlStatements('SELECT name$tag$, $1, name$$; SELECT $2;'),['SELECT name$tag$, $1, name$$','SELECT $2']);
 assert.deepEqual(splitSqlStatements('SELECT ($tag$body;$tag$);'),['SELECT ($tag$body;$tag$)']);
});

test('non-text input and unterminated tokens fail closed, even after complete earlier statements',()=>{
 for(const input of [null,undefined,0,{},[],Buffer.from('SELECT 1;')]){
  assert.throws(()=>splitSqlStatements(input),TypeError);assert.throws(()=>stripLeadingComments(input),TypeError);
 }
 for(const source of ["SELECT 1; SELECT 'secret",'SELECT "secret','SELECT $$secret;','SELECT $tag$secret$TAG$;','SELECT /* secret','SELECT /* outer /* nested */',"SELECT E'secret\\"]){
  assert.throws(()=>splitSqlStatements(source),error=>error instanceof SyntaxError&&/Unclosed SQL/.test(error.message)&&!error.message.includes('secret'));
 }
 assert.throws(()=>stripLeadingComments('/* unfinished'),SyntaxError);
 assert.deepEqual(splitSqlStatements('SELECT 1; -- EOF is a complete line comment'),['SELECT 1']);
});

test('schema.sql-style function and trigger definitions stay whole and remain classifiable after header removal',()=>{
 const schema=`-- schema.sql header
 CREATE SCHEMA sample;
 /* trigger function */ CREATE OR REPLACE FUNCTION sample.guard() RETURNS trigger AS $function$
 BEGIN
  IF NEW.value = 'semi;colon' THEN RAISE EXCEPTION 'not;allowed'; END IF;
  RETURN NEW;
 END;
 $function$ LANGUAGE plpgsql;
 -- actual trigger, not text inside the body
 CREATE TRIGGER immutable BEFORE UPDATE ON sample.records FOR EACH ROW EXECUTE FUNCTION sample.guard();`;
 const statements=splitSqlStatements(schema);
 assert.equal(statements.length,3);assert.match(statements[1],/^CREATE OR REPLACE FUNCTION sample\.guard/);
 assert.ok(statements[1].includes("THEN RAISE EXCEPTION 'not;allowed'; END IF;"));
 assert.ok(statements[1].endsWith('$function$ LANGUAGE plpgsql'));
 assert.match(statements[2],/^CREATE TRIGGER immutable/);
});

test('actual 132 schema functions retain their exact SQL bodies when reused for incremental installation',()=>{
 const root=path.join(__dirname,'..');
 const fragment=fs.readFileSync(path.join(root,'src/server/database/bootstrap/tablesOnly/kernel-functions.sql'),'utf8').replace(/\r\n/g,'\n');
 const baseline=fs.readFileSync(path.join(root,'migrations/132_card_kernel_tables_only.sql'),'utf8').replace(/\r\n/g,'\n');
 const fragmentStatements=splitSqlStatements(fragment),baselineStatements=splitSqlStatements(baseline);
 const functions=fragmentStatements.filter(statement=>/^CREATE (?:OR REPLACE )?FUNCTION\b/i.test(statement));
 const triggers=fragmentStatements.filter(statement=>/^CREATE (?:CONSTRAINT )?TRIGGER\b/i.test(statement));
 assert.ok(functions.length>0);assert.ok(triggers.length>0);
 for(const definition of [...functions,...triggers])assert.ok(baselineStatements.includes(definition),`Missing intact definition: ${definition.slice(0,100)}`);
 const store=functions.find(statement=>statement.startsWith('CREATE OR REPLACE FUNCTION new_design.kernel_store_record('));
 assert.ok(store);assert.ok(store.includes("RAISE EXCEPTION '内部记录缺少明确空间、身份或对象负载';"));
 assert.ok(store.endsWith('$$'));assert.ok(store.includes('RETURN card_id;'));
 assert.deepEqual(splitSqlStatements(baselineStatements.join('\n;\n')),baselineStatements);
});

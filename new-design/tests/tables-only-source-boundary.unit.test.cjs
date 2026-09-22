const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const baseline=fs.readFileSync(path.join(root,'migrations/132_card_kernel_tables_only.sql'),'utf8').replace(/\r\n/g,'\n');

test('literal runtime SQL references only baseline tables or declared table-returning functions',()=>{
  const tables=new Set([...baseline.matchAll(/CREATE TABLE new_design\.([a-z_][a-z0-9_]*)/g)].map(match=>match[1]));
  const functions=new Set([...baseline.matchAll(/CREATE (?:OR REPLACE )?FUNCTION new_design\.([a-z_][a-z0-9_]*)/gi)].map(match=>match[1]));
  assert.equal(tables.size,79);
  const failures=[];
  function visit(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())visit(file);
      else if(entry.name.endsWith('.ts')){
        const source=fs.readFileSync(file,'utf8');
        for(const match of source.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+new_design\.([a-z_][a-z0-9_]*)(\s*\()?/gi)){
          if(!tables.has(match[1])&&!(match[2]&&functions.has(match[1])))failures.push(`${path.relative(root,file)}: ${match[1]}`);
        }
      }
    }
  }
  visit(path.join(root,'src/server'));
  assert.deepEqual(failures,[],'Runtime SQL must not retain removed table/view dependencies');
});

test('assembled baseline includes the current domain source fragments without permanent business views',()=>{
  const directory=path.join(root,'src/server/database/bootstrap/tablesOnly');
  for(const file of fs.readdirSync(directory).filter(file=>file.endsWith('.sql'))){
    const fragment=fs.readFileSync(path.join(directory,file),'utf8').replace(/\r\n/g,'\n').trim();
    assert.ok(baseline.includes(fragment),`${file} differs from the assembled baseline`);
  }
  assert.doesNotMatch(baseline,/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\b/i);
});

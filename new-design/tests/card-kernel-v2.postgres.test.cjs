const {test}=require('node:test'),assert=require('node:assert/strict'),spec=require('../runtime/runtime-package.spec.json');
const {isolatedDatabase}=require('./support/isolatedDatabase.cjs');
const {randomUUID}=require('node:crypto');

const manual=spec.manualMigrationFiles.map(fileName=>({id:fileName.slice(0,-4),fileName}));

test('blank install converges to 79 application tables and four AGE projection tables',async t=>{
 const {pool}=await isolatedDatabase(t,manual);
 const counts=(await pool.query("SELECT (SELECT count(*) FROM new_design.schema_migrations) migrations,(SELECT count(*) FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='new_design' AND class.relkind='r') application_tables,(SELECT count(*) FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='new_design_projection' AND class.relkind='r') projection_tables")).rows[0];
 assert.deepEqual({migrations:Number(counts.migrations),applicationTables:Number(counts.application_tables),projectionTables:Number(counts.projection_tables)},{migrations:128,applicationTables:79,projectionTables:4});
 assert.equal((await pool.query("SELECT installed AND operational value FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2'")).rows[0].value,true);
 const relations=(await pool.query("SELECT relname,relkind FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='new_design' AND relname=ANY($1::text[]) ORDER BY relname",[['creative_hub_threads','creative_hub_turns','planning_objects','comic_projects','drama_projects']])).rows;
 assert.deepEqual(relations.map(row=>[row.relname,row.relkind]),[['comic_projects','v'],['creative_hub_threads','v'],['creative_hub_turns','v'],['drama_projects','v'],['planning_objects','v']]);
 const id=randomUUID();
 await pool.query('INSERT INTO new_design.creative_hub_threads(id,title,binding) VALUES($1,$2,$3::jsonb)',[id,'兼容视图验收','{}']);
 assert.equal((await pool.query('SELECT title FROM new_design.creative_hub_threads WHERE id=$1',[id])).rows[0].title,'兼容视图验收');
 await pool.query('UPDATE new_design.creative_hub_threads SET title=$2 WHERE id=$1',[id,'兼容视图更新']);
 assert.equal((await pool.query('SELECT title FROM new_design.creative_hub_threads WHERE id=$1',[id])).rows[0].title,'兼容视图更新');
 await pool.query('DELETE FROM new_design.creative_hub_threads WHERE id=$1',[id]);
 assert.equal((await pool.query('SELECT count(*) value FROM new_design.creative_hub_threads WHERE id=$1',[id])).rows[0].value,'0');
});

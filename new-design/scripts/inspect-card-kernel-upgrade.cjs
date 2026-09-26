'use strict';
// Read-only inventory of the configured development database. Never creates a
// database, runs runtime startup, copies credentials, or applies migration SQL.
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');
const {classifyLegacyType}=require('./card-kernel-upgrade-mapping.cjs');
const root=path.resolve(__dirname,'..');
function nativeTypes(source){
 const list=source.match(/FOREACH record_key IN ARRAY ARRAY\[([\s\S]*?)\]::text\[\]/);
 if(!list)throw new Error('Cannot identify the canonical internal record catalog');
 return new Set([...list[1].matchAll(/'([a-z][a-z0-9_]*)'/g)].map(match=>match[1]));
}
async function inspect(pool,typeKeys){
 const client=await pool.connect();
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity=(await client.query(`SELECT current_database() database,
   EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='131_card_kernel_v2_cutover') source_installed,
   EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='133_card_kernel_tables_only_upgrade') upgraded,
   (SELECT count(*)::int FROM new_design.books) books,
   (SELECT count(*)::int FROM new_design.chapter_body_versions) bodies,
   (SELECT count(*)::int FROM new_design.model_route_configs) model_routes,
   (SELECT count(*)::int FROM new_design.model_credential_refs) credentials`)).rows[0];
  const rows=(await client.query(`SELECT type.type_key,count(card.id)::int records,
   count(card.id) FILTER(WHERE NOT(card.values ? 'id'))::int composite_records
   FROM new_design.card_types type LEFT JOIN new_design.cards card ON card.card_type_id=type.id
   WHERE type.type_key LIKE 'legacy.%' GROUP BY type.type_key ORDER BY type.type_key`)).rows;
  const mappings=rows.map(row=>({...row,...classifyLegacyType(row.type_key,typeKeys)}));
  await client.query('ROLLBACK');
  return{identity,typeCount:typeKeys.size,mappings};
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
 finally{client.release();}
}
async function main(){
 const config=JSON.parse(await fs.readFile(path.join(root,'.data/runtime.json'),'utf8'));
 if(!config.database||['postgres','template0','template1'].includes(config.database)
  ||config.host&&!['localhost','127.0.0.1','::1'].includes(config.host))throw new Error('Expected the explicitly configured local development database');
 const pool=new Pool({...config,host:'127.0.0.1',max:1,connectionTimeoutMillis:3000,application_name:'card_kernel_upgrade_readonly_inventory'});
 try{
  const result=await inspect(pool,nativeTypes(await fs.readFile(path.join(root,'src/server/database/bootstrap/tablesOnly/record-types.sql'),'utf8')));
  const populated=result.mappings.filter(row=>row.records>0);
  console.log(JSON.stringify({identity:result.identity,nativeTypes:result.typeCount,populatedTypes:populated.length,
   categories:populated.reduce((counts,row)=>({...counts,[row.kind]:(counts[row.kind]??0)+row.records}),{}),
   nonDirect:populated.filter(row=>row.kind!=='record')},null,2));
 }finally{await pool.end();}
}
if(require.main===module)main().catch(()=>{console.error('升级只读预检未完成；未执行任何数据库修改。');process.exitCode=1;});
module.exports={nativeTypes,inspect};

const fs=require('node:fs/promises');
const path=require('node:path');
const {createCheckedPool,identity}=require('../tests/unifiedPostgres/connection.cjs');
const {migrations}=require('../dist/server/database/migrations');

async function main(){
  const pool=await createCheckedPool();
  try{
    const installedBefore=await pool.query("SELECT to_regclass('new_design.schema_migrations') ledger");
    if(!installedBefore.rows[0].ledger){
      // AGE image initializes only its extension catalog in the fresh database.
      const existing=await pool.query("SELECT count(*)::int count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','ag_catalog')");
      if(existing.rows[0].count!==0)throw new Error('Fresh isolated migration target must contain no business tables');
    }
    console.log(`Verified isolated target: ${identity.container} / ${identity.database} / 127.0.0.1:${identity.port} / tmpfs`);
    await pool.query('CREATE EXTENSION IF NOT EXISTS age');await pool.query("LOAD 'age'");
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query('CREATE SCHEMA IF NOT EXISTS new_design');
    await pool.query('CREATE TABLE IF NOT EXISTS new_design.schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const migration of migrations){
      if((await pool.query('SELECT 1 FROM new_design.schema_migrations WHERE id=$1',[migration.id])).rowCount)continue;
      const client=await pool.connect();
      try{
        const sql=await fs.readFile(path.join(__dirname,'../migrations',migration.fileName),'utf8');
        await client.query('BEGIN');await client.query(sql);
        await client.query('INSERT INTO new_design.schema_migrations(id) VALUES($1) ON CONFLICT(id) DO NOTHING',[migration.id]);
        await client.query('COMMIT');console.log(`Migration ${migration.id}: PASS`);
      }catch(error){await client.query('ROLLBACK');console.error(`Migration ${migration.id}: FAIL (${error.code??'unknown'}) ${error.message}`);throw error;}
      finally{client.release();}
    }
    const actual=(await pool.query('SELECT id FROM new_design.schema_migrations ORDER BY id')).rows.map(row=>row.id);
    const expected=migrations.map(migration=>migration.id).sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Isolated migration ledger does not match the exact original registry');
    const count=actual.length;
    console.log(`Isolated migrations: ${count}/${migrations.length} PASS`);
    console.log('Extensions:',JSON.stringify((await pool.query("SELECT extname,extversion FROM pg_extension WHERE extname IN ('age','vector','pg_trgm') ORDER BY extname")).rows));
  }finally{await pool.end();}
}
main().catch(error=>{console.error(`Isolated validation stopped: ${error.message}`);process.exitCode=1;});

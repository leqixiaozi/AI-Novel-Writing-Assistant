const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
/** A new empty database on the existing PostgreSQL server; never starts runtime,
 * migrates the author's database, copies author rows, calls a model or drops data. */
const buildRoot=process.env.ND_REFERENCE_TEST_BUILD?path.resolve(process.env.ND_REFERENCE_TEST_BUILD):path.join(__dirname,'../../dist');
exports.compiled=relative=>require(path.join(buildRoot,relative));
let currentPool;const isolatedRuntime={getNewDesignPool:async()=>currentPool,getInitializedNewDesignPool:async()=>currentPool};
exports.isolatedDatabase=async function(t,extraMigrations=[]){
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../../.data/runtime.json'),'utf8'));
 const database=`nd_reference_test_${randomUUID().replaceAll('-','')}`;
 const admin=new Pool({...config,host:'127.0.0.1',database:'postgres',max:1,connectionTimeoutMillis:3000});
 try{await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0 ENCODING 'UTF8'`);}finally{await admin.end();}
 t.diagnostic?.(`Fresh isolated database created and retained: ${database}`);
 const pool=new Pool({...config,host:'127.0.0.1',database,max:8,application_name:'reference_parity_isolated_test'});
 t.after(()=>pool.end());
 await pool.query("CREATE EXTENSION age; LOAD 'age'; CREATE EXTENSION vector; CREATE EXTENSION pg_trgm; CREATE SCHEMA new_design; CREATE TABLE new_design.schema_migrations(id text PRIMARY KEY,applied_at timestamptz DEFAULT now())");
 const {migrations}=exports.compiled('server/database/migrations');
 for(const migration of [...migrations,...extraMigrations]){
  const client=await pool.connect();try{await client.query('BEGIN');await client.query(fs.readFileSync(path.join(__dirname,'../../migrations',migration.fileName),'utf8'));await client.query('INSERT INTO new_design.schema_migrations(id) VALUES($1) ON CONFLICT DO NOTHING',[migration.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw new Error(`Isolated migration ${migration.id}: ${error.message}`);}finally{client.release();}
 }
 const runtimePath=require.resolve(path.join(buildRoot,'server/database/runtime'));
 currentPool=pool;require.cache[runtimePath]={id:runtimePath,filename:runtimePath,loaded:true,exports:isolatedRuntime};
 return {pool,database};
};

'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');
const root=path.resolve(__dirname,'..');
function fail(message){const error=new Error(message);error.name='EmptyKernelInitializationError';return error;}
function options(argv){
 const result={database:null,port:null,confirmed:false};
 for(let index=0;index<argv.length;index++){
  if(argv[index]==='--database'&&!result.database)result.database=argv[++index];
  else if(argv[index]==='--port'&&result.port===null)result.port=Number(argv[++index]);
  else if(argv[index]==='--confirm-empty-database'&&!result.confirmed)result.confirmed=true;
  else throw fail('仅接受 --database <独立空库> [--port <端口>] --confirm-empty-database。');
 }
 if(!result.confirmed||!result.database||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(result.database)||['postgres','template0','template1'].includes(result.database))throw fail('必须明确指定独立空库并确认初始化；本命令不删除或重建任何已有数据。');
 if(result.port!==null&&(!Number.isInteger(result.port)||result.port<1024||result.port>65535))throw fail('独立库端口无效。');
 return result;
}
async function initialize(input){
 const config=JSON.parse(await fs.readFile(path.join(root,'.data/runtime.json'),'utf8'));
 if(!config.user||!config.password||!Number.isInteger(config.port))throw fail('本地运行配置尚未就绪。');
 if(input.database===config.database&&(input.port??config.port)===config.port)throw fail('拒绝把当前作者开发库当作独立空库。请明确准备一个新的数据库，再运行完整流程。');
 const sql=await fs.readFile(path.join(root,'migrations/132_card_kernel_tables_only.sql'),'utf8');
 if(!sql.includes('-- TABLES_ONLY_BASELINE_COMPLETE'))throw fail('纯表代码基线尚未装配完成，未连接数据库或执行初始化。');
 const pool=new Pool({host:'127.0.0.1',port:input.port??config.port,user:config.user,password:config.password,database:input.database,max:1,application_name:'new_design_explicit_empty_initializer'});
 let client;let committing=false;
 try{
  client=await pool.connect();
  const identity=(await client.query('SELECT current_database() name,pg_is_in_recovery() recovery')).rows[0];
  if(identity.name!==input.database||identity.recovery)throw fail('目标数据库身份或可写状态不符合明确选择。');
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('new-design-empty-initialization',0))");
  const occupied=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','ag_catalog') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m','f') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LIMIT 1")).rows[0];
  if(occupied)throw fail('目标不是空库；原数据保持不变，不清理、不覆盖。');
  await client.query(sql);
  const status=(await client.query("SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind='r') app_tables,(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design_projection' AND c.relkind='r') projection_tables,(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('new_design','new_design_projection') AND c.relkind IN('v','m')) views,EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only') registered,EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational AND details->>'storage'='tables_only') ready")).rows[0];
  if(Number(status.app_tables)!==79||Number(status.projection_tables)!==4||Number(status.views)!==0||!status.registered||!status.ready)throw fail('纯表结构或能力登记不完整，整笔初始化回滚。');
  committing=true;await client.query('COMMIT');
  return{database:input.database,applicationTables:79,projectionTables:4,views:0,baseline:'132_card_kernel_tables_only',authorDatabaseChanged:false};
 }catch(error){if(client)await client.query('ROLLBACK').catch(()=>undefined);if(committing)throw fail('提交结果未确认；保留目标库只读核对，不删除、不重复初始化。');throw error;}
 finally{client?.release();await pool.end();}
}
if(require.main===module){Promise.resolve().then(()=>initialize(options(process.argv.slice(2)))).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.name==='EmptyKernelInitializationError'?error.message:'初始化失败；未输出连接信息，请保留目标库核对。');process.exitCode=1;});}
module.exports={options,initialize};

'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');

const root=path.resolve(__dirname,'..');
const migrationFiles=[
 '123_card_workflow_convergence.sql','124_comic_card_convergence.sql','125_drama_card_convergence.sql',
 '126_creative_hub_card_convergence.sql','127_card_convergence_support.sql','128_content_card_convergence.sql',
 '129_author_workflow_convergence.sql','130_infrastructure_ledger_convergence.sql','131_card_kernel_v2_cutover.sql',
];
function fail(message){const error=new Error(message);error.name='CardKernelInstallError';return error;}
function parse(values){
 const result={database:null,port:null,confirm:false};
 for(let index=0;index<values.length;index++){
  const value=values[index];
  if(value==='--database'&&!result.database&&values[index+1])result.database=values[++index];
  else if(value==='--port'&&result.port===null&&values[index+1])result.port=Number(values[++index]);
  else if(value==='--confirm-atomic-cutover'&&!result.confirm)result.confirm=true;
  else throw fail('仅接受 --database <目标库> --confirm-atomic-cutover。');
 }
 if(!result.database||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(result.database))throw fail('必须显式指定合法目标数据库名。');
 if(result.port!==null&&(!Number.isInteger(result.port)||result.port<1024||result.port>65535))throw fail('目标端口无效。');
 if(!result.confirm)throw fail('未确认原子切换；没有执行迁移。');
 return result;
}
async function config(){
 const value=JSON.parse(await fs.readFile(path.join(root,'.data','runtime.json'),'utf8'));
 if(!Number.isInteger(value.port)||value.port<1024||value.port>65535||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.user)||!value.password)throw fail('本机受控数据库配置无效。');
 return value;
}
async function install(target){
 const local=await config(),pool=new Pool({host:'127.0.0.1',port:target.port??local.port,user:local.user,password:local.password,database:target.database,max:1,application_name:'card_kernel_v2_atomic_installer'}),client=await pool.connect();
 try{
  const identity=(await client.query('SELECT current_database() database,pg_is_in_recovery() recovery')).rows[0];
  if(identity.database!==target.database||identity.recovery)throw fail('目标数据库身份或主库状态不符合安装要求。');
  const applied=(await client.query("SELECT id FROM new_design.schema_migrations WHERE id=ANY($1::text[]) ORDER BY id",[migrationFiles.map(name=>name.slice(0,-4))])).rows.map(row=>row.id);
  if(applied.length===migrationFiles.length){console.log('卡片内核 v2 的 9 项迁移已经完整登记；没有重复写入。');return;}
  if(applied.length)throw fail(`检测到部分安装状态（${applied.join('、')}）；禁止拆分重试。请从安装前备份恢复后重新执行。`);
  const baseline=Number((await client.query('SELECT count(*) value FROM new_design.schema_migrations')).rows[0].value);
  if(baseline!==119)throw fail(`目标库迁移基线为 ${baseline}，预期 119；没有执行收敛。`);
  await client.query('BEGIN');
  try{
   for(const file of migrationFiles){
    const id=file.slice(0,-4),sql=await fs.readFile(path.join(root,'migrations',file),'utf8');
    await client.query(sql);
    await client.query('INSERT INTO new_design.schema_migrations(id) VALUES($1)',[id]);
   }
   const result=(await client.query("SELECT (SELECT count(*) FROM new_design.schema_migrations) migrations,(SELECT count(*) FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='new_design' AND class.relkind='r') application_tables,(SELECT count(*) FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='new_design_projection' AND class.relkind='r') projection_tables,(SELECT installed AND operational FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2') operational")).rows[0];
   if(Number(result.migrations)!==128||Number(result.application_tables)!==79||Number(result.projection_tables)!==4||!result.operational)throw fail('最终迁移计数、物理表数或能力门禁不符合合同。');
   await client.query('COMMIT');
   console.log(JSON.stringify({database:target.database,migrations:128,applicationTables:79,projectionTables:4,operational:true}));
  }catch(error){await client.query('ROLLBACK');throw error;}
 }finally{client.release();await pool.end();}
}
if(require.main===module)install(parse(process.argv.slice(2))).catch(error=>{console.error(`卡片内核 v2 未安装：${error instanceof Error?error.message:String(error)} 作者数据依赖事务保持原状。`);process.exitCode=1;});
module.exports={parse,migrationFiles};

'use strict';
// Explicit, one-shot configuration transfer. Never imported by ordinary startup.
const fs=require('node:fs/promises');
const path=require('node:path');
const {scryptSync,createDecipheriv,createCipheriv,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const root=path.resolve(__dirname,'..');
const scopes=new Set(['system_default','task_group','task','node']);
const configColumns=['id','scope','task_group','task_key','node_key','book_id','override_key','name','status','current_version_id','published_version_id','revision','created_at','updated_at'];
const versionColumns=['id','config_id','version','base_version_id','source','status','provider','model','parameters','required_capabilities','credential_ref_id','budget_policy','timeout_ms','retry_policy','fallback_mode','content_hash','created_by','created_at'];
function fail(message,unknown=false){const error=new Error(message);error.name='ModelInitializationError';error.mutationOutcome=unknown?'unknown':'not_written';return error;}
function options(argv){
 const result={database:null,port:null,confirmed:false};
 for(let index=0;index<argv.length;index++){
  if(argv[index]==='--database'&&!result.database)result.database=argv[++index];
  else if(argv[index]==='--port'&&result.port===null)result.port=Number(argv[++index]);
  else if(argv[index]==='--confirm-model-copy'&&!result.confirmed)result.confirmed=true;
  else throw fail('仅接受 --database <已初始化的独立空业务库> [--port <端口>] --confirm-model-copy。');
 }
 if(!result.confirmed||!validDatabase(result.database))throw fail('必须明确指定独立空业务库并确认仅复制非作品模型配置。');
 if(result.port!==null&&(!Number.isInteger(result.port)||result.port<1024||result.port>65535))throw fail('目标端口无效。');
 return result;
}
function validDatabase(value){return typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)&&!['postgres','template0','template1'].includes(value);}
function validateConnection(config){
 if(!config||!validDatabase(config.database)||typeof config.user!=='string'||!config.user||typeof config.password!=='string'||!config.password
  ||!Number.isInteger(config.port)||config.port<1024||config.port>65535||config.host&&!['127.0.0.1','localhost','::1'].includes(config.host))throw fail('必须提供同机明确数据库身份；连接信息不会输出。');
}
function credentialKey(config){return scryptSync(config.password,`ai-novel:new-design:credentials:v1:${config.database}`,32);}
function poolOptions(config,applicationName){return{host:config.host??'127.0.0.1',port:config.port,user:config.user,password:config.password,database:config.database,max:1,application_name:applicationName};}
function reseal(envelope,sourceKey,targetKey){
 if(!Buffer.isBuffer(envelope)||envelope.length<=29||envelope[0]!==1)throw fail('原模型凭据密文格式不受支持，未复制。');
 let plain,first,last;
 try{
  const decrypt=createDecipheriv('aes-256-gcm',sourceKey,envelope.subarray(1,13));decrypt.setAuthTag(envelope.subarray(13,29));
  first=decrypt.update(envelope.subarray(29));last=decrypt.final();plain=Buffer.concat([first,last]);
  if(!plain.length||plain.length>8192)throw fail('原模型凭据内容不受支持，未复制。');
  const iv=randomBytes(12),encrypt=createCipheriv('aes-256-gcm',targetKey,iv);
  const ciphertext=Buffer.concat([encrypt.update(plain),encrypt.final()]);
  return Buffer.concat([Buffer.from([1]),iv,encrypt.getAuthTag(),ciphertext]);
 }catch{throw fail('原模型凭据无法用原运行密钥核实；未复制，不输出密文或密钥。');}
 finally{plain?.fill(0);first?.fill(0);last?.fill(0);}
}
async function readFallbacks(source,versionIds){
 const capability=(await source.query("SELECT to_regclass('new_design.system_capabilities') IS NOT NULL AS present")).rows[0].present;
 const kernel=capability?(await source.query("SELECT details FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational")).rows[0]:null;
 const final=kernel?.details?.storage==='tables_only',converged=kernel?.details?.migration==='131_card_kernel_v2_cutover';
 if(final||converged){
  const rows=(await source.query(`SELECT version.values->>'id' AS id,version.values->>'route_version_id' AS route_version_id,
  (version.values->>'sort_order')::integer AS sort_order,version.values->>'provider' AS provider,version.values->>'model' AS model,
  version.values->'parameters' AS parameters,version.values->>'credential_ref_id' AS credential_ref_id,
  ARRAY(SELECT jsonb_array_elements_text(version.values->'technical_failure_categories')) AS technical_failure_categories,
  version.values->>'__legacy_table' AS origin_table,version.values->'__legacy_identity'->>'id' AS origin_id
  FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$2
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  WHERE card.status='active' AND (version.values->>'route_version_id')::uuid=ANY($1::uuid[])
  ORDER BY version.values->>'route_version_id',(version.values->>'sort_order')::integer`,[versionIds,final?'model_route_fallback':'legacy.model_route_fallbacks'])).rows;
  return rows.map(({origin_table,origin_id,...row})=>{
   if(converged&&!final&&(origin_table!=='model_route_fallbacks'||origin_id!==row.id))throw fail('131原模型后备卡片的逻辑身份不一致，未复制。');
   return row;
  });
 }
 // The old source is accepted only as a physical, read-only export source, never as a compatibility view.
 const relation=(await source.query("SELECT class.relkind FROM pg_class class JOIN pg_namespace ns ON ns.oid=class.relnamespace WHERE ns.nspname='new_design' AND class.relname='model_route_fallbacks'")).rows[0];
 if(!relation||!['r','p'].includes(relation.relkind))throw fail('源模型后备配置不是已支持的物理来源；未复制，不读取兼容视图。');
 return(await source.query('SELECT id,route_version_id,sort_order,provider,model,parameters,credential_ref_id,technical_failure_categories FROM new_design.model_route_fallbacks WHERE route_version_id=ANY($1::uuid[]) ORDER BY route_version_id,sort_order',[versionIds])).rows;
}
async function readSource(source){
 const configs=(await source.query("SELECT id,scope,task_group,task_key,node_key,book_id,override_key,name,status,current_version_id,published_version_id,revision,created_at,updated_at FROM new_design.model_route_configs WHERE book_id IS NULL AND override_key IS NULL AND scope=ANY($1::text[]) ORDER BY id",[[...scopes]])).rows;
 if(!configs.some(row=>row.scope==='system_default'&&row.status==='active'&&row.published_version_id))throw fail('源库没有实际发布的系统默认模型；不会用历史示例或猜测型号替代。');
 const versions=(await source.query(`SELECT ${versionColumns.join(',')} FROM new_design.model_route_versions WHERE config_id=ANY($1::uuid[]) ORDER BY config_id,version,id`,[configs.map(row=>row.id)])).rows;
 const fallbacks=await readFallbacks(source,versions.map(row=>row.id));
 const credentialIds=[...new Set([...versions,...fallbacks].map(row=>row.credential_ref_id).filter(Boolean))];
 const credentials=(await source.query('SELECT id,credential_key,provider,secret_locator,secret_envelope,status,created_at,updated_at FROM new_design.model_credential_refs WHERE id=ANY($1::uuid[]) ORDER BY id',[credentialIds])).rows;
 if(credentials.length!==credentialIds.length)throw fail('源模型版本引用的凭据不完整，未复制。');
 const versionById=new Map(versions.map(row=>[row.id,row]));
 for(const config of configs){
  if(!scopes.has(config.scope)||config.book_id!==null||config.override_key!==null)throw fail('源模型范围不是非作品配置，未复制。');
  for(const id of [config.current_version_id,config.published_version_id].filter(Boolean))if(versionById.get(id)?.config_id!==config.id)throw fail('源路由当前／发布版本不属于原路由，未复制。');
  if(config.status==='active'&&!config.current_version_id)throw fail('源活动路由缺少原当前版本，未复制。');
  if(config.published_version_id&&versionById.get(config.published_version_id)?.status!=='published')throw fail('源路由发布指针和原版本状态不一致，未复制。');
 }
 for(const version of versions)if(version.base_version_id&&versionById.get(version.base_version_id)?.config_id!==version.config_id)throw fail('源模型历史版本链不完整，未复制。');
 return{configs,versions,fallbacks,credentials};
}
async function requireEmptyTarget(target){
 await target.query("SELECT pg_advisory_xact_lock(hashtextextended('new-design-explicit-model-initialization',0))");
 const capability=(await target.query("SELECT EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only') AND EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational AND details->>'storage'='tables_only') AS ready")).rows[0];
 if(!capability?.ready)throw fail('目标须先完成132纯表初始化；本命令不迁移或清理数据库。');
 await target.query('LOCK TABLE new_design.model_route_configs,new_design.model_route_versions,new_design.model_credential_refs,new_design.books,new_design.chapter_documents,new_design.research_documents,new_design.ai_tasks,new_design.media_jobs IN SHARE ROW EXCLUSIVE MODE');
 const occupied=(await target.query(`SELECT EXISTS(SELECT 1 FROM new_design.model_route_configs) OR EXISTS(SELECT 1 FROM new_design.model_route_versions)
  OR EXISTS(SELECT 1 FROM new_design.model_credential_refs) OR EXISTS(SELECT 1 FROM new_design.books) OR EXISTS(SELECT 1 FROM new_design.chapter_documents)
  OR EXISTS(SELECT 1 FROM new_design.research_documents) OR EXISTS(SELECT 1 FROM new_design.ai_tasks) OR EXISTS(SELECT 1 FROM new_design.media_jobs)
  OR EXISTS(SELECT 1 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE type.type_key='model_route_fallback') AS occupied`)).rows[0].occupied;
 if(occupied)throw fail('目标已有作品、模型配置或运行记录；拒绝覆盖或重复初始化。');
}
async function writeTarget(target,data,sourceKey,targetKey){
 for(const credential of data.credentials){
  let envelope=null;
  try{
   if(credential.secret_locator==='secret://database')envelope=reseal(credential.secret_envelope,sourceKey,targetKey);
   else if(credential.secret_envelope!==null)throw fail('原模型凭据定位和密文状态不一致。');
   await target.query('INSERT INTO new_design.model_credential_refs(id,credential_key,provider,secret_locator,secret_envelope,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[credential.id,credential.credential_key,credential.provider,credential.secret_locator,envelope,credential.status,credential.created_at,credential.updated_at]);
  }finally{envelope?.fill(0);}
 }
 for(const config of data.configs)await target.query(`INSERT INTO new_design.model_route_configs(${configColumns.join(',')}) VALUES(${configColumns.map((_,index)=>'$'+(index+1)).join(',')})`,configColumns.map(key=>['current_version_id','published_version_id'].includes(key)?null:config[key]));
 // Stable topological order preserves base-version references even when source numbers are irregular.
 const pending=new Map(data.versions.map(row=>[row.id,row])),written=new Set();
 while(pending.size){
  let progressed=false;
  for(const [id,version] of pending)if(!version.base_version_id||written.has(version.base_version_id)){
   await target.query(`INSERT INTO new_design.model_route_versions(${versionColumns.join(',')}) VALUES(${versionColumns.map((_,index)=>'$'+(index+1)).join(',')})`,versionColumns.map(key=>version[key]));
   pending.delete(id);written.add(id);progressed=true;
  }
  if(!progressed)throw fail('源模型历史版本链存在循环；目标整笔回滚。');
 }
 for(const fallback of data.fallbacks)await target.query("SELECT new_design.kernel_store_record('model_route_fallback','00000000-0000-4000-8000-000000000001'::uuid,$1::uuid,$2::jsonb)",[fallback.id,JSON.stringify(fallback)]);
 for(const config of data.configs)await target.query('UPDATE new_design.model_route_configs SET current_version_id=$2,published_version_id=$3 WHERE id=$1',[config.id,config.current_version_id,config.published_version_id]);
 const counts=(await target.query("SELECT (SELECT count(*) FROM new_design.model_route_configs) configs,(SELECT count(*) FROM new_design.model_route_versions) versions,(SELECT count(*) FROM new_design.model_credential_refs) credentials,(SELECT count(*) FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE type.type_key='model_route_fallback') fallbacks")).rows[0];
 if(Number(counts.configs)!==data.configs.length||Number(counts.versions)!==data.versions.length||Number(counts.credentials)!==data.credentials.length||Number(counts.fallbacks)!==data.fallbacks.length)throw fail('目标模型配置数量不匹配；整笔回滚。');
}
async function copyModelConfiguration({sourceConfig,targetConfig,confirmed}){
 if(confirmed!==true)throw fail('此操作仅由明确确认的独立初始化调用。');
 validateConnection(sourceConfig);validateConnection(targetConfig);
 if(sourceConfig.database===targetConfig.database)throw fail('拒绝把当前作者库作为目标；请使用不同名称的独立库。');
 const sourcePool=new Pool(poolOptions(sourceConfig,'new_design_model_configuration_read_only'));
 const targetPool=new Pool(poolOptions(targetConfig,'new_design_explicit_model_initialization'));
 let source,target,sourceKey,targetKey,data,committing=false,committed=false;
 try{
  source=await sourcePool.connect();await source.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if((await source.query('SELECT current_database() AS name')).rows[0].name!==sourceConfig.database)throw fail('源数据库身份不符合明确配置。');
  data=await readSource(source);
  target=await targetPool.connect();await target.query('BEGIN');
  const identity=(await target.query('SELECT current_database() AS name,pg_is_in_recovery() AS recovery')).rows[0];
  if(identity.name!==targetConfig.database||identity.recovery)throw fail('目标数据库身份或可写状态不符合明确选择。');
  await requireEmptyTarget(target);
  sourceKey=credentialKey(sourceConfig);targetKey=credentialKey(targetConfig);
  await writeTarget(target,data,sourceKey,targetKey);
  await source.query('ROLLBACK');source.release();source=null;
  committing=true;await target.query('COMMIT');committed=true;
  return{database:targetConfig.database,configs:data.configs.length,versions:data.versions.length,fallbacks:data.fallbacks.length,credentials:data.credentials.length,sourceChanged:false,modelCalled:false,mutationOutcome:'committed'};
 }catch(error){
  let rollbackFailed=false;
  await target?.query('ROLLBACK').catch(()=>{rollbackFailed=true;});
  if(committing&&!committed||rollbackFailed)throw fail('模型初始化提交或回滚结果未确认；仅只读核对目标，不重试、不删除。',true);
  if(error?.name==='ModelInitializationError')throw error;
  throw fail('模型初始化未完成；目标未提交，不输出连接信息、模型参数或凭据。');
 }finally{
  await source?.query('ROLLBACK').catch(()=>undefined);source?.release();target?.release();
  sourceKey?.fill(0);targetKey?.fill(0);for(const credential of data?.credentials??[])credential.secret_envelope?.fill(0);
  await Promise.allSettled([sourcePool.end(),targetPool.end()]);
 }
}
async function initialize(input){
 const config=JSON.parse(await fs.readFile(path.join(root,'.data/runtime.json'),'utf8'));
 return copyModelConfiguration({sourceConfig:config,targetConfig:{...config,database:input.database,port:input.port??config.port},confirmed:input.confirmed});
}
if(require.main===module){
 if(process.argv.length===2||process.argv.slice(2).includes('--help'))console.log('仅显式复制同机原作者库的非作品模型配置到已初始化132独立空业务库：node scripts/model-init.cjs --database <目标库> [--port <端口>] --confirm-model-copy。不会修改源库、作品或本地运行配置；不会调用模型。未连接数据库。');
 else Promise.resolve().then(()=>initialize(options(process.argv.slice(2)))).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error?.name==='ModelInitializationError'?error.message:'模型初始化失败；未输出连接信息或密钥。');process.exitCode=1;});
}
module.exports={options,initialize,copyModelConfiguration};

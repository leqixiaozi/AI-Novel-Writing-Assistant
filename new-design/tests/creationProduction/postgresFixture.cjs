const {randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {getNewDesignPool}=require('../../dist/server/database/runtime');
const {listPromptAssets}=require('../../dist/server/ai/prompts');

/** Empty real-schema infrastructure, no author's rows copied, no destructive cleanup. */
exports.creationFixture=async function(t){
 const pool=await getNewDesignPool(),client=await pool.connect(),schema=`creation_production_test_${randomUUID().replaceAll('-','')}`;
 if(process.env.ND_REFERENCE_TEST_BUILD){const oid=(await client.query("SELECT 'new_design.bridge_dependency_creation()'::regprocedure::oid oid")).rows[0].oid;await client.query(fs.readFileSync(path.join(__dirname,'../../migrations/099_dependency_creation_record_guards.sql'),'utf8'));require('node:assert/strict').equal((await client.query("SELECT 'new_design.bridge_dependency_creation()'::regprocedure::oid oid")).rows[0].oid,oid);}
 const assetIds=listPromptAssets().map(asset=>asset.assetId),failures=[];
 function rewrite(sql){const protectedSql=assetIds.reduce((value,id,index)=>value.replaceAll(id,`__PROMPT_ASSET_${index}__`),sql);return assetIds.reduce((value,id,index)=>value.replaceAll(`__PROMPT_ASSET_${index}__`,id),protectedSql.replace(/\bnew_design\b/g,schema));}
 const db=new Proxy(client,{get(target,key){if(key==='release')return()=>{};if(key==='query')return async(sql,values)=>{try{return await target.query(typeof sql==='string'?rewrite(sql):{...sql,text:rewrite(sql.text)},values);}catch(error){failures.push({code:error.code,message:error.message,routine:error.routine,context:error.where,statement:typeof sql==='string'?sql.slice(0,260):sql.text.slice(0,260)});throw error;}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const scopedPool={query:db.query,connect:async()=>db};
 const authorRoutes=(await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows;
 t.after(async()=>{if(failures.length)t.diagnostic?.(JSON.stringify({isolatedFixtureFailures:failures}));try{await client.query('ROLLBACK');await client.query(`UPDATE ${schema}.books SET status='archived' WHERE status='active'`);}finally{client.release();await pool.end();}});
 await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
 const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='new_design' ORDER BY tablename")).rows;
 for(const {tablename} of tables)await client.query(`CREATE TABLE ${schema}.${tablename}(LIKE new_design.${tablename} INCLUDING ALL)`);
 const fks=(await client.query("SELECT relation.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class relation ON relation.oid=c.conrelid JOIN pg_namespace n ON n.oid=relation.relnamespace WHERE n.nspname='new_design' AND c.contype='f' ORDER BY relation.relname,c.conname")).rows;
 for(const row of fks)await client.query(`ALTER TABLE ${schema}.${row.table_name} ADD CONSTRAINT ${row.conname} ${rewrite(row.definition)}`);
 const functions=(await client.query("SELECT p.oid,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='new_design' AND p.prokind='f' AND l.lanname IN ('sql','plpgsql') ORDER BY p.oid")).rows;
 for(const row of functions)await client.query(rewrite(row.definition));
 const triggers=(await client.query("SELECT pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='new_design' AND NOT t.tgisinternal ORDER BY r.relname,t.tgname")).rows;
 for(const row of triggers)await client.query(rewrite(row.definition));
 const migration=fs.readFileSync(path.join(__dirname,'../../migrations/030_postgres_outbox_job_runtime.sql'),'utf8');
 for(const table of ['outbox_event_topics','background_job_handlers','outbox_consumers']){const statement=migration.match(new RegExp(`INSERT INTO ${table}\\([^;]+;`));if(!statement)throw new Error(`Missing controlled fixture seed ${table}`);await db.query(statement[0]);}
 async function authorUnchanged(){const after=(await pool.query("SELECT id,current_version_id,published_version_id,revision,status FROM new_design.model_route_configs WHERE scope='system_default' ORDER BY id")).rows;require('node:assert/strict').deepEqual(after,authorRoutes);}
 return{pool,db,scopedPool,schema,failures,authorUnchanged};
};

exports.seedCreationTemplate=async function(db){
 const template=randomUUID(),version=randomUUID(),relation=randomUUID();
 const field=(key,name,required)=>({key,name,type:'short_text',description:'隔离字段',required,defaultValue:null,options:[],group:'基本信息',order:0});
 const payload={cardTypes:['character','event','volume','chapter','scene'].map(key=>({sourceId:randomUUID(),sourceVersionId:randomUUID(),key,name:{character:'人物',event:'事件',volume:'卷',chapter:'章节',scene:'场景'}[key],description:'隔离类型',capabilities:[],fields:[field('name','名称',true),field('notes','备注',false)],sortOrder:0})),dictionaries:[],tagDimensions:[],tagBindings:[],relationTypes:[{sourceId:relation,key:'companion',name:'同伴关系',description:'隔离关系',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['character'],sourceMax:null,targetMax:null,propertiesSchema:[field('reason','关系缘由',true)]}],forms:[],seedCards:[],menu:{defaultPage:'overview',pages:['overview']}};
 // Source IDs are real fixture configuration rows so installation provenance FKs remain enabled.
 const systemSpace='00000000-0000-4000-8000-000000000001';await db.query("INSERT INTO new_design.card_spaces(id,space_key,name) VALUES($1,'system','隔离系统规格')",[systemSpace]);
 for(const type of payload.cardTypes){await db.query("INSERT INTO new_design.card_types(id,space_id,type_key,name,status) VALUES($1,$2,$3,$4,'published')",[type.sourceId,systemSpace,type.key,type.name]);await db.query("INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,1,$3::jsonb)",[type.sourceVersionId,type.sourceId,JSON.stringify(type.fields)]);await db.query('UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1',[type.sourceId,type.sourceVersionId]);}
 await db.query("INSERT INTO new_design.relation_types(id,relation_key,name,scope,status,direction,source_type_keys,target_type_keys,properties_schema) VALUES($1,'companion','同伴关系','system','published','directed',ARRAY['character'],ARRAY['character'],$2::jsonb)",[relation,JSON.stringify(payload.relationTypes[0].propertiesSchema)]);
 await db.query("INSERT INTO new_design.template_groups(id,template_key,name,status) VALUES($1,$1::uuid::text,'隔离开书模板','published')",[template]);await db.query("INSERT INTO new_design.template_group_versions(id,template_id,version,payload) VALUES($1,$2,1,$3::jsonb)",[version,template,JSON.stringify(payload)]);await db.query('UPDATE new_design.template_groups SET current_version_id=$2 WHERE id=$1',[template,version]);
 return{template,version,relation,payload};
};

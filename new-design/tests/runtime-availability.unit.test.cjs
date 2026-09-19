const test=require('node:test'),assert=require('node:assert/strict');
const runtime=require('../dist/server/database/runtime');
const quality=require('../dist/server/database/chapterQuality');
const models=require('../dist/server/database/modelManagement');

test('missing manual chapter diagnosis schema has a precise read-only error',async()=>{
  const original=runtime.getNewDesignPool,queries=[];
  runtime.getNewDesignPool=async()=>({query:async sql=>{queries.push(sql);return{rows:[{installed:false}]};}});
  try{await assert.rejects(quality.listChapterQualityReceipts('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'),/章节诊断尚未启用/);assert.equal(queries.length,1);}
  finally{runtime.getNewDesignPool=original;}
});

test('other chapter diagnosis read failures remain failures',async()=>{
  const original=runtime.getNewDesignPool,broken=new Error('isolated database failure');
  runtime.getNewDesignPool=async()=>({query:async sql=>sql.includes('to_regclass')?{rows:[{installed:true}]}:Promise.reject(broken)});
  try{await assert.rejects(quality.listChapterQualityReceipts('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'),error=>error===broken);}
  finally{runtime.getNewDesignPool=original;}
});

test('published model with empty service address reports that before advanced settings',async()=>{
  const layer={id:'00000000-0000-4000-8000-000000000003',source_config_id:'00000000-0000-4000-8000-000000000004',scope:'system_default',provider:'ollama',model:'MiniMax-M3',parameters:{temperature:0.7},required_capabilities:['legacy-feature'],budget_policy:{maxTokens:16000,maxOutputTokens:8192},retry_policy:{},timeout_ms:120000,credential_ref_id:null,fallback_mode:'replace'};
  const client={query:async sql=>({rows:sql.includes('model_route_configs config')?[layer]:[]})};
  await assert.rejects(models.resolveManagedTaskRoute('initial_content',{client}),/未填写服务地址.*温度.*模型设置/);
});

test('task model override may inherit the configured default service address',async()=>{
  const base={id:'00000000-0000-4000-8000-000000000005',source_config_id:'00000000-0000-4000-8000-000000000006',scope:'system_default',provider:'ollama',model:'default-model',parameters:{baseUrl:'http://127.0.0.1:11434'},required_capabilities:[],budget_policy:{maxTokens:16000,maxOutputTokens:8192},retry_policy:{},timeout_ms:120000,credential_ref_id:null,fallback_mode:'replace'};
  const task={...base,id:'00000000-0000-4000-8000-000000000007',source_config_id:'00000000-0000-4000-8000-000000000008',scope:'task',provider:null,model:'task-model',parameters:{}};
  const client={query:async sql=>({rows:sql.includes('model_route_configs config')?[base,task]:[]})};
  const route=await models.resolveManagedTaskRoute('initial_content',{client});
  assert.equal(route.primary.endpoint,'http://127.0.0.1:11434');assert.equal(route.primary.model,'task-model');
});

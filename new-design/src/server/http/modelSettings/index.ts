import { Router } from "express";
import { z } from "zod";
import type { ModelTaskKey, ManagedModelConnection } from "../../../common/modelRouting";
import { getIndependentModelStatus, probeManagedModelConnection, AiExecutionError } from "../../ai";
import { NewDesignError } from "../../domain/errors";
import { getModelRouteCenterCatalog, saveManagedModelRoute, inheritManagedModelRoute, createManagedCredential, saveManagedCredentialSecret, resolveManagedTaskRoute, probeConnectionSchema,getManagedEmbeddingCatalog,saveManagedEmbeddingConnection,readManagedEmbeddingSaveReceipt,readManagedEmbeddingConnectionVersion,embeddingConnectionInputSchema,ManagedEmbeddingConfigurationError } from "../../database/modelManagement";

function recoveryError(step:string,error:unknown,savedResult:string):AiExecutionError {
  if(error instanceof AiExecutionError)return error;
  const fieldLabels:Record<string,string>={provider:"供应商",endpoint:"服务地址",model:"模型名称",credentialId:"凭据引用",apiKey:"服务密钥",maxOutputTokens:"输出预算",maxTotalTokens:"总预算",timeoutMs:"等待时间",maxRetries:"重试次数",retryDelayMs:"重试间隔",failureCategories:"备用模型触发条件",scope:"配置范围",taskType:"任务",expectedRevision:"服务器修订",name:"凭据名称",environmentVariable:"专用环境变量"};
  const issues=error instanceof z.ZodError?Object.fromEntries(error.issues.map(item=>{const last=String(item.path[item.path.length-1]??"form"),label=fieldLabels[last]??"模型设置";return [item.path.join(".")||"form",/[\u4e00-\u9fff]/.test(item.message)?`${label}：${item.message}`:`${label}：请核对填写格式、数量和允许范围。`];})):error instanceof NewDesignError?error.issues:undefined;
  const failure=new AiExecutionError(step,error instanceof NewDesignError?error.message:error instanceof z.ZodError?"模型设置填写不完整或超出允许范围，请核对标示字段。":`${step}未确认成功。请恢复连接并核对服务器结果，避免重复写入。`,error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,issues);
  failure.recovery.savedResult=savedResult;
  return failure;
}

export function modelSettingsRouter():Router {
  const router=Router();
  const embeddingRoute=(step:string,write:boolean,action:(request:import("express").Request)=>Promise<unknown>):import("express").RequestHandler=>(request,response,next)=>{void Promise.resolve().then(()=>action(request)).then(data=>response.json({success:true,data})).catch(error=>{const failure=recoveryError(step,error,"当前向量模型输入、已保存连接版本和知识索引保留；未知原请求只核对，不重复保存或生成向量。");failure.recovery.sourceRoute="/new-design/structure/models";failure.recovery.actionLabel="打开模型设置";if(write)failure.recovery.mutationOutcome=error instanceof ManagedEmbeddingConfigurationError?error.mutationOutcome:error instanceof z.ZodError?"not_written":"unknown";next(failure);});};
  router.get("/embedding/catalog",embeddingRoute("读取知识语义索引模型",false,()=>getManagedEmbeddingCatalog()));
  router.post("/embedding/connections",embeddingRoute("保存并启用知识语义索引模型",true,request=>saveManagedEmbeddingConnection(embeddingConnectionInputSchema.parse(request.body))));
  router.get("/embedding/connections/by-request/:key",embeddingRoute("只读核对原向量模型保存回执",false,request=>readManagedEmbeddingSaveReceipt(z.string().uuid().parse(request.params.key))));
  router.get("/embedding/connections/:id",embeddingRoute("读取所选原向量模型版本",false,request=>readManagedEmbeddingConnectionVersion(z.string().uuid().parse(request.params.id))));
  router.get("/status",(_request,response,next)=>{void getIndependentModelStatus().then(data=>response.json({success:true,data})).catch(next);});
  router.get("/catalog",(_request,response,next)=>{void getModelRouteCenterCatalog().then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("读取模型设置",error,"已保存模型版本和小说资料均保留。请点击重新读取目录后核对。")));});
  router.post("/routes",(request,response,next)=>{void saveManagedModelRoute(request.body).then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("保存并启用模型设置",error,"本次保存未确认成功；旧版本和当前输入均保留。请先点击核对服务器结果，确认版本后再点击保存并启用。")));});
  router.get("/preview/:taskType",(request,response,next)=>{void resolveManagedTaskRoute(String(request.params.taskType) as ModelTaskKey).then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("读取任务模型路由",error,"模型预览未完成；已保存的路由版本、小说资料和人工草稿均保留。请在模型设置配置默认模型，点击保存并启用后重新选择任务。")));});
  router.post("/routes/:id/inherit",(request,response,next)=>{
    try { const input=z.object({expectedRevision:z.number().int().positive()}).strict().parse(request.body); void inheritManagedModelRoute(String(request.params.id),input.expectedRevision).then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("恢复默认模型继承",error,"原任务模型版本保留。请重新加载核对任务是否已恢复默认，再点击恢复默认模型。"))); } catch(error) { next(recoveryError("核对恢复继承请求",error,"未修改模型设置。请重新加载设置后点击恢复默认模型。")); }
  });
  router.post("/credentials",(request,response,next)=>{
    try { const input=z.object({name:z.string().trim().min(1).max(120),provider:z.enum(["ollama","openai-compatible","anthropic-compatible"]),environmentVariable:z.string().regex(/^NEW_DESIGN_AI_[A-Z0-9_]+$/)}).strict().parse(request.body); void createManagedCredential(input).then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("创建凭据引用",error,"旧凭据引用不会覆盖。请点击重新读取目录核对凭据名称；同名冲突请更换名称，再点击创建凭据引用。"))); } catch(error) { next(recoveryError("核对模型凭据输入",error,"未修改凭据。请填写名称、供应商和专用环境变量名，再点击创建凭据引用。")); }
  });
  router.post("/credentials/database",(request,response,next)=>{
    try { const input=z.object({name:z.string().trim().min(1).max(120),provider:z.enum(["ollama","openai-compatible","anthropic-compatible"]),apiKey:z.string().min(1).max(8192),credentialId:z.string().uuid().nullable()}).strict().parse(request.body); void saveManagedCredentialSecret(input).then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("保存数据库模型凭据",error,"原凭据和模型路线保留。读取凭据目录核对结果，再决定是否重新录入；不会调用模型。"))); } catch(error) { next(recoveryError("核对数据库模型凭据",error,"密钥未保存到数据库；原凭据和模型路线保留。")); }
  });
  router.post("/probe",(request,response,next)=>{
    try { const input=z.object({connection:probeConnectionSchema}).strict().parse(request.body); void probeManagedModelConnection(input.connection as ManagedModelConnection).then(data=>response.json({success:true,data})).catch(error=>next(recoveryError("检查连接与模型列表",error,"连接测试未确认可用；已保存模型设置和小说草稿保留。请核对服务地址、凭据和模型，再点击检查连接与模型列表。"))); } catch(error) { next(recoveryError("核对连接测试输入",error,"连接测试尚未执行；所有已保存结果均保留。请核对服务地址与凭据后点击检查连接与模型列表。")); }
  });
  return router;
}

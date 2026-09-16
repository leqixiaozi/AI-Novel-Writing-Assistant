import {Router,type NextFunction,type Response} from "express";
import {z} from "zod";
import {COMPOSITION_ROUTE,type DebugPreviewInput} from "../../../common/promptComposition";
import {AiExecutionError,executeManagedPrompt} from "../../ai";
import {compileDebugBundle,loadDebugTaskSources,debugParametersSchema,replayDebugPrompt} from "../../ai/composition";
import {
  getCompositionCatalog,getCompositionSources,saveComposition,readCompositionSaveByRequest,
  loadCompositionRecipeVersion,saveDebugPreview,readDebugPreview,readDebugPreviewByRequest,
  claimDebugRun,finishDebugRun,readDebugResult,
} from "../../database/promptComposition";
import type {DebugRunCompletion} from "../../database/promptComposition";
import {NewDesignError} from "../../domain/errors";

const uuid=z.string().uuid(),key=z.string().trim().min(8).max(160);
const previewSchema=z.object({recipeId:uuid,recipeVersionId:uuid,parameters:debugParametersSchema,
  variableValues:z.record(z.string().max(100),z.union([z.string().max(30000),z.number().finite(),z.boolean()])),idempotencyKey:key}).strict()
  .refine(value=>Object.keys(value.variableValues).length<=100,{path:["variableValues"],message:"最多填写 100 个已声明参数。"});
const runSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:key}).strict();

function failure(step:string,error:unknown,savedResult:string,previewId?:string):AiExecutionError {
  const issueLabels:Record<string,string>={recipeId:"组合",recipeVersionId:"组合版本",parameters:"本次输入",schemaTypeIds:"内容类型",variableValues:"组合参数",sourceText:"参考文本",sourceReference:"参考来源名称",instruction:"本次要求",expectedRevision:"预览版本",rankingSnapshotIds:"榜单快照",dimensions:"分析维度",idempotencyKey:"请求凭证",title:"名称",name:"组合名称",description:"用途说明",method:"开书方式",premise:"故事构思",protagonist:"主角",centralConflict:"核心冲突",readerPromise:"读者体验",styleKeywords:"文风关键词",level:"规划层级",purpose:"分析用途",preset:"分析深度",components:"组件选择",variables:"参数定义",context:"参考资料",bookId:"参考书籍",sources:"参考资料选择",label:"参数名称",type:"参数类型",options:"参数选项",defaultValue:"参数默认值"};
  const issues=error instanceof z.ZodError?Object.fromEntries(error.issues.map(item=>[item.path.join(".")||"form",`${issueLabels[String(item.path[item.path.length-1])]??"本次输入"}：${/[\u4e00-\u9fff]/.test(item.message)?item.message:"请核对填写格式与允许范围。"}`])):error instanceof NewDesignError?error.issues:undefined;
  const message=error instanceof NewDesignError?error.message:error instanceof z.ZodError?"本次输入不完整或超出允许范围，请核对标示项目。":"服务未确认本次操作结果。请保留当前输入，恢复连接后先核对结果。";
  const result=new AiExecutionError(step,message,error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,issues);
  result.recovery.savedResult=savedResult;
  result.recovery.actionLabel="返回提示词组合";
  result.recovery.sourceRoute=COMPOSITION_ROUTE+(previewId?`?previewId=${previewId}`:"");
  return result;
}

async function trial(id:string,input:z.infer<typeof runSchema>){
  const claim=await claimDebugRun(id,input.expectedRevision,input.idempotencyKey);
  if("priorResult" in claim)return claim.priorResult;
  let completion:DebugRunCompletion;
  try {
    let prepared;
    try {prepared=replayDebugPrompt(claim.frozenBundle);}catch(error){throw failure("核对冻结请求",error,"冻结输入和旧运行记录保留。本次模型请求尚未发送，请返回组合页重新预览。",id);}
    const generated=await executeManagedPrompt(claim.preview.taskType,prepared,{
      routeResolver:async()=>claim.snapshot.route,snapshotWriter:async()=>claim.snapshot,
    });
    completion={output:generated.output,modelSnapshot:generated.modelSnapshot};
  }catch(error){
    const problem=error instanceof AiExecutionError?error:failure("执行试运行",error,"冻结输入和小说资料保留。请先读取本次运行结果，再明确生成新预览。",id);
    problem.recovery.savedResult="组合版本、冻结输入和小说资料保留；本次回复未确认为可用结果，也没有采用到小说中。请处理提示的问题，返回组合页生成新预览。";
    completion={failure:problem.recovery,modelSnapshot:problem.executionSnapshot??null,errorCategory:problem.category??(problem.recovery.failedStep==="核对冻结请求"?"data_integrity":problem.recovery.failedStep==="核对创作结果"?"structure_parse":"unknown")};
  }
  // Persistence failure is not a model failure. Never invoke a second time after a lost receipt.
  try {return await finishDebugRun(claim,completion);}catch(error){
    throw failure("保存试运行结果",error,"模型调用已经结束，但结果入库未确认。冻结输入与运行标识保留；请点击读取试运行结果核对，禁止直接重发这次模型请求。",id);
  }
}

export function promptCompositionRouter():Router {
  const router=Router();
  const respond=(response:Response,next:NextFunction,step:string,saved:string,work:()=>Promise<unknown>,id?:string)=>{
    void Promise.resolve().then(work).then(data=>response.json({success:true,data})).catch(error=>next(failure(step,error,saved,id)));
  };
  router.get("/catalog",(_request,response,next)=>respond(response,next,"读取组合目录","已保存组合和当前输入保留，请重新读取目录核对。",()=>getCompositionCatalog()));
  router.get("/sources/:bookId",(request,response,next)=>respond(response,next,"读取参考资料","书籍资料不会修改。请重新选择书籍并读取资料。",()=>getCompositionSources(uuid.parse(String(request.params.bookId)))));
  router.post("/recipes",(request,response,next)=>respond(response,next,"保存并启用组合","本次保存结果未确认；旧版本和当前输入保留。请先点击核对服务器结果，勿新建请求重复保存。",()=>saveComposition(request.body)));
  router.get("/recipes/by-request/:key",(request,response,next)=>respond(response,next,"核对组合保存结果","当前输入和保存凭证保留；核对失败不表示原保存失败，请恢复连接后继续核对。",()=>readCompositionSaveByRequest(key.parse(String(request.params.key)))));
  router.post("/previews",(request,response,next)=>respond(response,next,"生成请求预览","已保存组合与本次参数保留。模型请求尚未发送；先核对预览凭证，再处理输入或模型配置并重新预览。",async()=>{
    const input=previewSchema.parse(request.body) as DebugPreviewInput;
    // The store compares the complete request hash; a by-key hit alone cannot authorize a different payload.
    const loaded=await loadCompositionRecipeVersion(input.recipeId,input.recipeVersionId);
    const sources=await loadDebugTaskSources(loaded,input.parameters);
    const bundle=compileDebugBundle(loaded,input.parameters,input.variableValues,sources);
    return saveDebugPreview(bundle,input);
  }));
  router.get("/previews/by-request/:key",(request,response,next)=>respond(response,next,"核对预览结果","组合与参数保留；未找到或读取失败不证明请求未写入。请继续按原凭证核对。",()=>readDebugPreviewByRequest(key.parse(String(request.params.key)))));
  router.get("/previews/:id",(request,response,next)=>respond(response,next,"读取冻结预览","冻结预览和运行记录保留。请恢复连接后重新读取。",()=>readDebugPreview(uuid.parse(String(request.params.id)))));
  router.post("/previews/:id/run",(request,response,next)=>{
    let id:string;
    try {id=uuid.parse(String(request.params.id));runSchema.parse(request.body);}catch(error){next(failure("核对试运行请求",error,"本次模型请求尚未发送，请重新读取预览后明确点击确认试运行。"));return;}
    void trial(id,runSchema.parse(request.body)).then(data=>response.json({success:true,data})).catch(error=>next(error instanceof AiExecutionError?error:failure("提交试运行",error,"提交结果未确认。请保留冻结预览，先读取试运行结果，不重复发送模型请求。",id)));
  });
  router.get("/previews/:id/result",(request,response,next)=>respond(response,next,"读取试运行结果","读取失败不改变已保存结果。请按此预览标识继续读取，勿重复发送模型请求。",()=>readDebugResult(uuid.parse(String(request.params.id)))));
  return router;
}

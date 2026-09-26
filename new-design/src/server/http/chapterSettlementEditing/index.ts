import {Router,type NextFunction,type Response} from "express";
import {z} from "zod";
import {AiExecutionError} from "../../ai";
import {NewDesignError} from "../../domain/errors";
import {chapterSettlementAiInputSchema,readSettlementAiOriginalReceipt,getChapterSettlementAiStatus,runChapterSettlementAiExtraction,getChapterSettlementAiReceipt,getChapterSettlementAiResult,importSavedChapterSettlementAiResult,releaseSavedChapterSettlementAiResult,endExpiredUnknownChapterSettlementAiExtraction} from "../../ai/chapterSettlement";
import {
  startChapterAdoptionSession,getChapterSettlementEditingWorkspace,getChapterSettlementEditingByPreparation,createChapterSettlementEditingItem,updateChapterSettlementEditingItem,
  decideChapterSettlementEditingItems,commitChapterSettlementEditing,readChapterSettlementEditingReceipt,establishChapterSettlementEditingInitialState,
} from "../../database/chapterSettlement";
import {
  settlementSessionId,settlementRequestKey,settlementEditingCreateSchema,settlementEditingUpdateSchema,
  settlementEditingDecisionsSchema,settlementEditingCommitSchema,settlementEditingInitialSchema,settlementFieldLabels,
} from "./validation";

const defaults={runChapterSettlementAiExtraction,startChapterAdoptionSession,getChapterSettlementEditingWorkspace,getChapterSettlementEditingByPreparation,createChapterSettlementEditingItem,updateChapterSettlementEditingItem,
  decideChapterSettlementEditingItems,commitChapterSettlementEditing,readChapterSettlementEditingReceipt,establishChapterSettlementEditingInitialState};

function recoveryFailure(step:string,error:unknown,retained:string):AiExecutionError {
  if(error instanceof AiExecutionError)return error;
  const validation=error instanceof z.ZodError;
  const issues=validation?Object.fromEntries(error.issues.map(issue=>[issue.path.join(".")||"form",
    `${settlementFieldLabels[String(issue.path.at(-1))]??"本次输入"}：${/[\u4e00-\u9fff]/.test(issue.message)?issue.message:"请核对格式与允许范围。"}`])):
    error instanceof NewDesignError?error.issues:undefined;
  const result=new AiExecutionError(step,validation?"请核对标示的项目，当前输入保留。":error instanceof NewDesignError?error.message:
    "服务未确认本次结果。请保留输入，恢复连接后先核对原请求。",validation?422:error instanceof NewDesignError?error.status:503,null,issues);
  result.recovery.savedResult=validation?"本次请求未通过校验，未提交保存；已有章节内容和当前输入保留。":retained;
  result.recovery.sourceRoute="/new-design/structure/maintenance";
  result.recovery.actionLabel="打开运行维护";
  result.recovery.mutationOutcome=validation?"not_written":"unknown";
  if(error instanceof NewDesignError&&"recovery" in error&&error.recovery&&typeof error.recovery==="object"){
    const supplied=error.recovery as typeof result.recovery;
    // Only server-generated, exact source routes are accepted; never copy a route from the request body.
    if(typeof supplied.sourceRoute==="string"&&/^\/new-design\/books\/[0-9a-f-]{36}\/writing\?chapterDocument=[0-9a-f-]{36}&session=[0-9a-f-]{36}$/i.test(supplied.sourceRoute))
      Object.assign(result.recovery,supplied);
  }
  return result;
}

/** Source-workbench mutations and read-only receipts; no task-record action surface. */
export function chapterSettlementEditingRouter(dependencies:Partial<typeof defaults>={}):Router {
  const store={...defaults,...dependencies},router=Router();
  router.post("/chapter-adoption-sessions/:sessionId/editing/ai-extraction-receipt",(request,response,next)=>{void Promise.resolve().then(()=>readSettlementAiOriginalReceipt(settlementSessionId.parse(request.params.sessionId),chapterSettlementAiInputSchema.parse(request.body))).then(data=>response.json({success:true,data})).catch(next);});
  const respond=(response:Response,next:NextFunction,step:string,retained:string,run:()=>Promise<unknown>,status=200)=>{
    void Promise.resolve().then(run).then(data=>response.status(status).json({success:true,data})).catch(error=>next(recoveryFailure(step,error,retained)));
  };
  const startSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:settlementRequestKey,actor:z.string().trim().min(1).max(120).optional()}).strict();
  router.post("/chapter-adoption-preparations/:id/sessions",(request,response,next)=>respond(response,next,"采用正文并准备结果确认",
    "采用结果尚未确认；原正文、准备记录与输入保留，请查询原准备对应会话，不重复采用。",()=>store.startChapterAdoptionSession(
      settlementSessionId.parse(String(request.params.id)),startSchema.parse(request.body)),201));
  router.get("/chapter-adoption-preparations/:id/editing-session",(request,response,next)=>respond(response,next,"核对正文采用结果",
    "原采用准备与候选正文保留；查询失败不表示采用失败，请只读核对，不重复采用。",()=>store.getChapterSettlementEditingByPreparation(settlementSessionId.parse(String(request.params.id)))));
  router.get("/chapter-adoption-sessions/:id/editing-workspace",(request,response,next)=>respond(response,next,"读取章节确认清单",
    "已保存提案、采用正文与稳定结果不会因读取失败改变；当前输入保留。",()=>store.getChapterSettlementEditingWorkspace(settlementSessionId.parse(String(request.params.id)))));
  router.get("/chapter-adoption-sessions/:id/editing-receipts",(request,response,next)=>respond(response,next,"核对章节保存结果",
    "原请求凭证与当前输入保留；核对失败不证明原保存失败，请继续只读核对，不重复提交。",()=>store.readChapterSettlementEditingReceipt(
      settlementSessionId.parse(String(request.params.id)),settlementRequestKey.parse(request.query.requestKey))));
  router.post("/chapter-adoption-sessions/:id/editing-items",(request,response,next)=>respond(response,next,"保存章节变化提案",
    "保存结果尚未确认；已有清单、采用正文与当前输入保留，请按原请求核对结果。",()=>store.createChapterSettlementEditingItem(
      settlementSessionId.parse(String(request.params.id)),settlementEditingCreateSchema.parse(request.body)),201));
  router.post("/chapter-adoption-sessions/:id/editing-initial-state",(request,response,next)=>respond(response,next,"建立变化前的初始状态",
    "初始状态保存结果尚未确认；已有正文、正式状态与当前输入保留，请先核对原请求，不重复建立。",()=>store.establishChapterSettlementEditingInitialState(
      settlementSessionId.parse(String(request.params.id)),settlementEditingInitialSchema.parse(request.body)),201));
  router.put("/chapter-settlement-items/:id/editing",(request,response,next)=>respond(response,next,"保存章节变化修改",
    "修改结果尚未确认；旧提案与当前修改保留，请按原请求核对结果。",()=>store.updateChapterSettlementEditingItem(
      settlementSessionId.parse(String(request.params.id)),settlementEditingUpdateSchema.parse(request.body))));
  router.post("/chapter-adoption-sessions/:id/editing-decisions",(request,response,next)=>respond(response,next,"保存章节核对决定",
    "核对决定尚未确认；已有提案与正文保留，请先读取原请求结果。",()=>store.decideChapterSettlementEditingItems(
      settlementSessionId.parse(String(request.params.id)),settlementEditingDecisionsSchema.parse(request.body))));
  router.post("/chapter-adoption-sessions/:id/editing-settle",(request,response,next)=>respond(response,next,"确认章节稳定结果",
    "结算结果尚未确认；采用正文、确认清单与已有稳定结果保留，请核对原请求，不重复结算。",()=>store.commitChapterSettlementEditing(
      settlementSessionId.parse(String(request.params.id)),settlementEditingCommitSchema.parse(request.body))));
  const extractionSchema=chapterSettlementAiInputSchema;
  router.get("/chapter-adoption-sessions/:id/editing/ai-status",(request,response,next)=>respond(response,next,"读取正文变化提取能力",
    "正文与当前输入保留，能力读取不会发送模型请求。",async()=>{settlementSessionId.parse(String(request.params.id));return getChapterSettlementAiStatus();}));
  router.post("/chapter-adoption-sessions/:id/editing/ai-extractions",(request,response,next)=>respond(response,next,"整理正文变化提案",
    "本次运行结果尚未确认；采用正文、确认清单与原请求凭证保留，请先读取原运行结果，不再次调用模型。",()=>store.runChapterSettlementAiExtraction(
      settlementSessionId.parse(String(request.params.id)),extractionSchema.parse(request.body)),202));
  router.get("/chapter-adoption-sessions/:id/editing/ai-extractions/by-key/:key",(request,response,next)=>respond(response,next,"核对原变化提取请求",
    "读取失败不表示原模型请求未发送；原凭证与已有结果保留，请继续只读核对。",()=>getChapterSettlementAiReceipt(
      settlementSessionId.parse(String(request.params.id)),settlementRequestKey.parse(String(request.params.key)))));
  router.get("/chapter-proposal-extraction-requests/:id/editing-result",(request,response,next)=>respond(response,next,"读取正文变化提取结果",
    "模型运行与已保存结果不会因读取失败重做；请按原运行标识继续读取。",()=>getChapterSettlementAiResult(settlementSessionId.parse(String(request.params.id)))));
  router.post("/chapter-proposal-extraction-requests/:id/import-saved-result",(request,response,next)=>respond(response,next,"将已保存变化加入确认清单",
    "模型输出与采用正文保留；本次仅重新核对和保存原输出提案，不再次调用模型，保存状态待核对。",async()=>{
      const id=settlementSessionId.parse(String(request.params.id));z.object({}).strict().parse(request.body);return importSavedChapterSettlementAiResult(id);
    }));
  router.post("/chapter-proposal-extraction-requests/:id/release-saved-result",(request,response,next)=>respond(response,next,"保留旧结果并结束本次提取",
    "原模型输出、正文与执行凭证保留；结束结果尚未确认，请先读取原请求，不自动新建提取或改变正式状态。",async()=>{
      const id=settlementSessionId.parse(String(request.params.id));z.object({}).strict().parse(request.body);return releaseSavedChapterSettlementAiResult(id);
    }));
  router.post("/chapter-proposal-extraction-requests/:id/end-expired-unknown-run",(request,response,next)=>respond(response,next,"结束过期且结果未知的提取",
    "原冻结输入、执行记录与未知用量保留；结束回执待核对，不会自动再次生成或修改正式状态。",async()=>{
      const id=settlementSessionId.parse(String(request.params.id));z.object({}).strict().parse(request.body);return endExpiredUnknownChapterSettlementAiExtraction(id);
    }));
  const legacyGuard=(response:Response,next:NextFunction)=>respond(response,next,"核对章节操作入口",
    "本次旧入口请求没有提交；采用正文、已有提案及当前输入保留。请在原章节打开结果确认，通过正式字段表单操作。",async()=>{
      const error=new AiExecutionError("核对章节操作入口","请从章节创作的结果确认表单保存、核对与结算；此入口不能绕过正式字段和原请求核对。",409);
      error.recovery.mutationOutcome="not_written";
      error.recovery.savedResult="本次请求未提交；采用正文、已有提案及当前输入保留。";
      throw error;
    });
  router.post(["/chapter-adoption-sessions/:id/items","/chapter-adoption-sessions/:id/decisions","/chapter-adoption-sessions/:id/settle",
    "/books/:id/chapter-settlements"],(_request,response,next)=>legacyGuard(response,next));
  router.put("/chapter-settlement-items/:id",(_request,response,next)=>legacyGuard(response,next));
  const unregisteredExtraction=(response:Response,next:NextFunction)=>respond(response,next,"准备正文变化提取",
    "本次模型请求未发送，采用正文、已有确认清单与当前输入保留。可在原章节手工补充正式字段变化。",async()=>{
      const error=new AiExecutionError("准备正文变化提取","请从本章结果确认使用正文变化整理；此入口不能提交任意模型结果。",503);
      error.recovery.mutationOutcome="not_written";
      error.recovery.savedResult="本次模型请求未发送；采用正文、已有清单和当前输入保留。";
      throw error;
    });
  router.post(["/chapter-adoption-sessions/:id/extraction-requests","/chapter-proposal-extraction-requests/:id/result"],
    (_request,response,next)=>unregisteredExtraction(response,next));
  return router;
}

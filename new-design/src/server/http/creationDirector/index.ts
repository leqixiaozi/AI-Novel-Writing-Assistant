import type {Router,NextFunction,Response} from "express";
import type {NewDesignAiGateway} from "../../ai/gateway";
import {directorCommandSchema,directorControlSchema,executeCreationDirector,controlCreationDirector,getCreationDirectorControlReceipt,getCreationDirectorCommandReceipt} from "../../application/creationDirector";
import {createBookCreationSession,getBookCreationSession,getBookCreationSessionByRequest,saveBookCreationReview,completeBookCreation,
  getBookCreationProductionWorkspace,saveBookCreationFormalReview,readBookCreationProductionReceipt,saveFormalReviewInputSchema} from "../../database/bookCreationStore";
import {bookCreationSessionInputSchema,bookCreationReviewSchema,completeBookCreationSchema} from "../../domain/validation";
import {AiExecutionError} from "../../ai";
import {creationFailure,creationSessionId,creationRequestKey,creationSource} from "./recovery";
import {mountCreationPreparation} from "./preparation";

const defaults={createBookCreationSession,getBookCreationSession,getBookCreationSessionByRequest,saveBookCreationReview,completeBookCreation,
  getBookCreationProductionWorkspace,saveBookCreationFormalReview,readBookCreationProductionReceipt,controlCreationDirector,executeCreationDirector,getCreationDirectorControlReceipt,getCreationDirectorCommandReceipt};
const createInput=bookCreationSessionInputSchema.safeExtend({requestKey:creationRequestKey}).strict();
const reviewInput=bookCreationReviewSchema.safeExtend({requestKey:creationRequestKey}).strict();
const completeInput=completeBookCreationSchema.extend({requestKey:creationRequestKey}).strict();

/** Source actions and original-key GETs; no task-record workflow controls. */
export function mountCreationDirector(router:Router,ai?:NewDesignAiGateway,dependencies:Partial<typeof defaults>={}){
  mountCreationPreparation(router);
  const store={...defaults,...dependencies};
  const respond=(id:string|undefined,res:Response,next:NextFunction,step:string,retained:string,run:()=>Promise<unknown>,status=200)=>{
    void Promise.resolve().then(run).then(data=>res.status(status).json({success:true,data})).catch(error=>next(creationFailure(id,step,error,retained)));
  };
  router.post("/book-creation/sessions",(req,res,next)=>respond(undefined,res,next,"保存开书起点","开书起点保存回执未知；当前输入保留，请按原请求核对会话，不重复开始新书。",()=>store.createBookCreationSession(createInput.parse(req.body)),201));
  router.get("/book-creation/sessions/by-request/:key",(req,res,next)=>respond(undefined,res,next,"核对开书起点保存结果","原输入和凭证保留；空查询不能证明原请求没有保存，请继续只读核对。",()=>store.getBookCreationSessionByRequest(creationRequestKey.parse(String(req.params.key)))));
  router.get("/book-creation/sessions/:id",(req,res,next)=>respond(String(req.params.id),res,next,"读取开书表单","已保存起点、资料、阶段和正式创建结果保留；读取失败不启动模型或创建书籍。",()=>store.getBookCreationSession(creationSessionId.parse(String(req.params.id)))));
  router.patch("/book-creation/sessions/:id/review",(req,res,next)=>respond(String(req.params.id),res,next,"保存开书资料表单","当前填写、已保存资料和原请求凭证保留；保存结果未知时先核对，不覆盖人工草稿。",()=>store.saveBookCreationReview(creationSessionId.parse(String(req.params.id)),reviewInput.parse(req.body))));
  router.post("/book-creation/sessions/:id/complete",(req,res,next)=>respond(String(req.params.id),res,next,"确认开书并保存正式关系与规划","开书结果待核对；资料、关系和规划草稿保留，请核对原请求及书籍结果，不重新生成或重复开书。",()=>store.completeBookCreation(creationSessionId.parse(String(req.params.id)),completeInput.parse(req.body))));
  router.get("/book-creation/sessions/:id/write-receipts",(req,res,next)=>respond(String(req.params.id),res,next,"核对开书保存回执","原凭证和草稿保留；查询失败或空结果不证明未执行，仅核对不重复保存。",()=>store.readBookCreationProductionReceipt(creationSessionId.parse(String(req.params.id)),creationRequestKey.parse(req.query.requestKey))));
  router.get("/book-creation/sessions/:id/production-workspace",(req,res,next)=>respond(String(req.params.id),res,next,"读取正式关系与规划规格","原开书资料、关系和规划草稿保留；不会用未知规格代替正式合同。",()=>store.getBookCreationProductionWorkspace(creationSessionId.parse(String(req.params.id)))));
  router.patch("/book-creation/sessions/:id/formal-review",(req,res,next)=>respond(String(req.params.id),res,next,"保存关系与规划审阅","关系、规划与原资料草稿保留；结果未知时核对原请求，不自动采用或发布。",()=>store.saveBookCreationFormalReview(creationSessionId.parse(String(req.params.id)),saveFormalReviewInputSchema.parse(req.body))));
  router.patch("/book-creation/sessions/:id/director",(req,res,next)=>respond(String(req.params.id),res,next,"保存开书阶段与准备方式","已保存阶段、当前草稿和原请求保留；模式或接管结果未知时先核对，不重复生成。",async()=>(await store.controlCreationDirector(creationSessionId.parse(String(req.params.id)),directorControlSchema.parse(req.body))).session));
  router.get("/book-creation/sessions/:id/director/commands/by-key/:key",(req,res,next)=>respond(String(req.params.id),res,next,"核对阶段控制原请求","已保存阶段和原凭证保留；空查询不证明未执行，不自动切换或接管。",()=>store.getCreationDirectorControlReceipt(creationSessionId.parse(String(req.params.id)),creationRequestKey.parse(String(req.params.key)))));
  router.get("/book-creation/sessions/:id/director/prepare/by-key/:key",(req,res,next)=>respond(String(req.params.id),res,next,"核对阶段准备原请求","各阶段保存结果和原凭证保留；有候选则继续审阅，不重新调用模型。",()=>store.getCreationDirectorCommandReceipt(creationSessionId.parse(String(req.params.id)),creationRequestKey.parse(String(req.params.key)))));
  router.post("/book-creation/sessions/:id/director/prepare",(req,res,next)=>respond(String(req.params.id),res,next,"准备开书阶段资料","已保存阶段、资料和原请求保留；模型或保存结果未知时只读核对，不重新生成。",()=>store.executeCreationDirector(creationSessionId.parse(String(req.params.id)),directorCommandSchema.parse(req.body),ai)));
  for(const suffix of ["directions","initial-content","select-direction"]){
    router.post(`/book-creation/sessions/:id/${suffix}`,(req,_res,next)=>{
      const failure=new AiExecutionError("打开共用开书准备","请在开书表单选择准备方式，使用当前阶段操作；已有方向和资料保留。",409);
      Object.assign(failure.recovery,{sourceRoute:creationSource(String(req.params.id)),actionLabel:"返回开书表单",savedResult:"此入口没有提交模型请求、修改方向或创建书籍；原结果和当前输入保留。",mutationOutcome:"not_written"});next(failure);
    });
  }
}

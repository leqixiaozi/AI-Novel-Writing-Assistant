import {Router,type Response,type NextFunction} from "express";
import {z} from "zod";
import {AiExecutionError} from "../../ai";
import {NewDesignError} from "../../domain/errors";
import {
  getSettlementRelationConfigurationWorkspace,saveSettlementRelationConfigurationDraft,
  publishSettlementRelationConfigurationDraft,readSettlementRelationConfigurationReceipt,
  settlementRelationDraftInputSchema,settlementRelationPublishInputSchema,
} from "../../database/chapterSettlement";

const bookIdSchema=z.string().uuid();
const requestKeySchema=z.string().trim().min(8).max(160);
const labels:Record<string,string>={name:"关系名称",description:"关系说明",direction:"关系方向",sourceTypeKeys:"来源内容类型",targetTypeKeys:"目标内容类型",sourceMax:"来源关系数量",targetMax:"目标关系数量",fields:"关系字段",fieldKey:"结算字段",label:"字段显示名称",type:"字段类型",capability:"章节结算能力",mode:"状态记录方式",dimensions:"结算维度",policy:"结算规则",confirmPublish:"发布确认",confirmInstanceRebind:"应用到本书关系的确认",rebindRelations:"本书关系范围",createRelations:"新关系范围",expectedRevision:"草稿版本",expectedRelationTypeRevision:"正式关系版本",requestKey:"原请求凭证"};
const defaults={getSettlementRelationConfigurationWorkspace,saveSettlementRelationConfigurationDraft,publishSettlementRelationConfigurationDraft,readSettlementRelationConfigurationReceipt};

export function settlementRelationConfigurationRouter(dependencies:Partial<typeof defaults>={}):Router {
  const router=Router(),store={...defaults,...dependencies};
  const respond=(response:Response,next:NextFunction,rawBook:unknown,step:string,read:boolean,run:()=>Promise<unknown>)=>{
    void Promise.resolve().then(run).then(data=>response.json({success:true,data})).catch(error=>{
      if(error instanceof AiExecutionError){next(error);return;}
      const validation=error instanceof z.ZodError,book=bookIdSchema.safeParse(rawBook);
      const issues=validation?Object.fromEntries(error.issues.map(issue=>[issue.path.join(".")||"form",`${labels[String(issue.path.at(-1))]??"关系配置"}：请核对格式、选择范围与发布确认。`])):error instanceof NewDesignError?error.issues:undefined;
      const failure=new AiExecutionError(step,validation?"请核对标示的关系配置；当前草稿保留。":error instanceof NewDesignError?error.message:"服务未确认本次结果，请保留草稿并核对原请求。",validation?422:error instanceof NewDesignError?error.status:503,null,issues);
      failure.recovery.sourceRoute=book.success?`/new-design/structure/dictionaries-relations?view=relations&book=${book.data}`:"/new-design/structure/maintenance";
      failure.recovery.actionLabel=book.success?"打开关系配置":"打开运行维护";
      failure.recovery.savedResult=validation?"本次请求未提交；关系草稿、已有正式关系与章节输入保留。":read?"读取失败不改变原草稿、正式关系或发布结果；请只读重新核对。":"关系草稿与原请求凭证保留；保存或发布回执尚未确认，先核对原请求，不重复发布。";
      failure.recovery.mutationOutcome=validation?"not_written":"unknown";
      if(error instanceof NewDesignError&&"recovery" in error&&error.recovery&&typeof error.recovery==="object"){
        const supplied=error.recovery as typeof failure.recovery;
        if(book.success&&supplied.sourceRoute===`/new-design/structure/dictionaries-relations?view=relations&book=${book.data}`)Object.assign(failure.recovery,supplied);
      }
      next(failure);
    });
  };
  const path="/books/:bookId/settlement-relation-configuration";
  router.get(path,(request,response,next)=>respond(response,next,request.params.bookId,"读取本书关系配置",true,
    ()=>store.getSettlementRelationConfigurationWorkspace(bookIdSchema.parse(String(request.params.bookId)))));
  router.post(`${path}/drafts`,(request,response,next)=>respond(response,next,request.params.bookId,"保存关系配置草稿",false,
    ()=>store.saveSettlementRelationConfigurationDraft(bookIdSchema.parse(String(request.params.bookId)),settlementRelationDraftInputSchema.parse(request.body))));
  router.post(`${path}/publish`,(request,response,next)=>respond(response,next,request.params.bookId,"发布本书关系配置",false,
    ()=>store.publishSettlementRelationConfigurationDraft(bookIdSchema.parse(String(request.params.bookId)),settlementRelationPublishInputSchema.parse(request.body))));
  router.get(`${path}/receipts`,(request,response,next)=>respond(response,next,request.params.bookId,"核对关系配置原请求",true,
    ()=>store.readSettlementRelationConfigurationReceipt(bookIdSchema.parse(String(request.params.bookId)),requestKeySchema.parse(request.query.requestKey))));
  const legacyGuard=(_request:unknown,_response:Response,next:NextFunction)=>{
    const failure=new AiExecutionError("核对关系配置入口","请选择本书关系配置，保存草稿并明确发布；此入口不能直接修改正式关系字段或结算能力。",409);
    Object.assign(failure.recovery,{mutationOutcome:"not_written",savedResult:"本次请求未提交；已有正式关系、状态与当前输入保留。",sourceRoute:"/new-design/structure/dictionaries-relations?view=relations",actionLabel:"打开关系配置"});next(failure);
  };
  router.post("/relation-types",legacyGuard);
  router.patch("/relation-types/:id",legacyGuard);
  router.put("/spaces/:id/state-capabilities/relations",legacyGuard);
  return router;
}

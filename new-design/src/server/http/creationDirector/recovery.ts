import {z} from "zod";
import {AiExecutionError} from "../../ai";
import {NewDesignError} from "../../domain/errors";
import type {AiRuntimeRecovery} from "../../../common/aiRuntime";

export const creationSessionId=z.string().uuid();
export const creationRequestKey=z.string().trim().min(8).max(160);
const UUID="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const sourcePattern=new RegExp(`^/new-design/books/new(?:\\?session=${UUID})?$`,"i");
const allowedRoute=(value:unknown):value is string=>typeof value==="string"&&(sourcePattern.test(value)||value==="/new-design/structure/models"||value==="/new-design/structure/maintenance");
export function creationSource(id?:string):string{return id&&creationSessionId.safeParse(id).success?`/new-design/books/new?session=${id}`:"/new-design/books/new";}
const labels:Record<string,string>={bookName:"书名",description:"作品说明",templateVersionId:"开书模板",requestKey:"原请求凭证",idempotencyKey:"原请求凭证",revision:"表单版本",expectedRevision:"表单版本",expectedSessionRevision:"表单版本",reviewCards:"待审阅资料",title:"资料名称",values:"资料内容",relations:"资料关系",plans:"故事规划",decision:"采用决定",directionId:"创作方向",mode:"准备方式",cursor:"准备阶段"};

/** No inference from message text, HTTP status or an empty receipt to a write outcome. */
export function creationFailure(id:string|undefined,step:string,error:unknown,retained:string):AiExecutionError{
  if(error instanceof AiExecutionError){if(!allowedRoute(error.recovery.sourceRoute)){error.recovery.sourceRoute=creationSource(id);error.recovery.actionLabel="返回开书表单";}return error;}
  const invalid=error instanceof z.ZodError;
  const issues=invalid?Object.fromEntries(error.issues.map(issue=>[issue.path.join(".")||"form",`${labels[String(issue.path.at(-1))]??"本次输入"}：${/[\u4e00-\u9fff]/.test(issue.message)?issue.message:"请核对格式和允许范围。"}`])):error instanceof NewDesignError?error.issues:undefined;
  const result=new AiExecutionError(step,invalid?"请修改标识的内容，当前输入保留。":error instanceof NewDesignError?error.message:"本次结果尚未确认，请保留输入，恢复连接后只读核对原请求。",invalid?422:error instanceof NewDesignError?error.status:503,null,issues);
  Object.assign(result.recovery,{sourceRoute:creationSource(id),actionLabel:"返回开书表单",savedResult:invalid?"本次输入未通过校验，未提交保存；原开书起点、草稿和已确认结果保留。":retained,mutationOutcome:invalid?"not_written":"unknown"});
  if(error instanceof NewDesignError&&"recovery"in error&&error.recovery&&typeof error.recovery==="object"){
    const supplied=error.recovery as Partial<AiRuntimeRecovery>;
    if(allowedRoute(supplied.sourceRoute)&&typeof supplied.failedStep==="string"&&typeof supplied.summary==="string"&&typeof supplied.savedResult==="string"&&typeof supplied.actionLabel==="string"&&["not_written","unknown","committed"].includes(supplied.mutationOutcome??""))Object.assign(result.recovery,supplied);
    // Preparation failures use a typed source object; adapt only a server-controlled, allowlisted route.
    const preparation=error.recovery as {source?:{kind?:string;route?:unknown;label?:unknown};nextAction?:unknown;savedResult?:unknown;failedStep?:unknown;summary?:unknown;mutationOutcome?:unknown};
    if(preparation.source?.kind==="book_creation"&&allowedRoute(preparation.source.route)&&typeof preparation.source.label==="string"&&typeof preparation.nextAction==="string"&&typeof preparation.savedResult==="string"&&typeof preparation.failedStep==="string"&&typeof preparation.summary==="string"&&["not_written","unknown","committed"].includes(String(preparation.mutationOutcome))){
      Object.assign(result.recovery,{sourceRoute:preparation.source.route,actionLabel:preparation.source.label,failedStep:preparation.failedStep,summary:preparation.summary,savedResult:`${preparation.savedResult} ${preparation.nextAction}`,mutationOutcome:preparation.mutationOutcome});
    }
  }
  return result;
}

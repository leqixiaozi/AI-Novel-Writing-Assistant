import {z} from "zod";
import type {AiUsageSummary} from "../contracts";
import {isAuthorTaskSourceRoute,type AuthorTaskRecord} from "../authorTasks";
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const summarySchema=z.object({taskCount:integer,attemptCount:integer,totalAttemptCount:integer,unrecordedAttemptCount:integer,unknownCostAttemptCount:integer,inputTokens:integer.nullable(),outputTokens:integer.nullable(),cachedInputTokens:integer.nullable(),durationMs:integer.nullable(),estimatedCost:z.number().finite().nonnegative().nullable(),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),fallbackCount:integer,unknownUsageCount:integer}).strict().superRefine((value,ctx)=>{if(value.attemptCount+value.unrecordedAttemptCount!==value.totalAttemptCount||value.unknownUsageCount>value.attemptCount||value.unknownCostAttemptCount>value.totalAttemptCount)ctx.addIssue({code:"custom",message:"原尝试与用量账本数量不一致"});});
export interface AuthorUsageScope {filter:{bookId?:string;taskId?:string};label:string;sourceRoute:string;sourceLabel:string;}
export function authorUsageScope(record:AuthorTaskRecord):AuthorUsageScope|null {
 if(!isAuthorTaskSourceRoute(record.source.route))return null;
 const book=record.bookId===null?null:z.string().uuid().safeParse(record.bookId);if(book!==null&&!book.success)return null;
 if(record.kind==="ai_task"){const task=z.string().uuid().safeParse(record.id.startsWith("ai_task:")?record.id.slice(8):"");if(!task.success)return null;return {filter:{...(book?.success?{bookId:book.data}:{}),taskId:task.data},label:"此原任务的全部已登记尝试",sourceRoute:record.source.route,sourceLabel:record.source.label};}
 if(!book?.success)return null;return {filter:{bookId:book.data},label:"本书全部已登记 AI 尝试（不是此单条记录或导演范围的单独用量）",sourceRoute:record.source.route,sourceLabel:record.source.label};
}
export interface AuthorUsagePresentation {rows:Array<{label:string;value:string}>;usageNotice:string;costNotice:string;}
const known=(value:number|null)=>value===null?"尚无已确认数值":value.toLocaleString("zh-CN");
/** Public read projection only. Configurations, estimates and missing receipts never imply actual invocation. */
export function presentAuthorUsageSummary(raw:AiUsageSummary):AuthorUsagePresentation {
 const parsed=summarySchema.safeParse(raw);if(!parsed.success)throw new Error("原用量摘要未完整读取，保留原运行凭证；请刷新核对，不重复生成。");const value=parsed.data;
 const unknownCount=value.unknownUsageCount+value.unrecordedAttemptCount;
 const cost=value.estimatedCost===null||value.currency===null?"尚无可合并的费用估算":`${value.estimatedCost.toLocaleString("zh-CN",{maximumFractionDigits:8})} ${value.currency}`;
 return {rows:[{label:"原任务数量",value:known(value.taskCount)},{label:"已登记的原尝试",value:known(value.totalAttemptCount)},{label:"已有用量账本的尝试",value:known(value.attemptCount)},{label:"已记录但输入／输出用量不完整",value:known(value.unknownUsageCount)},{label:"尚无用量账本的原尝试",value:known(value.unrecordedAttemptCount)},{label:"已知输入用量（Token）",value:known(value.inputTokens)},{label:"已知输出用量（Token）",value:known(value.outputTokens)},{label:"已知缓存输入用量（Token）",value:known(value.cachedInputTokens)},{label:"已知执行时长（毫秒）",value:known(value.durationMs)},{label:"已记录备用调用次数",value:known(value.fallbackCount)},{label:"已记录费用估算（非计费账单）",value:cost},{label:"尚无完整费用记录的原尝试",value:known(value.unknownCostAttemptCount)}],
 usageNotice:unknownCount>0?`${unknownCount.toLocaleString("zh-CN")} 个原尝试尚无完整用量证明；已知输入／输出只是已保存部分，不是全部实际用量，也不证明其它尝试未发送。`:value.totalAttemptCount===0?"此范围尚无已登记的原尝试；空摘要不证明模型没有调用，仍须在原来源按凭证核对。":"这些数值仅来自已保存原尝试账本，不是模型配置上限或预算估计；配置生效不等于真实模型调用已验收。",
 costNotice:value.unknownCostAttemptCount>0||value.estimatedCost===null||value.currency===null?"费用记录、价格或币种尚不完整，不能推断总费用，更不以零元表示未知；只展示已有同币种费用估算。":"仅显示已有同币种费用估算，不重新查询价格或推测计费；实际费用以服务方账单为准。"};
}

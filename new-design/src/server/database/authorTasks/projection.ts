import {AUTHOR_TASK_DOMAIN_LABELS,AUTHOR_TASK_STATUS_LABELS,isAuthorTaskSourceRoute,type AuthorTaskDomain,type AuthorTaskKind,type AuthorTaskRecord,type AuthorTaskStatus,type AuthorTaskTag} from "../../../common/authorTasks";

export interface AuthorTaskRow {kind:AuthorTaskKind;id:string;domain:AuthorTaskDomain;book_id:string|null;book_name:string|null;status:string;title:string|null;updated_at:Date|string;cursor_at?:string;route:string;progress:number|null;meta:Record<string,unknown>;}
const STATUS_GROUPS:Record<AuthorTaskStatus,string[]>={
 unknown:["unknown","ended_unknown"],attention:["failed","unavailable","dead_letter","impact_review_required","stale"],warning:["warning","partial"],
 pending:["queued","preparing","draft"],running:["running","generating","creating","settling","leased","retry_scheduled","cancel_requested"],
 review:["review","waiting_direction","waiting_approval","paused","reviewing","adopted_pending_proposals","pending_review","partially_confirmed"],
 completed:["succeeded","completed","applied","adopted","stable"],ended:["cancelled","discarded","released","archived"],
};
const AI_KINDS=["ai_task","creation_batch","planning_run","production_director","writing_request","settlement_extraction"];
const quoted=(values:string[])=>values.map(value=>`'${value}'`).join(",");
/** SQL and presentation consume the same fixed state groups; these are not AI routing rules. */
const DIRECTOR_STATUS_SQL=`WHEN kind='production_director' THEN CASE WHEN status='cancelled' THEN 'ended' WHEN status='failed' AND COALESCE((meta->>'endedUnknownCount')::integer,0)>0 THEN 'unknown' WHEN status='failed' THEN 'attention' WHEN status IN ('running','waiting_recovery') AND COALESCE((meta->>'unknownRequestCount')::integer,0)>0 THEN 'unknown' WHEN status='waiting_recovery' OR status='running' AND meta->>'leaseExpired'='true' THEN CASE WHEN COALESCE((meta->>'replyPendingCount')::integer,0)>0 OR COALESCE((meta->>'ledgerPendingCount')::integer,0)>0 OR COALESCE((meta->>'boundaryPendingCount')::integer,0)>0 THEN 'review' ELSE 'unknown' END WHEN status='ready' THEN 'pending' WHEN status='paused' THEN 'review' WHEN status='completed' THEN 'completed' WHEN status='running' THEN 'running' ELSE 'unknown' END`;
export const AUTHOR_TASK_STATUS_SQL=`CASE ${DIRECTOR_STATUS_SQL} WHEN kind='writing_request' AND status IN ('queued','running') AND (meta->>'ledgerPending'='true' OR meta->>'modelReplySaved'='true' AND meta->>'candidateSaved'='false') THEN 'review' WHEN meta->>'superseded'='true' THEN 'ended' WHEN status='ended_unknown' THEN 'unknown' WHEN status='released' THEN 'ended' WHEN status='running' AND meta->>'leaseExpired'='true' THEN CASE WHEN meta->>'saved'='true' THEN 'review' ELSE 'unknown' END WHEN meta->>'failure'='true' THEN 'attention' WHEN meta->>'activeCommand'='true' THEN 'running' WHEN domain='quality' THEN CASE WHEN status='completed' THEN 'completed' ELSE 'warning' END ${Object.entries(STATUS_GROUPS).map(([status,native])=>`WHEN status IN (${quoted(native)}) THEN '${status}'`).join(" ")} ELSE 'unknown' END`;
export const AUTHOR_TASK_TAG_SQL=`array_remove(ARRAY[CASE WHEN kind IN (${quoted(AI_KINDS)}) THEN 'ai' END,CASE WHEN meta->>'manual'='true' THEN 'manual' END,CASE WHEN projected_status='review' THEN 'review' END,CASE WHEN meta->>'saved'='true' THEN 'saved' END,CASE WHEN COALESCE((meta->>'warningCount')::integer,0)>0 THEN 'warning' END,CASE WHEN projected_status='attention' THEN 'failure' END,CASE WHEN projected_status='unknown' OR meta->>'endedUnknown'='true' OR COALESCE((meta->>'endedUnknownCount')::integer,0)>0 THEN 'unknown' END,CASE WHEN meta->>'qualityDebt'='true' THEN 'quality_debt' END],NULL)`;
const STAGE_LABELS:Record<string,string>={collect_input:"填写开书起点",direction:"准备故事方向",directions:"准备故事方向",project:"准备作品目标",world:"准备世界设定",characters:"准备人物与势力",skeleton:"准备故事骨架",initial_content:"准备开书资料",form_assist:"补充表单内容",review:"审阅候选",creating:"确认开书"};
Object.assign(STAGE_LABELS,{director_direction:"准备故事方向",director_project:"准备作品目标",director_world:"准备世界设定",director_characters:"准备人物与势力",director_skeleton:"准备故事骨架",review_initial_content:"审阅开书表单"});
STAGE_LABELS.production_director="全书导演生成章候选与确认章边界";
const count=(meta:Record<string,unknown>,key:string)=>typeof meta[key]==="number"&&Number.isSafeInteger(meta[key])&&Number(meta[key])>=0&&Number(meta[key])<=1000000?Number(meta[key]):0;
function directorStatus(row:AuthorTaskRow):AuthorTaskStatus{if(row.status==="cancelled")return "ended";if(row.status==="failed")return count(row.meta,"endedUnknownCount")>0?"unknown":"attention";if(["running","waiting_recovery"].includes(row.status)&&count(row.meta,"unknownRequestCount")>0)return "unknown";if(row.status==="waiting_recovery"||row.status==="running"&&row.meta.leaseExpired===true)return count(row.meta,"replyPendingCount")>0||count(row.meta,"ledgerPendingCount")>0||count(row.meta,"boundaryPendingCount")>0?"review":"unknown";return row.status==="ready"?"pending":row.status==="paused"?"review":row.status==="completed"?"completed":row.status==="running"?"running":"unknown";}
function projectedStatus(row:AuthorTaskRow):AuthorTaskStatus {
  if(row.kind==="production_director")return directorStatus(row);
  if(row.kind==="writing_request"&&["queued","running"].includes(row.status)&&(row.meta.ledgerPending===true||row.meta.modelReplySaved===true&&row.meta.candidateSaved===false))return "review";
  if(row.meta.superseded===true)return "ended";
  if(row.status==="ended_unknown")return "unknown";
  if(row.status==="released")return "ended";
  if(row.status==="running"&&row.meta.leaseExpired===true)return row.meta.saved===true?"review":"unknown";
  if(row.meta.failure===true)return "attention";
  if(row.meta.activeCommand===true)return "running";
  if(row.domain==="quality")return row.status==="completed"?"completed":"warning";
  return (Object.entries(STATUS_GROUPS).find(([,native])=>native.includes(row.status))?.[0]??"unknown") as AuthorTaskStatus;
}
/** Only structural state and public identifiers are consumed. Raw error/output is excluded by SQL. */
export function projectAuthorTask(row:AuthorTaskRow):AuthorTaskRecord {
  const status=projectedStatus(row),saved=row.meta.saved===true,unknown=status==="unknown",review=status==="review",endedUnknown=row.meta.endedUnknown===true||count(row.meta,"endedUnknownCount")>0;
  const domainLabel=AUTHOR_TASK_DOMAIN_LABELS[row.domain];
  const failedStep=status==="attention"?row.kind==="production_director"&&typeof row.meta.failedChapterTitle==="string"?`生成“${row.meta.failedChapterTitle.slice(0,240)}”的原候选与运行回执`:STAGE_LABELS[String(row.meta.stage)]??`${domainLabel}结果确认`:null;
  const proofs:AuthorTaskRecord["proofs"]=[{label:"来源记录",id:row.id}];
  const resultLabel:Partial<Record<AuthorTaskKind,string>>={research_version:"研究运行版本",settlement_extraction:"输入正文版本",settlement_session:"确认正文版本",research_adoption:"研究来源版本",export_request:"冻结导出清单",completion_check:"完本检查快照",quality_issue:"问题描述版本"};
  for(const [key,label] of [["resultId",resultLabel[row.kind]??"保存版本"],["artifactId","导出文件回执"],["settlementId","结算回执"],["baseline","输入正文版本"],["sessionId","开书会话"],["recordId","研究记录"]]){
    if(typeof row.meta[key]==="string")proofs.push({label,id:String(row.meta[key])});
  }
  let route=row.route,exact=row.meta.exact!==false;
  if(!isAuthorTaskSourceRoute(route)){route="/new-design/structure/maintenance";exact=false;}
  const retainedResult=row.kind==="production_director"?typeof row.meta.targetCount==="number"?`原冻结范围 ${count(row.meta,"targetCount")} 章、已保存 ${count(row.meta,"candidateCount")} 个原章候选、${count(row.meta,"modelReplyCount")} 个原模型回复保留；${count(row.meta,"ledgerPendingCount")} 个候选运行回执待完成，${count(row.meta,"boundaryPendingCount")} 个原章边界待确认，${count(row.meta,"warningCount")} 条结构化警告。进度只表示候选保存，不表示已采用、已结算或全书完成。`:"原导演范围、原请求与候选保存凭证保留；具体数量尚未读取，不推断已采用或全书完成。"
    :row.kind==="writing_request"&&row.meta.endedUnknown===true?"原过期运行已明确结束；原冻结输入和请求凭证保留，模型是否返回结果及实际用量仍未知，不能认定未发送或已成功。"
    :row.kind==="writing_request"&&row.meta.modelReplySaved===true&&!row.meta.candidateSaved?"原模型回复已保存；候选正文入库尚无保存证明。输入版本和人工正文保留，先核对并恢复原回复，不重新生成。"
    :row.kind==="writing_request"&&row.meta.ledgerPending===true?"原章候选已保存，运行回执待完成；候选版本与人工正文保留，不重复生成。"
    :row.kind==="export_request"?row.meta.artifactId?"导出文件回执、冻结导出清单与正文版本保留。":"冻结导出清单与正文版本保留；文件完成回执待核对。"
    :row.kind==="settlement_session"?"采用确认会话、对应正文版本与已保存结算结果保留。"
    :row.kind==="creation_session"?"开书起点与审阅草稿保留；候选采用及正式开书回执须在来源页核对。"
    :row.kind==="quality_issue"?"问题记录、检测来源与已有正文保留；质量债不代表整书运行失败。"
    :saved?"来源记录含保存结果；请在来源页核对候选、版本和采用回执。":"未读取到本次结果保存证明；已有人工资料和输入版本保留，不据此推断模型未发送。";
  const recoveryGuidance=row.kind==="production_director"?endedUnknown?"返回此原导演范围核对已结束的原请求；结束只释放原运行占用，未知结果与用量仍保留。是否另行准备只能在来源页明确决定，记录中心不执行。":unknown?"返回此原导演范围，按原请求凭证只读核对在途章；已有其它章候选不证明当前章调用已完成，禁止在记录中心重试。":status==="attention"?"返回原导演范围查看具体失败章、原请求及已保存回复；优先恢复原候选／运行回执，是否重新准备须在来源页明确决定。":review?"返回原导演范围审阅章边界、原候选和警告；有原回复时先完成保存／运行回执，不在记录中心继续执行。":"打开原导演范围仅查看当前章节及原候选；警告不会在记录中心升级成整书失败。"
    :row.kind==="writing_request"&&row.meta.endedUnknown===true?"返回原章节来源只读核对已结束的原请求；未知结果及用量不会因结束而变成成功或未发送，不在记录中心重发。"
    :row.kind==="writing_request"&&(row.meta.modelReplySaved===true&&!row.meta.candidateSaved||row.meta.ledgerPending===true)?"返回原章节来源，用原请求核对已保存回复并完成原候选／运行回执；不换新凭证或重发模型。"
    :unknown?"返回来源页，用原请求凭证只读核对；未确认结果前不要重复生成。"
    :row.meta.superseded===true?"此批次被后续累计候选引用；返回原开书表单查看完整阶段历史。"
    :row.kind==="quality_issue"?"返回正文或规划来源查看问题范围，在对应工作台处理；质量债仅作章节跟进。"
    :status==="attention"?"返回来源页查看具体失败字段、保存回执与可用恢复入口；有旧输出时优先恢复原结果。"
    :review?"返回来源页审阅候选及影响范围，由作者明确采用或保留。":"返回来源页查看创作上下文和保存结果。";
  const tags:AuthorTaskTag[]=[];
  if(AI_KINDS.includes(row.kind))tags.push("ai");
  if(row.meta.manual===true)tags.push("manual");
  if(review)tags.push("review");if(saved)tags.push("saved");if(count(row.meta,"warningCount")>0)tags.push("warning");if(status==="attention")tags.push("failure");if(unknown||endedUnknown)tags.push("unknown");if(row.meta.qualityDebt===true)tags.push("quality_debt");
  return {id:`${row.kind}:${row.id}`,kind:row.kind,domain:row.domain,status,statusLabel:AUTHOR_TASK_STATUS_LABELS[status],
    title:row.title||domainLabel,bookId:row.book_id,bookName:row.book_name,tags,updatedAt:new Date(row.updated_at).toISOString(),
    source:{route,label:row.kind==="production_director"?"查看此原全书导演范围":`打开${domainLabel}来源`,exact},retainedResult:retainedResult+(row.kind==="production_director"&&endedUnknown?` ${count(row.meta,"endedUnknownCount")} 个原过期运行已结束，但模型结果及用量仍未知。`:"")+(row.kind==="writing_request"&&count(row.meta,"warningCount")>0?` 原回复含 ${count(row.meta,"warningCount")} 条警告，内容在原章节来源查看，不等同整书失败。`:""),failedStep,recoveryGuidance,
    consequence:"打开来源页仅导航，不重发模型请求、不采用候选、不取消任务。恢复或采用须在来源页核对范围后明确操作。",
    progress:typeof row.progress==="number"?Math.min(100,Math.max(0,row.progress)):null,
    requestKey:typeof row.meta.requestKey==="string"?row.meta.requestKey.slice(0,240):null,proofs};
}

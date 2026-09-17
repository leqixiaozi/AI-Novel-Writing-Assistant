import {z} from 'zod';
import {AUTHOR_TASK_DOMAINS,AUTHOR_TASK_STATUSES,AUTHOR_TASK_TAGS,AUTHOR_TASK_KINDS,isAuthorTaskSourceRoute,type AuthorTaskPage,type AuthorTaskRecord} from '../authorTasks';
export const DIRECTOR_FOLLOWUP_ROUTE='/new-design/operations/director';
export const directorFollowupFilterSchema=z.object({bookId:z.string().uuid().optional(),domain:z.enum(AUTHOR_TASK_DOMAINS).optional(),status:z.enum(AUTHOR_TASK_STATUSES).optional(),tag:z.enum(AUTHOR_TASK_TAGS).optional(),search:z.string().trim().max(120).optional(),cursor:z.string().max(400).optional(),limit:z.coerce.number().int().min(1).max(100).default(40),bookStatus:z.enum(['active','archived','all']).default('active')}).strict();
export type DirectorFollowupFilter=z.input<typeof directorFollowupFilterSchema>;
export const directorFollowupKindSchema=z.enum(AUTHOR_TASK_KINDS);
export interface FollowupBook {id:string;name:string;revision:number;status:'active'|'archived';statusLabel:string;updatedAt:string;tasks:{total:number;running:number;failed:number;waitingApproval:number};directors:{total:number;running:number;paused:number;waitingRecovery:number};quality:{total:number;unresolved:number;debt:number;stale:number}}
export interface DirectorFollowupWorkspace {books:FollowupBook[];booksTotal:number;booksTruncated:boolean;selectedBook:FollowupBook|null;records:AuthorTaskPage;readAt:string;batchRecovery:{enabled:false;reason:string}}
export interface FollowupAnchor {label:string;stableId:string;versionId:string|null;hash:string|null;stateLabel:string}
export interface FollowupStep {id:string;label:string;statusLabel:string;revision:number;attemptId:string|null;attemptStatusLabel:string|null;failureCategoryLabel:string|null;leaseExpired:boolean}
export interface DirectorFollowupDetail {record:AuthorTaskRecord;book:FollowupBook|null;anchors:FollowupAnchor[];anchorsTruncated:boolean;steps:FollowupStep[];stepsTruncated:boolean;readAt:string;notes:string[];navigation:{route:string;label:string;exact:boolean;available:boolean};batchRecovery:{enabled:false;reason:string}}
export interface DirectorFollowupApi {workspace(input:DirectorFollowupFilter):Promise<DirectorFollowupWorkspace>;detail(kind:AuthorTaskRecord['kind'],id:string):Promise<DirectorFollowupDetail>}
/** Only original local navigation, never a command. A book-scoped record cannot redirect to another book. */
export function followupSourceNavigation(record:AuthorTaskRecord):DirectorFollowupDetail['navigation']{
 const fallback={route:'/new-design/structure/maintenance',label:'打开运行维护核对来源',exact:false,available:false};
 if(!isAuthorTaskSourceRoute(record.source.route)||record.source.route.includes('#'))return fallback;
 try{const url=new URL(record.source.route,'http://director-followup.invalid'),match=url.pathname.match(/^\/new-design\/books\/([0-9a-f-]{36})(?:\/|$)/i);if(match&&record.bookId&&match[1].toLowerCase()!==record.bookId.toLowerCase())return fallback;for(const [key,value]of url.searchParams){if(/token|secret|password|credential|authorization/i.test(key)||/[\u0000-\u001f\u007f]/.test(value))return fallback;if((key==='book'||key==='bookId')&&record.bookId&&value.toLowerCase()!==record.bookId.toLowerCase())return fallback;}return{...record.source,available:true};}catch{return fallback;}
}
export const FOLLOWUP_BATCH_UNAVAILABLE='尚无跨来源统一的完整恢复预览与逐项原回执接口；请打开原来源页核对并明确操作。本页不批量执行、重试、采用或取消任务。';
export const FOLLOWUP_STATUS_LABELS:Record<string,string>={queued:'等待开始',preparing:'准备中',running:'运行中',waiting_approval:'等待作者确认',paused:'作者已暂停',retry_scheduled:'原技术重试已安排',succeeded:'已保存成功回执',failed:'已失败',cancelled:'已取消',discarded:'原尝试已结束',ready:'等待明确开始',completed:'范围候选已保存',waiting_recovery:'等待原结果恢复'};
export const FOLLOWUP_FAILURE_LABELS:Record<string,string>={timeout:'等待响应超时',rate_limit:'服务限流',authentication:'模型凭据核对',provider_unavailable:'模型服务不可用',transport:'传输结果未确认',context_limit:'输入范围或预算超限',structure_parse:'候选结构不符',content_unsatisfactory:'候选内容需核对',cancelled:'原尝试已取消',safety:'安全校验未通过',data_integrity:'来源或版本核对失败',unknown:'结果待核对'};

/** Read-only presentation of authoritative domain records; never workflow commands. */
export {parseResearchSourceSelection,parseExportSourceSelection,parseResearchAdoptionSourceSelection,findResearchAdoptionSource,findResearchSourceRecord,findResearchSourceVersion,findExportSourceRecord,researchMetadataBaseline,type ResearchSourceSelection,type ExportSourceSelection,type ResearchAdoptionSourceSelection} from "./sourceSelection";
export const AUTHOR_TASK_DOMAINS=["creation","planning","writing","research","publication","quality","execution"] as const;
export type AuthorTaskDomain=typeof AUTHOR_TASK_DOMAINS[number];
export const AUTHOR_TASK_DOMAIN_LABELS:Record<AuthorTaskDomain,string>={creation:"开书准备",planning:"故事规划",writing:"章节创作",research:"研究与分析",publication:"完本与导出",quality:"质量与连续性",execution:"AI 执行"};
export const AUTHOR_TASK_STATUSES=["pending","running","review","completed","attention","warning","ended","unknown"] as const;
export type AuthorTaskStatus=typeof AUTHOR_TASK_STATUSES[number];
export const AUTHOR_TASK_STATUS_LABELS:Record<AuthorTaskStatus,string>={pending:"等待开始",running:"进行中",review:"等待作者确认",completed:"已完成",attention:"需要处理",warning:"需要关注",ended:"已结束",unknown:"结果待核对"};
export const AUTHOR_TASK_KINDS=["ai_task","story_batch","creation_session","creation_batch","planning_run","planning_review","production_director","writing_request","settlement_session","settlement_extraction","research_version","research_adoption","export_request","completion_check","quality_issue"] as const;
export type AuthorTaskKind=typeof AUTHOR_TASK_KINDS[number];
export const AUTHOR_TASK_TAGS=["ai","manual","review","failure","unknown","saved","warning","quality_debt"] as const;
export type AuthorTaskTag=typeof AUTHOR_TASK_TAGS[number];
export const AUTHOR_TASK_TAG_LABELS:Record<AuthorTaskTag,string>={ai:"AI 协作",manual:"人工创作",review:"待确认",failure:"需处理",unknown:"待核对",saved:"有保存结果",warning:"有警告",quality_debt:"质量债"};
export interface AuthorTaskRecord {
  id:string;kind:AuthorTaskKind;domain:AuthorTaskDomain;status:AuthorTaskStatus;statusLabel:string;
  title:string;bookId:string|null;bookName:string|null;tags:AuthorTaskTag[];updatedAt:string;
  source:{route:string;label:string;exact:boolean};retainedResult:string;failedStep:string|null;
  recoveryGuidance:string;consequence:string;progress:number|null;requestKey:string|null;
  /** Only public identifiers of existing saved records, never raw output/configuration. */
  proofs:Array<{label:string;id:string}>;
}
export interface AuthorTaskFilter {bookId?:string;domain?:AuthorTaskDomain;status?:AuthorTaskStatus;tag?:AuthorTaskTag;search?:string;cursor?:string;limit?:number;}
export interface AuthorTaskPage {items:AuthorTaskRecord[];nextCursor:string|null;total:number;readAt:string;}
/** Navigation safety guard, not intent recognition or AI task routing. */
export function isAuthorTaskSourceRoute(route:string):boolean {
  if(route.length>1200||!route.startsWith("/new-design/")||/[\\\u0000-\u0020]/.test(route))return false;
  try{const url=new URL(route,"http://author-tasks.invalid");return url.origin==="http://author-tasks.invalid"&&!url.username&&!url.password&&url.pathname.startsWith("/new-design/")&&!/%(?:2f|5c|00)/i.test(url.pathname);}catch{return false;}
}

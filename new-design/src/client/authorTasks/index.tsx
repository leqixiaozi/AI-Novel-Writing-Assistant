import {useCallback,useEffect,useRef,useState} from "react";
import {AUTHOR_TASK_DOMAINS,AUTHOR_TASK_DOMAIN_LABELS,AUTHOR_TASK_STATUSES,AUTHOR_TASK_STATUS_LABELS,AUTHOR_TASK_TAGS,AUTHOR_TASK_TAG_LABELS,isAuthorTaskSourceRoute,type AuthorTaskFilter,type AuthorTaskPage,type AuthorTaskRecord,type AuthorTaskKind} from "../../common/authorTasks";
import "./author-tasks.css";
import {AuthorUsagePanel} from "../authorUsage";

export interface AuthorTasksApi {listAuthorTasks(input:AuthorTaskFilter):Promise<AuthorTaskPage>;getAuthorTask(kind:AuthorTaskKind,id:string):Promise<AuthorTaskRecord>;}
const dateLabel=(value:string)=>new Date(value).toLocaleString("zh-CN");
/** API is injected by the top-level client. This component has no mutation API. */
export function AuthorTaskCenterPage({api,bookId}:{api:AuthorTasksApi;bookId?:string}) {
  const [filter,setFilter]=useState<AuthorTaskFilter>({bookId}),[search,setSearch]=useState(""),[page,setPage]=useState<AuthorTaskPage|null>(null),[detail,setDetail]=useState<AuthorTaskRecord|null>(null);
  const [busy,setBusy]=useState(false),[detailBusy,setDetailBusy]=useState(false),[failure,setFailure]=useState(""),[detailFailure,setDetailFailure]=useState("");
  const generation=useRef(0),selection=useRef(0),mounted=useRef(true),activeId=useRef<string|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;selection.current++;};},[]);
  useEffect(()=>{setFilter(current=>current.bookId===bookId?current:{...current,bookId});},[bookId]);
  const refresh=useCallback(async(cursor?:string)=>{
    const request=++generation.current;setBusy(true);setFailure("");
    try{const next=await api.listAuthorTasks({...filter,cursor,limit:40});if(!mounted.current||request!==generation.current)return;
      setPage(next);if(activeId.current&&!next.items.some(item=>item.id===activeId.current)){selection.current++;activeId.current=null;setDetail(null);setDetailBusy(false);setDetailFailure("");}
    }catch{if(mounted.current&&request===generation.current)setFailure("读取运行记录失败。原来源结果保留；可刷新列表核对，不会重发创作请求。");}
    finally{if(mounted.current&&request===generation.current)setBusy(false);}
  },[api,filter]);
  useEffect(()=>{setPage(null);selection.current++;activeId.current=null;setDetail(null);setDetailBusy(false);setDetailFailure("");void refresh();},[refresh]);
  const select=async(record:AuthorTaskRecord)=>{
    const request=++selection.current;activeId.current=record.id;setDetail(record);setDetailBusy(true);setDetailFailure("");
    try{const next=await api.getAuthorTask(record.kind,record.id.slice(record.kind.length+1));if(mounted.current&&request===selection.current)setDetail(next);}
    catch{if(mounted.current&&request===selection.current)setDetailFailure("详细回执未读取，所选列表记录保留；请刷新核对或返回原来源页查看。");}
    finally{if(mounted.current&&request===selection.current)setDetailBusy(false);}
  };
  return <div className="nd-shell nd-author-tasks">
    <header className="nd-page-header"><div><p className="nd-eyebrow">新设计／创作进度</p><h1>运行记录</h1><p>查看开书、规划、正文和导出进度；需要处理时，回到对应来源页核对内容与影响范围。</p></div><button type="button" className="nd-button" disabled={busy} onClick={()=>void refresh()}>刷新记录</button></header>
    <form className="nd-author-task-filters" onSubmit={event=>{event.preventDefault();setFilter(current=>({...current,search:search.trim()||undefined}));}}>
      <label>创作阶段<select value={filter.domain??""} onChange={event=>setFilter(current=>({...current,domain:AUTHOR_TASK_DOMAINS.find(value=>value===event.target.value)}))}><option value="">全部阶段</option>{AUTHOR_TASK_DOMAINS.map(value=><option key={value} value={value}>{AUTHOR_TASK_DOMAIN_LABELS[value]}</option>)}</select></label>
      <label>状态<select value={filter.status??""} onChange={event=>setFilter(current=>({...current,status:AUTHOR_TASK_STATUSES.find(value=>value===event.target.value)}))}><option value="">全部状态</option>{AUTHOR_TASK_STATUSES.map(value=><option key={value} value={value}>{AUTHOR_TASK_STATUS_LABELS[value]}</option>)}</select></label>
      <label>标签<select value={filter.tag??""} onChange={event=>setFilter(current=>({...current,tag:AUTHOR_TASK_TAGS.find(value=>value===event.target.value)}))}><option value="">全部标签</option>{AUTHOR_TASK_TAGS.map(value=><option key={value} value={value}>{AUTHOR_TASK_TAG_LABELS[value]}</option>)}</select></label>
      <label>名称或书名<input value={search} maxLength={120} onChange={event=>setSearch(event.target.value)} placeholder="搜索记录名称或书名"/></label><button type="submit" className="nd-button">筛选</button>
    </form>
    {failure&&<p className="nd-author-task-alert" role="alert">未完成步骤：读取运行记录。{failure}</p>}
    <p className="nd-author-task-count" role="status">{busy?"正在读取记录…":page?`${page.total} 条符合条件的记录 · 核对时间 ${dateLabel(page.readAt)}`:"等待读取记录"}</p>
    <main className="nd-author-task-workspace"><section aria-label="运行记录列表" aria-busy={busy}>
      {page?.items.length?<ul className="nd-author-task-list">{page.items.map(record=><li key={record.id}><button type="button" aria-pressed={detail?.id===record.id} className={detail?.id===record.id?"is-selected":""} onClick={()=>void select(record)}><span className="nd-author-task-row-top"><span>{record.title}</span><span className={`nd-author-task-status is-${record.status}`}>{record.statusLabel}</span></span><small>{record.bookName??"尚未关联正式书籍"} · {AUTHOR_TASK_DOMAIN_LABELS[record.domain]} · {dateLabel(record.updatedAt)}</small>{record.failedStep&&<small>未完成步骤：{record.failedStep}</small>}<span className="nd-author-task-tags">{record.tags.map(tag=><span key={tag}>{AUTHOR_TASK_TAG_LABELS[tag]}</span>)}</span></button></li>)}</ul>:!busy&&<div className="nd-empty-state"><p>没有符合筛选条件的记录。</p><p>从开书表单、故事规划或章节工作台开始创作，保存的进度会显示在这里。</p></div>}
      {page?.nextCursor&&<button type="button" className="nd-button" disabled={busy} onClick={()=>void refresh(page.nextCursor??undefined)}>查看更早记录</button>}
    </section><aside className="nd-author-task-detail" aria-label="所选记录详情" aria-busy={detailBusy}>
      {detail?<><header><p className="nd-kicker">{AUTHOR_TASK_DOMAIN_LABELS[detail.domain]}</p><h2>{detail.title}</h2><p className={`nd-author-task-status is-${detail.status}`}>{detail.statusLabel}</p></header>
      {detailFailure&&<p className="nd-author-task-alert" role="alert">未完成步骤：读取详细回执。{detailFailure}</p>}{detailBusy&&<p role="status">正在核对详细回执…</p>}
      {detail.progress!==null&&<label className="nd-author-task-progress">来源进度：{detail.progress}%<progress max={100} value={detail.progress}/></label>}
      <section><h3>{detail.failedStep?`未完成步骤：${detail.failedStep}`:"保存结果"}</h3><p>{detail.retainedResult}</p><p>{detail.recoveryGuidance}</p></section>
      <section><h3>来源与凭证</h3><dl><dt>书籍</dt><dd>{detail.bookName??"未建立正式书籍"}</dd><dt>更新时间</dt><dd>{dateLabel(detail.updatedAt)}</dd>{detail.requestKey&&<><dt>原请求凭证</dt><dd><code>{detail.requestKey}</code></dd></>}{detail.proofs.map(proof=><div key={`${proof.label}:${proof.id}`}><dt>{proof.label}</dt><dd><code>{proof.id}</code></dd></div>)}</dl></section>
      <AuthorUsagePanel key={detail.id} record={detail}/>
      <footer><p>{detail.consequence}</p>{!detail.source.exact&&<p>进入来源页后，请按本记录名称、版本或原请求凭证选择对应内容。</p>}{isAuthorTaskSourceRoute(detail.source.route)&&<a className="nd-button nd-button-primary" href={detail.source.route}>{detail.source.label}</a>}{detail.bookId&&<a className="nd-button" href={`/new-design/creative-hub?${new URLSearchParams({bookId:detail.bookId,taskKind:detail.kind,taskId:detail.id.startsWith(`${detail.kind}:`)?detail.id.slice(detail.kind.length+1):detail.id})}`}>在创作中枢诊断</a>}</footer></>:<p className="nd-empty-state">选择一条记录，查看进度、保存结果和处理来源。</p>}
    </aside></main>
  </div>;
}

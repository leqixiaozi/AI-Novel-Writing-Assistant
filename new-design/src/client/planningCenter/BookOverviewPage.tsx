import { useEffect, useState } from "react";
import type { BookOverview, BookSummary, TaskContract } from "../../common/contracts";
import { runtimeLabel } from "../../common/presentation";
import { newDesignApi } from "../api";
import BookShell from "../BookShell";

const metricValue=(value:number|null,unit:string)=>value===null?"暂无":`${value}${unit}`;

export default function BookOverviewPage({bookId}:{bookId:string}){
  const [book,setBook]=useState<BookSummary|null>(null),[overview,setOverview]=useState<BookOverview|null>(null),[message,setMessage]=useState("");
  const [contracts,setContracts]=useState<TaskContract[]>([]);
  useEffect(()=>{let active=true;void newDesignApi.listPublishedTaskContracts().then(items=>{if(active)setContracts(items);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{void Promise.all([newDesignApi.getBook(bookId),newDesignApi.getBookOverview(bookId)]).then(([nextBook,nextOverview])=>{setBook(nextBook);setOverview(nextOverview);}).catch(error=>setMessage(error instanceof Error?error.message:"创作概览加载失败。"));},[bookId]);
  if(message)return <div className="nd-shell nd-fatal"><h1>无法打开创作概览</h1><p>{message}</p><a className="nd-button nd-button-primary" href="/new-design/books">返回我的书籍</a></div>;
  if(!book||!overview)return <div className="nd-shell nd-loading-screen"><div className="nd-loader"/><strong>正在整理本书进展</strong><span>从资料、规划、正文和运行记录中汇总。</span></div>;
  return <BookShell book={book} active="overview"><main className="nd-overview-page">
    <section className="nd-overview-lead" aria-labelledby="book-direction-title">
      <div><p className="nd-kicker">故事方向</p><h2 id="book-direction-title">{overview.direction?.title??"等待确定故事方向"}</h2><p>{overview.direction?.summary??"先在故事规划中建立总计划并采用一个版本，后续卷章计划才有稳定依据。"}</p></div>
      <div className="nd-overview-actions"><a className="nd-button nd-button-primary" href={`/new-design/books/${bookId}/planning`}>打开规划工作台</a></div>
    </section>

    <section aria-label="本书创作专项"><h2>写法与标题</h2><div className="nd-row-actions"><a className="nd-button" href={`/new-design/resources/extraction?bookId=${bookId}&mode=writing_resource`}>提炼写法资源</a><a className="nd-button" href={`/new-design/resources/extraction?bookId=${bookId}&mode=style_cleaning`}>仿写与清洗正文</a><a className="nd-button" href={`/new-design/resources/extraction?bookId=${bookId}&mode=title_groups`}>生成与比较标题</a></div><p>参考、目标章节和人工填写分别确认；候选需明确保存或采用。</p></section>
    <section aria-labelledby="progress-title"><div className="nd-section-heading"><div><p className="nd-kicker">创作进展</p><h2 id="progress-title">下一步从缺口开始</h2></div><small>汇总时间 {new Date(overview.updatedAt).toLocaleString()}</small></div>
      <div className="nd-overview-metrics">{overview.metrics.map(item=><a className={`nd-overview-metric is-${item.state}`} href={item.sourceRoute} key={item.key}><span>{item.label}</span><strong>{metricValue(item.value,item.unit)}</strong><p>{item.detail}</p><small>{item.sourceLabel} · {item.updatedAt?new Date(item.updatedAt).toLocaleString():"暂无更新时间"}</small></a>)}</div>
    </section>

    <div className="nd-overview-columns">
      <section aria-labelledby="materials-title"><div className="nd-section-heading"><div><p className="nd-kicker">主要资料</p><h2 id="materials-title">按本书内容类型检查</h2></div><a href={`/new-design/books/${bookId}/cards`}>维护本书资料</a></div>
        {overview.materials.length?<div className="nd-readiness-list">{overview.materials.map(item=><a href={item.sourceRoute} key={item.typeKey}><span className={`nd-status-dot is-${item.state}`} aria-hidden="true"/><div><strong>{item.typeName}</strong><small>{item.categoryName} · {item.activeCount?`${item.activeCount} 条资料`:`暂无资料`}</small></div><span>{item.requiredFieldCount?`${item.filledRequiredFieldCount}/${item.requiredFieldCount} 个必填项`:(item.activeCount?"可用":"待补充")}</span></a>)}</div>:<div className="nd-empty-state"><strong>暂无可检查的内容类型</strong><p>从本书设置安装内容类型后，这里会按真实字段和资料汇总。</p></div>}
      </section>

      <aside className="nd-overview-side">
        <section aria-labelledby="context-title"><div className="nd-section-heading"><div><p className="nd-kicker">写作准备</p><h2 id="context-title">上下文可用性</h2></div><span className={`nd-status-label is-${overview.context.state}`}>{overview.context.state==="ready"?"可用":overview.context.state==="attention"?"需处理":"待接入"}</span></div><p>{overview.context.detail}</p><small>{overview.context.adoptedRuleCount} 条采用规则 · {overview.context.updatedAt?new Date(overview.context.updatedAt).toLocaleString():"暂无预览"}</small><a href={overview.context.sourceRoute}>查看上下文管理</a></section>
        <section aria-labelledby="runs-title"><div className="nd-section-heading"><div><p className="nd-kicker">最近运行</p><h2 id="runs-title">任务与处理状态</h2></div></div>{overview.recentTasks.length?<div className="nd-recent-runs">{overview.recentTasks.map(task=><a href={task.sourceRoute} key={task.id}><div><strong>{contracts.find(contract=>contract.taskKey===task.taskKey)?.name??"创作任务"}</strong><small>{new Date(task.updatedAt).toLocaleString()}</small></div><span className={`nd-status-label is-${task.status==="failed"?"attention":"ready"}`}>{runtimeLabel(task.status)}</span></a>)}</div>:<div className="nd-empty-state"><strong>暂无运行记录</strong><p>发起创作任务后，可以在这里查看状态并返回来源页面。</p></div>}</section>
      </aside>
    </div>
  </main></BookShell>;
}

import {useEffect,useId,useState,type MouseEvent} from 'react';
import type {BookTaskNavKey} from '../navigation';
import type {BookSummary} from '../../common/contracts';
import {newDesignApi} from '../api';
import {BOOK_WORKFLOW_STEPS,currentBookWorkflowStep,defaultBookNavigationCollapsed} from './workflow';
import {workflowProgress,type WorkflowProgress} from './progress';
import './navigation.css';
import './workbench.css';
export {default as BookRouteShell} from './BookRouteShell';
const progressCache=new Map<string,{progress:WorkflowProgress[]|null;error:boolean}>();
function localNavigate(event:MouseEvent<HTMLAnchorElement>){if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const href=event.currentTarget.href,url=new URL(href,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/new-design/'))return;const leaving=new Event('beforeunload',{cancelable:true});if(!dispatchEvent(leaving)&&!confirm('当前页面可能有未保存内容，确定离开吗？'))return;event.preventDefault();history.pushState({},'',`${url.pathname}${url.search}${url.hash}`);dispatchEvent(new PopStateEvent('popstate'));}
export default function BookNavigation({book,active}:{book:BookSummary;active:BookTaskNavKey}){
 const bodyId=useId(),preferenceKey=`new-design:book-navigation:${book.id}:collapsed`;
 const [collapsed,setCollapsed]=useState(()=>{try{return defaultBookNavigationCollapsed(location.pathname,typeof window==='undefined'?0:window.innerWidth,sessionStorage.getItem(preferenceKey));}catch{return false;}});
 const cached=progressCache.get(book.id),[progress,setProgress]=useState<WorkflowProgress[]|null>(cached?.progress??null),[progressError,setProgressError]=useState(cached?.error??false);
 useEffect(()=>{let active=true,revision=0;const read=()=>{const current=++revision;void Promise.allSettled([newDesignApi.getPlanningCenter(book.id),newDesignApi.getBookViewWorkspace(book.id),newDesignApi.getChapterWritingWorkspace(book.id)]).then(([planning,views,writing])=>{if(!active||current!==revision)return;
  const objects=planning.status==='fulfilled'&&planning.value.bookId===book.id?planning.value.objects:null;
  const cards=views.status==='fulfilled'&&views.value.bookId===book.id?views.value.cards:null;
  const chapters=writing.status==='fulfilled'&&writing.value.bookId===book.id?writing.value.chapters:null;
  const next=workflowProgress(objects,cards,chapters),error=objects===null&&cards===null&&chapters===null;progressCache.set(book.id,{progress:next,error});setProgress(next);setProgressError(error);
 });};const onChanged=(event:Event)=>{if((event as CustomEvent<{bookId:string}>).detail?.bookId===book.id)read();};read();addEventListener('focus',read);addEventListener('new-design:book-workflow-changed',onChanged);return()=>{active=false;revision++;removeEventListener('focus',read);removeEventListener('new-design:book-workflow-changed',onChanged);};},[book.id]);
  const current=currentBookWorkflowStep(active,new URLSearchParams(location.search),location.pathname);
  const toolCurrent=(key:BookTaskNavKey)=>current<0&&active===key?'page':undefined;
 const toggle=()=>{const next=!collapsed;setCollapsed(next);try{sessionStorage.setItem(preferenceKey,String(next));}catch{}};
 const base=`/new-design/books/${book.id}`;
 const nextIndex=progress?.findIndex(item=>item.ready===false)??-1;
 return <aside className={`nd-book-navigation${collapsed?' is-collapsed':''}`} aria-label={`${book.name}创作工作台`}>
  <div className="nd-book-navigation-heading"><span hidden={collapsed}>创作工作台</span><button type="button" className="nd-book-navigation-collapse" aria-label={collapsed?'展开创作导航':'收起创作导航'} aria-controls={bodyId} aria-expanded={!collapsed} onClick={toggle}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={collapsed?'m7 5 5 5-5 5':'m12 5-5 5 5 5'}/></svg></button></div>
  <div id={bodyId} hidden={collapsed}>
   <div className="nd-book-navigation-context"><strong title={book.name}>{book.name}</strong><p><a href="/new-design/books" onClick={localNavigate}>返回我的书籍</a></p><p>流程：{current>=0?BOOK_WORKFLOW_STEPS[current].label:'项目工具'}</p>{nextIndex>=0&&<a className="nd-workflow-next" href={`${base}/${BOOK_WORKFLOW_STEPS[nextIndex].path}`} onClick={localNavigate}>下一步：{BOOK_WORKFLOW_STEPS[nextIndex].label}</a>}</div>
   <nav className="nd-production-steps nd-book-navigation-body" aria-label="小说创作流程">{BOOK_WORKFLOW_STEPS.map((step,index)=><a key={step.label} href={`${base}/${step.path}`} onClick={localNavigate} aria-current={index===current?'page':undefined}><span className="nd-production-step-number">{index+1}</span><span className="nd-production-step-copy"><strong>{step.label}</strong><small>{progress?.[index]?<>{progress[index].adopted}<br/>{progress[index].ready===null?progress[index].detail:progress[index].ready?'本步就绪':`待补 · ${progress[index].detail}`}</>:progressError?'状态未读取':'正在核对状态'}</small></span></a>)}</nav>
   <details className="nd-production-tools" open={current<0}><summary>其他项目工具</summary><nav aria-label="本书辅助工具"><a href={`${base}/overview`} onClick={localNavigate} aria-current={toolCurrent('overview')}>创作概览</a><a href={`${base}/composition`} onClick={localNavigate} aria-current={toolCurrent('composition')}>全书编排</a><a href={`${base}/planning`} onClick={localNavigate} aria-current={toolCurrent('planning')}>多维故事规划</a><a href={`${base}/director`} onClick={localNavigate} aria-current={toolCurrent('director')}>AI 驾驶舱</a><a href={`${base}/views/chapters`} onClick={localNavigate} aria-current={toolCurrent('views')}>查看与分析</a><a href={`${base}/history`} onClick={localNavigate} aria-current={toolCurrent('history')}>整书历史</a><a href={`${base}/completion`} onClick={localNavigate} aria-current={toolCurrent('completion')}>完本与导出</a><a href={`${base}/fields`} onClick={localNavigate} aria-current={toolCurrent('settings')}>本书设置</a></nav></details>
  </div>
 </aside>;
}

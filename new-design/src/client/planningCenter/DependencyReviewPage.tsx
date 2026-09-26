import {useEffect,useState} from 'react';
import type {BookSummary,DependencyResourceStatus,DependencyInvalidationEvent,DependencyRecomputeRequest} from '../../common/contracts';
import {newDesignApi} from '../api';
import BookShell from '../BookShell';

const labels:Record<string,string>={fresh:'来源有效',stale:'来源已变化',invalid:'来源失效',needs_review:'需复核',recompute_pending:'等待复核',recomputing:'正在重算',recomputed:'已重算',accepted_stale:'已明确保留旧来源'};
type Acceptance={resourceId:string;eventId:string;riskSummary:string;reason:string;idempotencyKey:string};

export default function DependencyReviewPage({bookId}:{bookId:string}){
 const [book,setBook]=useState<BookSummary|null>(null);
 const [entries,setEntries]=useState<DependencyResourceStatus[]>([]);
 const [requests,setRequests]=useState<DependencyRecomputeRequest[]>([]);
 const [cursor,setCursor]=useState<string|undefined>();
 const [next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [event,setEvent]=useState<DependencyInvalidationEvent|null>(null);
 const [acceptance,setAcceptance]=useState<Acceptance|null>(null);

 useEffect(()=>{
  let current=true;
  setBusy(true);setError('');
  void Promise.all([
   newDesignApi.getBook(bookId),
   newDesignApi.listDependencyStates(bookId,{cursor,limit:100}),
   newDesignApi.listDependencyRecomputes(bookId,{status:'pending',limit:100}),
  ]).then(([source,page,pending])=>{
   if(!current)return;
   if(source.id!==bookId||page.items.some(item=>item.bookId!==bookId)||pending.items.some(item=>item.bookId!==bookId))throw Error('原复核清单来源不一致，请保留页面。');
   setBook(source);
   setEntries(previous=>cursor?[...previous,...page.items]:page.items);
   setNext(page.nextCursor);
   setRequests(pending.items);
  }).catch(failure=>{if(current)setError(failure instanceof Error?failure.message:'原复核清单未读取。');})
   .finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;};
 },[bookId,cursor]);

 async function inspect(id:string){
  setBusy(true);setError('');
  try{const result=await newDesignApi.getDependencyInvalidation(id,bookId);if(result.bookId!==bookId||result.id!==id)throw Error('原失效记录来源不一致。');setEvent(result);}
  catch(failure){setError(failure instanceof Error?failure.message:'原失效记录未读取。');}
  finally{setBusy(false);}
 }

 async function accept(){
  if(!acceptance?.riskSummary.trim()||!acceptance.reason.trim())return;
  setBusy(true);setError('');
  try{
   await newDesignApi.acceptStaleDependency({bookId,resourceId:acceptance.resourceId,invalidationEventId:acceptance.eventId,riskSummary:acceptance.riskSummary.trim(),reason:acceptance.reason.trim(),actor:'local-operator',idempotencyKey:acceptance.idempotencyKey});
   const [states,pending]=await Promise.all([newDesignApi.listDependencyStates(bookId,{limit:100}),newDesignApi.listDependencyRecomputes(bookId,{status:'pending',limit:100})]);
   setEntries(states.items);setNext(states.nextCursor);setCursor(undefined);setRequests(pending.items);setAcceptance(null);
  }catch(failure){setError(failure instanceof Error?failure.message:'旧来源保留决定未确认；请核对后用原请求重试。');}
  finally{setBusy(false);}
 }

 const waiting=entries.filter(item=>['stale','invalid','needs_review','recompute_pending','recomputing'].includes(item.state));
 const manual=requests.filter(item=>item.strategyKey==='manual_review');
 const content=<main className="nd-overview-page">
  <h1>来源变化与复核</h1>
  <p>这里显示本书正式依赖来源。手工复核不会自动调用模型或更换上下文；先到来源页检查，再决定生成新版本或明确保留旧来源。</p>
  <nav className="nd-row-actions"><a className="nd-button" href={`/new-design/books/${bookId}/planning`}>核对规划版本</a><a className="nd-button" href={`/new-design/books/${bookId}/writing`}>核对正文与结算</a><a className="nd-button" href={`/new-design/books/${bookId}/views/quality`}>审阅质量问题</a></nav>
  {error&&<p role="alert">{error}</p>}{busy&&<p role="status">正在核对原记录…</p>}
  {manual.length>0&&<section><h2>等待作者判断的来源 · {manual.length}{manual.length===100?'（仅显示前 100 项）':''}</h2><p>这些是业务复核请求，后台不会替作者接受过期上下文。核对原变化后，可在来源页生成新版本，或填写保留旧来源的风险与原因。</p><div className="nd-version-list">{manual.map(item=><article key={item.id}><strong>{item.reason}</strong><p>复核请求 {item.id}</p><small>来源资源 {item.targetResourceId}</small></article>)}</div></section>}
  {!waiting.length&&!manual.length&&!busy&&<p>{next?'已读取范围内没有待复核项；可继续读取后续记录。':'本书没有待复核项。'}</p>}
  <div className="nd-version-list">{waiting.map(item=><article key={item.resourceId}>
   <strong>{labels[item.state]??'状态待核对'}</strong>
   {item.reasons.map(reason=><p key={reason.id}>{reason.reason}</p>)}
   <details><summary>原来源凭证</summary><p>{item.resourceId}</p><p>原状态修订 {item.revision} · {new Date(item.updatedAt).toLocaleString()}</p></details>
   {item.lastEventId&&<button className="nd-button" type="button" disabled={busy} onClick={()=>void inspect(item.lastEventId!)}>查看原变化影响</button>}
   {item.reasons.filter(reason=>!reason.resolvedAt).map(reason=><button key={reason.id} className="nd-button" type="button" disabled={busy} onClick={()=>setAcceptance({resourceId:item.resourceId,eventId:reason.eventId,riskSummary:'',reason:'',idempotencyKey:crypto.randomUUID()})}>明确保留此旧来源</button>)}
  </article>)}</div>
  {next&&<button className="nd-button" disabled={busy} onClick={()=>setCursor(next)}>继续读取原记录</button>}
  {acceptance&&<section><h2>保留旧来源的正式决定</h2><p>此操作会记录作者明知来源已经变化仍继续使用旧版本，并取消对应重算请求。请先核对来源，再填写具体风险与原因。</p><p>来源资源 {acceptance.resourceId}</p><div className="nd-form-grid"><label className="nd-control"><span>已知风险</span><textarea rows={3} maxLength={3000} value={acceptance.riskSummary} onChange={e=>setAcceptance({...acceptance,riskSummary:e.target.value})}/></label><label className="nd-control"><span>保留原因</span><textarea rows={3} maxLength={2000} value={acceptance.reason} onChange={e=>setAcceptance({...acceptance,reason:e.target.value})}/></label></div><div className="nd-row-actions"><button className="nd-button" disabled={busy} onClick={()=>setAcceptance(null)}>返回核对</button><button className="nd-button nd-button-primary" disabled={busy||!acceptance.riskSummary.trim()||!acceptance.reason.trim()} onClick={()=>void accept()}>记录保留决定</button></div></section>}
  {event&&<section><h2>原变化影响</h2><p>{event.reason}</p><p>{event.impacts.length} 项精确来源受影响</p><ul>{event.impacts.map(item=><li key={item.id}>{labels[item.impactState]} · {item.dependencyStrength==='hard'?'强依赖':'提醒依赖'}<details><summary>精确受影响来源</summary>{item.resourceId}</details></li>)}</ul></section>}
 </main>;
 return book?<BookShell book={book} active="overview">{content}</BookShell>:content;
}

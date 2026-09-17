import {useEffect,useRef,useState} from 'react';
import type {ResourceLedgerSelection} from '../../../common/characterResources';
import type {CharacterResourceHistory} from '../../../common/characterResources/history';
import type {ResourceHistoryItem,ResourceHistoryFocusOutput} from '../../../common/characterResources/history';
import {newDesignApi} from '../../api';
/** Explicit source-page read. Historical confirmations never replace current holding. */
export function ResourceHistoryPanel({bookId,characterId,selection,disabled}:{bookId:string;characterId:string;selection:ResourceLedgerSelection|null;disabled:boolean}){
 const [history,setHistory]=useState<CharacterResourceHistory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false);
 const alive=useRef(true),epoch=useRef(0),reading=useRef(false),scope=JSON.stringify([bookId,characterId,selection]);
 useEffect(()=>{alive.current=true;epoch.current++;reading.current=false;setHistory(null);setError('');setBusy(false);setOpen(false);return()=>{alive.current=false;epoch.current++;};},[scope]);
 const read=async()=>{
  if(disabled||reading.current||!selection)return;reading.current=true;setBusy(true);setOpen(true);setError('');const seq=++epoch.current;
  try{const next=await newDesignApi.getCharacterResourceHistory(bookId,characterId,selection);if(!alive.current||seq!==epoch.current)return;
   if(next.contract!=='character_resource_history_v1'||next.bookId!==bookId||next.characterId!==characterId||next.selection.relationTypeId!==selection.relationTypeId||next.selection.holdingDimensionKey!==selection.holdingDimensionKey||next.selection.specificationHash!==selection.specificationHash)throw new Error('原资源历史与当前人物或完整维度不同，请保留来源核对。');setHistory(next);
  }catch(reason){if(alive.current&&seq===epoch.current)setError(reason instanceof Error?reason.message:'原资源历史未读取，请核对原来源。');}finally{if(alive.current&&seq===epoch.current){reading.current=false;setBusy(false);}}
 };
 return <section className="nd-resource-history"><div className="nd-row-actions"><button className="nd-button" disabled={disabled||busy||!selection} onClick={()=>void read()}>{busy?'正在读取原确认…':'核对已确认资源历史'}</button>{open&&<button className="nd-button" onClick={()=>setOpen(false)}>收起资源历史</button>}</div>
  {open&&<><h4>原确认与当前持有</h4><p>历史保留原章节确认及正文证据。当前持有单独核对；资源计划、数量为零或关系归档不能证明已经转交。</p>{error&&<p role="alert">{error}</p>}{history?.truncated&&<p role="alert">原变化超出本次范围，以下历史不完整。请打开原章节核对，未显示不代表不存在。</p>}
   {history?.items.map(item=><details key={item.relationId}><summary>{item.name} · {item.changes.length} 条原变化 · 当前持有：{item.currentHolding?.available?item.currentHolding.display:'未确认'}</summary>{item.changes.map(change=><section key={change.id}><h5>第 {change.chapterOrder} 章 · {change.fieldLabel}</h5><p>{change.available?'原确认已核对':'原来源待核对'}：{change.beforeDisplay} → {change.afterDisplay}</p>{change.unavailableReason&&<p role="alert">{change.unavailableReason}</p>}<p>{change.reason}</p>{change.original.anchor&&<blockquote>{String(change.original.anchor.excerpt)}</blockquote>}<a href={change.sourceRoute}>核对原章节确认与正文</a><details><summary>原确认与引用版本</summary><p>原变化：{change.id}；采用正文：{change.bodyVersionId}；关系引用：{String(change.original.relationVersion?.id??'缺失')}；资源引用：{String(change.original.resourceVersion?.id??'缺失')}。</p><p>原确认保留，关系和资源档案是否仍活跃不代表当前持有。</p></details></section>)}</details>)}
   {history&&!history.items.length&&<p>没有对应的原章节资源状态变化。未确认的持有与转交保持未知。</p>}
  </>}
 </section>;
}
export function ResourceHistoryItemView({item,suggestion}:{item:ResourceHistoryItem;suggestion?:ResourceHistoryFocusOutput[number]}){
 const latest=item.changes[0];
 return <article><h4>{item.name}<small>当前持有：{item.currentHolding?.available?item.currentHolding.display:'未确认'}</small></h4>
  <p>原人物关系关联的资源 · 历史确认</p>{suggestion&&<p>AI 原确认显示建议：{({transferred:'已转交',stale:'已淡出',other:'其它原确认',unknown:'待核对'})[suggestion.status]}；{suggestion.explanation}</p>}
  {latest&&<><p>第 {latest.chapterOrder} 章 · {latest.fieldLabel}：{latest.beforeDisplay} → {latest.afterDisplay}</p>{latest.unavailableReason&&<p role="alert">{latest.unavailableReason}</p>}<a href={latest.sourceRoute}>核对原章节确认与正文</a></>}
  <details><summary>全部原确认与引用证据</summary>{item.changes.map(change=><section key={change.id}><p>第 {change.chapterOrder} 章 · {change.fieldLabel}：{change.beforeDisplay} → {change.afterDisplay}；{change.available?'原确认已核对':'原来源待核对'}。</p>{change.original.anchor&&<blockquote>{String(change.original.anchor.excerpt)}</blockquote>}<p>原确认：{change.id}；采用正文：{change.bodyVersionId}；关系引用：{String(change.original.relationVersion?.id??'缺失')}。</p><a href={change.sourceRoute}>打开确切原确认</a></section>)}</details>
 </article>;
}

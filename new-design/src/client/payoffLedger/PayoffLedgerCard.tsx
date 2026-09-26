import {useCallback,useEffect,useRef,useState} from 'react';
import type {PayoffLedgerItem,PayoffLedgerWorkspace,SavePayoffWindowInput} from '../../common/payoffLedger';
import {newDesignApi} from '../api';
import type {WorkspaceEditor} from '../storyWorkspace/useGuard';
import './payoffLedger.css';

interface Draft {cardId:string;start:string;end:string;revision:number;}
const draftOf=(item:PayoffLedgerItem):Draft=>({cardId:item.cardId,start:item.targetStartChapterOrder?.toString()??'',end:item.targetEndChapterOrder?.toString()??'',revision:item.windowRevision});
const numberOrNull=(text:string)=>text.trim()===''?null:Number(text);
const windowLabel=(item:PayoffLedgerItem)=>item.targetStartChapterOrder!==null&&item.targetEndChapterOrder!==null
  ?`第 ${item.targetStartChapterOrder}–${item.targetEndChapterOrder} 章`
  :item.targetEndChapterOrder!==null?`最晚第 ${item.targetEndChapterOrder} 章`
  :item.targetStartChapterOrder!==null?`从第 ${item.targetStartChapterOrder} 章起`:'未限定';
const statusLabel={pending:'待兑现',urgent:'紧急',overdue:'逾期',paid_off:'已回收',abandoned:'已废弃'} as const;

export default function PayoffLedgerCard({bookId,refreshToken,onEditorStateChange,onRequest,expandedByDefault=false}:{bookId:string;refreshToken:number;onEditorStateChange:(state:WorkspaceEditor)=>void;onRequest:(action:()=>void)=>boolean;expandedByDefault?:boolean}){
  const [workspace,setWorkspace]=useState<PayoffLedgerWorkspace|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [expanded,setExpanded]=useState(expandedByDefault);
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[pendingKey,setPendingKey]=useState<string|null>(null);
  const generation=useRef(0),frozen=useRef<{cardId:string;input:SavePayoffWindowInput}|null>(null);
  const pendingStorageKey=`new-design:payoff-window-pending:${bookId}`;
  useEffect(()=>{try{const raw=localStorage.getItem(pendingStorageKey);if(!raw)return;const saved=JSON.parse(raw) as {bookId:string;cardId:string;draft:Draft;input:SavePayoffWindowInput};if(saved.bookId!==bookId||saved.cardId!==saved.draft?.cardId||!saved.input?.idempotencyKey)throw Error();frozen.current={cardId:saved.cardId,input:saved.input};setDraft(saved.draft);setPendingKey(saved.input.idempotencyKey);setMessage('发现原目标窗口请求；填写与请求编号已恢复，请先核对原回执。');}catch{setError('原目标窗口请求凭证无法读取；为防止重复保存，当前页面不能提交新窗口。');setPendingKey('unreadable');}},[bookId,pendingStorageKey]);
  const load=useCallback(async()=>{const seq=++generation.current;try{const result=await newDesignApi.getPayoffLedger(bookId);if(seq===generation.current){setWorkspace(result);setError('');}}catch(reason){if(seq===generation.current)setError(reason instanceof Error?reason.message:'伏笔账本读取失败。');}},[bookId]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load,refreshToken]);
  const selected=workspace?.items.find(item=>item.cardId===draft?.cardId)??null;
  const dirty=Boolean(draft&&selected&&(draft.start!==draftOf(selected).start||draft.end!==draftOf(selected).end));
  const locked=busy||pendingKey!==null;
  useEffect(()=>{if(!dirty&&!locked)return;const before=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[dirty,locked]);
  const complete=async()=>{try{const raw=localStorage.getItem(pendingStorageKey);if(raw&&(JSON.parse(raw) as {input?:SavePayoffWindowInput}).input?.idempotencyKey===pendingKey)localStorage.removeItem(pendingStorageKey);}catch{/* 已有服务器回执优先，刷新后仍可核对旧键。 */}setPendingKey(null);frozen.current=null;setBusy(false);setDraft(null);setMessage('目标窗口已保存；这只更新计划期限，不表示伏笔已回收。');await load();return true;};
  const save=async():Promise<boolean>=>{
    if(busy||!draft||!selected||!workspace?.windowEditingAvailable||pendingKey==='unreadable')return false;
    if(!dirty&&!pendingKey)return true;
    const start=numberOrNull(draft.start),end=numberOrNull(draft.end);
    if([start,end].some(item=>item!==null&&(!Number.isInteger(item)||item<=0||item>1000000))||start!==null&&end!==null&&start>end){setError('目标章节必须是正整数，且截止章节不得早于起始章节。');return false;}
    const key=pendingKey??crypto.randomUUID(),input=frozen.current?.input??{startChapterOrder:start,endChapterOrder:end,expectedRevision:draft.revision,idempotencyKey:key};
    if(frozen.current&&frozen.current.cardId!==draft.cardId){setError('原请求关联的伏笔与当前输入不一致，不能改用新对象重试。');return false;}
    try{const raw=JSON.stringify({bookId,cardId:draft.cardId,draft,input}),prior=localStorage.getItem(pendingStorageKey);if(prior&&prior!==raw)throw Error();localStorage.setItem(pendingStorageKey,raw);if(localStorage.getItem(pendingStorageKey)!==raw)throw Error();}catch{setError('未能保留原请求编号；未提交保存。请检查本机存储或核对已有请求。');return false;}
    frozen.current={cardId:draft.cardId,input};setPendingKey(key);setBusy(true);setError('');setMessage('');
    try{const receipt=await newDesignApi.savePayoffWindow(bookId,draft.cardId,input);
      if(receipt.idempotencyKey!==key||receipt.cardId!==draft.cardId||receipt.startChapterOrder!==input.startChapterOrder||receipt.endChapterOrder!==input.endChapterOrder)throw new Error('窗口保存回执与原请求不一致，请保留输入并核对。');
      return await complete();
    }catch(reason){
      try{const receipt=await newDesignApi.getPayoffWindowRequest(bookId,key);
        if(receipt){if(receipt.cardId!==draft.cardId||receipt.startChapterOrder!==input.startChapterOrder||receipt.endChapterOrder!==input.endChapterOrder)throw new Error('请求编号对应其他目标窗口，不能据此确认保存。');return await complete();}
        setError(`${reason instanceof Error?reason.message:'保存未确认。'} 未查到原请求回执；填写和请求编号保留，可核对或使用原请求编号重试。`);
      }catch(checkError){setError(`${reason instanceof Error?reason.message:'保存未确认。'} 回执查询也失败：${checkError instanceof Error?checkError.message:'未知错误'}。请保留填写和原请求编号。`);}
      setBusy(false);return false;
    }
  };
  const discard=()=>{if(locked)return false;setDraft(null);setError('');return true;};
  useEffect(()=>{onEditorStateChange({dirty,locked,save,discard});});
  const inspect=async()=>{if(!pendingKey||!draft)return;setBusy(true);try{const receipt=await newDesignApi.getPayoffWindowRequest(bookId,pendingKey);if(receipt){if(receipt.cardId!==draft.cardId||receipt.startChapterOrder!==frozen.current?.input.startChapterOrder||receipt.endChapterOrder!==frozen.current?.input.endChapterOrder)throw new Error('原请求回执与保留输入不一致。');await complete();}else setMessage('原请求尚无回执；可使用同一请求编号重试，不会创建第二个保存请求。');}catch(reason){setError(reason instanceof Error?reason.message:'原请求核对失败。');}finally{setBusy(false);}};
  return <section className="nd-payoff-ledger" aria-label="全书伏笔兑现压力账本"><details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary><strong>全书伏笔兑现压力账本</strong><span>待兑现 {workspace?.summary.pendingCount??'—'} · 紧急 {workspace?.summary.urgentCount??'—'} · 逾期 {workspace?.summary.overdueCount??'—'} · 已回收 {workspace?.summary.paidOffCount??'—'}</span></summary>
    <div className="nd-payoff-body"><p>全书范围，不随当前规划筛选切换。目标窗口来自手工期限或已采用章节规划；叙事位置仅为标注。已回收只认稳定章节的正式状态结算：在章节结果确认中先建立伏笔状态前值，再提交并确认 paid_off 变化；作者档案状态不替代这一步。</p>
      {error&&<p role="alert" className="nd-message is-error">{error}</p>}{message&&<p role="status">{message}</p>}
      <div className="nd-row-actions"><span>已稳定至第 {workspace?.throughStableChapterOrder??0} 章 · {workspace?.summary.unknownWindowCount??0} 项无结构化期限</span><a className="nd-button" href={`/new-design/books/${bookId}/writing`}>前往章节结果确认</a><button type="button" className="nd-button" disabled={busy||dirty||locked} onClick={()=>void load()}>刷新账本</button></div>
      {!workspace&&!error&&<p role="status">正在读取伏笔账本…</p>}
      {workspace&&!workspace.windowEditingAvailable&&<p role="status">手工目标窗口尚未安装；已采用章节规划仍可提供可核实的目标章序，现有资料保持只读。</p>}
      {workspace?.items.length===0&&<p>当前没有正式伏笔资料；不会从规划文本推断新伏笔或兑现状态。</p>}
      {workspace?.items.map(item=><article key={item.cardId} className="nd-payoff-item"><div className="nd-row-actions"><strong>{item.title}</strong><span className={`nd-payoff-status is-${item.status}`}>{statusLabel[item.status]}</span><span>{windowLabel(item)}</span></div>
        {item.summary&&<p>{item.summary}</p>}{item.authorPlan&&<p><small>资料中的回收计划（原文，不解析章数）：{item.authorPlan}</small></p>}
        <p><small>期限来源：{item.windowSource==='manual'?'手工目标窗口':item.windowSource==='adopted_plan'?'已采用章节规划':'未知'}；最近正式状态结算：{item.lastTouchedChapterOrder===null?'暂无':`第 ${item.lastTouchedChapterOrder} 章`}。</small></p>
        <p><small>压力判断：{item.status==='overdue'?`已稳定至第 ${workspace.throughStableChapterOrder} 章，超过第 ${item.targetEndChapterOrder} 章截止且无正式回收结算。`:item.status==='urgent'?item.targetEndChapterOrder!==null&&item.targetEndChapterOrder<=workspace.throughStableChapterOrder+1?'下一个稳定章节前接近明确截止，尚无正式回收结算。':'已进入明确目标窗口，尚无正式回收结算。':item.status==='paid_off'?`第 ${item.paidOffChapterOrder} 章正式状态结算已确认回收。`:item.status==='abandoned'?'正式状态结算标记为废弃。':item.windowSource==='unknown'?'没有结构化目标窗口；不从文字猜测逾期。':'目标窗口尚未临近，等待正式回收结算。'}</small></p>
        {item.settlementUnavailableReason&&<p role="status"><small>正式回收暂不可结算：{item.settlementUnavailableReason}</small></p>}
        <p><small>来源摘要：{item.sources.slice(0,4).map(source=>source.label).join(' / ')||'暂无'}</small></p>
        {workspace.windowEditingAvailable&&<button type="button" className="nd-button" disabled={locked} onClick={()=>onRequest(()=>{setDraft(draftOf(item));setError('');setMessage('');})}>{draft?.cardId===item.cardId?'重置当前输入':'设置目标窗口'}</button>}
        {draft?.cardId===item.cardId&&<div className="nd-payoff-editor"><label>起始章<input type="number" min="1" max="1000000" value={draft.start} disabled={locked} onChange={event=>setDraft(current=>current?{...current,start:event.target.value}:current)}/></label><label>截止章<input type="number" min="1" max="1000000" value={draft.end} disabled={locked} onChange={event=>setDraft(current=>current?{...current,end:event.target.value}:current)}/></label><button className="nd-button nd-button-primary" type="button" disabled={busy||!dirty&&pendingKey===null} onClick={()=>void save()}>{pendingKey?'原请求编号重试':'保存期限'}</button><button className="nd-button" type="button" disabled={busy||pendingKey===null} onClick={()=>void inspect()}>核对原请求</button><button className="nd-button" type="button" disabled={locked} onClick={()=>{setDraft(null);setError('');}}>取消</button></div>}
      </article>)}
    </div></details></section>;
}

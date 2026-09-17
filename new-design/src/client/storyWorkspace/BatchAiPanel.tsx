import {useEffect,useRef,useState} from 'react';
import type {StoryBatchDraft,StoryBatchRecord,StoryBatchRequest} from '../../common/storyWorkspace';
import {canonicalWriteInput} from '../../common/storyWorkspace';
import {ApiError,newDesignApi} from '../api';
import type {WorkspaceEditor} from './useGuard';
import Help from './Help';

export type StoryBatchSeed={mode:'setting';typeIds:string[];newTypeId:string}|{mode:'planning';scopeId:string};
const labels:Record<string,string>={__title:'资料名称',goal:'目标',storyTime:'故事时间',mustHappen:'必须发生',mustPreserve:'必须保留',forbiddenBoundaries:'禁止越界',expectedChanges:'预期变化',characterArc:'人物弧',notes:'备注',eventSchedule:'事件发生顺序与时间',relationshipPlans:'人物关系发展安排'};
const blank=(value:unknown)=>value==null||value===''||Array.isArray(value)&&value.length===0;
const display=(value:unknown)=>Array.isArray(value)?value.join('；'):value&&typeof value==='object'?JSON.stringify(value):String(value??'未填写');
export default function BatchAiPanel({bookId,seed,open,onClose,onState,onLoad,onRequest,initialRequestKey}:{initialRequestKey?:string|null;bookId:string;seed:StoryBatchSeed;open:boolean;onClose:()=>void;onState:(state:WorkspaceEditor)=>void;onLoad:(draft:StoryBatchDraft)=>void;onRequest:(action:()=>void)=>void}){
 const [instruction,setInstruction]=useState(''),[newCount,setNewCount]=useState(1),[record,setRecord]=useState<StoryBatchRecord|null>(null),[pending,setPending]=useState<StoryBatchRequest|null>(null),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Record<string,string[]>>({}),[confirmEnd,setConfirmEnd]=useState(false);
 const storageKey=`new-design:story-batch:${bookId}:${seed.mode}`,sequence=useRef(0),inFlight=useRef(false),scope=useRef(storageKey);scope.current=storageKey;
 const locked=unknown||record?.status==='running'||busy&&!record?.output;
 const accept=(next:StoryBatchRecord,request:StoryBatchRequest)=>{if(next.bookId!==bookId||next.requestKey!==request.requestKey||canonicalWriteInput(next.request)!==canonicalWriteInput(request))throw new Error('原请求来源不匹配，凭证保留。');setRecord(next);setUnknown(next.status==='running');setSelected(Object.fromEntries(next.snapshot.slots.map(slot=>[slot.id,Object.keys(next.output?.candidates[slot.id]??{}).filter(key=>blank(slot.values[key]))])));};
 useEffect(()=>{
  let active=true;sequence.current++;setBusy(false);setRecord(null);setPending(null);setUnknown(false);setError('');
  try{
   const raw=sessionStorage.getItem(storageKey),retained=raw?JSON.parse(raw) as StoryBatchRequest:null;
   if(retained&&(retained.mode!==seed.mode||!retained.requestKey))throw new Error('原候选凭证无法匹配。');
   if(retained||initialRequestKey){
    setPending(retained);setUnknown(true);
    void (async()=>{
     if(retained&&initialRequestKey&&retained.requestKey!==initialRequestKey){
      const original=await newDesignApi.readStoryBatch(bookId,retained.requestKey);if(!active)return;
      if(!original||original.status==='running'){if(original)accept(original,retained);setError('本机还有另一原请求待核对；保留原请求，确认后再打开所选记录。');return;}
     }
     const key=initialRequestKey??retained!.requestKey,next=await newDesignApi.readStoryBatch(bookId,key);if(!active)return;
     if(!next||next.snapshot.mode!==seed.mode||next.requestKey!==key){setError('指定原候选未在本书找到，不推断未执行或改选其他请求。');return;}
     const request=key===retained?.requestKey?retained:next.request;
     accept(next,request);setPending(request);sessionStorage.setItem(storageKey,JSON.stringify(request));
    })().catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'原候选未读取。');});
   }
  }catch(reason){setUnknown(true);setError(reason instanceof Error?reason.message:'原请求凭证未读取。');}
  return()=>{active=false;sequence.current++;};
 },[storageKey,initialRequestKey]);
 useEffect(()=>{onState({dirty:false,locked:!!locked,save:async()=>!locked,discard:()=>!locked});},[locked,onState]);
 const generate=async()=>{
  if(inFlight.current||locked)return;
  if(seed.mode==='setting'&&(!Number.isInteger(newCount)||newCount<0||newCount>10)){setError("新增数量请填写 0 至 10 的整数。");return;}
  const request:StoryBatchRequest=seed.mode==='setting'?{...seed,requestKey:crypto.randomUUID(),instruction:instruction.trim(),newCount}:{...seed,requestKey:crypto.randomUUID(),instruction:instruction.trim()};
  try{sessionStorage.setItem(storageKey,JSON.stringify(request));}catch{setError('未能保留候选请求，尚未提交，请检查浏览器存储权限。');return;}
  const expected=storageKey,seq=++sequence.current;inFlight.current=true;setPending(request);setRecord(null);setBusy(true);setUnknown(true);setError('');
  try{const next=await newDesignApi.generateStoryBatch(bookId,request);if(seq===sequence.current&&scope.current===expected)accept(next,request);}catch(reason){if(seq!==sequence.current||scope.current!==expected)return;const notWritten=reason instanceof ApiError&&reason.recovery?.mutationOutcome==='not_written';setUnknown(!notWritten);if(notWritten){sessionStorage.removeItem(storageKey);setPending(null);}setError(reason instanceof Error?reason.message:'候选结果待核对。');}finally{inFlight.current=false;if(seq===sequence.current&&scope.current===expected)setBusy(false);}
 };
 const read=async()=>{if(!pending||inFlight.current)return;const seq=++sequence.current,expected=storageKey;setBusy(true);setError('');try{const next=await newDesignApi.readStoryBatch(bookId,pending.requestKey);if(seq!==sequence.current||scope.current!==expected)return;if(next)accept(next,pending);else setError('未找到原请求回执，不代表未执行；原请求和已有资料保留。');}catch(reason){if(seq===sequence.current)setError(reason instanceof Error?reason.message:'原请求未读取。');}finally{if(seq===sequence.current)setBusy(false);}};
 const showValue=(key:string,value:unknown)=>{const name=(id:string)=>record?.snapshot.materials.find(item=>item.id===id)?.title??'指定对象';if(key==='relationshipPlans'&&Array.isArray(value))return value.map(row=>`${name(row.sourceId)} → ${name(row.targetId)}：${row.description}`).join('；');if(key==='eventSchedule'&&value&&typeof value==='object')return Object.entries(value as Record<string,{occurrenceOrder:number|null;timeLabel:string}>).map(([id,row])=>`${name(id)}：${row.occurrenceOrder==null?'未分配发生顺序':'发生顺序 '+row.occurrenceOrder}${row.timeLabel?' · '+row.timeLabel:''}`).join('；');return display(value);};
 const end=async()=>{if(!pending||busy||!confirmEnd)return;setBusy(true);setError('');try{const next=await newDesignApi.endUnknownStoryBatch(bookId,pending.requestKey);if(scope.current===storageKey){accept(next,pending);setConfirmEnd(false);}}catch(reason){setError(reason instanceof Error?reason.message:'原请求结束结果待核对，请读取原回执。');}finally{setBusy(false);}};
 const load=async(slotId:string)=>{if(!record||!record.output||busy)return;const keys=selected[slotId]??[];if(!keys.length){setError('请先勾选需要载入的字段。');return;}setBusy(true);setError('');const expected=storageKey,seq=++sequence.current;try{const checked=await newDesignApi.checkStoryBatchSlot(bookId,record.requestKey,slotId);if(seq!==sequence.current||scope.current!==expected)return;const values=Object.fromEntries(keys.map(key=>[key,checked.values[key]]));onRequest(()=>onLoad({...checked,values}));}catch(reason){if(seq===sequence.current)setError(reason instanceof Error?reason.message:'候选来源未核对。');}finally{if(seq===sequence.current)setBusy(false);}};
 if(!open&&!pending&&!unknown)return null;
 return <section className="nd-story-batch" aria-label={seed.mode==='setting'?'整组设定 AI 候选':'范围规划 AI 候选'} hidden={!open&&!locked}>
  <header className="nd-section-heading"><h3>{seed.mode==='setting'?'AI 准备本组设定':'AI 规划当前范围'} <Help label="整组候选">设定只补充空白字段。规划已有内容默认保留，勾选的字段才会载入编辑器。请检查后保存；规划还需明确采用才会成为创作依据。</Help></h3><button type="button" className="nd-button" disabled={!!locked} onClick={onClose}>收起候选</button></header>
  {record?.error&&<p role="alert" className="nd-message is-error">{record.error}</p>}
  {error&&<p role="alert" className="nd-message is-error">{error}</p>}
  {(error||record?.error)&&<button type="button" className="nd-button" disabled={!!locked} onClick={()=>onRequest(()=>location.assign('/new-design/structure/models'))}>核对创作模型设置</button>}
  <label>本次创作要求<textarea value={instruction} maxLength={2000} disabled={!!locked} rows={2} onChange={event=>setInstruction(event.target.value)} placeholder="可留空，由 AI 根据本书资料推荐"/></label>
  {seed.mode==='setting'&&<label>新增设定数量<input type="number" min={0} max={10} value={newCount} disabled={!!locked} onChange={event=>setNewCount(Number(event.target.value))}/></label>}
  <div className="nd-row-actions"><button type="button" className="nd-button nd-button-primary" disabled={!!locked||seed.mode==='setting'&&(!seed.typeIds.length||!seed.newTypeId)} onClick={()=>onRequest(()=>void generate())}>{record?.status==='review'?'另行准备一组候选':'准备候选'}</button>{pending&&<button type="button" className="nd-button" disabled={busy} onClick={()=>void read()}>核对原请求结果</button>}</div>
  {locked&&<p role="status">{busy?'正在处理候选请求…':'原请求结果待核对，请保留此页和请求凭证。'}</p>}
  {record?.status==='running'&&!busy&&<div><label><input type="checkbox" checked={confirmEnd} onChange={event=>setConfirmEnd(event.target.checked)}/>我确认结束此原请求的页面占用，生成结果与用量仍可能未知。</label><button type="button" className="nd-button" disabled={!confirmEnd} onClick={()=>void end()}>结束原请求占用</button></div>}
  {initialRequestKey&&pending&&pending.requestKey!==initialRequestKey&&record&&record.status!=='running'&&<button type="button" className="nd-button" onClick={()=>onRequest(()=>{sessionStorage.removeItem(storageKey);location.reload();})}>打开所选原候选</button>}
  {record&&<p>本次准备 {record.snapshot.slots.length} 项 · {record.snapshot.mode==='setting'?'故事设定':'故事规划'}{record.request.mode==='planning'&&record.request.scopeId!=='book'?' · 指定卷章范围':''}</p>}
  {record?.output&&record.snapshot.slots.map(slot=>{const values=record.output!.candidates[slot.id]??{},chosen=selected[slot.id]??[];return <article key={slot.id} className="nd-story-batch-item"><h4>{slot.title}</h4>{Object.entries(values).map(([key,value])=><label key={key} className="nd-story-batch-field"><input type="checkbox" disabled={busy} checked={chosen.includes(key)} onChange={event=>setSelected(current=>({...current,[slot.id]:event.target.checked?[...chosen,key]:chosen.filter(item=>item!==key)}))}/><span><strong>{slot.fields.find(field=>field.key===key)?.name??labels[key]??key}</strong>{!blank(slot.values[key])&&<small>原内容：{showValue(key,slot.values[key])}；勾选后将替换此字段。</small>}<p>{showValue(key,value)}</p></span></label>)}<button type="button" className="nd-button" disabled={busy||!chosen.length} onClick={()=>void load(slot.id)}>载入编辑器检查</button></article>;})}
 </section>;
}

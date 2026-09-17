import {useEffect,useMemo,useReducer,useState} from 'react';
import type {CharacterResourceLedger,ResourceBackfillScope} from '../../../common/characterResources';
import {ApiError,newDesignApi} from '../../api';
import {prepareResourceBackfillSeries,prepareResourceBackfillAi} from './preflight';
import {ResourceBackfillSeriesController} from './controller';
export function useResourceBackfillSeries(bookId:string,characterId:string){
 const [,update]=useReducer(value=>value+1,0);
 const controller=useMemo(()=>new ResourceBackfillSeriesController({bookId,characterId,key:`nd-resource-series:${bookId}:${characterId}`,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},uuid:()=>crypto.randomUUID(),changed:()=>update(),lock:async run=>{if(!navigator.locks)throw new Error('Range lock unavailable');await navigator.locks.request(`nd-resource-series:${bookId}:${characterId}`,async()=>{await run();});},prepare:input=>prepareResourceBackfillSeries(newDesignApi,bookId,input,()=>crypto.randomUUID()),prepareAi:(part,input)=>prepareResourceBackfillAi(newDesignApi,bookId,part,input.resourceScope),start:input=>newDesignApi.startResourceSupplement(bookId,input),readStart:input=>newDesignApi.readResourceSupplementStartOriginal(bookId,input),ai:command=>newDesignApi.createChapterSettlementAiExtraction(command.sessionId,command.input),readAi:command=>newDesignApi.readChapterSettlementAiOriginalReceipt(command.sessionId,command.input),notWritten:error=>error instanceof ApiError&&error.recovery?.mutationOutcome==='not_written'}),[bookId,characterId]);
 useEffect(()=>{controller.restore();return()=>controller.cancel();},[controller]);
 useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(controller.isLocked()){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[controller]);
 return controller;
}
export function ResourceBackfillSeriesPanel({controller,ledger,scope,disabled}:{controller:ResourceBackfillSeriesController;ledger:CharacterResourceLedger|null;scope:ResourceBackfillScope|null;disabled:boolean}){
 const [count,setCount]=useState('3'),[confirmed,setConfirmed]=useState(false);
 const chapters=ledger?.recentChapters.slice(0,Number(count)).sort((a,b)=>a.logicalOrder-b.logicalOrder||a.documentId.localeCompare(b.documentId))??[],locked=disabled||controller.isLocked();
 const selection=JSON.stringify({scope,documents:chapters.map(chapter=>chapter.documentId)});
 useEffect(()=>{setConfirmed(false);},[selection,controller.plan?.id,controller.plan?.stage]);
 return <section aria-label="最近章节资源回填">
  <p>先核对完整采用正文与资源范围，再按章序整理候选；请返回各章逐项人工确认，稳定章另建补充清单。</p>
  {controller.message&&<p role="status">{controller.message}</p>}
  {controller.pending()&&<button className="nd-button" disabled={controller.busy||controller.blocked} onClick={()=>void controller.verify()}>只读核对原章节请求</button>}
  {controller.plan?.stage==='ready'&&<div className="nd-row-actions"><button className="nd-button nd-button-primary" disabled={controller.busy||controller.blocked} onClick={()=>void controller.resume()}>继续原范围剩余章节</button><button className="nd-button" disabled={controller.busy||controller.blocked} onClick={()=>void controller.stop()}>结束本次范围，保留原结果</button></div>}
  {!controller.isLocked()&&<><label>回填章节范围<select disabled={locked} value={count} onChange={event=>{setCount(event.target.value);setConfirmed(false);}}><option value="3">最近三章</option><option value="5">最近五章</option></select></label>
   <ol>{chapters.map(chapter=><li key={chapter.documentId}><a href={chapter.sourceRoute}>{chapter.title}</a> · {chapter.sessionStatus==='stable'?'独立资源补充':chapter.unavailableReason??'原章节人工清单'}</li>)}</ol>
   {!chapters.length&&<p>尚无采用正文，请先在章节创作中明确采用。</p>}
   <label><input type="checkbox" disabled={locked||!scope?.resourceIds.length||!chapters.length} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>确认以上全部章节与所选人物资源范围，只准备候选。</label>
   <button className="nd-button nd-button-primary" disabled={locked||!confirmed||!scope?.resourceIds.length||!chapters.length||Boolean(ledger?.truncated)} onClick={()=>void controller.start({resourceScope:scope!,documentIds:chapters.map(chapter=>chapter.documentId)})}>AI 逐章回填最近章节</button>
  </>}
  {controller.plan&&<ol>{controller.plan.parts.map(part=><li key={part.chapter.documentId}><strong>{part.chapter.title}</strong> · {part.receipt?`${part.receipt.proposalCount} 项原候选 · ${part.receipt.status==='succeeded'?'待人工核对':'原结果需处理'}`:part.startReceipt?'独立清单已保存':'尚未生成'}{(part.receipt||part.startReceipt)&&<> <a href={part.receipt?.sourceRoute??part.startReceipt!.sourceRoute}>打开原章节清单</a></>}</li>)}</ol>}
 </section>;
}

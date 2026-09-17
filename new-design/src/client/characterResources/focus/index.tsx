import {useEffect,useMemo,useRef,useState} from 'react';
import type {CharacterResourceLedger,ResourceLedgerSelection} from '../../../common/characterResources';
import type {ResourceFocusRecord,ResourceFocusRequest,ResourceFocusPreview} from '../../../common/characterResources/focus';
import {resourceFocusRequestSchema,validResourceFocusRecord,sameResourceFocusValue} from '../../../common/characterResources/focus';
import {newDesignApi} from '../../api';
import {useReferenceCommand} from '../../referenceParity/useCommand';
import {ResourceFocusRecovery,ResourceFocusRecoveryError} from './recovery';

export function useResourceFocus(bookId:string,characterId:string,onRestore:(selection:ResourceLedgerSelection)=>void,initialId?:string|null){
 const key=`nd-resource-focus:${bookId}:${characterId}`;
 const recovery=useMemo(()=>new ResourceFocusRecovery(bookId,characterId,key,{getItem:name=>localStorage.getItem(name),setItem:(name,value)=>localStorage.setItem(name,value)},async run=>{if(!navigator.locks)throw new ResourceFocusRecoveryError('浏览器无法锁定完整原显示请求，请保留凭证核对；未发送其他请求。');await navigator.locks.request(`nd-focus-command:${key}`,async()=>{await run();});}),[key]);
 const [record,setRecord]=useState<ResourceFocusRecord|null>(null),[preview,setPreview]=useState<ResourceFocusPreview|null>(null),[busy,setBusy]=useState(false),[applied,setApplied]=useState(false),[verifiedHash,setVerifiedHash]=useState<string|null>(null),[error,setError]=useState(''),[blocked,setBlocked]=useState(false);
 const live=useRef(onRestore),alive=useRef(true),epoch=useRef(0),restored=useRef<ResourceLedgerSelection|null>(null),operating=useRef(false);live.current=onRestore;
 const isRequest=(input:unknown):input is ResourceFocusRequest=>resourceFocusRequestSchema.safeParse(input).success&&(input as ResourceFocusRequest).characterId===characterId;
 const persist=(result:ResourceFocusRecord,apply:boolean,preserveChoice=false,explicit=false)=>recovery.save(result,apply,preserveChoice,explicit);
 const verifySource=async(result:ResourceFocusRecord)=>{const seq=epoch.current,current=await newDesignApi.previewResourceFocus(bookId,characterId,result.request.selection);if(!alive.current||seq!==epoch.current)return;const same=current.sourceHash===result.request.expectedSourceHash&&sameResourceFocusValue(current.snapshot,result.snapshot);setVerifiedHash(same?current.sourceHash:null);if(!same){live.current(current.snapshot.selection);setError('建议来源已有变化，原结果保留；请查看全部资源并重新核对。');}};
 const command=useReferenceCommand<ResourceFocusRequest,ResourceFocusRecord>(key,{
  valid:isRequest,write:input=>newDesignApi.generateResourceFocus(bookId,input),read:input=>newDesignApi.readResourceFocusOriginal(bookId,input),
  restore:input=>{restored.current=input.selection;},
  accept:async(result,input)=>{
   if(!validResourceFocusRecord(result,bookId,characterId)||!sameResourceFocusValue(result.request,input))throw new Error('原资源建议回执与完整原来源不同，凭证保留。');
   if(result.status==='running')throw new Error('原资源建议仍待核对，请保留完整凭证；未再次调用AI。');
   const choice=persist(result,false,true);setRecord(result);setApplied(choice);setVerifiedHash(null);setPreview(null);
   try{await verifySource(result);}catch{if(alive.current)setError('原建议已保存，当前来源未能读取，请查看全部资源；读取可重试。');}
  },
 });
 useEffect(()=>{alive.current=true;const seq=++epoch.current;operating.current=false;setRecord(null);setPreview(null);setApplied(false);setVerifiedHash(null);setError('');setBlocked(false);setBusy(true);
  const read=async()=>{
   try{
    if(command.isLocked())return;
    const raw=localStorage.getItem(`${key}:result`),saved=raw?JSON.parse(raw):null;
    if(saved&&(saved.format!==1||saved.bookId!==bookId||saved.characterId!==characterId||typeof saved.applied!=='boolean'||!validResourceFocusRecord(saved.record,bookId,characterId)))throw new Error('原显示建议凭证无法读取，请保留浏览器记录核对。');
    const result=initialId?await newDesignApi.getResourceFocusRecord(bookId,characterId,initialId):saved?await newDesignApi.readResourceFocusOriginal(bookId,saved.record.request):null;
    if(!alive.current||seq!==epoch.current)return;
    if((initialId||saved)&&!result)throw new Error('原显示建议记录尚未读取，请保留完整原凭证；未准备其他请求。');
    if(!result)return;
    if(!validResourceFocusRecord(result,bookId,characterId))throw new Error('原显示建议来源与当前人物不同。');
    setRecord(result);setApplied(!initialId&&saved?.applied===true&&sameResourceFocusValue(saved.record,result));restored.current=result.request.selection;live.current(result.request.selection);await verifySource(result);
   }catch(reason){if(alive.current&&seq===epoch.current){setApplied(false);setBlocked(true);setError(reason instanceof Error?reason.message:'原显示建议读取待核对，请保留凭证。');}}finally{if(alive.current&&seq===epoch.current)setBusy(false);}
  };void read();return()=>{alive.current=false;epoch.current++;};
 },[key,initialId]);
 const locked=command.locked||busy||blocked||record?.status==='running';
 const prepare=async(selection:ResourceLedgerSelection)=>{if(locked)return;const seq=epoch.current;setBusy(true);setError('');try{const result=await newDesignApi.previewResourceFocus(bookId,characterId,selection);if(alive.current&&seq===epoch.current){setPreview(result);setVerifiedHash(null);setApplied(false);}}catch(reason){if(alive.current&&seq===epoch.current)setError(reason instanceof Error?reason.message:'原资源范围未完整读取。');}finally{if(alive.current&&seq===epoch.current)setBusy(false);}};
 const action=async(input:ResourceFocusRequest,write:boolean,run:(seq:number)=>Promise<void>)=>{
  if(busy||command.busy||blocked||operating.current)return;const seq=epoch.current;operating.current=true;setBusy(true);setError('');
  try{await recovery.exclusive(input,write,async()=>{if(alive.current&&seq===epoch.current)await run(seq);});}
  catch(reason){if(alive.current&&seq===epoch.current){if(reason instanceof ResourceFocusRecoveryError)setBlocked(true);setApplied(false);setVerifiedHash(null);setError(reason instanceof Error?reason.message:'完整原请求未核对，请保留凭证并查看全部资源。');}}
  finally{if(alive.current&&seq===epoch.current){operating.current=false;setBusy(false);}}
 };
 const generate=async(input:ResourceFocusRequest)=>{if(locked)return;await action(input,true,async()=>{await command.perform(input);});};
 const apply=async()=>{if(locked||!record?.output||record.status!=='review')return;await action(record.request,false,async seq=>{const current=await newDesignApi.previewResourceFocus(bookId,characterId,record.request.selection);if(!alive.current||seq!==epoch.current)return;if(current.sourceHash!==record.request.expectedSourceHash||!sameResourceFocusValue(current.snapshot,record.snapshot)){setApplied(false);setVerifiedHash(null);live.current(current.snapshot.selection);setError('原建议来源已变化，请保留原结果并查看全部资源。');return;}persist(record,true,false,true);setVerifiedHash(current.sourceHash);setApplied(true);});};
 const showAll=async()=>{if(locked||!record)return;await action(record.request,false,async()=>{persist(record,false,false,true);setApplied(false);});};
 const verifyOriginal=async()=>{const input=command.pending??record?.request;if(!input)return;await action(input,false,async seq=>{if(command.pending){await command.verify();return;}const result=await newDesignApi.readResourceFocusOriginal(bookId,input);if(!alive.current||seq!==epoch.current)return;if(!result||!validResourceFocusRecord(result,bookId,characterId)||!sameResourceFocusValue(result.request,input))throw new Error('完整原显示建议结果未核对，原凭证保留。');const choice=persist(result,false,true);setRecord(result);setApplied(choice);await verifySource(result);});};
 const endUnknown=async()=>{const input=command.pending??record?.request;if(!input)return;await action(input,false,async seq=>{const result=await newDesignApi.endUnknownResourceFocus(bookId,input);if(!alive.current||seq!==epoch.current)return;if(!validResourceFocusRecord(result,bookId,characterId)||!sameResourceFocusValue(result.request,input)||result.stage!=='ended_unknown')throw new Error('结束原占用的完整结果尚未核对，凭证保留。');persist(result,false);setRecord(result);setApplied(false);setVerifiedHash(null);if(command.pending)await command.verify();});};
 return{record,preview,busy,applied,verifiedHash,error,blocked,locked,command,prepare,generate,apply,showAll,verifyOriginal,endUnknown,getRestoredSelection:()=>restored.current};
}
export type ResourceFocusController=ReturnType<typeof useResourceFocus>;
export {resourceFocusView} from './view';
export function ResourceFocusPanel({controller,selection,disabled}:{controller:ResourceFocusController;selection:ResourceLedgerSelection|null;disabled:boolean}){
 const [confirmed,setConfirmed]=useState(false),[confirmEnd,setConfirmEnd]=useState(false);
 useEffect(()=>{setConfirmed(false);},[controller.preview?.sourceHash,selection?.specificationHash,controller.record?.id]);
 useEffect(()=>{setConfirmEnd(false);},[controller.command.pending?.requestKey,controller.record?.id]);
 return <section aria-label="人物资源显示建议">
  <p>AI 根据原人物档案和资源策划建议显示范围；未知保持待核对，全部原资源可随时查看。</p>
  {controller.error&&<p role="alert">{controller.error}</p>}{controller.command.message&&<p role="status">{controller.command.message}</p>}
  {(controller.command.pending||controller.record?.status==='running')&&<button className="nd-button" disabled={controller.command.busy||controller.busy||controller.blocked} onClick={()=>void controller.verifyOriginal()}>只读核对原显示建议</button>}
  {(controller.command.pending||controller.record?.status==='running')&&<div><label><input type="checkbox" disabled={controller.busy||controller.command.busy||controller.blocked} checked={confirmEnd} onChange={event=>setConfirmEnd(event.target.checked)}/>确认结束原占用，保留完整来源；模型结果和用量仍可能未知。</label><button className="nd-button" disabled={!confirmEnd||controller.busy||controller.command.busy||controller.blocked} onClick={()=>void controller.endUnknown()}>结束原显示建议占用</button></div>}
  <button className="nd-button" disabled={disabled||controller.locked||!selection} onClick={()=>void controller.prepare(selection!)}>核对人物与完整资源范围</button>
  {controller.preview&&<><p>人物：{controller.preview.snapshot.ledger.characterName}；{controller.preview.snapshot.ledger.items.length} 条原资源关系。</p><details><summary>本次判断的原档案与策划</summary>{controller.preview.snapshot.evidenceSources.map(source=><p key={`${source.cardId}:${source.fieldKey}`}>{controller.preview!.snapshot.objects.find(object=>object.id===source.cardId)?.title} · {source.fieldKey}：{source.text}</p>)}</details>
   <label><input type="checkbox" disabled={disabled||controller.locked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>确认以上原来源，只准备显示建议。</label>
   <button className="nd-button" disabled={disabled||controller.locked||!confirmed||!sameResourceFocusValue(selection,controller.preview.snapshot.selection)} onClick={()=>void controller.generate({requestKey:crypto.randomUUID(),characterId:controller.preview!.snapshot.characterId,selection:controller.preview!.snapshot.selection,expectedSourceHash:controller.preview!.sourceHash,instruction:''})}>AI 准备资源显示建议</button>
  </>}
  {controller.record&&<><p>原建议：{controller.record.status==='review'?'待核对':controller.record.error||'结果待核对'} <a href={controller.record.sourceRoute}>打开原显示建议</a></p>{controller.record.output&&<><p>AI 定位建议：{({protagonist:'主角',long_term:'长期角色',temporary:'临时角色',unknown:'未知'})[controller.record.output.role.value]}；{controller.record.output.role.explanation}</p><details><summary>逐项重要性与原文出处</summary>{controller.record.output.resources.map(item=><p key={item.relationId}>{controller.record!.snapshot.ledger.items.find(original=>original.relationId===item.relationId)?.name}：{({key:'关键',ordinary:'普通',unknown:'未知'})[item.importance]}；{item.explanation}{item.evidence.map((proof,index)=><span key={index}> · 原字段 {proof.fieldKey}：{proof.excerpt}</span>)}</p>)}</details><div className="nd-row-actions"><button className="nd-button" disabled={disabled||controller.locked} onClick={()=>void controller.apply()}>核对原来源并采用显示建议</button><button className="nd-button" disabled={disabled||controller.locked} onClick={controller.showAll}>显示全部原资源</button></div></>}{controller.record.output?.notes.map((note,index)=><p key={index}>{note}</p>)}</>}
 </section>;
}

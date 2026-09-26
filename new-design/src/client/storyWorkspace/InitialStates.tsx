import {useEffect,useRef,useState} from 'react';
import type {EntityInitialState,FieldDefinition,StateSubjectKind} from '../../common/contracts';
import {initialWriteInput} from '../../common/storyWorkspace';
import {writeInputHash} from '../../common/storyWorkspace';
import {ApiError,newDesignApi} from '../api';
import DynamicForm from '../DynamicForm';
import Help from './Help';
import type {WorkspaceEditor} from './useGuard';

export default function InitialStates({bookId,subjectId,subjectKind='card',fields,onState}:{bookId:string;subjectId:string;subjectKind?:StateSubjectKind;fields:FieldDefinition[];onState:(state:WorkspaceEditor)=>void}) {
 const [states,setStates]=useState<EntityInitialState[]>([]),[values,setValues]=useState<Record<string,unknown>>({}),[base,setBase]=useState<Record<string,unknown>>({}),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const active=useRef(true),inFlight=useRef(false),unknownRef=useRef(false),storageKey=`new-design:setting-initial:${bookId}:${subjectKind}:${subjectId}`;
 unknownRef.current=unknown;
 const dirty=JSON.stringify(values)!==JSON.stringify(base);
 const read=async()=>{setBusy(true);try{const all=await newDesignApi.listInitialStates(bookId);if(!active.current)return;const own=all.filter(item=>item.bookId===bookId&&item.subjectKind===subjectKind&&item.subjectId===subjectId);setStates(own);const next=Object.fromEntries(own.map(item=>[item.stateKey,item.currentValue]));setBase(next);if(!dirty&&!unknownRef.current)setValues(next);setReady(true);setError(unknownRef.current?'已读取当前初始值；请按原保存请求核对回执，不重复保存。':'');}catch(reason){if(active.current)setError(reason instanceof Error?reason.message:'初始状态未读取，不能保存。');}finally{if(active.current)setBusy(false);}};
 useEffect(()=>{active.current=true;try{const raw=sessionStorage.getItem(storageKey);if(raw){const saved=JSON.parse(raw);if(saved?.pending===true&&saved.values&&typeof saved.values==='object'){unknownRef.current=true;setUnknown(true);setValues(saved.values);setError('原初始值保存结果待核对，填写与请求保留。');}}}catch{unknownRef.current=true;setUnknown(true);setError('原请求凭证无法读取，不能重复保存。');}void read();return()=>{active.current=false;};},[storageKey]);
 const save=async()=>{
  if(busy||unknown||!ready||inFlight.current)return false;inFlight.current=true;setBusy(true);setError('');
  const savedStates=[...states];let sent=false;
  try{
   for(const field of fields){
    if(JSON.stringify(values[field.key])===JSON.stringify(base[field.key])||values[field.key]===undefined)continue;
    const existing=savedStates.find(item=>item.stateKey===field.key),input={requestKey:crypto.randomUUID(),subjectKind,subjectId,stateKey:field.key,value:values[field.key],sourceFactId:null,expectedRevision:existing?.revision??0,actor:'user',note:'在故事设定中确认初始状态'};
    sessionStorage.setItem(storageKey,JSON.stringify({pending:true,values,input}));setUnknown(true);unknownRef.current=true;sent=true;
    let result:EntityInitialState;
    try{result=await newDesignApi.saveInitialState(bookId,input);}catch(reason){if(reason instanceof ApiError&&reason.recovery?.mutationOutcome==='not_written'){sessionStorage.removeItem(storageKey);sent=false;setUnknown(false);unknownRef.current=false;}throw reason;}
    if(result.bookId!==bookId||result.subjectId!==subjectId||result.subjectKind!==subjectKind||result.stateKey!==field.key||!result.versions.some(version=>version.id===input.requestKey))throw new Error('初始值保存回执不匹配，请核对原请求。');
    const at=savedStates.findIndex(item=>item.stateKey===field.key);if(at>=0)savedStates[at]=result;else savedStates.push(result);
    sessionStorage.removeItem(storageKey);setUnknown(false);unknownRef.current=false;sent=false;
    if(active.current){setStates([...savedStates]);setBase(current=>({...current,[field.key]:values[field.key]}));}
   }
   return true;
  }catch(reason){if(active.current){setUnknown(sent);unknownRef.current=sent;setError(reason instanceof Error?reason.message:'原初始值保存结果待核对。');}return false;}finally{inFlight.current=false;if(active.current)setBusy(false);}
 };
 const readReceipt=async()=>{
  if(busy||inFlight.current)return;setBusy(true);setError('');
  try{
   const raw=sessionStorage.getItem(storageKey),pending=raw?JSON.parse(raw):null,input=pending?.input;
   if(!input?.requestKey){setError('原凭证没有完整请求标识，不能以相似内容确认成功；填写保留。');return;}
   const receipt=await newDesignApi.readInitialStateWriteReceipt(bookId,input.requestKey);if(!active.current)return;
   if(!receipt){setError('未找到原初始值回执，不代表未执行；请求和填写保留，不重复保存。');return;}
   const hash=await writeInputHash(initialWriteInput({bookId,...input}));
   if(receipt.bookId!==bookId||receipt.requestKey!==input.requestKey||receipt.version.id!==input.requestKey||receipt.input.subjectKind!==subjectKind||receipt.input.subjectId!==subjectId||receipt.inputHash!==hash){setError('原初始值回执输入不匹配，填写和凭证保留。');return;}
   sessionStorage.removeItem(storageKey);setUnknown(false);unknownRef.current=false;await read();if(active.current)setError('原保存请求已确认。其余未保存填写保留，请检查后继续保存。');
  }catch(reason){if(active.current)setError(reason instanceof Error?reason.message:'原初始值回执未读取。');}finally{if(active.current)setBusy(false);}
 };
 useEffect(()=>{onState({dirty,locked:busy||unknown||!ready,save,discard:()=>{if(busy||unknown||inFlight.current)return false;setValues({...base});return true;}});},[dirty,busy,unknown,ready,values,base,onState]);
 useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty||unknown||busy){event.preventDefault();event.returnValue='';}};addEventListener('beforeunload',leave);return()=>removeEventListener('beforeunload',leave);},[dirty,unknown,busy]);
 return <section className="nd-story-initial"><h3>初始状态 <Help label="初始状态">记录故事开始时的值，字段来自本书模板与状态配置。后续章节变化、当前状态与历史快照沿各自记录保留；档案填写值不会自动成为初始状态。</Help></h3>{error&&<p className="nd-message" role={unknown?'alert':'status'}>{error}</p>}{busy&&<p role="status">正在处理初始状态…</p>}{fields.length?<><DynamicForm compactHelp fields={fields} values={values} disabled={busy||unknown||!ready} onChange={setValues}/><div className="nd-row-actions"><button className="nd-button nd-button-primary" disabled={busy||unknown||!ready||!dirty} onClick={()=>void save()}>保存初始状态</button><button className="nd-button" disabled={busy||dirty&&!unknown} onClick={()=>void read()}>只读核对初始状态</button>{unknown&&<button className="nd-button" disabled={busy} onClick={()=>void readReceipt()}>核对原保存回执</button>}</div></>:<p>本书没有为此对象配置可填写的初始状态。</p>}</section>;
}

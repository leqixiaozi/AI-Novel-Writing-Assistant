import {useEffect,useRef,useState} from 'react';
import type {PublicationExportManifest,PublicationExportRecord} from '../../common/contracts';
import {ApiError,newDesignApi} from '../api';

type OriginalSubmit={bookId:string;manifestId:string;expectedSourceHash:string;requestedBy:string;idempotencyKey:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function valid(value:unknown,bookId:string):value is OriginalSubmit{
 if(!value||typeof value!=='object')return false;
 const item=value as Partial<OriginalSubmit>;
 return item.bookId===bookId&&typeof item.manifestId==='string'&&uuid.test(item.manifestId)&&typeof item.expectedSourceHash==='string'&&/^[a-f0-9]{64}$/.test(item.expectedSourceHash)&&item.requestedBy==='local-author'&&typeof item.idempotencyKey==='string'&&item.idempotencyKey.length>=8&&item.idempotencyKey.length<=200;
}

/** Retain the exact command before sending; recovery performs only a GET. */
export default function useExportSubmission(bookId:string,onSubmitted:(record:PublicationExportRecord)=>Promise<void>,onRejected:()=>void){
 const key=`new-design:publication-submit:${bookId}`;
 const [pending,setPending]=useState<OriginalSubmit|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[storageBlocked,setStorageBlocked]=useState(false);
 const liveBook=useRef(bookId),inFlight=useRef<symbol|null>(null),original=useRef<OriginalSubmit|null>(null);liveBook.current=bookId;
 const restore=()=>{
  if(inFlight.current)return;
  original.current=null;setPending(null);setError('');setStorageBlocked(false);setLoading(true);
  try{const raw=sessionStorage.getItem(key);if(raw){const value:unknown=JSON.parse(raw);if(!valid(value,bookId))throw Error('原导出恢复凭证无法核对；暂不允许提交另一任务，请检查网站存储。');original.current=value;setPending(value);}}
  catch(cause){setStorageBlocked(true);setError(cause instanceof Error?cause.message:'原导出凭证读取失败。');}
  finally{setLoading(false);}
 };
 useEffect(()=>{liveBook.current=bookId;inFlight.current=null;setBusy(false);restore();return()=>{liveBook.current='';};},[bookId,key]);
 const accept=async(record:PublicationExportRecord,command:OriginalSubmit)=>{
  if(record.manifest.bookId!==command.bookId||record.manifest.id!==command.manifestId||record.manifest.sourceHash!==command.expectedSourceHash||record.requestedBy!==command.requestedBy)throw Error('导出回执与原书、清单或作者不匹配；原凭证保留。');
  if(liveBook.current!==command.bookId||original.current?.idempotencyKey!==command.idempotencyKey)return;
  sessionStorage.removeItem(key);original.current=null;setPending(null);setError('');
  await onSubmitted(record);
 };
 const submit=async(manifest:PublicationExportManifest)=>{
  if(inFlight.current||loading||original.current||storageBlocked||manifest.bookId!==bookId)return;
  const command:OriginalSubmit={bookId,manifestId:manifest.id,expectedSourceHash:manifest.sourceHash,requestedBy:'local-author',idempotencyKey:`publication:${crypto.randomUUID()}`};
  try{sessionStorage.setItem(key,JSON.stringify(command));}
  catch{setStorageBlocked(true);setError('浏览器无法保留原导出凭证，本次未发送；请检查网站存储。');return;}
  const token=Symbol();original.current=command;setPending(command);inFlight.current=token;setBusy(true);setError('');
  try{await accept(await newDesignApi.submitPublicationExport(command.manifestId,command),command);}
  catch(cause){if(liveBook.current===bookId&&original.current?.idempotencyKey===command.idempotencyKey){
   if(cause instanceof ApiError&&cause.recovery?.mutationOutcome==='not_written'){
    try{sessionStorage.removeItem(key);original.current=null;setPending(null);onRejected();}
    catch{setStorageBlocked(true);}
   }
   setError(cause instanceof Error?cause.message:'原导出结果未确认，请只读核对，不再次提交。');
  }}
  finally{if(inFlight.current===token){inFlight.current=null;if(liveBook.current===bookId)setBusy(false);}}
 };
 const check=async()=>{
  const command=original.current;if(!command||inFlight.current)return;
  const token=Symbol();inFlight.current=token;setBusy(true);
  try{const record=await newDesignApi.readPublicationExportReceipt(command.manifestId,{expectedSourceHash:command.expectedSourceHash,requestedBy:command.requestedBy,idempotencyKey:command.idempotencyKey});if(record)await accept(record,command);else if(liveBook.current===bookId)setError('未读取到原导出回执，不能据此断言未提交；原凭证保留，不生成另一任务。');}
  catch(cause){if(liveBook.current===bookId)setError(cause instanceof Error?cause.message:'原导出回执未读取，凭证保留。');}
  finally{if(inFlight.current===token){inFlight.current=null;if(liveBook.current===bookId)setBusy(false);}}
 };
 return {pending,busy,error,locked:loading||busy||Boolean(pending)||storageBlocked,submit,check,restore};
}

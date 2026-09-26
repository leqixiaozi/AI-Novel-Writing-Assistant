import {useEffect,useRef,useState} from 'react';
import {ApiError} from '../api';
// Recovery reads the complete original command; an absent receipt never authorizes another write.
export function useReferenceCommand<Input,Result>(storage:string,options:{valid:(input:unknown)=>input is Input;write:(input:Input)=>Promise<Result>;read:(input:Input)=>Promise<Result|null>;accept:(result:Result,input:Input)=>Promise<void>;restore?:(input:Input)=>void;onLock?:(locked:boolean)=>void}){
 const [pending,setPending]=useState<Input|null>(null),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const original=useRef<Input|null>(null),running=useRef(false),storageBlocked=useRef(false),live=useRef(options);live.current=options;
 const scope=useRef(storage),alive=useRef(true),epoch=useRef(0);scope.current=storage;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  epoch.current++;original.current=null;running.current=false;storageBlocked.current=false;setPending(null);setBusy(false);setBlocked(false);setMessage('');
  try{const raw=localStorage.getItem(storage);if(!raw)return;const saved=JSON.parse(raw);if(saved.format!==1||saved.storage!==storage||!live.current.valid(saved.input))throw new Error();original.current=saved.input;setPending(saved.input);live.current.restore?.(saved.input);setMessage('原请求结果待核对，填写与凭证保留。');}
  catch{storageBlocked.current=true;setBlocked(true);setMessage('原请求凭证无法读取，请保留浏览器记录并打开运行维护核对。');}
 },[storage]);
 useEffect(()=>{live.current.onLock?.(pending!==null||busy||blocked);},[pending,busy,blocked]);
 const current=(originalScope:string,originalEpoch:number)=>alive.current&&scope.current===originalScope&&epoch.current===originalEpoch;
 async function finish(result:Result,input:Input,originalScope:string,originalEpoch:number,accept:typeof options.accept){
  if(!current(originalScope,originalEpoch))return false;
  await accept(result,input);if(!current(originalScope,originalEpoch))return false;
  localStorage.removeItem(originalScope);original.current=null;setPending(null);setMessage('原请求结果已确认。');return true;
 }
 async function perform(input:Input){
  if(original.current||running.current||storageBlocked.current)return false;
  const commandOptions=live.current,originalEpoch=epoch.current;
  if(!commandOptions.valid(input)){setMessage('请求范围不完整，请保留填写并重新预览。');return false;}
  const frozen=structuredClone(input);
  try{localStorage.setItem(storage,JSON.stringify({format:1,storage,input:frozen}));}
  catch{storageBlocked.current=true;setBlocked(true);setMessage('发送前无法保留原请求，尚未提交，请恢复浏览器存储。');return false;}
  original.current=frozen;setPending(frozen);running.current=true;setBusy(true);setMessage('');let confirmed=false;
  try{const result=await commandOptions.write(frozen);confirmed=true;return await finish(result,frozen,storage,originalEpoch,commandOptions.accept);}
  catch(error){
   if(!current(storage,originalEpoch))return false;
   if(!confirmed&&error instanceof ApiError&&error.recovery?.mutationOutcome==='not_written'){
    try{localStorage.removeItem(storage);original.current=null;setPending(null);setMessage(`${error.message}。本次未写入，请重新读取并预览。`);}
    catch{storageBlocked.current=true;setBlocked(true);setMessage('本次未写入，但原凭证无法清理，请恢复浏览器存储。');}
   }else setMessage(`${error instanceof Error?error.message:'响应中断'}。原结果待核对，禁止重复提交。`);
   return false;
  }finally{if(current(storage,originalEpoch)){running.current=false;setBusy(false);}}
 }
 async function verify(){
  const input=original.current;if(!input||running.current)return false;
  const commandOptions=live.current,originalEpoch=epoch.current;running.current=true;setBusy(true);
  try{const result=await commandOptions.read(input);if(!current(storage,originalEpoch))return false;if(!result){setMessage('原回执尚未读取，不能证明未写入；保留原请求继续核对。');return false;}return await finish(result,input,storage,originalEpoch,commandOptions.accept);}
  catch(error){if(current(storage,originalEpoch))setMessage(`${error instanceof Error?error.message:'核对失败'}。原凭证保留。`);return false;}
  finally{if(current(storage,originalEpoch)){running.current=false;setBusy(false);}}
 }
 return{pending,busy,blocked,message,locked:pending!==null||busy||blocked,isLocked:()=>original.current!==null||running.current||storageBlocked.current,perform,verify};
}

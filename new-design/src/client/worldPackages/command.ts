import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,newDesignApi} from '../api';
import {worldInstallCommitSchema,worldSyncCommitSchema,worldLibraryCommitSchema,worldLibraryPublishSchema,type WorldInstallCommit,type WorldInstallReceipt,type WorldSyncCommit,type WorldSyncReceipt,type WorldLibraryCommit,type WorldLibraryPublish,type WorldLibraryReceipt} from '../../common/worldPackages';

export type WorldCommand={kind:'install';bookId:string;input:WorldInstallCommit}|{kind:'sync';bookId:string;input:WorldSyncCommit}|{kind:'libraryPrepare';bookId:string;input:WorldLibraryCommit}|{kind:'libraryPublish';bookId:string;input:WorldLibraryPublish};
export type WorldResult=WorldInstallReceipt|WorldSyncReceipt|WorldLibraryReceipt;
const stable=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function valid(value:unknown,book:string):value is WorldCommand {if(!value||typeof value!=='object')return false;const item=value as WorldCommand;if(item.bookId!==book)return false;switch(item.kind){case 'install':return worldInstallCommitSchema.safeParse(item.input).success;case 'sync':return worldSyncCommitSchema.safeParse(item.input).success;case 'libraryPrepare':return worldLibraryCommitSchema.safeParse(item.input).success;case 'libraryPublish':return worldLibraryPublishSchema.safeParse(item.input).success;default:return false;}}
async function send(book:string,command:WorldCommand,verify:boolean):Promise<WorldResult|null>{switch(command.kind){case 'install':return verify?newDesignApi.worldPackages.installOriginal(book,command.input):newDesignApi.worldPackages.install(book,command.input);case 'sync':return verify?newDesignApi.worldPackages.original(book,command.input):newDesignApi.worldPackages.save(book,command.input);case 'libraryPrepare':return verify?newDesignApi.worldPackages.libraryOriginal(book,command.input):newDesignApi.worldPackages.libraryPrepare(book,command.input);case 'libraryPublish':return verify?newDesignApi.worldPackages.libraryOriginal(book,command.input):newDesignApi.worldPackages.libraryPublish(book,command.input);}}
export function useWorldCommand(book:string,root:string,accept:(result:WorldResult,command:WorldCommand)=>Promise<void>){
 const storage=`new-design:world-command:${book}:${root}`,history=`${storage}:confirmed`,[pending,setPending]=useState<WorldCommand|null>(null),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(true),live=useRef(accept),scope=useRef(storage);live.current=accept;scope.current=storage;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const read=useCallback(()=>{try{const raw=localStorage.getItem(storage);if(!raw){setPending(null);return null;}const value:unknown=JSON.parse(raw);if(!valid(value,book))throw new Error('原请求凭证无法读取，请保留浏览器记录并核对原世界。');setPending(value);return value;}catch(error){setBlocked(true);setMessage(error instanceof Error?error.message:'原请求凭证无法读取。');return null;}},[storage,book]);
 useEffect(()=>{setBusy(false);setBlocked(false);setMessage('');read();const update=(event:StorageEvent)=>{if(event.key===storage)read();};window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[read,storage]);
 async function run(command:WorldCommand|null,verify:boolean){
  if(busy||blocked)return false;
  if(!navigator.locks){setBlocked(true);setMessage('浏览器无法保护原请求，请在支持安全本地访问的浏览器中核对世界。');return false;}
  const originalScope=storage;let confirmed=false;
  return navigator.locks.request(storage,{ifAvailable:true},async lock=>{
   if(!mounted.current||scope.current!==originalScope)return false;
   if(!lock){setMessage('另一个页面正在处理本书世界，请稍后核对原结果。');return false;}
   let original:WorldCommand|null=null;
   try{const raw=localStorage.getItem(storage);if(raw){const value:unknown=JSON.parse(raw);if(!valid(value,book))throw new Error('原请求凭证无法读取。');original=value;}if(verify){if(!original)return false;}else{if(original){setPending(original);setMessage('请先核对原请求结果。');return false;}if(!command||!valid(command,book))throw new Error('请求范围不完整，请重新预览。');original=structuredClone(command);localStorage.setItem(storage,JSON.stringify(original));if(localStorage.getItem(storage)!==JSON.stringify(original)){setBlocked(true);throw new Error('原请求凭证未能完整保留，请恢复浏览器存储后核对。');}}setPending(original);setBusy(true);
    const frozen=original!;
    if(!mounted.current||scope.current!==originalScope)return false;
    const result=await send(book,frozen,verify);
    if(!result){if(mounted.current&&scope.current===originalScope)setMessage('原结果尚未读取，请保留原请求继续核对。');return false;}confirmed=true;
    const requestKey=frozen.kind==='install'?frozen.input.input.requestKey:frozen.input.requestKey;
    if(result.bookId!==book||result.requestKey!==requestKey||stable(result.input)!==stable(frozen.input))throw new Error('返回结果与完整原请求不匹配，请保留原凭证。');
    // Retain the complete confirmed result before removing the recovery command.
    localStorage.setItem(history,JSON.stringify({command:frozen,result}));
    if(localStorage.getItem(history)!==JSON.stringify({command:frozen,result}))throw new Error('已确认结果未能完整保留，原请求继续保留。');
    if(!mounted.current||scope.current!==originalScope)return false;
    await live.current(result,frozen);
    if(!mounted.current||scope.current!==originalScope)return false;
    if(localStorage.getItem(storage)!==JSON.stringify(frozen))throw new Error('原请求凭证已变化，请核对原结果。');
    localStorage.removeItem(storage);if(localStorage.getItem(storage)!==null)throw new Error('原请求凭证未能清理，请只读核对已确认结果。');if(mounted.current&&scope.current===originalScope){setPending(null);setMessage('保存结果已确认。');}return true;
   }catch(error){
    if(!mounted.current||scope.current!==originalScope)return false;
    try{
     if(!confirmed&&!verify&&error instanceof ApiError&&error.recovery?.mutationOutcome==='not_written'&&original&&localStorage.getItem(storage)===JSON.stringify(original)){
      localStorage.removeItem(storage);if(localStorage.getItem(storage)!==null)throw new Error();
      setPending(null);setMessage(`${error.message}。未写入，请保留填写重新预览。`);
     }else setMessage(`${error instanceof Error?error.message:'响应中断'}。请核对原结果，避免重复提交。`);
    }catch{setBlocked(true);setMessage('浏览器里的原请求未能安全核对或清理，请保留记录并恢复网站存储后核对。');}
    return false;
   }
   finally{if(mounted.current&&scope.current===originalScope)setBusy(false);}
  });
 }
 return{pending,busy,blocked,message,locked:!!pending||busy||blocked,perform:(command:WorldCommand)=>run(command,false),verify:()=>run(null,true)};
}

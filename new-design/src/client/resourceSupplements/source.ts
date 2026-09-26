import {useCallback,useEffect,useRef,useState} from 'react';
import type {ResourceSupplementFrozenSource} from '../../common/resourceSupplements/correction';
import {newDesignApi} from '../api';
export function useResourceSupplementSource(book:string,session:string|null,body?:string){
 const [source,setSource]=useState<ResourceSupplementFrozenSource|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),epoch=useRef(0),alive=useRef(true);
 const reload=useCallback(async()=>{const seq=++epoch.current;if(!session){setSource(null);setError('');setBusy(false);return;}setBusy(true);try{
  const result=await newDesignApi.getResourceSupplementSource(book,session);if(result.bookId!==book||result.basis.bookId!==book||body&&result.basis.bodyVersionId!==body)throw new Error('原来源不属于当前书籍或本章正文。');
  if(alive.current&&epoch.current===seq){setSource(result);setError('');}
 }catch(reason){if(alive.current&&epoch.current===seq){setSource(null);setError(reason instanceof Error?reason.message:'原资源来源未读取。');}}finally{if(alive.current&&epoch.current===seq)setBusy(false);}},[book,session,body]);
 useEffect(()=>{alive.current=true;setSource(null);void reload();return()=>{alive.current=false;epoch.current++;};},[reload]);
 return {source,error,busy,reload};
}

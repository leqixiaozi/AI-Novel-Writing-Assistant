import {useEffect,useState} from 'react';
import type {ResourceBackfillScope} from '../../common/characterResources';
import {newDesignApi} from '../api';
import StartPanel from './StartPanel';
export default function ResourceSupplementIssuePanel({bookId,issueId,documentId,disabled=false,onLockChange}:{bookId:string;issueId:string;documentId:string;disabled?:boolean;onLockChange?:(locked:boolean)=>void}){
 const [scope,setScope]=useState<ResourceBackfillScope|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[names,setNames]=useState<string[]>([]);
 useEffect(()=>{let active=true;setScope(null);setError('');void(async()=>{
  try{const source=await newDesignApi.getResourceSupplementIssueSource(bookId,issueId);
   if(source.issue.book_id!==bookId||source.issue.issue_id!==issueId||source.issue.chapter_document_id!==documentId)throw new Error('冲突来源不属于当前书籍章节，请从原人物资源页返回。');
   const declared=source.resourceScope,ledger=await newDesignApi.getCharacterResources(bookId,declared.characterId,{relationTypeId:declared.relationTypeId,holdingDimensionKey:declared.holdingDimensionKey,specificationHash:declared.specificationHash});
   const items=ledger.items.filter(item=>declared.resourceIds.includes(item.resourceId)&&declared.relationIds.includes(item.relationId));
   if(ledger.truncated||!ledger.selection||items.length!==declared.relationIds.length||new Set(items.map(item=>item.resourceId)).size!==declared.resourceIds.length)throw new Error('原资源范围未能完整读取，请回人物资源页明确选择完整范围。');
   if(active){setScope({...ledger.selection,characterId:ledger.characterId,characterVersionId:ledger.characterVersionId,characterRevision:ledger.characterRevision,resourceIds:[...declared.resourceIds],relationIds:[...declared.relationIds]});setNames(items.map(item=>item.name));}
  }catch(reason){if(active)setError(reason instanceof Error?reason.message:'原资源冲突依据未读取。');}
 })();return()=>{active=false;};},[bookId,issueId,documentId,attempt]);
 return <section className="nd-settlement-source" aria-label="本章资源冲突"><h3>本章资源来源需核对</h3>
  {error?<p role="alert">{error} <button className="nd-button" onClick={()=>setAttempt(value=>value+1)}>重新读取原来源</button></p>:!scope?<p role="status">正在读取本章冲突及完整人物资源范围…</p>:<><p>资源范围：{names.join('、')}。预览实际章前来源后，明确创建独立修正清单。</p><StartPanel bookId={bookId} issueId={issueId} scope={scope} disabled={disabled} onLockChange={onLockChange}/></>}
 </section>;
}

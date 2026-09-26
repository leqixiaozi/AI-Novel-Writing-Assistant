import {useEffect,useState} from 'react';
import type {BookSummary,CardTypeSummary,PlanningLevel} from '../../common/contracts';
import type {AuthorMaterialWriteReceipt} from '../../common/authorMaterials';
import BusinessFormWorkspace,{type BusinessEditorState} from '../businessForms/BusinessFormWorkspace';
import {newDesignApi} from '../api';

/** Reuses the original author form, version receipt and unknown-response recovery. */
export default function PlanningMaterialCreator({book,level,confirmed,onState,onSaved,onClose}:{book:BookSummary;level:PlanningLevel;confirmed:boolean;onState:(state:BusinessEditorState)=>void;onSaved:(receipt:AuthorMaterialWriteReceipt)=>void;onClose:()=>void}){
 const [types,setTypes]=useState<CardTypeSummary[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let current=true;void newDesignApi.listCardTypes(book.spaceId).then(items=>{if(current)setTypes(items.filter(item=>item.spaceId===book.spaceId&&item.key===level));}).catch(caught=>{if(current)setError(caught instanceof Error?caught.message:'原资料类型未读取。');});return()=>{current=false;};},[book.spaceId,level]);
 return <section className="nd-planning-material-create" aria-label={`新建${level==='volume'?'卷':level==='chapter'?'章节':'场景'}资料`}>
  <div className="nd-section-heading"><div><h3>先建立{level==='volume'?'卷':level==='chapter'?'章节':'场景'}资料</h3><p>原规划填写保留。资料保存后带回当前候选，仍需保存规划并明确采用。</p></div><button className="nd-button nd-button-secondary" type="button" onClick={onClose}>关闭资料填写</button></div>
  {error&&<p role="alert">{error}</p>}{types?.length===1?<fieldset disabled={confirmed}><BusinessFormWorkspace key={`${book.id}:${level}`} book={book} cardTypes={types} scope="chapters" embedded compact initialTypeId={types[0].id} startCreating onEditorStateChange={onState} onSavedReceipt={onSaved}/></fieldset>:types&&<p role="alert">本书对应的正式资料类型缺失或不唯一；未改选其他类型。<a href={`/new-design/books/${book.id}/cards`}>维护本书资料类型</a></p>}
 </section>;
}

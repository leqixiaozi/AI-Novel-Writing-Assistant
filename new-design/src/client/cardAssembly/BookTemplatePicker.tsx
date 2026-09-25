import {useEffect,useState} from 'react';
import type {TemplateGroupSummary,TemplateGroupVersion} from '../../common/contracts';
import type {BookAssembly} from '../../common/cardAssembly';
import {newDesignApi} from '../api';
import './assembly.css';

interface Props {
  templates:TemplateGroupSummary[];
  value:string;
  disabled:boolean;
  onChange:(versionId:string)=>void;
}

export default function BookTemplatePicker({templates,value,disabled,onChange}:Props){
  const bookTemplates=templates.filter(item=>item.draftConfig?.assembly);
  const legacyTemplates=templates.filter(item=>!item.draftConfig?.assembly);
  const [activeId,setActiveId]=useState('');
  const [versions,setVersions]=useState<TemplateGroupVersion[]>([]);
  const [error,setError]=useState('');
  const active=bookTemplates.find(item=>item.id===activeId);
  useEffect(()=>{
    if(!activeId){setVersions([]);return}
    let valid=true;
    void newDesignApi.cardAssembly.bookTemplateVersions(activeId).then(result=>{if(valid){setVersions(result);setError('')}}).catch(cause=>{if(valid)setError(cause instanceof Error?cause.message:'书籍模板版本读取失败。')});
    return()=>{valid=false};
  },[activeId]);
  useEffect(()=>{
    if(activeId||!value)return;
    const current=bookTemplates.find(item=>item.currentVersionId===value);
    if(current)setActiveId(current.id);
  },[activeId,value,templates]);
  const selectedVersion=versions.find(item=>item.id===value);
  const assembly=selectedVersion?.payload.assembly as BookAssembly|undefined;
  return <div className="nd-assembly-book-picker" data-start-field="templateVersionId">
    <strong>选择书籍模板与版本</strong>
    <p>确认开书时复制所选发布版本的结构快照；本书填写和编排不会修改源模板。</p>
    {bookTemplates.length?bookTemplates.map(item=><button key={item.id} type="button" disabled={disabled} className={`nd-assembly-listitem ${item.id===activeId?'active':''}`} onClick={()=>{setActiveId(item.id);onChange(item.currentVersionId??'')}}><span>{item.name}<br/><small>{item.description||'根卡、组合模块与元卡片'}</small></span><small>v{item.currentVersion??1}</small></button>):<p>尚无已发布书籍模板。请先在“书籍模板”中发布一个版本。</p>}
    {active&&<label className="nd-control"><span>采用的发布版本</span><select disabled={disabled||!versions.length} value={versions.some(item=>item.id===value)?value:active.currentVersionId??''} onChange={event=>onChange(event.target.value)}>{versions.map(item=><option key={item.id} value={item.id}>v{item.version} · {new Date(item.createdAt).toLocaleDateString()}</option>)}</select></label>}
    {assembly&&<p className="nd-assembly-inspector-note">本书根卡 1 张 · 组合模块 {assembly.modules.length} 种 · 开书预建实例 {assembly.modules.reduce((sum,item)=>sum+item.initialInstanceCount,0)} 个 · 独立元卡片 {assembly.standalone.length} 张</p>}
    {error&&<p role="alert">{error}</p>}
    {legacyTemplates.length>0&&<details><summary>原有创作模板</summary><label className="nd-control"><span>旧版模板</span><select disabled={disabled} value={legacyTemplates.some(item=>item.currentVersionId===value)?value:''} onChange={event=>{setActiveId('');onChange(event.target.value)}}><option value="">请选择</option>{legacyTemplates.map(item=><option key={item.id} value={item.currentVersionId??''}>{item.name}</option>)}</select></label></details>}
  </div>;
}

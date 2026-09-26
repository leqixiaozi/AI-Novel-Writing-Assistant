import {useEffect,useState} from 'react';
import type {FieldDefinition} from '../../common/contracts';
import {newDesignApi} from '../api';

const COMMON_FIELDS=new Set(['bookName','name','description','storyFormat','targetWordCount','genre','styleKeywords','targetAudience']);

export default function BookRootExtraFields({versionId,values,disabled,onChange}:{versionId:string;values:Record<string,unknown>;disabled:boolean;onChange:(values:Record<string,unknown>)=>void}){
  const [fields,setFields]=useState<FieldDefinition[]>([]),[error,setError]=useState('');
  useEffect(()=>{
    if(!versionId){setFields([]);return}
    let active=true;
    void newDesignApi.cardAssembly.bookTemplateRootFields(versionId).then(result=>{if(active){setFields(result.fields.filter(field=>!COMMON_FIELDS.has(field.key)));setError('')}}).catch(cause=>{if(active){setFields([]);setError(cause instanceof Error?cause.message:'书籍信息字段读取失败。')}});
    return()=>{active=false};
  },[versionId]);
  if(!versionId||!fields.length&&!error)return null;
  return <section className="nd-assembly-book-picker">
    {fields.length>0&&<><strong>这份书籍模板的额外信息</strong><p>开书时填写，之后仍可在书籍信息卡中修改。</p></>}
    {fields.map(field=>{
      const value=values[field.key],update=(next:unknown)=>onChange({...values,[field.key]:next});
      return <label className="nd-control" key={field.key}><span>{field.name}{field.required?' *':''}</span>
        {field.type==='boolean'?<input type="checkbox" disabled={disabled} checked={value===true} onChange={event=>update(event.target.checked)}/>
          :field.type==='long_text'?<textarea disabled={disabled} value={typeof value==='string'?value:''} onChange={event=>update(event.target.value)}/>
          :field.type==='select'?<select disabled={disabled} value={typeof value==='string'?value:''} onChange={event=>update(event.target.value)}><option value="">请选择</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
          :field.type==='multi_select'?<select disabled={disabled} multiple value={Array.isArray(value)?value.map(String):[]} onChange={event=>update([...event.target.selectedOptions].map(option=>option.value))}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
          :<input disabled={disabled} type={field.type==='number'?'number':field.type==='date'?'date':'text'} value={field.type==='number'?typeof value==='number'?value:'':typeof value==='string'?value:''} onChange={event=>update(field.type==='number'?event.target.value===''?null:Number(event.target.value):event.target.value)}/>}
        {field.description&&<small>{field.description}</small>}
      </label>
    })}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

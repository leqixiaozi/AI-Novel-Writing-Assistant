import {useEffect,useState} from 'react';
import type {BookAssemblyWorkspace} from '../../common/cardAssembly';
import type {FieldDefinition} from '../../common/contracts';
import {newDesignApi} from '../api';
import {BookRouteShell} from '../bookNavigation';
import ResizableAssemblyWorkspace from './ResizableAssemblyWorkspace';
import './assembly.css';

const api=newDesignApi.cardAssembly;
type Selected={kind:'root'|'slot'|'relation';id:string};

function FieldInput({field,value,onChange}:{field:FieldDefinition;value:unknown;onChange:(value:unknown)=>void}){
  const text=typeof value==='string'?value:'';
  return <label>{field.name}{field.required?' *':''}
    {field.type==='boolean'?<input type="checkbox" checked={value===true} onChange={event=>onChange(event.target.checked)}/>
      :field.type==='long_text'?<textarea value={text} onChange={event=>onChange(event.target.value)}/>
      :field.type==='select'?<select value={text} onChange={event=>onChange(event.target.value)}><option value="">请选择</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      :field.type==='multi_select'?<select multiple value={Array.isArray(value)?value.map(String):[]} onChange={event=>onChange([...event.target.selectedOptions].map(option=>option.value))}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      :<input type={field.type==='number'?'number':field.type==='date'?'date':'text'} value={field.type==='number'?typeof value==='number'?value:'':text} onChange={event=>onChange(field.type==='number'?event.target.value===''?null:Number(event.target.value):event.target.value)}/>}
    <small>{field.description}</small>
  </label>
}

export default function BookAssemblyPage({bookId}:{bookId:string}){
  const [workspace,setWorkspace]=useState<BookAssemblyWorkspace|null>(null);
  const [selected,setSelected]=useState<Selected|null>(null);
  const [values,setValues]=useState<Record<string,unknown>>({});
  const [title,setTitle]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [fromSlotId,setFromSlotId]=useState('');
  const [toSlotId,setToSlotId]=useState('');
  const [relationTypeVersionId,setRelationTypeVersionId]=useState('');
  const [relationValues,setRelationValues]=useState<Record<string,unknown>>({});

  async function refresh(){const next=await api.bookWorkspace(bookId);setWorkspace(next);return next}
  useEffect(()=>{void refresh().then(next=>{if(next.root)choose({kind:'root',id:next.root.id},next)}).catch(error=>setMessage(String(error)))},[bookId]);
  function choose(value:Selected,next=workspace){
    setSelected(value);setMessage('');
    if(value.kind==='root'){setValues({...next?.root?.values});setTitle(next?.root?.title??'')}
    else if(value.kind==='slot'){const slot=next?.slots.find(item=>item.id===value.id);setValues({});setTitle(slot?.cardTitle??slot?.name??'')}
    else setValues({});
  }
  async function perform(work:()=>Promise<unknown>,notice:string){
    setBusy(true);setMessage('');
    try{await work();const next=await refresh();if(selected)choose(selected,next);setMessage(notice)}
    catch(error){setMessage(String(error))}
    finally{setBusy(false)}
  }

  const root=selected?.kind==='root'?workspace?.root:null;
  const slot=selected?.kind==='slot'?workspace?.slots.find(item=>item.id===selected.id):null;
  const relation=selected?.kind==='relation'?workspace?.relations.find(item=>item.id===selected.id):null;
  const filledSlots=workspace?.slots.filter(item=>item.status==='filled'&&item.cardId)??[];
  const newRelationType=workspace?.availableRelationTypes?.find(item=>item.id===relationTypeVersionId);
  const slotLabel=(id:string)=>{const item=workspace?.slots.find(candidate=>candidate.id===id);return item?.cardTitle??item?.name??'未知卡片'};

  return <BookRouteShell bookId={bookId} active="assembly"><div className="nd-shell">
    <header className="nd-context-header"><div><p className="nd-breadcrumb">本书／卡片结构</p><h1>{workspace?.bookName??'本书卡片'}</h1><p>书籍信息是根卡。填写槽位生成本书资料卡，再确认卡片之间的关系。</p></div></header>
    {workspace?.legacy?<p className="nd-assembly-message">本书使用原有创作模板。<a href={`/new-design/books/${bookId}/cards`}>查看本书资料</a></p>
      :<ResizableAssemblyWorkspace>
        <aside>
          <h2>本书卡片树</h2>
          {workspace?.root&&<button className={`nd-assembly-listitem ${selected?.kind==='root'?'active':''}`} type="button" onClick={()=>choose({kind:'root',id:workspace.root!.id})}>📖 {workspace.bookName}<br/><small>书籍信息</small></button>}
          {workspace?.moduleReferences?.map(reference=>{
            const instances=workspace.modules.filter(item=>item.moduleRefNodeId===reference.id);
            return <section key={reference.id}><h3>{reference.name} · {instances.length}</h3>
              {instances.map(instance=><div className="nd-assembly-field" key={instance.id}>
                <strong>{instance.displayName} · #{instance.ordinal}</strong>
                <small>{instance.complete?' 已完成':` 待核对：${instance.pendingRequiredSlots} 个必选槽位、${instance.pendingRequiredRelations} 条必需关系`}</small>
                {workspace.slots.filter(item=>item.moduleInstanceId===instance.id).map(item=><button key={item.id} className={`nd-assembly-listitem ${selected?.id===item.id?'active':''}`} type="button" onClick={()=>choose({kind:'slot',id:item.id})}>
                  {item.cardTitle??item.name}<br/><small>{item.status==='filled'?'已填写':'待填写'}{item.required?' · 必选':''}</small>
                </button>)}
              </div>)}
              <button type="button" className="nd-assembly-small" disabled={busy} onClick={()=>void perform(()=>api.addBookModuleInstance(bookId,reference.id),'已新增本书卡片组。')}>＋ 新增实例</button>
            </section>
          })}
          <h3>独立元卡片</h3>
          {workspace?.slots.filter(item=>!item.moduleInstanceId).map(item=><button key={item.id} className={`nd-assembly-listitem ${selected?.id===item.id?'active':''}`} type="button" onClick={()=>choose({kind:'slot',id:item.id})}>{item.cardTitle??item.name} · {item.status==='filled'?'已填':'待填'}</button>)}
        </aside>
        <main>
          <div className="nd-assembly-actions"><strong>{root?'书籍信息':slot?.cardTitle??slot?.name??relation?.name??'选择卡片'}</strong></div>
          <div style={{padding:18,overflow:'auto'}}>
            {root&&root.fields.map(field=><FieldInput key={field.key} field={field} value={values[field.key]} onChange={value=>setValues(current=>({...current,[field.key]:value}))}/>)}
            {slot&&(slot.status==='filled'?<p>这张资料卡已建立。<a href={`/new-design/books/${bookId}/cards`}>编辑本书资料</a></p>:<><label>资料卡标题<input value={title} onChange={event=>setTitle(event.target.value)}/></label>{slot.fields.map(field=><FieldInput key={field.key} field={field} value={values[field.key]} onChange={value=>setValues(current=>({...current,[field.key]:value}))}/>)}</>)}
            {relation&&<><p>从 {workspace?.slots.find(item=>item.nodeId===relation.fromNodeId)?.cardTitle??'书籍信息'} 指向 {workspace?.slots.find(item=>item.nodeId===relation.toNodeId)?.cardTitle??'书籍信息'}</p><p>{relation.name} · {relation.status==='confirmed'?'已确认':relation.status==='invalidated'?'需重新核对':'待确认'}</p>{relation.fields.map(field=><FieldInput key={field.key} field={field} value={values[field.key]} onChange={value=>setValues(current=>({...current,[field.key]:value}))}/>)}</>}
            {message&&<p className="nd-assembly-message" role="status">{message}</p>}
          </div>
        </main>
        <aside>
          <h2>填写与核对</h2>
          {root&&<button type="button" className="nd-assembly-small primary" disabled={busy} onClick={()=>void perform(()=>api.reviseRoot(bookId,{expectedBookRevision:workspace!.bookRevision!,expectedCardRevision:root.revision,values}),'书籍信息已保存。')}>保存书籍信息</button>}
          {slot?.status==='pending'&&<button type="button" className="nd-assembly-small primary" disabled={busy||!title.trim()} onClick={()=>void perform(()=>api.fillSlot(bookId,slot.id,{expectedRevision:slot.revision,title,values}),'资料卡已填写。')}>确认填写</button>}
          {relation?.status==='pending'&&<button type="button" className="nd-assembly-small primary" disabled={busy} onClick={()=>void perform(()=>api.confirmRelation(bookId,relation.id,{expectedRevision:relation.revision,properties:values}),'关系已建立。')}>确认关系</button>}
          <h3>模板预设关系</h3>
          {workspace?.relations.map(item=><button type="button" key={item.id} className={`nd-assembly-listitem ${selected?.id===item.id?'active':''}`} onClick={()=>choose({kind:'relation',id:item.id})}>{item.name}<br/><small>{item.status==='confirmed'?'已确认':item.status==='invalidated'?'需重新核对':'待确认'}{item.required?' · 必需':''}</small></button>)}
          <h3>新增卡片关系</h3>
          <p className="nd-assembly-inspector-note">例如将两张已填写的人物卡连成师徒关系。</p>
          <label>起点卡片<select value={fromSlotId} onChange={event=>setFromSlotId(event.target.value)}><option value="">请选择</option>{filledSlots.map(item=><option key={item.id} value={item.id}>{item.cardTitle??item.name}</option>)}</select></label>
          <label>关系类型<select value={relationTypeVersionId} onChange={event=>{setRelationTypeVersionId(event.target.value);setRelationValues({})}}><option value="">请选择</option>{workspace?.availableRelationTypes?.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>终点卡片<select value={toSlotId} onChange={event=>setToSlotId(event.target.value)}><option value="">请选择</option>{filledSlots.filter(item=>item.id!==fromSlotId).map(item=><option key={item.id} value={item.id}>{item.cardTitle??item.name}</option>)}</select></label>
          {newRelationType?.fields.map(field=><FieldInput key={field.key} field={field} value={relationValues[field.key]} onChange={value=>setRelationValues(current=>({...current,[field.key]:value}))}/>)}
          <button type="button" className="nd-assembly-small primary" disabled={busy||!fromSlotId||!toSlotId||fromSlotId===toSlotId||!relationTypeVersionId} onClick={()=>void perform(()=>api.createInstanceRelation(bookId,{fromSlotId,toSlotId,relationTypeVersionId,properties:relationValues}),'卡片关系已建立。')}>建立关系</button>
          <h3>本书新增关系</h3>
          {workspace?.instanceRelations?.map(item=><p className="nd-assembly-inspector-note" key={item.id}>{slotLabel(item.fromSlotId)} — {item.name} → {slotLabel(item.toSlotId)}</p>)}
        </aside>
      </ResizableAssemblyWorkspace>}
  </div></BookRouteShell>
}

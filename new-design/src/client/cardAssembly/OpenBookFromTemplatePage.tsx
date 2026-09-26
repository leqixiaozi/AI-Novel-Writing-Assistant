import {useEffect,useState} from 'react';
import type {TemplateGroupSummary} from '../../common/contracts';
import {ApiError,newDesignApi} from '../api';
import BookRootExtraFields from './BookRootExtraFields';
import BookTemplatePicker from './BookTemplatePicker';
import './assembly.css';

interface PendingOpen {key:string;name:string;description:string;templateVersionId:string;rootValues:Record<string,unknown>}
const PENDING_KEY='new-design:assembly-book-open:v1';
const pending=():PendingOpen|null=>{try{const raw=sessionStorage.getItem(PENDING_KEY);return raw?JSON.parse(raw) as PendingOpen:null}catch{return null}};

export default function OpenBookFromTemplatePage(){
  const [templates,setTemplates]=useState<TemplateGroupSummary[]>([]);
  const [name,setName]=useState(''),[description,setDescription]=useState('');
  const [storyFormat,setStoryFormat]=useState('long_novel'),[targetWordCount,setTargetWordCount]=useState(200000);
  const [genre,setGenre]=useState(''),[styleKeywords,setStyleKeywords]=useState(''),[targetAudience,setTargetAudience]=useState('');
  const [rootValues,setRootValues]=useState<Record<string,unknown>>({});
  const [templateVersionId,setTemplateVersionId]=useState('');
  const [attempt,setAttempt]=useState<PendingOpen|null>(pending);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{void newDesignApi.cardAssembly.listBookTemplates().then(items=>{
    setTemplates(items.filter(item=>item.currentVersionId));
    const query=new URLSearchParams(location.search),templateId=query.get('templateId');
    const selected=items.find(item=>item.id===templateId);
    if(selected?.currentVersionId&&!attempt)setTemplateVersionId(selected.currentVersionId);
  }).catch(error=>setMessage(String(error)))},[]);

  const go=(bookId:string)=>location.assign(`/new-design/books/${bookId}/assembly`);
  async function check(){
    if(!attempt)return;
    setBusy(true);
    try{
      const books=await newDesignApi.listBooks(),found=books.find(book=>book.key===attempt.key);
      if(found)go(found.id);
      else setMessage('书籍列表中尚未找到这次开书结果。请保留本页填写和请求记录，核对服务状态后再决定是否重试。');
    }catch(error){setMessage(error instanceof Error?error.message:'书籍列表读取失败。')}
    finally{setBusy(false)}
  }
  async function open(){
    if(!name.trim()||!templateVersionId||busy||attempt)return;
    const request:PendingOpen={key:crypto.randomUUID().replaceAll('-',''),name:name.trim(),description:description.trim(),templateVersionId,
      rootValues:{...rootValues,bookName:name.trim(),description:description.trim(),storyFormat,targetWordCount,genre,styleKeywords,targetAudience}};
    try{sessionStorage.setItem(PENDING_KEY,JSON.stringify(request))}catch{setMessage('浏览器无法保存本次开书记录，请检查存储设置。');return}
    setAttempt(request);setBusy(true);setMessage('');
    try{const book=await newDesignApi.createBook(request);sessionStorage.removeItem(PENDING_KEY);go(book.id)}
    catch(error){
      try{const books=await newDesignApi.listBooks(),found=books.find(book=>book.key===request.key);if(found){sessionStorage.removeItem(PENDING_KEY);go(found.id);return}}
      catch{/* The original result is uncertain; keep the request record. */}
      if(error instanceof ApiError&&error.status===422){sessionStorage.removeItem(PENDING_KEY);setAttempt(null)}
      setMessage(error instanceof Error?error.message:'开书结果待核对。');
    }finally{setBusy(false)}
  }
  return <div className="nd-shell nd-create-flow">
    <header className="nd-create-header"><div><a href="/new-design/structure/book-templates">返回书籍模板</a><p className="nd-eyebrow">本书初始化</p><h1>从书籍模板开书</h1><p>先建立书籍信息根卡和独立的结构副本。人物、战力等资料开书后逐张填写。</p></div></header>
    <main className="nd-create-layout"><section><h2>开书顺序</h2><p>填写书籍信息 → 选择书籍模板 → 确认开书 → 在本书填充卡片和关系。</p><p>模板中的模块只作结构来源；本书修改不会写回模板。</p></section>
      <section className="nd-create-input"><fieldset disabled={busy||Boolean(attempt)}>
        <label className="nd-control"><span>书名 *</span><input value={name} onChange={event=>setName(event.target.value)}/></label>
        <label className="nd-control"><span>作品说明</span><textarea value={description} onChange={event=>setDescription(event.target.value)}/></label>
        <label className="nd-control"><span>篇幅形式</span><select value={storyFormat} onChange={event=>{setStoryFormat(event.target.value);setTargetWordCount(event.target.value==='short_story'?8000:200000)}}><option value="long_novel">长篇小说</option><option value="short_story">连续完整短篇</option></select></label>
        <label className="nd-control"><span>目标字数</span><input type="number" min={storyFormat==='short_story'?3000:30001} max={storyFormat==='short_story'?30000:3000000} value={targetWordCount} onChange={event=>setTargetWordCount(Number(event.target.value))}/></label>
        <label className="nd-control"><span>题材基底</span><input value={genre} onChange={event=>setGenre(event.target.value)}/></label>
        <label className="nd-control"><span>文风关键词</span><input value={styleKeywords} onChange={event=>setStyleKeywords(event.target.value)}/></label>
        <label className="nd-control"><span>目标读者</span><input value={targetAudience} onChange={event=>setTargetAudience(event.target.value)}/></label>
        <BookTemplatePicker templates={templates} value={templateVersionId} disabled={busy||Boolean(attempt)} onChange={value=>{setTemplateVersionId(value);setRootValues({})}}/>
        <BookRootExtraFields versionId={templateVersionId} values={rootValues} disabled={busy||Boolean(attempt)} onChange={setRootValues}/>
      </fieldset>
      <button className="nd-button nd-button-primary" type="button" disabled={busy||Boolean(attempt)||!name.trim()||!templateVersionId||!Number.isFinite(targetWordCount)} onClick={()=>void open()}>确认开书</button>
      {attempt&&<div className="nd-creation-recovery"><p>这次开书结果需要核对，暂时不会再发起同一请求。</p><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={()=>void check()}>核对书籍列表</button></div>}
      {message&&<p className="nd-assembly-message" role="status">{message}</p>}
    </section></main>
  </div>
}

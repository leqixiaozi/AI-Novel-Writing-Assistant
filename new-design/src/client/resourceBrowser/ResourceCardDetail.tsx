import {useEffect,useRef,useState} from "react";
import type {BookSummary,CardSummary,FieldDefinition} from "../../common/contracts";
import {ApiError,newDesignApi as api} from "../api";
import DynamicForm from "../DynamicForm";
import type {ResourceSelection} from "./catalog";

type CardSelection=Extract<ResourceSelection,{kind:"card"}>;
export default function ResourceCardDetail({selection,books,onGuard,onSaved}:{selection:CardSelection;books:BookSummary[];onGuard:(blocked:boolean)=>void;onSaved:(card:CardSummary)=>void}){
 const [source,setSource]=useState<CardSummary|null>(null),[fields,setFields]=useState<FieldDefinition[]>([]),[title,setTitle]=useState(""),[values,setValues]=useState<Record<string,unknown>>({}),[baseline,setBaseline]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[issues,setIssues]=useState<Record<string,string>>({}),[uncertain,setUncertain]=useState(false),[checked,setChecked]=useState<CardSummary|null>(null),[bookId,setBookId]=useState("");
 const sequence=useRef(0),dirty=Boolean(source)&&JSON.stringify({title,values})!==baseline;
 useEffect(()=>{onGuard(busy||dirty||uncertain);},[busy,dirty,uncertain,onGuard]);
 useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(busy||dirty||uncertain){event.preventDefault();event.returnValue="";}};addEventListener("beforeunload",leave);return()=>removeEventListener("beforeunload",leave);},[busy,dirty,uncertain]);
 const read=async()=>{
  const token=++sequence.current;setBusy(true);setMessage("");
  try{const card=await api.getCard(selection.card.id);if(card.id!==selection.card.id||card.cardTypeId!==selection.card.cardTypeId)throw new Error("资源身份不匹配，请重新读取目录。");
   const versions=await api.listCardTypeVersions(card.cardTypeId),version=versions.find(item=>item.id===card.typeVersionId);
   if(!version)throw new Error("未找到资源的精确内容规格，未用其他规格代替。请打开内容类型核对。");
   if(token!==sequence.current)return;setSource(card);setFields(version.fields);setTitle(card.title);setValues(card.values);setBaseline(JSON.stringify({title:card.title,values:card.values}));setIssues({});setUncertain(false);setChecked(null);
  }catch(error){if(token===sequence.current)setMessage(error instanceof Error?error.message:"资源读取失败。");}finally{if(token===sequence.current)setBusy(false);}
 };
 useEffect(()=>{setSource(null);void read();return()=>{sequence.current++;};},[selection.card.id]);
 const save=async()=>{
  if(!source||!selection.editable||busy||uncertain||source.status!=="active")return;
  setBusy(true);setMessage("");setIssues({});
  try{const saved=await api.updateCard({...source,title:title.trim(),values});if(saved.id!==source.id||saved.cardTypeId!==source.cardTypeId||saved.typeVersionId!==source.typeVersionId)throw new Error("保存回执的资源身份或规格不匹配，请核对服务器内容。");setSource(saved);setTitle(saved.title);setValues(saved.values);setBaseline(JSON.stringify({title:saved.title,values:saved.values}));onSaved(saved);setMessage("资源已保存，已有书籍安装的独立快照不会被自动替换。");}
  catch(error){setUncertain(true);if(error instanceof ApiError)setIssues(error.issues);setMessage(`保存失败或结果待核对：${error instanceof Error?error.message:"未收到有效回执"}。填写保留，请先读取服务器内容，再决定是否继续。`);}
  finally{setBusy(false);}
 };
 const check=async()=>{if(!source||busy)return;setBusy(true);try{const card=await api.getCard(source.id);if(card.id!==source.id||card.cardTypeId!==source.cardTypeId||card.typeVersionId!==source.typeVersionId||card.status!=="active")throw new Error("资源身份、状态或规格已变化，请保留填写并到原编辑器核对。");setChecked(card);setMessage("服务器内容已读取。对比后可保留填写，使用已核对的修订继续；不会自动保存。");}catch(error){setMessage(error instanceof Error?error.message:"核对失败，填写仍保留。");}finally{setBusy(false);}};
 const install=async()=>{if(!source||!bookId||busy||dirty||uncertain)return;setBusy(true);try{await api.installStrategyResource(source.id,bookId);setMessage("已安装到所选书籍，形成该书独立的资料快照。");}catch(error){setMessage(error instanceof Error?error.message:"安装失败或待核对，请到所选书籍检查资料；不会自动重新安装。");}finally{setBusy(false);}};
 return <section className="nd-resource-browser-detail"><header className="nd-section-heading"><div><p className="nd-kicker">{source?.cardTypeName??selection.card.cardTypeName}</p><h2>{selection.name}</h2></div><a href={selection.href} target="_blank" rel="noreferrer">打开完整编辑器</a></header>
  {message&&<p className="nd-message" role="status">{message}</p>}
  {!source?<button type="button" className="nd-button nd-button-secondary" disabled={busy} onClick={()=>void read()}>{busy?"正在读取…":"重新读取此资源"}</button>:<>
   <label className="nd-control"><span>资源名称</span><input value={title} disabled={busy||!selection.editable||uncertain} onChange={event=>setTitle(event.target.value)}/>{issues.title&&<em>{issues.title}</em>}</label>
   <DynamicForm fields={fields} values={values} issues={issues} disabled={busy||!selection.editable||uncertain} preview={!selection.editable} onChange={setValues}/>
   {uncertain&&<div className="nd-resource-browser-recovery"><button type="button" className="nd-button nd-button-secondary" disabled={busy} onClick={()=>void check()}>读取服务器内容</button>{checked&&<><details open><summary>服务器修订 {checked.revision}：{checked.title}</summary><DynamicForm fields={fields} values={checked.values} preview/></details><button type="button" className="nd-button nd-button-secondary" disabled={busy} onClick={()=>{setSource(checked);setBaseline(JSON.stringify({title:checked.title,values:checked.values}));setUncertain(false);setChecked(null);setMessage("填写保留，已使用核对后的修订。请检查后明确保存。");}}>保留填写，按核对后的修订继续</button></>}</div>}
   {selection.editable&&<div className="nd-resource-browser-actions"><button type="button" className="nd-button nd-button-secondary" disabled={busy||uncertain||!dirty} onClick={()=>{setTitle(source.title);setValues(source.values);setIssues({});setMessage("");}}>放弃本次修改</button><button type="button" className="nd-button nd-button-primary" disabled={busy||uncertain||!title.trim()||source.status!=="active"} onClick={()=>void save()}>保存资源</button><label className="nd-control"><span>加入书籍</span><select value={bookId} disabled={busy} onChange={event=>setBookId(event.target.value)}><option value="">明确选择一本书</option>{books.map(book=><option key={book.id} value={book.id}>{book.name}</option>)}</select></label><button type="button" className="nd-button nd-button-secondary" disabled={busy||dirty||uncertain||!bookId} onClick={()=>void install()}>安装到所选书籍</button></div>}
   {!selection.editable&&<p>此处查看内容；分类、引用或研究操作请在完整编辑器中处理。</p>}
  </>}
 </section>;
}

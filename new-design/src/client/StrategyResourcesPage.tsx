import { useEffect, useMemo, useState } from "react";
import { STRATEGY_RESOURCE_TYPE_KEYS, type BookSummary, type CardTypeSummary, type CardVersion, type StrategyResourceSummary, type StrategyResourceTypeKey } from "../common/contracts";
import { ApiError, newDesignApi } from "./api";
import DynamicForm from "./DynamicForm";
import ResourceShell from "./ResourceShell";

const RESOURCE_SPACE_ID="60000000-0000-4000-8000-000000000001";

export default function StrategyResourcesPage() {
  const initialType=new URLSearchParams(window.location.search).get("type") as StrategyResourceTypeKey|null;
  const [types,setTypes]=useState<CardTypeSummary[]>([]);
  const [resources,setResources]=useState<StrategyResourceSummary[]>([]);
  const [books,setBooks]=useState<BookSummary[]>([]);
  const [typeKey,setTypeKey]=useState<StrategyResourceTypeKey>(STRATEGY_RESOURCE_TYPE_KEYS.includes(initialType as StrategyResourceTypeKey)?initialType as StrategyResourceTypeKey:"genre_strategy");
  const [search,setSearch]=useState("");
  const [editing,setEditing]=useState<StrategyResourceSummary|null>(null);
  const [creating,setCreating]=useState(false);
  const [title,setTitle]=useState("");
  const [values,setValues]=useState<Record<string,unknown>>({});
  const [issues,setIssues]=useState<Record<string,string>>({});
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [bookId,setBookId]=useState("");
  const [history,setHistory]=useState<CardVersion[]|null>(null);

  const load=async()=>{const [nextTypes,nextResources,nextBooks]=await Promise.all([newDesignApi.listCardTypes(),newDesignApi.listStrategyResources(),newDesignApi.listBooks()]);setTypes(nextTypes.filter((item)=>STRATEGY_RESOURCE_TYPE_KEYS.includes(item.key as StrategyResourceTypeKey)));setResources(nextResources);setBooks(nextBooks);setBookId((current)=>current||nextBooks[0]?.id||"");};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"创作策略加载失败。"));},[]);
  const selectedType=types.find((item)=>item.key===typeKey)??null;
  const visible=useMemo(()=>resources.filter((item)=>item.typeKey===typeKey&&(!search.trim()||`${item.title} ${JSON.stringify(item.values)}`.toLowerCase().includes(search.trim().toLowerCase()))),[resources,typeKey,search]);

  useEffect(()=>{
    if(creating||visible.some((item)=>item.id===editing?.id))return;
    const first=visible[0]??null;
    setEditing(first);setTitle(first?.title??"");setValues(first?.values??{});setIssues({});setMessage("");
  },[creating,editing?.id,visible]);
  const open=(resource:StrategyResourceSummary)=>{setEditing(resource);setCreating(false);setTitle(resource.title);setValues(resource.values);setIssues({});setMessage("");};
  const beginCreate=()=>{setEditing(null);setCreating(true);setTitle("");setValues({});setIssues({});setMessage("");};
  const save=async()=>{if(!selectedType)return;setBusy(true);setIssues({});setMessage("");try{const saved=editing?await newDesignApi.updateCard({...editing,title,values}):await newDesignApi.createCard({cardTypeId:selectedType.id,title,values,spaceId:RESOURCE_SPACE_ID});await load();const refreshed=(await newDesignApi.listStrategyResources()).find((item)=>item.id===saved.id)??null;if(refreshed)open(refreshed);setMessage(`“${saved.title}”已保存。`);}catch(error){if(error instanceof ApiError){setIssues(error.issues);setMessage(error.message);}else setMessage(error instanceof Error?error.message:"保存失败。");}finally{setBusy(false);}};
  const archive=async()=>{if(!editing)return;setBusy(true);try{await newDesignApi.archiveCard(editing.id,editing.revision);setEditing(null);await load();setMessage("资源已归档，版本仍然保留。");}catch(error){setMessage(error instanceof Error?error.message:"归档失败。");}finally{setBusy(false);}};
  const install=async()=>{if(!editing||!bookId)return;setBusy(true);setMessage("");try{const result=await newDesignApi.installStrategyResource(editing.id,bookId);const book=books.find((item)=>item.id===bookId);setMessage(`“${result.resource.title}”已安装到《${book?.name??"目标书籍"}》，形成独立资料快照。`);}catch(error){setMessage(error instanceof Error?error.message:"安装失败。");}finally{setBusy(false);}};
  const showHistory=async()=>{if(!editing)return;setBusy(true);try{setHistory(await newDesignApi.listCardVersions(editing.id));}catch(error){setMessage(error instanceof Error?error.message:"版本加载失败。");}finally{setBusy(false);}};
  const editorVisible=creating||editing;

  return <ResourceShell active="strategies"><main className="nd-resource-workspace"><aside><div className="nd-resource-type-tabs">{types.map((type)=><button className={type.key===typeKey?"is-active":""} key={type.id} onClick={()=>setTypeKey(type.key as StrategyResourceTypeKey)} type="button"><span>{type.name}</span><b>{resources.filter((item)=>item.typeKey===type.key).length}</b></button>)}</div><label className="nd-control"><span>搜索当前资源</span><input value={search} placeholder={`搜索${selectedType?.name??"创作策略"}`} onChange={(event)=>setSearch(event.target.value)}/></label><div className="nd-resource-list">{visible.map((resource)=><button className={editing?.id===resource.id?"is-selected":""} key={resource.id} onClick={()=>open(resource)} type="button"><strong>{resource.title}</strong><small>修订 {resource.revision} · 规格 v{resource.typeVersion}</small></button>)}{!visible.length&&<div className="nd-empty nd-empty-compact">没有匹配的资源。</div>}</div></aside><section className="nd-resource-editor"><div className="nd-section-heading"><div><p className="nd-kicker">{editing?`${selectedType?.name} · 修订 ${editing.revision}`:`新建${selectedType?.name??"策略"}`}</p><h2>{editing?.title??`新建${selectedType?.name??"策略"}`}</h2></div><button className="nd-button nd-button-primary" type="button" onClick={beginCreate}>＋ 新建资源</button></div>{editorVisible?<><label className={`nd-control${issues.title?" has-error":""}`}><span>资源名称 *</span><input value={title} onChange={(event)=>setTitle(event.target.value)}/>{issues.title&&<em>{issues.title}</em>}</label><DynamicForm fields={selectedType?.draftFields??[]} values={values} issues={issues} onChange={setValues}/>{message&&<p className={`nd-message${Object.keys(issues).length?" is-error":" is-success"}`}>{message}</p>}<div className="nd-resource-actions"><div>{editing&&<><select aria-label="目标书籍" value={bookId} onChange={(event)=>setBookId(event.target.value)}><option value="">选择目标书籍</option>{books.map((book)=><option key={book.id} value={book.id}>{book.name}</option>)}</select><button className="nd-button nd-button-secondary" disabled={busy||!bookId} onClick={()=>void install()} type="button">安装到本书</button></>}</div><div>{editing&&<button className="nd-text-button" disabled={busy} onClick={()=>void showHistory()} type="button">查看版本</button>}{editing&&<button className="nd-text-button is-danger" disabled={busy} onClick={()=>void archive()} type="button">归档</button>}<button className="nd-button nd-button-primary" disabled={busy||!title.trim()} onClick={()=>void save()} type="button">{busy?"处理中…":"保存资源"}</button></div></div></>:<div className="nd-empty nd-empty-page"><strong>选择或新建一项创作策略</strong><span>同一套动态表单负责四类资源，不建立专用事实表。</span></div>}</section></main>{history&&<div className="nd-dialog-backdrop" role="presentation" onMouseDown={()=>setHistory(null)}><section className="nd-history-dialog" role="dialog" aria-modal="true" aria-labelledby="strategy-history" onMouseDown={(event)=>event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">只读快照</p><h2 id="strategy-history">资源版本</h2></div><button className="nd-dialog-close" type="button" onClick={()=>setHistory(null)}>×</button></div><div className="nd-history-list">{history.map((version)=><article key={version.id}><div><strong>修订 {version.revision}</strong><span>{version.source==="create"?"创建":"编辑"}</span></div><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time><h3>{version.title}</h3></article>)}</div></section></div>}</ResourceShell>;
}

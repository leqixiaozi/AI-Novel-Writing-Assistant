import { useEffect, useState } from "react";
import type { BookSummary, BookViewKey, CardTypeCategory, CardTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import BookShell from "./BookShell";
import BookViewsPage from "./BookViewsPage";
import TypeDesigner from "./TypeDesigner";
import { BusinessFormWorkspace, type BusinessFormScope } from "./businessForms";
import InitializeProjectRule from './bookClassification/InitializeProjectRule';
import ProjectSetupIntro from './bookNavigation/ProjectSetupIntro';

interface Props { bookId:string; view:"forms"|"views"|"cards"|"fields"; viewKey?:BookViewKey; }

export default function BookWorkspacePage({bookId,view,viewKey="chapters"}:Props) {
  const [projectCardId,setProjectCardId]=useState<string|undefined>(),[canInitialize,setCanInitialize]=useState(false),[projectIssue,setProjectIssue]=useState<string|null>(null);
  const [book,setBook]=useState<BookSummary|null>(null);
  const [types,setTypes]=useState<CardTypeSummary[]>([]);
  const [categories,setCategories]=useState<CardTypeCategory[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const load=async()=>{const nextBook=await newDesignApi.getBook(bookId);const [nextTypes,nextCategories]=await Promise.all([newDesignApi.listCardTypes(nextBook.spaceId),newDesignApi.listCardTypeCategories()]);const requestedType=new URLSearchParams(location.search).get("typeKey");if(view==="cards"&&requestedType&&!nextTypes.some(type=>type.key===requestedType))throw Error("指定的本书资料类型不存在，不改选其他类型。");if(view==='forms'){const source=await newDesignApi.getBookClassification(bookId);if(source.bookId!==bookId)throw Error('\u4f5c\u54c1\u7ea6\u5b9a\u6765\u6e90\u4e0d\u4e00\u81f4\u3002');setProjectIssue(source.issue);setProjectCardId(source.cardId??undefined);setCanInitialize(source.canInitialize===true);}setBook(nextBook);setTypes(nextTypes);setCategories(nextCategories);setSelectedId((current)=>current??nextTypes[0]?.id??null);};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"书籍工作区加载失败。"));},[bookId]);
  if(message)return <div className="nd-shell nd-fatal"><h1>无法打开书籍</h1><p>{message}</p><a className="nd-button nd-button-primary" href="/new-design/books">返回我的书籍</a></div>;
  if(!book)return <div className="nd-shell nd-loading-screen"><div className="nd-loader"/><strong>正在打开书籍空间</strong></div>;
  if(view==="views")return <BookShell book={book} active="views"><BookViewsPage book={book} initialView={viewKey}/></BookShell>;
  if(view!=="fields") {
    const scope:BusinessFormScope=view==="forms"?"overview":"all";
    const active=view==="forms"?"direction":"materials";
    if(view==='forms'&&canInitialize)return <BookShell book={book} active={active}><ProjectSetupIntro/><InitializeProjectRule bookId={bookId} onReady={load}/></BookShell>;
    if(view==='forms'&&!projectCardId)return <BookShell book={book} active={active}><p role="alert">{projectIssue??'\u4f5c\u54c1\u7ea6\u5b9a\u539f\u6765\u6e90\u672a\u786e\u5b9a\uff0c\u4e0d\u6539\u9009\u5176\u4ed6\u8d44\u6599\u3002'}</p><a className="nd-button nd-button-secondary" href={`/new-design/books/${bookId}/cards?typeKey=project_rule`}>核对原作品约定</a><a className="nd-button nd-button-secondary" href={`/new-design/books/${bookId}/fields`}>维护本书原规格</a></BookShell>;
    return <BookShell book={book} active={active}>{view==='forms'&&<ProjectSetupIntro/>}<BusinessFormWorkspace book={book} cardTypes={types} scope={scope} compact initialCardId={view==='forms'?projectCardId:undefined} initialTypeId={view==="forms"?types.find(type=>type.key==="project_rule")?.id:types.find(type=>type.key===new URLSearchParams(location.search).get("typeKey"))?.id}/></BookShell>;
  }
  const selected=types.find((type)=>type.id===selectedId)??null;
  const saved=(next:CardTypeSummary)=>{setTypes((current)=>current.map((item)=>item.id===next.id?next:item));setSelectedId(next.id);};
  return <BookShell book={book} active="settings"><div className="nd-types-workspace"><aside className="nd-type-list-pane"><div className="nd-list-heading"><div><p className="nd-kicker">本书内容设置</p><strong>{types.length} 种资料类型</strong></div></div><div className="nd-type-list">{types.map((type,index)=><button className={selectedId===type.id?"is-selected":""} key={type.id} type="button" onClick={()=>setSelectedId(type.id)}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{type.name}</strong><small>本书独立 · v{type.currentVersion}</small></div><b>›</b></button>)}</div></aside><TypeDesigner selected={selected} spaceId={book.spaceId} onSaved={saved}/></div></BookShell>;
}

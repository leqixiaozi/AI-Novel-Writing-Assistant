import { useEffect, useState } from "react";
import type { BookSummary, CardTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import BookShell from "./BookShell";
import CardWorkspace from "./CardWorkspace";
import EventPlanningForm from "./EventPlanningForm";
import TypeDesigner from "./TypeDesigner";

interface Props { bookId:string; view:"forms"|"cards"|"fields"; }

export default function BookWorkspacePage({bookId,view}:Props) {
  const [book,setBook]=useState<BookSummary|null>(null);
  const [types,setTypes]=useState<CardTypeSummary[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const load=async()=>{const nextBook=await newDesignApi.getBook(bookId);const nextTypes=await newDesignApi.listCardTypes(nextBook.spaceId);setBook(nextBook);setTypes(nextTypes);setSelectedId((current)=>current??nextTypes[0]?.id??null);};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"书籍工作区加载失败。"));},[bookId]);
  if(message)return <div className="nd-shell nd-fatal"><h1>无法打开书籍</h1><p>{message}</p><a className="nd-button nd-button-primary" href="/new-design/books">返回我的书籍</a></div>;
  if(!book)return <div className="nd-shell nd-loading-screen"><div className="nd-loader"/><strong>正在打开书籍空间</strong></div>;
  if(view==="forms")return <BookShell book={book} active="forms"><EventPlanningForm spaceId={book.spaceId} bookName={book.name}/></BookShell>;
  if(view==="cards")return <BookShell book={book} active="cards"><CardWorkspace cardTypes={types} spaceId={book.spaceId}/></BookShell>;
  const selected=types.find((type)=>type.id===selectedId)??null;
  const saved=(next:CardTypeSummary)=>{setTypes((current)=>current.map((item)=>item.id===next.id?next:item));setSelectedId(next.id);};
  return <BookShell book={book} active="fields"><div className="nd-types-workspace"><aside className="nd-type-list-pane"><div className="nd-list-heading"><div><p className="nd-kicker">本书类型副本</p><strong>{types.length} 种卡片</strong></div></div><div className="nd-type-list">{types.map((type,index)=><button className={selectedId===type.id?"is-selected":""} key={type.id} type="button" onClick={()=>setSelectedId(type.id)}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{type.name}</strong><small>本书独立 · v{type.currentVersion}</small></div><b>›</b></button>)}</div></aside><TypeDesigner selected={selected} spaceId={book.spaceId} onSaved={saved}/></div></BookShell>;
}

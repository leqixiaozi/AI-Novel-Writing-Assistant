import { useEffect, useState } from "react";
import type { BookSummary } from "../common/contracts";
import { newDesignApi } from "./api";

export default function BooksPage() {
  const [books,setBooks]=useState<BookSummary[]>([]);
  const [message,setMessage]=useState("");
  const load=async()=>setBooks(await newDesignApi.listBooks());
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"书籍加载失败。"));},[]);
  return <div className="nd-shell">
    <header className="nd-page-header"><div><p className="nd-eyebrow">新设计 · 我的书籍</p><h1>我的书籍</h1><p>每本书都是独立工作空间，开书模板只负责安装起点，不会把后续修改互相串联。</p><div className="nd-header-facts"><span>{books.length} 本书</span><span>{books.reduce((sum,book)=>sum+book.cardCount,0)} 条本书资料</span></div></div><a className="nd-button nd-button-primary" href="/new-design/books/new">＋ 新建书籍</a></header>
    {message&&<p className="nd-message is-error">{message}</p>}
    {books.length?<div className="nd-book-grid">{books.map((book)=><article className="nd-book-card" key={book.id}><div><p className="nd-kicker">开书模板 · {book.templateName} v{book.templateVersion}</p><h2>{book.name}</h2><p>{book.description||"尚未填写书籍说明。"}</p></div><dl><div><dt>本书资料</dt><dd>{book.cardCount}</dd></div><div><dt>创作表单</dt><dd>{book.formCount}</dd></div></dl><div className="nd-row-actions"><a className="nd-button nd-button-primary" href={`/new-design/books/${book.id}/overview`}>进入创作</a><a className="nd-button nd-button-secondary" href={`/new-design/books/${book.id}/cards`}>本书资料</a></div></article>)}</div>:<div className="nd-empty nd-empty-page"><strong>还没有书籍</strong><span>选择适合你的起点，系统会把内容整理进统一创作表单。</span><a className="nd-button nd-button-primary" href="/new-design/books/new">新建书籍</a></div>}
  </div>;
}

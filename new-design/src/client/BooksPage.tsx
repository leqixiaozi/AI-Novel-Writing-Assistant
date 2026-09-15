import { useEffect, useState } from "react";
import type { BookSummary, TemplateGroupSummary } from "../common/contracts";
import { newDesignApi } from "./api";

export default function BooksPage() {
  const [books,setBooks]=useState<BookSummary[]>([]);
  const [templates,setTemplates]=useState<TemplateGroupSummary[]>([]);
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [description,setDescription]=useState("");
  const [templateVersionId,setTemplateVersionId]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const load=async()=>{const [nextBooks,nextTemplates]=await Promise.all([newDesignApi.listBooks(),newDesignApi.listTemplates()]);setBooks(nextBooks);setTemplates(nextTemplates.filter((item)=>item.currentVersionId));setTemplateVersionId((current)=>current||nextTemplates.find((item)=>item.currentVersionId)?.currentVersionId||"");};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"书籍加载失败。"));},[]);
  const create=async()=>{setBusy(true);setMessage("");try{const book=await newDesignApi.createBook({key:`book_${Date.now().toString(36)}`,name,description,templateVersionId});window.location.href=`/new-design/books/${book.id}/forms`;}catch(error){setMessage(error instanceof Error?error.message:"创建书籍失败。");setBusy(false);}};
  return <div className="nd-shell">
    <header className="nd-page-header"><div><p className="nd-eyebrow">新设计 · 我的书籍</p><h1>我的书籍</h1><p>每本书都是独立工作空间，模板只负责安装起点，不会把后续修改互相串联。</p><div className="nd-header-facts"><span>{books.length} 本书</span><span>{books.reduce((sum,book)=>sum+book.cardCount,0)} 张生产卡片</span></div></div><button className="nd-button nd-button-primary" type="button" onClick={()=>setCreating(true)}>＋ 新建书籍</button></header>
    {message&&<p className="nd-message is-error">{message}</p>}
    {books.length?<div className="nd-book-grid">{books.map((book)=><article className="nd-book-card" key={book.id}><div><p className="nd-kicker">{book.templateName} · v{book.templateVersion}</p><h2>{book.name}</h2><p>{book.description||"尚未填写书籍说明。"}</p></div><dl><div><dt>生产卡片</dt><dd>{book.cardCount}</dd></div><div><dt>创作表单</dt><dd>{book.formCount}</dd></div></dl><div className="nd-row-actions"><a className="nd-button nd-button-primary" href={`/new-design/books/${book.id}/forms`}>进入创作</a><a className="nd-button nd-button-secondary" href={`/new-design/books/${book.id}/cards`}>全部卡片</a></div></article>)}</div>:<div className="nd-empty nd-empty-page"><strong>还没有书籍</strong><span>选择一个已发布模板，建立第一本独立书籍空间。</span><button className="nd-button nd-button-primary" type="button" onClick={()=>setCreating(true)}>新建书籍</button></div>}
    {creating&&<div className="nd-dialog-backdrop" role="presentation" onMouseDown={()=>setCreating(false)}><section className="nd-history-dialog nd-create-book-dialog" role="dialog" aria-modal="true" onMouseDown={(event)=>event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">安装模板快照</p><h2>新建书籍</h2></div><button className="nd-dialog-close" type="button" onClick={()=>setCreating(false)}>×</button></div><label className="nd-control"><span>书名</span><input autoFocus value={name} onChange={(event)=>setName(event.target.value)}/></label><label className="nd-control"><span>一句话说明</span><textarea value={description} onChange={(event)=>setDescription(event.target.value)}/></label><label className="nd-control"><span>初始模板</span><select value={templateVersionId} onChange={(event)=>setTemplateVersionId(event.target.value)}>{templates.map((template)=><option key={template.id} value={template.currentVersionId??""}>{template.name} · v{template.currentVersion}</option>)}</select></label><p className="nd-help-text">创建后会复制类型、字典、关系和表单；以后本书可独立调整。</p><div className="nd-editor-actions"><button className="nd-button nd-button-secondary" type="button" onClick={()=>setCreating(false)}>取消</button><button className="nd-button nd-button-primary" disabled={busy||!name.trim()||!templateVersionId} type="button" onClick={()=>void create()}>{busy?"创建中…":"创建并进入"}</button></div></section></div>}
  </div>;
}

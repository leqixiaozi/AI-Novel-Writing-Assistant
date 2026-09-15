import { useEffect, useState } from "react";
import type { BookSummary } from "../common/contracts";
import { newDesignApi } from "./api";

export default function NewDesignLanding() {
  const [books,setBooks]=useState<BookSummary[]>([]);
  const [database,setDatabase]=useState<{mode:"bundled"|"external";postgresVersion:string;port:number}|null>(null);
  const [message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([newDesignApi.listBooks(),newDesignApi.health()]).then(([nextBooks,status])=>{setBooks(nextBooks);setDatabase(status);}).catch((error)=>setMessage(error instanceof Error?error.message:"新设计服务启动失败。"));},[]);
  const recent=books[0];
  return <div className="nd-shell">
    <header className="nd-page-header"><div><p className="nd-eyebrow">小说生产底座</p><h1>新设计</h1><p>先进入一本书进行创作；结构设计中心负责维护可复用模板，不和具体书稿混在一起。</p></div>{database&&<div className="nd-db-status" title={`PostgreSQL ${database.postgresVersion}`}><i/><span>数据底座正常</span><small>PostgreSQL · 端口 {database.port}</small></div>}</header>
    {message?<div className="nd-fatal"><h2>数据库未就绪</h2><p>{message}</p></div>:<div className="nd-entry-grid"><a className="nd-entry-card is-primary" href={recent?`/new-design/books/${recent.id}/forms`:"/new-design/books"}><p className="nd-kicker">推荐入口</p><h2>{recent?`继续《${recent.name}》`:"开始第一本书"}</h2><p>{recent?`${recent.cardCount} 条资料已经在独立书籍空间中就绪。`:"选择模板，建立一套可持续生产的书籍资料。"}</p><span>进入我的书籍 →</span></a><a className="nd-entry-card" href="/new-design/resources"><p className="nd-kicker">跨书复用</p><h2>我的卡片</h2><p>维护业务资源与 AI 指令组件；人物、世界和事件仍归各自书籍。</p><span>浏览资源卡片 →</span></a><a className="nd-entry-card" href="/new-design/structure/card-types"><p className="nd-kicker">底座管理</p><h2>结构设计中心</h2><p>维护 30 种系统规格、稳定字典、关系、组合表单和模板版本。</p><span>管理结构 →</span></a></div>}
  </div>;
}

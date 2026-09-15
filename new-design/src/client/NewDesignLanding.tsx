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
    <header className="nd-page-header"><div><p className="nd-eyebrow">新设计 · 小说生产底座</p><h1>创作首页</h1><p>从一本书开始，按人物、世界、剧情和章节完成创作规划；跨书复用内容统一放在创作资源中。</p></div>{database&&<div className="nd-db-status" title={`PostgreSQL ${database.postgresVersion}`}><i/><span>数据底座正常</span><small>PostgreSQL · 端口 {database.port}</small></div>}</header>
    {message?<div className="nd-fatal"><h2>数据库未就绪</h2><p>{message}</p></div>:<div className="nd-entry-grid"><a className="nd-entry-card is-primary" href={recent?`/new-design/books/${recent.id}/forms`:"/new-design/books"}><p className="nd-kicker">推荐入口</p><h2>{recent?`继续《${recent.name}》`:"开始第一本书"}</h2><p>{recent?`${recent.cardCount} 条本书资料已经就绪。`:"选择开书模板，建立可持续完善的创作资料。"}</p><span>进入我的书籍 →</span></a><a className="nd-entry-card" href="/new-design/resources"><p className="nd-kicker">跨书复用</p><h2>创作资源</h2><p>维护题材策略、推进方式与 AI 指令；人物、世界和事件仍归各自书籍。</p><span>浏览创作资源 →</span></a><a className="nd-entry-card" href="/new-design/structure/card-types"><p className="nd-kicker">高级设置</p><h2>内容与模板</h2><p>维护内容类型、选项与关联、创作表单和开书模板。</p><span>打开高级设置 →</span></a></div>}
  </div>;
}

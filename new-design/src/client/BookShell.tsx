import type { ReactNode } from "react";
import type { BookSummary } from "../common/contracts";

interface BookShellProps {
  book: BookSummary;
  active: "forms" | "cards" | "fields";
  children: ReactNode;
}

export default function BookShell({ book, active, children }: BookShellProps) {
  const root = `/new-design/books/${book.id}`;
  return <div className="nd-shell">
    <header className="nd-context-header nd-book-header">
      <div>
        <p className="nd-breadcrumb"><a href="/new-design/books">新设计／我的书籍</a>／{book.name}</p>
        <h1>{book.name}</h1>
        <p>{book.description || "这本书拥有独立的卡片、字段、关系和创作表单。"}</p>
        <div className="nd-header-facts"><span>{book.cardCount} 张卡片</span><span>{book.formCount} 个创作表单</span><span>模板 v{book.templateVersion}</span></div>
      </div>
    </header>
    <nav className="nd-subnav" aria-label={`${book.name}工作区`}>
      <a className={active === "forms" ? "active" : ""} href={`${root}/forms`}>创作表单</a>
      <a className={active === "cards" ? "active" : ""} href={`${root}/cards`}>本书资料库</a>
      <a className={active === "fields" ? "active" : ""} href={`${root}/fields`}>本书字段</a>
    </nav>
    {children}
  </div>;
}

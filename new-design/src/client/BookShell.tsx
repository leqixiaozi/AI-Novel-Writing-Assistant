import type { ReactNode } from "react";
import type { BookSummary } from "../common/contracts";
import { BOOK_TASK_NAV, type BookTaskNavKey } from "./navigation";

interface BookShellProps {
  book: BookSummary;
  active: BookTaskNavKey;
  children: ReactNode;
}

export default function BookShell({ book, active, children }: BookShellProps) {
  const root = `/new-design/books/${book.id}`;
  return <div className="nd-shell">
    <header className="nd-context-header nd-book-header">
      <div>
        <p className="nd-breadcrumb"><a href="/new-design/books">新设计／我的书籍</a>／{book.name}</p>
        <h1>{book.name}</h1>
        <p>{book.description || "这本书拥有独立的创作资料、设定关联和创作表单。"}</p>
        <div className="nd-header-facts"><span>{book.cardCount} 条本书资料</span><span>{book.formCount} 个创作表单</span><span>开书模板 v{book.templateVersion}</span></div>
      </div>
    </header>
    <nav className="nd-subnav" aria-label={`${book.name}工作区`}>
      {BOOK_TASK_NAV.map((item) => <a className={active === item.key ? "active" : ""} href={`${root}/${item.path}`} key={item.key}>{item.label}</a>)}
    </nav>
    {children}
  </div>;
}

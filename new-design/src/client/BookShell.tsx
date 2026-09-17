import type { ReactNode } from "react";
import type { BookSummary } from "../common/contracts";
import type { BookTaskNavKey } from "./navigation";
import BookNavigation from "./bookNavigation";

interface BookShellProps {
  book: BookSummary;
  active: BookTaskNavKey;
  children: ReactNode;
  compact?: boolean;
}

export default function BookShell({ book, active, children, compact=false }: BookShellProps) {
  const root = `/new-design/books/${book.id}`;
  return <div className="nd-shell">
    <header className="nd-context-header nd-book-header">
      <div>
        <p className="nd-breadcrumb"><a href="/new-design/books">新设计／我的书籍</a>／{book.name}</p>
        <div className="nd-book-title-row"><h1>{book.name}</h1><a className="nd-book-settings-link" href={`${root}/fields`} aria-current={active === "settings" ? "page" : undefined}>本书设置</a></div>
        {!compact&&<><p>{book.description || "这本书拥有独立的创作资料、设定关联和创作表单。"}</p>
        <div className="nd-header-facts"><span>{book.cardCount} 条本书资料</span><span>{book.formCount} 个创作表单</span><span>开书模板 v{book.templateVersion}</span></div></>}
      </div>
    </header>
    <div className="nd-book-layout">
      <BookNavigation key={book.id} bookId={book.id} bookName={book.name} active={active}/>
      <div className="nd-book-content">{children}</div>
    </div>
  </div>;
}

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
  return <div className={`nd-shell nd-book-shell${compact?" is-compact":""}`}>
    <div className="nd-book-layout">
      <BookNavigation key={book.id} book={book} active={active}/>
      <div className="nd-book-content">{children}</div>
    </div>
  </div>;
}

import type { ReactNode } from "react";
import type { BookSummary } from "../common/contracts";
import type { BookTaskNavKey } from "./navigation";
import BookNavigation from "./bookNavigation";
import {BOOK_WORKFLOW_STEPS,currentBookWorkflowStep} from "./bookNavigation/workflow";

interface BookShellProps {
  book: BookSummary;
  active: BookTaskNavKey;
  children: ReactNode;
  compact?: boolean;
  title?: string;
}

export default function BookShell({ book, active, children, compact=false,title }: BookShellProps) {
  const step=currentBookWorkflowStep(active,new URLSearchParams(location.search),location.pathname);
  const auxiliaryTitle:Partial<Record<BookTaskNavKey,string>>={overview:'创作概览',views:'查看与分析',director:'AI 驾驶舱',history:'整书历史',completion:'完本与导出',settings:'本书设置',materials:'本书资料',knowledge:'知识与参考'};
  return <div className={`nd-shell nd-book-shell${compact?" is-compact":""}`}>
    <div className="nd-book-layout">
      <BookNavigation key={book.id} book={book} active={active}/>
      <div className="nd-book-content"><header className="nd-production-header"><div><p>{book.name}{step>=0&&<span>第 {step+1} 步 / 共 8 步</span>}</p><h1>{title??(step>=0?BOOK_WORKFLOW_STEPS[step].label:auxiliaryTitle[active]??"本书工具")}</h1></div><nav aria-label="书级操作"><a className="nd-button" href={`/new-design/books/${book.id}/simple`}>简易创作</a><a className="nd-button" href={`/new-design/books/${book.id}/director`}>AI 全书导演</a><a className="nd-button" href={`/new-design/books/${book.id}/completion`}>导出</a><a className="nd-button" href={`/new-design/books/${book.id}/overview`}>项目工具</a></nav></header>{children}</div>
    </div>
  </div>;
}

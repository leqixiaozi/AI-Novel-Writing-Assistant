import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, BookOpen, BookOpenText, Boxes, FileText, LayoutDashboard, Library, Settings, Users, WandSparkles } from "lucide-react";
import "@/pages/bookArrangement/bookArrangement.css";

export interface ArrangementBookSummary { title: string; chapters: number; written: number; coverUrl?: string | null; genre?: string | null }
const ArrangementShellContext = createContext<(book: ArrangementBookSummary | null) => void>(() => {});
export const useArrangementShell = () => useContext(ArrangementShellContext);

/** Uses the workbench header when mounted in the app; remains local in isolated previews. */
export function ArrangementToolbar({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(document.getElementById("book-arrangement-toolbar")); }, []);
  return target ? createPortal(children, target) : <div className="ba-toolbar-local">{children}</div>;
}

export default function BookArrangementShell({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const novelId = params.get("novelId");
  const [book, setBook] = useState<ArrangementBookSummary | null>(null);
  const bookPath = novelId ? `/novels/${encodeURIComponent(novelId)}/edit` : "/novels";
  const stagePath = (stage: string) => novelId ? `${bookPath}?stage=${stage}` : bookPath;
  useEffect(() => { setBook(null); }, [novelId]);
  const links = [
    { title: "作品概览", to: stagePath("basic"), Icon: LayoutDashboard },
    { title: "角色准备", to: stagePath("character"), Icon: Users },
    { title: "大纲与章节", to: stagePath("structured"), Icon: FileText },
    { title: "全书编排台", to: `/book-arrangement${novelId ? `?novelId=${encodeURIComponent(novelId)}` : ""}`, Icon: Boxes, active: true },
    { title: "章节写作", to: stagePath("chapter"), Icon: BookOpenText },
  ];
  return <ArrangementShellContext.Provider value={setBook}>
    <div className="ba-app-shell">
      <header className="ba-app-header">
        <Link to="/novels" className="ba-brand" aria-label="返回小说列表"><BookOpen size={27} strokeWidth={1.6} /><span>拾章</span></Link>
        <span className="ba-brand-caption">用 AI，写出更好的故事</span>
        <div id="book-arrangement-toolbar" className="ba-header-tools" />
      </header>
      <div className="ba-app-body">
        <aside className="ba-sidebar" aria-label="作品导航">
          <section className="ba-book-summary">
            <p>当前作品</p>
            <div className="ba-book-summary-content">
              {book?.coverUrl ? <img src={book.coverUrl} alt="作品封面" className="ba-book-cover" /> : <BookOpen className="ba-book-icon" size={34} strokeWidth={1.2} />}
              <div><h2>{book?.title || "选择作品"}</h2><small>{book?.genre || "长篇创作"}</small><span>{book ? `${book.written} / ${book.chapters} 章已写` : "从编排台选择一本作品"}</span>{book && <progress aria-label="已写章节进度" value={book.written} max={Math.max(1, book.chapters)} />}</div>
            </div>
          </section>
          <nav>{links.map(({ title, to, Icon, active }) => <Link key={title} to={to} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={1.8} /><span>{title}</span></Link>)}</nav>
          <nav className="ba-sidebar-secondary">
            <Link to="/creative-hub"><WandSparkles size={18} /><span>创作工具</span></Link>
            <Link to="/knowledge"><Library size={18} /><span>资源库</span></Link>
            <Link to="/settings"><Settings size={18} /><span>系统设置</span></Link>
            <Link to="/novels"><ArrowLeft size={18} /><span>返回小说列表</span></Link>
          </nav>
          <p className="ba-sidebar-caption">让好故事被看见</p>
        </aside>
        <main className="ba-app-content">{children}</main>
      </div>
    </div>
  </ArrangementShellContext.Provider>;
}

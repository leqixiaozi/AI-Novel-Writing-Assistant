import {useId,useMemo,useState} from "react";
import type {BookTaskNavKey} from "../navigation";
import type {BookSummary} from "../../common/contracts";
import {bookNavigationPage} from "../navigation";
import BookFlowNavigation from "./BookFlowNavigation";
import {buildBookFunctionTree} from "./catalog";
import "./navigation.css";
export {default as BookRouteShell} from "./BookRouteShell";

interface Props {book:BookSummary;active:BookTaskNavKey;}

export default function BookNavigation({book,active}:Props){
 const {id:bookId,name:bookName}=book;
 const bodyId=useId(),preferenceKey=`new-design:book-navigation:${bookId}:collapsed`;
 const [collapsed,setCollapsed]=useState(()=>{try{return sessionStorage.getItem(preferenceKey)==="true";}catch{return false;}});
 const nodes=useMemo(()=>buildBookFunctionTree(bookId),[bookId]);
 const toggle=()=>{const next=!collapsed;setCollapsed(next);try{sessionStorage.setItem(preferenceKey,String(next));}catch{/* Navigation remains usable without browser storage. */}};
 return <aside className={`nd-book-navigation${collapsed?" is-collapsed":""}`} aria-label={`${bookName}功能目录`}>
  <div className="nd-book-navigation-context" hidden={collapsed}>
   <p><a href="/new-design/books">新设计／我的书籍</a></p>
   <div><strong>{bookName}</strong><a href={`/new-design/books/${bookId}/fields`} aria-current={active === "settings" ? "page" : undefined}>本书设置</a></div>
  </div>
  <div className="nd-book-navigation-heading">
   <span hidden={collapsed}>本书目录</span>
   <button type="button" className="nd-book-navigation-collapse" aria-label={collapsed?"展开本书目录":"向左收起本书目录"} title={collapsed?"展开本书目录":"向左收起本书目录"} aria-controls={bodyId} aria-expanded={!collapsed} onClick={toggle}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d={collapsed?"m7 5 5 5-5 5":"m12 5-5 5 5 5"}/></svg>
   </button>
  </div>
  <div id={bodyId} className="nd-book-navigation-body" hidden={collapsed}>
   <BookFlowNavigation label={`${bookName}工作区`} nodes={nodes} selectedId={`page:${bookNavigationPage(active)}`}/>
  </div>
 </aside>;
}

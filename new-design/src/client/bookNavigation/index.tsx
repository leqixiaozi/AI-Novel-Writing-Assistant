import {useId,useMemo,useState} from "react";
import type {BookTaskNavKey} from "../navigation";
import {TreeNavigation} from "../tree";
import {buildBookFunctionTree} from "./catalog";
import "./navigation.css";
export {default as BookRouteShell} from "./BookRouteShell";

interface Props {bookId:string;bookName:string;active:BookTaskNavKey;}

export default function BookNavigation({bookId,bookName,active}:Props){
 const bodyId=useId(),preferenceKey=`new-design:book-navigation:${bookId}:collapsed`;
 const [collapsed,setCollapsed]=useState(()=>{try{return sessionStorage.getItem(preferenceKey)==="true";}catch{return false;}});
 const nodes=useMemo(()=>buildBookFunctionTree(bookId),[bookId]);
 const toggle=()=>{const next=!collapsed;setCollapsed(next);try{sessionStorage.setItem(preferenceKey,String(next));}catch{/* Navigation remains usable without browser storage. */}};
 return <aside className={`nd-book-navigation${collapsed?" is-collapsed":""}`} aria-label={`${bookName}功能目录`}>
  <div className="nd-book-navigation-heading">
   <span hidden={collapsed}>本书目录</span>
   <button type="button" className="nd-book-navigation-collapse" aria-label={collapsed?"展开本书目录":"向左收起本书目录"} title={collapsed?"展开本书目录":"向左收起本书目录"} aria-controls={bodyId} aria-expanded={!collapsed} onClick={toggle}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d={collapsed?"m7 5 5 5-5 5":"m12 5-5 5 5 5"}/></svg>
   </button>
  </div>
  <div id={bodyId} className="nd-book-navigation-body" hidden={collapsed}>
   <TreeNavigation label={`${bookName}工作区`} nodes={nodes} selectedIds={[`page:${active}`]}/>
  </div>
 </aside>;
}

import {useEffect,useState,type ReactNode} from "react";
import type {BookSummary} from "../../common/contracts";
import type {BookTaskNavKey} from "../navigation";
import {newDesignApi} from "../api";
import BookShell from "../BookShell";

export default function BookRouteShell({bookId,active,children}:{bookId:string;active:BookTaskNavKey;children:ReactNode}){
 const [book,setBook]=useState<BookSummary|null>(null),[error,setError]=useState(""),[revision,setRevision]=useState(0);
 useEffect(()=>{let current=true;setBook(null);setError("");void newDesignApi.getBook(bookId).then(next=>{
  if(!current)return;
  if(next.id!==bookId||next.status!=="active")throw new Error("本书来源不可用，请返回书架核对。");
  setBook(next);
 }).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:"本书来源读取失败。");});return()=>{current=false;};},[bookId,revision]);
 if(!book)return <main className="nd-shell"><p role={error?"alert":"status"}>{error||"正在读取本书来源…"}</p>{error&&<><button type="button" className="nd-button" onClick={()=>setRevision(value=>value+1)}>重新读取本书来源</button><a href="/new-design/books">返回书架</a></>}</main>;
 return <BookShell book={book} active={active}>{children}</BookShell>;
}

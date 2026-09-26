import {useEffect,useState,type ReactNode} from "react";
import type {TreeNavigationNode} from "../tree";

function ancestors(nodes:TreeNavigationNode[],selectedId:string):string[]{
 for(const node of nodes){
  if(node.id===selectedId)return [node.id];
  const path=ancestors(node.children??[],selectedId);
  if(path.length)return [node.id,...path];
 }
 return [];
}

export default function BookFlowNavigation({nodes,selectedId,label}:{nodes:TreeNavigationNode[];selectedId:string;label:string}){
 const [expanded,setExpanded]=useState(()=>new Set(ancestors(nodes,selectedId).slice(0,-1)));
 useEffect(()=>{setExpanded(current=>new Set([...current,...ancestors(nodes,selectedId).slice(0,-1)]));},[nodes,selectedId]);
 const toggle=(id:string)=>setExpanded(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
 const render=(items:TreeNavigationNode[],depth=0):ReactNode=><ul>{items.map(node=>{
  const children=node.children??[],open=expanded.has(node.id);
  return <li key={node.id}>
   {children.length?<button type="button" className={`nd-book-flow-item is-group level-${depth}`} aria-expanded={open} onClick={()=>toggle(node.id)}>
    <svg className={open?"is-open":""} viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg><span>{node.name}</span>
   </button>:<a className={`nd-book-flow-item level-${depth}${node.id===selectedId?" is-selected":""}`} href={node.href} aria-current={node.id===selectedId?"page":undefined}>{node.name}</a>}
   {children.length>0&&<div hidden={!open}>{render(children,depth+1)}</div>}
  </li>;
 })}</ul>;
 return <nav className="nd-book-flow" aria-label={label}>{render(nodes)}</nav>;
}

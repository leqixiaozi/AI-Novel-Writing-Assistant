import {useEffect,useMemo,useState,type ReactNode} from "react";
import {filterNavigation,navigationAncestors,type NavigationBranch} from "./navigationPolicy";
import "./navigation.css";

export interface TreeNavigationNode extends NavigationBranch {
 children?:TreeNavigationNode[];count?:number;badge?:ReactNode;leading?:ReactNode;actions?:ReactNode;body?:ReactNode;
 disabled?:boolean;expandable?:boolean;onSelect?:()=>void;onExpand?:()=>void;anchorId?:string;href?:string;
}
interface Props {label:string;nodes:TreeNavigationNode[];selectedIds?:string[];query?:string;onSelect?:(id:string)=>void;initialExpandedIds?:string[];emptyText?:string;disabled?:boolean;}
export default function TreeNavigation({label,nodes,selectedIds=[],query="",onSelect,initialExpandedIds=[],emptyText="没有匹配内容。",disabled=false}:Props){
 const [expanded,setExpanded]=useState<Set<string>>(()=>new Set(initialExpandedIds));
 const signature=selectedIds.join("\u0000");
 useEffect(()=>{const parents=navigationAncestors(nodes,new Set(selectedIds));if(parents.length)setExpanded(current=>new Set([...current,...parents]));},[nodes,signature]);
 const filtered=useMemo(()=>filterNavigation(nodes,query),[nodes,query]),selected=new Set(selectedIds),searching=Boolean(query.trim());
 const toggle=(node:TreeNavigationNode)=>{const opening=!expanded.has(node.id);if(opening&&!disabled&&!node.disabled)node.onExpand?.();setExpanded(current=>{const next=new Set(current);if(next.has(node.id))next.delete(node.id);else next.add(node.id);return next;});};
 const render=(node:TreeNavigationNode):ReactNode=>{
  const children=node.children??[],branch=children.length>0||Boolean(node.body)||Boolean(node.expandable),open=searching||expanded.has(node.id),active=selected.has(node.id);
  const choose=()=>{if(disabled||node.disabled)return;if(node.onSelect)node.onSelect();else if(onSelect)onSelect(node.id);else if(branch)toggle(node);if(branch&&(node.onSelect||onSelect)){if(!node.onSelect)node.onExpand?.();setExpanded(current=>new Set([...current,node.id]));}};
  return <li key={node.id}><div id={node.anchorId} className={`nd-nav-tree-row${active?" is-selected":""}`}>
   {branch?<button type="button" className="nd-nav-tree-toggle" aria-label={`${open?"收起":"展开"}${node.name}`} aria-expanded={open} onClick={()=>toggle(node)}><svg className={open?"is-open":""} viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg></button>:<span className="nd-nav-tree-spacer"/>}
   {node.leading&&<span className="nd-nav-tree-leading">{node.leading}</span>}
   {node.href?<a className="nd-nav-tree-label" href={disabled||node.disabled?undefined:node.href} aria-disabled={disabled||node.disabled||undefined} tabIndex={disabled||node.disabled?-1:undefined} aria-current={active?"page":undefined} title={node.description||node.name} onClick={event=>{if(disabled||node.disabled)event.preventDefault();}}>{node.name}</a>:<button type="button" className="nd-nav-tree-label" disabled={disabled||node.disabled} aria-current={active?"true":undefined} title={node.description||node.name} onClick={choose}>{node.name}</button>}
   {node.badge&&<small className="nd-nav-tree-badge">{node.badge}</small>}{node.count!==undefined&&<small className="nd-nav-tree-count">{node.count}</small>}
   {node.actions&&<div className="nd-nav-tree-actions">{node.actions}</div>}
  </div>{open&&children.length>0&&<ul>{children.map(render)}</ul>}{open&&node.body&&<div className="nd-nav-tree-body">{node.body}</div>}</li>;
 };
 return <nav className="nd-nav-tree" aria-label={label}><ul>{filtered.map(render)}</ul>{!filtered.length&&<p className="nd-help-text">{emptyText}</p>}</nav>;
}

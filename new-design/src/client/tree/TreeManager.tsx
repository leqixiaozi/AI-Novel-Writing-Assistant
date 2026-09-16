import { useMemo, useState } from "react";
import type { TreeSelectorNode } from "./TreeSelector";

interface Props {
  nodes:TreeSelectorNode[];
  selectedId:string|null;
  onSelect:(id:string)=>void;
  onAdd:(parentId:string|null)=>void;
  onMove?:(id:string,direction:-1|1)=>void;
  isManagedNode?:(node:TreeSelectorNode)=>boolean;
}

export default function TreeManager({nodes,selectedId,onSelect,onAdd,onMove,isManagedNode=()=>true}:Props){
  const [query,setQuery]=useState(""),[expanded,setExpanded]=useState<Set<string>>(()=>new Set(nodes.filter(node=>!node.parentId).map(node=>node.id)));
  const children=useMemo(()=>{const map=new Map<string|null,TreeSelectorNode[]>();for(const node of nodes){map.set(node.parentId,[...(map.get(node.parentId)??[]),node]);}for(const branch of map.values())branch.sort((left,right)=>(left.sortOrder??0)-(right.sortOrder??0)||left.name.localeCompare(right.name,"zh-CN"));return map;},[nodes]);
  const normalized=query.trim().toLocaleLowerCase("zh-CN"),matches=(node:TreeSelectorNode)=>!normalized||`${node.name} ${node.description??""} ${(node.path??[]).join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized);
  const visible=useMemo(()=>{if(!normalized)return new Set(nodes.map(node=>node.id));const result=new Set<string>(),byId=new Map(nodes.map(node=>[node.id,node]));for(const node of nodes.filter(matches)){let current:TreeSelectorNode|undefined=node;while(current){result.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}}return result;},[nodes,normalized]);
  const render=(node:TreeSelectorNode,depth:number):React.ReactNode=>{
    if(!visible.has(node.id))return null;
    const branch=(children.get(node.id)??[]).filter(item=>visible.has(item.id)),siblings=(children.get(node.parentId)??[]).filter(isManagedNode),siblingIndex=siblings.findIndex(item=>item.id===node.id),open=Boolean(normalized)||expanded.has(node.id),selected=selectedId===node.id;
    return <div className="nd-tree-manager-node" key={node.id}>
      <div className={`nd-tree-manager-row${selected?" is-selected":""}`} style={{paddingLeft:`${.45+depth*.85}rem`}}>
        {branch.length?<button className={`nd-tree-manager-toggle${open?" is-open":""}`} type="button" aria-label={open?`收起${node.name}`:`展开${node.name}`} aria-expanded={open} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(node.id))next.delete(node.id);else next.add(node.id);return next;})}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg></button>:<span className="nd-tree-manager-spacer"/>}
        <button className="nd-tree-manager-label" type="button" onClick={()=>onSelect(node.id)} aria-current={selected?"true":undefined}><strong>{node.name}</strong><small>{node.description||"未填写解释"}</small></button>
        {isManagedNode(node)&&<div className="nd-tree-manager-actions">
          {onMove&&<><button type="button" aria-label={`上移${node.name}`} title="上移" disabled={siblingIndex<=0} onClick={()=>onMove(node.id,-1)}>↑</button><button type="button" aria-label={`下移${node.name}`} title="下移" disabled={siblingIndex<0||siblingIndex>=siblings.length-1} onClick={()=>onMove(node.id,1)}>↓</button></>}
          <button type="button" aria-label={`在${node.name}下新增`} title="新增下级" onClick={()=>onAdd(node.id)}>＋</button>
        </div>}
      </div>
      {open&&branch.map(child=>render(child,depth+1))}
    </div>;
  };
  return <aside className="nd-tree-manager"><div className="nd-tree-manager-tools"><label className="nd-control"><span className="nd-visually-hidden">搜索树节点</span><input value={query} placeholder="搜索名称或路径" onChange={event=>setQuery(event.target.value)}/></label><button className="nd-button nd-button-secondary" type="button" onClick={()=>onAdd(null)}>＋ 顶层项</button></div><div className="nd-tree-manager-scroll" role="tree">{(children.get(null)??[]).map(node=>render(node,0))}{!visible.size?<div className="nd-tree-manager-empty"><strong>没有匹配节点</strong><span>换一个关键词，或者新增顶层项。</span></div>:null}</div></aside>;
}

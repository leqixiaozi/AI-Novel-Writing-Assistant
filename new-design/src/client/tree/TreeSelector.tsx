import { useMemo, useState } from "react";
import type { TreeSelectionRule } from "../../common/contracts";
import { selectableTreeNodeIds, treeDescendantIds } from "../../common/treePolicy";

export interface TreeSelectorNode {
  id:string;
  parentId:string|null;
  name:string;
  description?:string;
  sortOrder?:number;
  status?:"active"|"archived";
  path?:string[];
}

interface Props {
  label:string;
  nodes:TreeSelectorNode[];
  rule:TreeSelectionRule;
  selectedIds:string[];
  disabled?:boolean;
  onChange:(ids:string[])=>void;
  onCreateChild?:(parentId:string|null)=>void;
}

export default function TreeSelector({label,nodes,rule,selectedIds,disabled,onChange,onCreateChild}:Props){
  const [query,setQuery]=useState(""),[expanded,setExpanded]=useState<Set<string>>(()=>new Set(nodes.filter(node=>!node.parentId).map(node=>node.id)));
  const byParent=useMemo(()=>{const map=new Map<string|null,TreeSelectorNode[]>();for(const node of nodes.filter(item=>item.status!=="archived")){map.set(node.parentId,[...(map.get(node.parentId)??[]),node]);}return map;},[nodes]);
  const selectable=useMemo(()=>selectableTreeNodeIds(nodes,rule),[nodes,rule]);
  const normalized=query.trim().toLocaleLowerCase("zh-CN");
  const visible=useMemo(()=>{if(!normalized)return new Set(nodes.map(node=>node.id));const result=new Set<string>();const byId=new Map(nodes.map(node=>[node.id,node]));for(const node of nodes){if(`${node.name} ${node.description??""} ${(node.path??[]).join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized)){let current:TreeSelectorNode|undefined=node;while(current){result.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}}}return result;},[nodes,normalized]);
  const toggle=(node:TreeSelectorNode)=>{if(disabled||!selectable.has(node.id))return;const single=rule.mode==="single"||rule.mode==="cascade_single";if(single){onChange(selectedIds.includes(node.id)?[]:[node.id]);return;}const affected=rule.mode==="cascade_multiple"?[node.id,...treeDescendantIds(nodes,node.id)]:[node.id];const next=new Set(selectedIds),remove=affected.every(id=>next.has(id));for(const id of affected.filter(id=>selectable.has(id))){if(remove)next.delete(id);else next.add(id);}const ordered=nodes.filter(item=>next.has(item.id)).map(item=>item.id);onChange(rule.maxSelections===null?ordered:ordered.slice(0,rule.maxSelections));};
  const render=(node:TreeSelectorNode,depth:number):React.ReactNode=>{if(!visible.has(node.id))return null;const children=(byParent.get(node.id)??[]).filter(child=>visible.has(child.id)),open=normalized.length>0||expanded.has(node.id),checked=selectedIds.includes(node.id),canSelect=selectable.has(node.id);return <div className="nd-tree-selector-node" key={node.id}><div className={`nd-tree-selector-row${checked?" is-selected":""}${canSelect?"":" is-restricted"}`} style={{paddingLeft:`${.5+depth*.9}rem`}}>{children.length?<button type="button" className="nd-tree-toggle" aria-label={open?`收起${node.name}`:`展开${node.name}`} aria-expanded={open} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(node.id))next.delete(node.id);else next.add(node.id);return next;})}>{open?"⌄":"›"}</button>:<span className="nd-tree-toggle-spacer"/>}<label><input type={rule.mode==="single"||rule.mode==="cascade_single"?"radio":"checkbox"} name={label} checked={checked} disabled={disabled||!canSelect} onChange={()=>toggle(node)}/><span><strong>{node.name}</strong>{rule.showFullPath&&node.path?.length?<small>{node.path.join("／")}</small>:node.description?<small>{node.description}</small>:null}</span></label>{onCreateChild&&rule.allowInlineCreate&&!disabled?<button className="nd-tree-inline-add" type="button" onClick={()=>onCreateChild(node.id)} aria-label={`在${node.name}下新增`}>＋</button>:null}</div>{open&&children.map(child=>render(child,depth+1))}</div>;};
  return <section className="nd-tree-selector" aria-label={label}><div className="nd-tree-selector-head"><div><strong>{label}</strong><small>{selectedIds.length?`已选 ${selectedIds.length} 项`:"尚未选择"}</small></div>{onCreateChild&&rule.allowInlineCreate&&!disabled?<button className="nd-text-button" type="button" onClick={()=>onCreateChild(null)}>＋ 新增顶层项</button>:null}</div><label className="nd-control"><span className="nd-visually-hidden">搜索{label}</span><input value={query} placeholder="搜索名称或路径" onChange={event=>setQuery(event.target.value)}/></label><div className="nd-tree-selector-scroll" role="tree">{(byParent.get(null)??[]).filter(node=>visible.has(node.id)).map(node=>render(node,0))}{!visible.size?<p className="nd-help-text">没有找到匹配项，可以更换关键词{onCreateChild&&rule.allowInlineCreate?"，或新增一项":""}。</p>:null}</div></section>;
}

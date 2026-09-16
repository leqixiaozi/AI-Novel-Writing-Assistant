import { useEffect, useMemo, useState } from "react";
import type { DefinitionScope } from "../../common/contracts";
import type { ReactNode } from "react";

export interface TreeResourceCatalogItem {
  id:string;
  name:string;
  description:string;
  scope:DefinitionScope;
  nodeCount:number;
}

interface Props {
  title:string;
  items:TreeResourceCatalogItem[];
  selectedId:string|null;
  onSelect:(id:string)=>void;
  onCreate:()=>void;
  selectedTree?:ReactNode;
}

const GROUPS:Array<{scope:DefinitionScope;label:string;hint:string}>=[
  {scope:"system",label:"系统资源",hint:"所有项目可用"},
  {scope:"template",label:"开书模板",hint:"随模板安装"},
  {scope:"book",label:"本书独立",hint:"仅当前书籍可用"},
];

export default function TreeResourceCatalog({title,items,selectedId,onSelect,onCreate,selectedTree}:Props){
  const grouped=useMemo(()=>new Map(GROUPS.map(group=>[group.scope,items.filter(item=>item.scope===group.scope)])),[items]);
  const [expanded,setExpanded]=useState<Set<DefinitionScope>>(()=>new Set(GROUPS.filter(group=>(grouped.get(group.scope)?.length??0)>0).map(group=>group.scope)));
  useEffect(()=>{const selected=items.find(item=>item.id===selectedId);if(selected)setExpanded(current=>new Set([...current,selected.scope]));},[items,selectedId]);
  const toggle=(scope:DefinitionScope)=>setExpanded(current=>{const next=new Set(current);if(next.has(scope))next.delete(scope);else next.add(scope);return next;});
  const [collapsedTrees,setCollapsedTrees]=useState<Set<string>>(()=>new Set());
  return <aside className="nd-catalog-list nd-tree-resource-catalog" aria-label={`${title}目录`}>
    <div className="nd-list-heading"><div><p className="nd-kicker">{title}</p><strong>{items.length} 个</strong></div><button type="button" aria-label={`新建${title}`} title={`新建${title}`} onClick={onCreate}>＋</button></div>
    <div className="nd-tree-resource-catalog-scroll">
      {GROUPS.map(group=>{const children=grouped.get(group.scope)??[];if(!children.length)return null;const open=expanded.has(group.scope);return <section className="nd-tree-resource-group" key={group.scope}>
        <button className="nd-tree-resource-group-toggle" type="button" title={group.hint} aria-expanded={open} onClick={()=>toggle(group.scope)}>
          <svg className={open?"is-open":""} viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg>
          <span><strong>{group.label}</strong><small>{group.hint}</small></span>
          <b>{children.length}</b>
        </button>
        {open&&<div className="nd-tree-resource-group-children">{children.map(item=>{const selected=item.id===selectedId,treeOpen=selected&&!collapsedTrees.has(item.id);return <div key={item.id} className="nd-catalog-branch">
          <div className={`nd-catalog-branch-heading${selected?" is-selected":""}`}>
          <button className={`nd-tree-manager-toggle${treeOpen?" is-open":""}`} type="button" aria-label={`${treeOpen?"收起":"展开"}${item.name}`} aria-expanded={treeOpen} onClick={()=>{if(!selected)onSelect(item.id);setCollapsedTrees(current=>{const next=new Set(current);if(treeOpen)next.add(item.id);else next.delete(item.id);return next;});}}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg></button>
          <button className="nd-catalog-branch-label" type="button" aria-current={selected?"page":undefined} onClick={()=>{onSelect(item.id);setCollapsedTrees(current=>{const next=new Set(current);next.delete(item.id);return next;});}} title={item.description||item.name}>
          <span><strong>{item.name}</strong>{item.description&&<small>{item.description}</small>}</span>
          </button><b>{item.nodeCount}</b></div>
          {treeOpen&&selectedTree&&<div className="nd-catalog-branch-nodes">{selectedTree}</div>}
        </div>;})}</div>}
      </section>;})}
      {!items.length&&<div className="nd-tree-manager-empty"><strong>还没有内容</strong><span>点击右上角加号创建第一棵树。</span></div>}
      {!selectedId&&selectedTree&&<div className="nd-catalog-branch-nodes">{selectedTree}</div>}
    </div>
  </aside>;
}

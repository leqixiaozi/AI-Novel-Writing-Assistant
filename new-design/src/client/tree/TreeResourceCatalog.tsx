import { useEffect, useMemo, useState } from "react";
import type { DefinitionScope } from "../../common/contracts";

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
}

const GROUPS:Array<{scope:DefinitionScope;label:string;hint:string}>=[
  {scope:"system",label:"系统资源",hint:"所有项目可用"},
  {scope:"template",label:"开书模板",hint:"随模板安装"},
  {scope:"book",label:"本书独立",hint:"仅当前书籍可用"},
];

export default function TreeResourceCatalog({title,items,selectedId,onSelect,onCreate}:Props){
  const grouped=useMemo(()=>new Map(GROUPS.map(group=>[group.scope,items.filter(item=>item.scope===group.scope)])),[items]);
  const [expanded,setExpanded]=useState<Set<DefinitionScope>>(()=>new Set(GROUPS.filter(group=>(grouped.get(group.scope)?.length??0)>0).map(group=>group.scope)));
  useEffect(()=>{const selected=items.find(item=>item.id===selectedId);if(selected)setExpanded(current=>new Set([...current,selected.scope]));},[items,selectedId]);
  const toggle=(scope:DefinitionScope)=>setExpanded(current=>{const next=new Set(current);if(next.has(scope))next.delete(scope);else next.add(scope);return next;});
  return <aside className="nd-catalog-list nd-tree-resource-catalog" aria-label={`${title}目录`}>
    <div className="nd-list-heading"><div><p className="nd-kicker">{title}</p><strong>{items.length} 个</strong></div><button type="button" aria-label={`新建${title}`} title={`新建${title}`} onClick={onCreate}>＋</button></div>
    <div className="nd-tree-resource-catalog-scroll" role="tree">
      {GROUPS.map(group=>{const children=grouped.get(group.scope)??[];if(!children.length)return null;const open=expanded.has(group.scope);return <section className="nd-tree-resource-group" key={group.scope}>
        <button className="nd-tree-resource-group-toggle" type="button" aria-expanded={open} onClick={()=>toggle(group.scope)}>
          <svg className={open?"is-open":""} viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg>
          <span><strong>{group.label}</strong><small>{group.hint}</small></span>
          <b>{children.length}</b>
        </button>
        {open&&<div className="nd-tree-resource-group-children" role="group">{children.map(item=>{const selected=item.id===selectedId;return <button className={selected?"is-selected":""} type="button" role="treeitem" aria-current={selected?"page":undefined} key={item.id} onClick={()=>onSelect(item.id)} title={item.description||item.name}>
          <span className="nd-tree-resource-connector" aria-hidden="true"/>
          <span><strong>{item.name}</strong>{item.description&&<small>{item.description}</small>}</span>
          <b>{item.nodeCount}</b>
        </button>;})}</div>}
      </section>;})}
      {!items.length&&<div className="nd-tree-manager-empty"><strong>还没有内容</strong><span>点击右上角加号创建第一棵树。</span></div>}
    </div>
  </aside>;
}

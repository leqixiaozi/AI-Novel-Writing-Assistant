import { useEffect, useMemo, useState } from "react";
import type { CardTypeCategory, CardTypeSummary } from "../common/contracts";
import { buildCardTypeTree, type CardTypeTreeNode } from "../common/cardTypeTree";
import { newDesignApi } from "./api";
import StructureShell from "./StructureShell";
import TypeDesigner from "./TypeDesigner";

export default function CardTypeCatalogPage() {
  const [cardTypes,setCardTypes]=useState<CardTypeSummary[]>([]);
  const [categories,setCategories]=useState<CardTypeCategory[]>([]);
  const [selectedTypeId,setSelectedTypeId]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const [query,setQuery]=useState("");
  const [message,setMessage]=useState("");
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [addingCategory,setAddingCategory]=useState(false);
  const [categoryName,setCategoryName]=useState("");
  const load=async()=>{const [types,nextCategories]=await Promise.all([newDesignApi.listCardTypes(),newDesignApi.listCardTypeCategories()]);setCardTypes(types);setCategories(nextCategories);setExpanded(new Set(nextCategories.map((item)=>item.id)));setSelectedTypeId((current)=>current??types[0]?.id??null);};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"类型目录加载失败。"));},[]);
  const selected=creating?null:cardTypes.find((item)=>item.id===selectedTypeId)??null;
  const tree=useMemo(()=>buildCardTypeTree(categories,cardTypes,query),[categories,cardTypes,query]);
  const saved=(cardType:CardTypeSummary)=>{setCardTypes((current)=>current.some((item)=>item.id===cardType.id)?current.map((item)=>item.id===cardType.id?cardType:item):[cardType,...current]);setSelectedTypeId(cardType.id);setCreating(false);};
  const toggle=(id:string)=>setExpanded((current)=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const addCategory=async()=>{if(!categoryName.trim())return;try{const created=await newDesignApi.createCardTypeCategory({key:`category_${Date.now().toString(36)}`,name:categoryName.trim(),parentId:null,sortOrder:1000});setCategories((current)=>[...current,created]);setExpanded((current)=>new Set([...current,created.id]));setCategoryName("");setAddingCategory(false);}catch(error){setMessage(error instanceof Error?error.message:"分类创建失败。");}};
  const renderNode=(node:CardTypeTreeNode,depth=0):React.ReactNode=>{
    const open=query.trim().length>0||expanded.has(node.category.id);
    return <div className="nd-tree-node" key={node.category.id}>
      <button className="nd-tree-category" style={{paddingLeft:`${.7+depth*.85}rem`}} type="button" onClick={()=>toggle(node.category.id)} aria-expanded={open} title={node.category.name}>
        <span className={`nd-tree-chevron${open?" is-open":""}`} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7.5 5 5 5-5 5"/></svg></span>
        <strong>{node.category.name}</strong>
        <span className="nd-tree-count">{node.typeCount}</span>
        <span className="nd-tree-source">{node.category.isSystem?"内置":"自定义"}</span>
      </button>
      {open&&<div className="nd-tree-children">{node.children.map((child)=>renderNode(child,depth+1))}{node.cardTypes.map((item)=>{
        const active=!creating&&selectedTypeId===item.id;
        return <button key={item.id} type="button" className={`nd-tree-leaf${active?" is-selected":""}`} style={{paddingLeft:`${2+depth*.85}rem`}} onClick={()=>{setCreating(false);setSelectedTypeId(item.id);}} aria-current={active?"page":undefined} title={item.name}>
          <span className="nd-tree-branch" aria-hidden="true"/>
          <div><strong>{item.name}</strong><small>{item.isSystem?"系统":"自定义"} · {item.currentVersion?`v${item.currentVersion}`:"草稿"}</small></div>
        </button>;
      })}</div>}
    </div>;
  };
  return <StructureShell title="内容类型" description="维护系统、开书模板和书籍可以安装的字段结构与组合能力。">
    <div className="nd-types-workspace"><aside className="nd-type-list-pane" aria-label="内容类型目录"><div className="nd-list-heading nd-catalog-heading"><div><p className="nd-kicker">内容目录</p><strong>{categories.length} 个分类 <span>· {cardTypes.length} 种类型</span></strong></div><div className="nd-tree-actions"><button title="新建分类" aria-label="新建分类" type="button" onClick={()=>setAddingCategory((value)=>!value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h6l2 2h10v10H3zM17 11v5M14.5 13.5h5"/></svg><span>分类</span></button><button className="is-primary" title="新建内容类型" aria-label="新建内容类型" type="button" onClick={()=>{setCreating(true);setSelectedTypeId(null);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>类型</span></button></div></div>{addingCategory&&<div className="nd-category-create"><label><span>新分类名称</span><input autoFocus value={categoryName} placeholder="例如：世界设定" onChange={(event)=>setCategoryName(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void addCategory();if(event.key==="Escape")setAddingCategory(false);}}/></label><div><button type="button" onClick={()=>setAddingCategory(false)}>取消</button><button className="is-primary" type="button" disabled={!categoryName.trim()} onClick={()=>void addCategory()}>保存</button></div></div>}<div className="nd-type-search"><label className="nd-visually-hidden" htmlFor="nd-card-type-search">搜索内容类型</label><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><input id="nd-card-type-search" value={query} placeholder="搜索类型或分类" onChange={(event)=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label="清空搜索" title="清空搜索" onClick={()=>setQuery("")}>×</button>}</div><div className="nd-type-tree">{tree.length?tree.map((node)=>renderNode(node)):<div className="nd-type-tree-empty"><strong>没有匹配结果</strong><span>试试更短的名称，或新建一种内容类型。</span></div>}</div>{message&&<p className="nd-message is-error">{message}</p>}</aside><TypeDesigner selected={selected} categories={categories} onSaved={saved}/></div>
  </StructureShell>;
}

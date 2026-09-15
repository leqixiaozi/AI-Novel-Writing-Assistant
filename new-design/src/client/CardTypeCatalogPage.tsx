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
  const renderNode=(node:CardTypeTreeNode,depth=0):React.ReactNode=><div className="nd-tree-node" key={node.category.id}><button className="nd-tree-category" style={{paddingLeft:`${.55+depth*.8}rem`}} type="button" onClick={()=>toggle(node.category.id)} aria-expanded={query.trim()?true:expanded.has(node.category.id)}><span>{query.trim()||expanded.has(node.category.id)?"⌄":"›"}</span><strong>{node.category.name}</strong><small>{node.typeCount}</small><b>{node.category.isSystem?"内置":"自定义"}</b></button>{(query.trim()||expanded.has(node.category.id))&&<div>{node.children.map((child)=>renderNode(child,depth+1))}{node.cardTypes.map((item)=><button key={item.id} type="button" className={`nd-tree-leaf${!creating&&selectedTypeId===item.id?" is-selected":""}`} style={{paddingLeft:`${1.65+depth*.8}rem`}} onClick={()=>{setCreating(false);setSelectedTypeId(item.id);}}><span>└</span><div><strong>{item.name}</strong><small>{item.isSystem?"系统":"自定义"} · {item.currentVersion?`v${item.currentVersion}`:"草稿"}</small></div></button>)}</div>}</div>;
  return <StructureShell title="元卡片类型" description="维护系统、模板和书籍可以安装的字段结构与组合能力。">
    <div className="nd-types-workspace"><aside className="nd-type-list-pane"><div className="nd-list-heading"><div><p className="nd-kicker">结构目录</p><strong>{categories.length} 个分类 · {cardTypes.length} 种类型</strong></div><div className="nd-tree-actions"><button title="新建分类" type="button" onClick={()=>setAddingCategory((value)=>!value)}>分</button><button title="新建元卡片类型" type="button" onClick={()=>{setCreating(true);setSelectedTypeId(null);}}>＋</button></div></div>{addingCategory&&<div className="nd-category-create"><input autoFocus value={categoryName} placeholder="分类名称" onChange={(event)=>setCategoryName(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void addCategory();}}/><button type="button" onClick={()=>void addCategory()}>保存</button></div>}<label className="nd-type-search"><span className="nd-visually-hidden">搜索元卡片类型</span><input value={query} placeholder="搜索类型或分类" onChange={(event)=>setQuery(event.target.value)}/></label><div className="nd-type-tree">{tree.map((node)=>renderNode(node))}</div>{message&&<p className="nd-message is-error">{message}</p>}</aside><TypeDesigner selected={selected} categories={categories} onSaved={saved}/></div>
  </StructureShell>;
}

import { useEffect, useState } from "react";
import type { CardTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import StructureShell from "./StructureShell";
import TypeDesigner from "./TypeDesigner";

export default function CardTypeCatalogPage() {
  const [cardTypes,setCardTypes]=useState<CardTypeSummary[]>([]);
  const [selectedTypeId,setSelectedTypeId]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const [query,setQuery]=useState("");
  const [message,setMessage]=useState("");
  const load=async()=>{const types=await newDesignApi.listCardTypes();setCardTypes(types);setSelectedTypeId((current)=>current??types[0]?.id??null);};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"类型目录加载失败。"));},[]);
  const selected=creating?null:cardTypes.find((item)=>item.id===selectedTypeId)??null;
  const filtered=cardTypes.filter((item)=>`${item.name} ${item.key} ${item.description}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));
  const saved=(cardType:CardTypeSummary)=>{setCardTypes((current)=>current.some((item)=>item.id===cardType.id)?current.map((item)=>item.id===cardType.id?cardType:item):[cardType,...current]);setSelectedTypeId(cardType.id);setCreating(false);};
  return <StructureShell title="元卡片类型" description="维护系统、模板和书籍可以安装的字段结构与组合能力。">
    <div className="nd-types-workspace"><aside className="nd-type-list-pane"><div className="nd-list-heading"><div><p className="nd-kicker">结构目录</p><strong>{cardTypes.length} 种卡片</strong></div><button type="button" onClick={()=>{setCreating(true);setSelectedTypeId(null);}}>＋</button></div><label className="nd-type-search"><span className="nd-visually-hidden">搜索卡片类型</span><input value={query} placeholder="搜索卡片类型" onChange={(event)=>setQuery(event.target.value)}/></label><div className="nd-type-list">{filtered.map((item,index)=><button key={item.id} type="button" className={!creating&&selectedTypeId===item.id?"is-selected":""} onClick={()=>{setCreating(false);setSelectedTypeId(item.id);}}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{item.name}</strong><small>{item.isSystem?"内置":"自定义"} · {item.currentVersion?`已发布 v${item.currentVersion}`:"草稿"}</small></div><b>›</b></button>)}</div>{message&&<p className="nd-message is-error">{message}</p>}</aside><TypeDesigner selected={selected} onSaved={saved}/></div>
  </StructureShell>;
}

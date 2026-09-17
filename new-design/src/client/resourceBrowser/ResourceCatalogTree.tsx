import {useState} from "react";
import {TreeNavigation} from "../tree";
import type {ResourceNode} from "./catalog";

export default function ResourceCatalogTree({nodes,selectedId,onSelect}:{nodes:ResourceNode[];selectedId:string;onSelect:(id:string)=>void}){
 const [query,setQuery]=useState("");
 return <aside className="nd-resource-browser-catalog"><label className="nd-control"><span>资源目录</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索资源、字典或标签"/></label><TreeNavigation label="多层创作资源目录" nodes={nodes} selectedIds={[selectedId]} query={query} onSelect={onSelect} initialExpandedIds={["strategies"]} emptyText="没有匹配资源，请换一个关键词。"/></aside>;
}

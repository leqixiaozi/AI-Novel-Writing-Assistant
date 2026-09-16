import { useEffect, useState } from "react";
import type { ContextAuthorChoice } from "../../../common/contextAuthor";
import { newDesignApi } from "../../api";

export default function FormAiReferences({bookId,selected,onChange,disabled}:{bookId:string;selected:string[];onChange:(ids:string[])=>void;disabled?:boolean}){
  const [choices,setChoices]=useState<ContextAuthorChoice[]>([]),[error,setError]=useState("");
  useEffect(()=>{let active=true;setChoices([]);setError("");void newDesignApi.getContextAuthorCatalog(bookId).then(catalog=>{if(active)setChoices(catalog.sources.filter(source=>source.kind==="card_version"&&source.current).map(source=>({id:source.stableId,label:source.label})));}).catch(error=>{if(active)setError(error instanceof Error?error.message:"参考目录读取失败。");});return()=>{active=false;};},[bookId]);
  return <label className="nd-control"><span>参考本书资料（可选，最多 20 项）</span><select aria-label="参考本书资料" multiple disabled={disabled} value={selected} onChange={event=>onChange(Array.from(event.target.selectedOptions).map(option=>option.value))}>{selected.filter(id=>!choices.some(choice=>choice.id===id)).map(id=><option value={id} key={id}>已选择资料（需复核）</option>)}{choices.map(choice=><option value={choice.id} key={choice.id}>{choice.label}</option>)}</select><small>{error||"选择已有世界、人物或创作策略作为依据；不选择时可以用一句想法或让 AI 推荐。"}</small></label>;
}

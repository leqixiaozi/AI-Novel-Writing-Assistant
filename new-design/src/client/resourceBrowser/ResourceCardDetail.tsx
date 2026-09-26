import {useEffect,useRef,useState} from "react";
import type {CardSummary,FieldDefinition} from "../../common/contracts";
import {newDesignApi as api} from "../api";
import DynamicForm from "../DynamicForm";
import type {ResourceSelection} from "./catalog";

type CardSelection=Extract<ResourceSelection,{kind:"card"}>;

export default function ResourceCardDetail({selection}:{selection:CardSelection}){
 const [source,setSource]=useState<CardSummary|null>(null),[fields,setFields]=useState<FieldDefinition[]>([]);
 const [loading,setLoading]=useState(false),[message,setMessage]=useState("");
 const sequence=useRef(0);
 const read=async()=>{
  const token=++sequence.current;setLoading(true);setMessage("");
  try{
   const card=await api.getCard(selection.card.id);
   if(card.id!==selection.card.id||card.cardTypeId!==selection.card.cardTypeId)throw new Error("资源身份不匹配，请重新读取目录。");
   const versions=await api.listCardTypeVersions(card.cardTypeId),version=versions.find(item=>item.id===card.typeVersionId);
   if(!version)throw new Error("未找到资源的精确内容规格，请打开原工作台核对。");
   if(token!==sequence.current)return;
   setSource(card);setFields(version.fields);
  }catch(error){if(token===sequence.current)setMessage(error instanceof Error?error.message:"资源读取失败。");}
  finally{if(token===sequence.current)setLoading(false);}
 };
 useEffect(()=>{setSource(null);void read();return()=>{sequence.current++;};},[selection.card.id]);
 return <section className="nd-resource-browser-detail">
  <header className="nd-section-heading"><div><p className="nd-kicker">{source?.cardTypeName??selection.card.cardTypeName}</p><h2>{source?.title??selection.name}</h2></div><a className="nd-button nd-button-primary" href={selection.href}>{selection.editable?"到资源工作台编辑或安装":"打开原资源工作区"}</a></header>
  {message&&<p className="nd-message" role="status">{message}</p>}
  {!source?<button type="button" className="nd-button nd-button-secondary" disabled={loading} onClick={()=>void read()}>{loading?"正在读取…":"重新读取此资源"}</button>:<><p>这里按原版本只读预览；{selection.editable?"修改、收藏、比较和安装请进入资源工作台。":"修改请进入原资源工作区。"}</p><DynamicForm fields={fields} values={source.values} preview/></>}
 </section>;
}

import { useEffect, useState } from "react";
import type { CardTypeTagBinding, MaterialManagementWorkspace, TagDimension } from "../../common/contracts";
import { newDesignApi, type MaterialApiScope } from "../api";
import TreeSelector from "./TreeSelector";

interface Props{scope:MaterialApiScope;spaceId:string;cardTypeId:string;cardId:string;}

export default function CardTagFields({scope,spaceId,cardTypeId,cardId}:Props){
  const [bindings,setBindings]=useState<CardTypeTagBinding[]>([]),[dimensions,setDimensions]=useState<TagDimension[]>([]),[workspace,setWorkspace]=useState<MaterialManagementWorkspace|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>{const [nextBindings,nextDimensions,nextWorkspace]=await Promise.all([newDesignApi.listCardTypeTagBindings(cardTypeId),newDesignApi.listTagDimensions(spaceId),newDesignApi.getMaterialWorkspace(scope)]);setBindings(nextBindings);setDimensions(nextDimensions);setWorkspace(nextWorkspace);};
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"标签维度加载失败。"));},[cardTypeId,cardId,spaceId]);
  const membership=workspace?.memberships.find(item=>item.cardId===cardId),selected=new Set(membership?.tagIds??[]);
  const change=async(binding:CardTypeTagBinding,nextIds:string[])=>{const dimension=dimensions.find(item=>item.id===binding.dimensionId);if(!dimension)return;const previous=dimension.nodes.filter(node=>selected.has(node.id)).map(node=>node.id),add=nextIds.filter(id=>!previous.includes(id)),remove=previous.filter(id=>!nextIds.includes(id));setBusy(true);setMessage("");try{for(const id of add)await newDesignApi.changeTagMemberships(scope,id,{cardIds:[cardId],action:"add",idempotencyKey:crypto.randomUUID()});for(const id of remove)await newDesignApi.changeTagMemberships(scope,id,{cardIds:[cardId],action:"remove",idempotencyKey:crypto.randomUUID()});await load();setMessage("分类标签已保存。");}catch(error){setMessage(error instanceof Error?error.message:"标签保存失败。");}finally{setBusy(false);}};
  if(!bindings.length)return null;
  return <section className="nd-card-tag-fields"><div><p className="nd-kicker">分类与检索</p><h3>多维标签</h3><p className="nd-help-text">标签独立于卡片正式字段，可用于筛选和 AI 上下文。</p></div>{bindings.map(binding=>{const dimension=dimensions.find(item=>item.id===binding.dimensionId);if(!dimension)return <p className="nd-help-text" key={binding.id}>{binding.dimensionName}尚未安装到当前空间。</p>;return <TreeSelector key={binding.id} label={binding.dimensionName} nodes={dimension.nodes.map(node=>({id:node.id,parentId:node.parentId,name:node.name,description:String(node.metadata.description??""),status:node.status,path:node.path.map(part=>part.name)}))} rule={binding.rule} selectedIds={dimension.nodes.filter(node=>selected.has(node.id)).map(node=>node.id)} disabled={busy} onChange={ids=>void change(binding,ids)}/>;})}{message&&<p className="nd-message" aria-live="polite">{message}</p>}</section>;
}

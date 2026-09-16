import { useEffect, useMemo, useState } from "react";
import type { DictionaryItem, DictionarySummary, MaterialTag, StandardFieldSemantic, TagDimension, TreeImpactPreview } from "../common/contracts";
import { treeDescendantIds } from "../common/treePolicy";
import { newDesignApi } from "./api";
import ResourceShell from "./ResourceShell";
import { TreeManager, TreeResourceCatalog } from "./tree";

const RESOURCE_SPACE_ID="00000000-0000-4000-8000-000000000001";
type Mode="dictionary"|"tag"|"field";

function blankDictionary():DictionarySummary{
  const now=new Date().toISOString();
  return{id:"",key:`dictionary_${Date.now().toString(36)}`,name:"",description:"",scope:"system",ownerSpaceId:null,sourceDictionaryId:null,readOnly:false,status:"draft",revision:1,items:[],createdAt:now,updatedAt:now};
}

function blankDimension():TagDimension{
  const now=new Date().toISOString();
  return{id:"",key:"",name:"",description:"",scope:"system",ownerSpaceId:RESOURCE_SPACE_ID,sourceDimensionId:null,status:"active",revision:1,readOnly:false,nodes:[],createdAt:now,updatedAt:now};
}

function newDictionaryItem(parentId:string|null,sortOrder:number):DictionaryItem{
  const id=crypto.randomUUID();
  return{id,key:`node_${id.replaceAll("-","").slice(0,12)}`,label:"新字典项",description:"",parentId,value:{},sortOrder,status:"active",revision:1,currentVersionId:null,path:[],childCount:0,referenceCount:0};
}

function reorderSiblings<T extends {id:string;parentId:string|null;sortOrder:number;status:string}>(items:T[],id:string,direction:-1|1):T[]{
  const selected=items.find(item=>item.id===id);
  if(!selected)return items;
  const siblings=items.filter(item=>item.status==="active"&&item.parentId===selected.parentId).sort((left,right)=>left.sortOrder-right.sortOrder);
  const index=siblings.findIndex(item=>item.id===id),target=index+direction;
  if(index<0||target<0||target>=siblings.length)return items;
  [siblings[index],siblings[target]]=[siblings[target],siblings[index]];
  const order=new Map(siblings.map((item,itemIndex)=>[item.id,(itemIndex+1)*10]));
  return items.map(item=>order.has(item.id)?{...item,sortOrder:order.get(item.id)!}:item);
}

export default function ResourceTreesPage({initialMode}:{initialMode:"dictionary"|"tag"}){
  const [mode,setMode]=useState<Mode>(initialMode);
  const [dictionaries,setDictionaries]=useState<DictionarySummary[]>([]);
  const [dimensions,setDimensions]=useState<TagDimension[]>([]);
  const [semantics,setSemantics]=useState<StandardFieldSemantic[]>([]);
  const [dictionary,setDictionary]=useState<DictionarySummary|null>(null);
  const [dimension,setDimension]=useState<TagDimension|null>(null);
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [impact,setImpact]=useState<TreeImpactPreview|null>(null);

  const load=async()=>{
    const [nextDictionaries,nextDimensions,nextSemantics]=await Promise.all([
      newDesignApi.listDictionaries(),
      newDesignApi.listTagDimensions(RESOURCE_SPACE_ID),
      newDesignApi.listStandardFieldSemantics(),
    ]);
    setDictionaries(nextDictionaries);
    setDimensions(nextDimensions);
    setSemantics(nextSemantics);
    setDictionary(current=>current?nextDictionaries.find(item=>item.id===current.id)??current:nextDictionaries[0]??null);
    setDimension(current=>current?nextDimensions.find(item=>item.id===current.id)??current:nextDimensions[0]??null);
  };

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"树资源加载失败。"));},[]);
  useEffect(()=>{setMode(initialMode);setSelectedNodeId(null);setImpact(null);},[initialMode]);

  const activeDictionaryItem=dictionary?.items.find(item=>item.id===selectedNodeId)??null;
  const activeTag=dimension?.nodes.find(item=>item.id===selectedNodeId)??null;
  const nodes=useMemo(()=>mode==="dictionary"
    ?(dictionary?.items??[]).filter(item=>item.status==="active").map(item=>({id:item.id,parentId:item.parentId,name:item.label,description:item.description,sortOrder:item.sortOrder,path:item.path.map(part=>part.label)}))
    :(dimension?.nodes??[]).filter(item=>item.status==="active").map(item=>({id:item.id,parentId:item.parentId,name:item.name,description:String(item.metadata.description??""),sortOrder:item.sortOrder,path:item.path.map(part=>part.name)})),[mode,dictionary,dimension]);
  const catalogItems=useMemo(()=>mode==="dictionary"
    ?dictionaries.map(item=>({id:item.id,name:item.name,description:item.description,scope:item.scope,nodeCount:item.items.filter(node=>node.status==="active").length}))
    :dimensions.map(item=>({id:item.id,name:item.name,description:item.description,scope:item.scope,nodeCount:item.nodes.filter(node=>node.status==="active").length})),[mode,dictionaries,dimensions]);
  const forbiddenParentIds=useMemo(()=>selectedNodeId?new Set([selectedNodeId,...treeDescendantIds(nodes,selectedNodeId)]):new Set<string>(),[nodes,selectedNodeId]);

  const run=async(action:()=>Promise<void>,success:string)=>{
    setBusy(true);setMessage("");
    try{await action();await load();setMessage(success);setImpact(null);}
    catch(error){setMessage(error instanceof Error?error.message:"保存失败。");}
    finally{setBusy(false);}
  };

  const createCatalogItem=()=>{
    setSelectedNodeId(null);setImpact(null);
    if(mode==="dictionary")setDictionary(blankDictionary());
    else setDimension(blankDimension());
  };

  const selectCatalogItem=(id:string)=>{
    setSelectedNodeId(null);setImpact(null);
    if(mode==="dictionary"){
      const selected=dictionaries.find(item=>item.id===id);
      if(selected)setDictionary(structuredClone(selected));
    }else{
      const selected=dimensions.find(item=>item.id===id);
      if(selected)setDimension(structuredClone(selected));
    }
  };

  const addNode=(parentId:string|null)=>{
    setImpact(null);
    if(mode==="dictionary"&&dictionary){
      const item=newDictionaryItem(parentId,dictionary.items.length*10+10);
      setDictionary({...dictionary,items:[...dictionary.items,item]});setSelectedNodeId(item.id);
    }else if(mode==="tag"&&dimension){
      const id=crypto.randomUUID();
      const tag:MaterialTag={id,spaceId:RESOURCE_SPACE_ID,key:`tag_${id.replaceAll("-","").slice(0,12)}`,name:"新标签",aliases:[],color:null,metadata:{description:""},dimensionId:dimension.id,parentId,sortOrder:dimension.nodes.length*10+10,path:[],childCount:0,status:"active",revision:1,currentVersionId:"",visibility:"space",memberCount:0,updatedAt:new Date().toISOString()};
      setDimension({...dimension,nodes:[...dimension.nodes,tag]});setSelectedNodeId(id);
    }
  };

  const moveNode=async(id:string,direction:-1|1)=>{
    setImpact(null);
    if(mode==="dictionary"&&dictionary){
      setDictionary({...dictionary,items:reorderSiblings(dictionary.items,id,direction)});
      setSelectedNodeId(id);setMessage("顺序已调整，保存字典树后生效。");return;
    }
    if(mode==="tag"&&dimension){
      const selected=dimension.nodes.find(item=>item.id===id);
      if(!selected?.currentVersionId){setMessage("请先保存这个新标签，再调整顺序。");return;}
      const nextNodes=reorderSiblings(dimension.nodes,id,direction);
      const changed=nextNodes.filter(item=>dimension.nodes.find(previous=>previous.id===item.id)?.sortOrder!==item.sortOrder);
      if(!changed.length)return;
      setDimension({...dimension,nodes:nextNodes});setSelectedNodeId(id);setBusy(true);setMessage("");
      try{
        for(const item of changed){
          await newDesignApi.reviseMaterialTag({spaceId:RESOURCE_SPACE_ID},item.id,{name:item.name,aliases:item.aliases,color:item.color,metadata:item.metadata,dimensionId:dimension.id,parentId:item.parentId,sortOrder:item.sortOrder,visibility:item.visibility,expectedRevision:item.revision,idempotencyKey:crypto.randomUUID()});
        }
        await load();setMessage("标签顺序已保存。");
      }catch(error){setMessage(error instanceof Error?error.message:"顺序保存失败。");await load();}
      finally{setBusy(false);}
    }
  };

  const saveDictionary=()=>dictionary&&run(async()=>{const saved=dictionary.id?await newDesignApi.updateDictionary(dictionary):await newDesignApi.createDictionary(dictionary);setDictionary(saved);},"字典树已保存，历史路径快照已更新。");
  const saveDimension=()=>dimension&&run(async()=>{const saved=dimension.id?await newDesignApi.updateTagDimension(dimension):await newDesignApi.createTagDimension(dimension);setDimension(saved);},"标签维度已保存。");
  const saveTag=()=>dimension&&activeTag&&run(async()=>{
    const persisted=dimensions.flatMap(item=>item.nodes).some(item=>item.id===activeTag.id),description=String(activeTag.metadata.description??"");
    if(persisted)await newDesignApi.reviseMaterialTag({spaceId:RESOURCE_SPACE_ID},activeTag.id,{name:activeTag.name,aliases:activeTag.aliases,color:activeTag.color,metadata:{...activeTag.metadata,description},dimensionId:dimension.id,parentId:activeTag.parentId,sortOrder:activeTag.sortOrder,visibility:activeTag.visibility,expectedRevision:activeTag.revision,idempotencyKey:crypto.randomUUID()});
    else await newDesignApi.createMaterialTag({spaceId:RESOURCE_SPACE_ID},{key:activeTag.key,name:activeTag.name,aliases:[],metadata:{description},dimensionId:dimension.id,parentId:activeTag.parentId,sortOrder:activeTag.sortOrder,idempotencyKey:crypto.randomUUID()});
  },"标签节点已保存，所属路径已记录。");
  const preview=(kind:"dictionary"|"tag",id:string,action:"move"|"archive")=>{setBusy(true);void newDesignApi.previewTreeNodeChange(id,kind,action).then(setImpact).catch(error=>setMessage(error instanceof Error?error.message:"影响检查失败。")).finally(()=>setBusy(false));};
  const archive=()=>{
    if(mode==="dictionary"&&dictionary&&activeDictionaryItem&&impact?.nodeId===activeDictionaryItem.id){setDictionary({...dictionary,items:dictionary.items.map(item=>item.id===activeDictionaryItem.id?{...item,status:"archived"}:item)});setSelectedNodeId(null);setImpact(null);}
    else if(mode==="tag"&&activeTag&&impact?.nodeId===activeTag.id){void run(()=>newDesignApi.reviseMaterialTag({spaceId:RESOURCE_SPACE_ID},activeTag.id,{name:activeTag.name,aliases:activeTag.aliases,color:activeTag.color,metadata:activeTag.metadata,parentId:activeTag.parentId,sortOrder:activeTag.sortOrder,visibility:activeTag.visibility,expectedRevision:activeTag.revision,idempotencyKey:crypto.randomUUID()},true).then(()=>undefined),"标签已停用，历史选择仍保留原名称和路径。");}
  };
  const saveSemantic=(item:StandardFieldSemantic)=>run(async()=>{if(item.id.startsWith("new:")){const {id:_id,status:_status,revision:_revision,...input}=item;await newDesignApi.createStandardFieldSemantic(input);}else await newDesignApi.updateStandardFieldSemantic(item);},"字段模板已保存。");

  return <ResourceShell active={initialMode==="dictionary"?"dictionaries":"tags"}>
    <main className="nd-tree-resource-page">
      <nav className="nd-segmented" aria-label="树资源类型">
        <button className={mode==="dictionary"?"is-active":""} onClick={()=>setMode("dictionary")} type="button">字典树</button>
        <button className={mode==="tag"?"is-active":""} onClick={()=>setMode("tag")} type="button">标签树</button>
        <button className={mode==="field"?"is-active":""} onClick={()=>setMode("field")} type="button">字段模板</button>
      </nav>
      {message&&<p className="nd-message" aria-live="polite">{message}</p>}
      {mode==="field"?<section className="nd-standard-field-list">
        <div className="nd-section-heading"><div><p className="nd-kicker">标准字段语义</p><h2>复用业务含义，不强制相同表单</h2></div><button className="nd-button nd-button-secondary" type="button" onClick={()=>setSemantics(items=>[...items,{id:`new:${crypto.randomUUID()}`,name:"新字段模板",description:"",dataType:"short_text",recommendedDictionaryId:null,applicableTypeKeys:[],allowedSelectionModes:["single"],settlementSuggestion:"none",status:"active",revision:1}])}>＋ 新建模板</button></div>
        {semantics.map((item,index)=><article key={item.id}><div className="nd-form-grid"><label className="nd-control"><span>中文名称</span><input value={item.name} onChange={event=>setSemantics(values=>values.map((value,i)=>i===index?{...value,name:event.target.value}:value))}/></label><label className="nd-control"><span>内容形式</span><select value={item.dataType} onChange={event=>setSemantics(values=>values.map((value,i)=>i===index?{...value,dataType:event.target.value as StandardFieldSemantic["dataType"]}:value))}><option value="short_text">短文本</option><option value="long_text">长文本</option><option value="number">数字</option><option value="boolean">是／否</option><option value="select">单选</option><option value="multi_select">多选</option><option value="date">日期</option></select></label><label className="nd-control"><span>推荐字典</span><select value={item.recommendedDictionaryId??""} onChange={event=>setSemantics(values=>values.map((value,i)=>i===index?{...value,recommendedDictionaryId:event.target.value||null}:value))}><option value="">不绑定</option>{dictionaries.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label></div><label className="nd-control"><span>用途解释</span><input value={item.description} onChange={event=>setSemantics(values=>values.map((value,i)=>i===index?{...value,description:event.target.value}:value))}/></label><button className="nd-button nd-button-secondary" type="button" disabled={busy||!item.name.trim()} onClick={()=>void saveSemantic(item)}>保存字段模板</button></article>)}
      </section>:<div className="nd-tree-resource-workspace">
        <TreeResourceCatalog title={mode==="dictionary"?"字典树":"标签维度"} items={catalogItems} selectedId={mode==="dictionary"?dictionary?.id??null:dimension?.id??null} onSelect={selectCatalogItem} onCreate={createCatalogItem} selectedTree={<TreeManager key={`${mode}:${mode==="dictionary"?dictionary?.id:dimension?.id}`} nodes={nodes} selectedId={selectedNodeId} onSelect={id=>{setSelectedNodeId(id);setImpact(null);}} onAdd={addNode} onMove={(id,direction)=>void moveNode(id,direction)}/>}/>
        <section className="nd-tree-resource-editor">{(mode==="dictionary"?dictionary:dimension)?<>
          <div className="nd-form-grid"><label className="nd-control"><span>{mode==="dictionary"?"字典名称":"维度名称"}</span><input value={(mode==="dictionary"?dictionary:dimension)?.name??""} onChange={event=>mode==="dictionary"&&dictionary?setDictionary({...dictionary,name:event.target.value}):dimension&&setDimension({...dimension,name:event.target.value})}/></label><label className="nd-control"><span>用途解释</span><input value={(mode==="dictionary"?dictionary:dimension)?.description??""} onChange={event=>mode==="dictionary"&&dictionary?setDictionary({...dictionary,description:event.target.value}):dimension&&setDimension({...dimension,description:event.target.value})}/></label></div>
          <div className="nd-tree-resource-detail">
            <div className="nd-tree-node-editor">
              {mode==="dictionary"&&activeDictionaryItem?<>
                <label className="nd-control"><span>中文名称</span><input value={activeDictionaryItem.label} onChange={event=>setDictionary(dictionary&&{...dictionary,items:dictionary.items.map(item=>item.id===activeDictionaryItem.id?{...item,label:event.target.value}:item)})}/></label>
                <label className="nd-control"><span>解释</span><textarea value={activeDictionaryItem.description} onChange={event=>setDictionary(dictionary&&{...dictionary,items:dictionary.items.map(item=>item.id===activeDictionaryItem.id?{...item,description:event.target.value}:item)})}/></label>
                <label className="nd-control"><span>上级节点</span><select value={activeDictionaryItem.parentId??""} onChange={event=>setDictionary(dictionary&&{...dictionary,items:dictionary.items.map(item=>item.id===activeDictionaryItem.id?{...item,parentId:event.target.value||null}:item)})}><option value="">顶层</option>{(dictionary?.items??[]).filter(item=>!forbiddenParentIds.has(item.id)&&item.status==="active").map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <button className="nd-text-button is-danger" type="button" onClick={()=>preview("dictionary",activeDictionaryItem.id,"archive")}>检查停用影响</button>
              </>:mode==="tag"&&activeTag?<>
                <label className="nd-control"><span>中文名称</span><input value={activeTag.name} onChange={event=>setDimension(dimension&&{...dimension,nodes:dimension.nodes.map(item=>item.id===activeTag.id?{...item,name:event.target.value}:item)})}/></label>
                <label className="nd-control"><span>解释</span><textarea value={String(activeTag.metadata.description??"")} onChange={event=>setDimension(dimension&&{...dimension,nodes:dimension.nodes.map(item=>item.id===activeTag.id?{...item,metadata:{...item.metadata,description:event.target.value}}:item)})}/></label>
                <label className="nd-control"><span>上级节点</span><select value={activeTag.parentId??""} onChange={event=>setDimension(dimension&&{...dimension,nodes:dimension.nodes.map(item=>item.id===activeTag.id?{...item,parentId:event.target.value||null}:item)})}><option value="">顶层</option>{(dimension?.nodes??[]).filter(item=>!forbiddenParentIds.has(item.id)&&item.status==="active").map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <div className="nd-row-actions"><button className="nd-button nd-button-secondary" type="button" disabled={busy||!activeTag.name.trim()||!dimension?.id} onClick={()=>void saveTag()}>保存节点</button><button className="nd-text-button is-danger" type="button" onClick={()=>preview("tag",activeTag.id,"archive")}>检查停用影响</button></div>
              </>:<div className="nd-empty nd-empty-compact">选择一个节点，或在树中新增。</div>}
              {impact&&<div className="nd-tree-impact"><strong>影响预览</strong>{impact.messages.map(item=><p key={item}>{item}</p>)}<button className="nd-button nd-button-secondary" type="button" onClick={archive}>确认停用</button></div>}
            </div>
          </div>
          <footer className="nd-editor-actions"><button className="nd-button nd-button-primary" disabled={busy||!(mode==="dictionary"?dictionary?.name:dimension?.name)?.trim()} type="button" onClick={()=>void(mode==="dictionary"?saveDictionary():saveDimension())}>{busy?"保存中…":mode==="dictionary"?"保存字典树":"保存标签维度"}</button></footer>
        </>:<div className="nd-empty nd-empty-page">选择或新建一棵树。</div>}</section>
      </div>}
    </main>
  </ResourceShell>;
}

import { useEffect, useMemo, useState } from "react";
import type { DictionarySummary, RelationTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import StructureShell from "./StructureShell";

type CatalogView = "dictionaries" | "relations";

function blankDictionary(): DictionarySummary {
  const now = new Date().toISOString();
  return { id:"",key:"",name:"",description:"",scope:"system",ownerSpaceId:null,status:"draft",revision:1,items:[],createdAt:now,updatedAt:now };
}

function blankRelation(): RelationTypeSummary {
  const now = new Date().toISOString();
  return { id:"",key:"",name:"",description:"",direction:"directed",sourceTypeKeys:["event"],targetTypeKeys:["character"],sourceMax:null,targetMax:null,
    scope:"system",ownerSpaceId:null,propertiesSchema:[],status:"draft",revision:1,createdAt:now,updatedAt:now };
}

export default function DictionaryRelationsPage() {
  const [view,setView] = useState<CatalogView>("dictionaries");
  const [dictionaries,setDictionaries] = useState<DictionarySummary[]>([]);
  const [relations,setRelations] = useState<RelationTypeSummary[]>([]);
  const [dictionary,setDictionary] = useState<DictionarySummary | null>(null);
  const [relation,setRelation] = useState<RelationTypeSummary | null>(null);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);

  const load = async () => {
    const [nextDictionaries,nextRelations] = await Promise.all([newDesignApi.listDictionaries(),newDesignApi.listRelationTypes()]);
    setDictionaries(nextDictionaries); setRelations(nextRelations);
    setDictionary((current) => current ? nextDictionaries.find((item) => item.id === current.id) ?? current : nextDictionaries[0] ?? null);
    setRelation((current) => current ? nextRelations.find((item) => item.id === current.id) ?? current : nextRelations[0] ?? null);
  };
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "结构目录加载失败。")); }, []);

  const saveDictionary = async () => {
    if (!dictionary) return;
    setBusy(true); setMessage("");
    try {
      const saved = dictionary.id ? await newDesignApi.updateDictionary(dictionary) : await newDesignApi.createDictionary(dictionary);
      await load(); setDictionary(saved); setMessage("字典和稳定字典项已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "字典保存失败。"); }
    finally { setBusy(false); }
  };
  const saveRelation = async () => {
    if (!relation) return;
    setBusy(true); setMessage("");
    try {
      const saved = relation.id ? await newDesignApi.updateRelationType(relation) : await newDesignApi.createRelationType(relation);
      await load(); setRelation(saved); setMessage("关系方向、类型边界和数量规则已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "关系类型保存失败。"); }
    finally { setBusy(false); }
  };

  const activeItems = useMemo(() => dictionary?.items.filter((item) => item.status === "active") ?? [],[dictionary]);

  return (
    <StructureShell title="选项与关联" description="用稳定键管理跨模板选项，并约束不同资料之间允许建立的关联。">
      <div className="nd-segmented nd-catalog-switch">
        <button className={view === "dictionaries" ? "is-active" : ""} type="button" onClick={() => setView("dictionaries")}>稳定字典</button>
        <button className={view === "relations" ? "is-active" : ""} type="button" onClick={() => setView("relations")}>资料关联</button>
      </div>
      {view === "dictionaries" ? (
        <div className="nd-structure-workspace">
          <aside className="nd-catalog-list">
            <div className="nd-list-heading"><div><p className="nd-kicker">字典</p><strong>{dictionaries.length} 项</strong></div><button type="button" onClick={() => setDictionary(blankDictionary())}>＋</button></div>
            {dictionaries.map((item) => <button key={item.id} className={dictionary?.id === item.id ? "is-selected" : ""} type="button" onClick={() => setDictionary(structuredClone(item))}><strong>{item.name}</strong><small>{item.scope} · {item.items.filter((entry) => entry.status === "active").length} 个选项</small></button>)}
          </aside>
          <section className="nd-structure-editor">
            {dictionary ? <>
              <div className="nd-form-grid"><label className="nd-control"><span>字典名称</span><input value={dictionary.name} onChange={(event) => setDictionary({...dictionary,name:event.target.value})}/></label><label className="nd-control"><span>稳定键</span><input disabled={Boolean(dictionary.id)} value={dictionary.key} onChange={(event) => setDictionary({...dictionary,key:event.target.value})}/></label></div>
              <label className="nd-control"><span>用途说明</span><textarea value={dictionary.description} onChange={(event) => setDictionary({...dictionary,description:event.target.value})}/></label>
              <div className="nd-section-heading"><div><p className="nd-kicker">稳定字典项</p><h2>{activeItems.length} 个可用选项</h2></div><button className="nd-button nd-button-secondary" type="button" onClick={() => setDictionary({...dictionary,items:[...dictionary.items,{id:crypto.randomUUID(),key:"new_item",label:"新选项",value:{value:"new_item"},sortOrder:dictionary.items.length*10+10,status:"active"}]})}>＋ 添加选项</button></div>
              <div className="nd-dictionary-items">{dictionary.items.map((item,index) => item.status === "active" ? <div key={item.id || index} className="nd-form-grid nd-dictionary-row"><label className="nd-control"><span>稳定键</span><input value={item.key} onChange={(event) => { const items=[...dictionary.items]; items[index]={...item,key:event.target.value,value:{...item.value,value:event.target.value}}; setDictionary({...dictionary,items}); }}/></label><label className="nd-control"><span>显示名称</span><input value={item.label} onChange={(event) => { const items=[...dictionary.items]; items[index]={...item,label:event.target.value}; setDictionary({...dictionary,items}); }}/></label><button className="nd-text-button" type="button" onClick={() => { const items=[...dictionary.items]; items[index]={...item,status:"archived"}; setDictionary({...dictionary,items}); }}>停用</button></div> : null)}</div>
              {message && <p className="nd-message">{message}</p>}<div className="nd-editor-actions"><button className="nd-button nd-button-primary" disabled={busy || !dictionary.name || !dictionary.key} type="button" onClick={() => void saveDictionary()}>{busy ? "保存中…" : "保存字典"}</button></div>
            </> : <div className="nd-empty nd-empty-page">选择一个字典。</div>}
          </section>
        </div>
      ) : (
        <div className="nd-structure-workspace">
          <aside className="nd-catalog-list"><div className="nd-list-heading"><div><p className="nd-kicker">关系</p><strong>{relations.length} 类</strong></div><button type="button" onClick={() => setRelation(blankRelation())}>＋</button></div>{relations.map((item) => <button key={item.id} className={relation?.id===item.id?"is-selected":""} type="button" onClick={() => setRelation(structuredClone(item))}><strong>{item.name}</strong><small>{item.sourceTypeKeys.join("、")} → {item.targetTypeKeys.join("、")}</small></button>)}</aside>
          <section className="nd-structure-editor">{relation ? <>
            <div className="nd-form-grid"><label className="nd-control"><span>关系名称</span><input value={relation.name} onChange={(event)=>setRelation({...relation,name:event.target.value})}/></label><label className="nd-control"><span>稳定键</span><input disabled={Boolean(relation.id)} value={relation.key} onChange={(event)=>setRelation({...relation,key:event.target.value})}/></label></div>
            <label className="nd-control"><span>用途说明</span><textarea value={relation.description} onChange={(event)=>setRelation({...relation,description:event.target.value})}/></label>
            <div className="nd-form-grid"><label className="nd-control"><span>方向</span><select value={relation.direction} onChange={(event)=>setRelation({...relation,direction:event.target.value as RelationTypeSummary["direction"]})}><option value="directed">有方向</option><option value="undirected">无方向</option></select></label><label className="nd-control"><span>来源类型键</span><input value={relation.sourceTypeKeys.join(", ")} onChange={(event)=>setRelation({...relation,sourceTypeKeys:event.target.value.split(",").map((value)=>value.trim()).filter(Boolean)})}/></label><label className="nd-control"><span>目标类型键</span><input value={relation.targetTypeKeys.join(", ")} onChange={(event)=>setRelation({...relation,targetTypeKeys:event.target.value.split(",").map((value)=>value.trim()).filter(Boolean)})}/></label></div>
            <div className="nd-form-grid"><label className="nd-control"><span>每个来源最多关系数</span><input type="number" min="1" placeholder="不限" value={relation.sourceMax ?? ""} onChange={(event)=>setRelation({...relation,sourceMax:event.target.value?Number(event.target.value):null})}/></label><label className="nd-control"><span>每个目标最多关系数</span><input type="number" min="1" placeholder="不限" value={relation.targetMax ?? ""} onChange={(event)=>setRelation({...relation,targetMax:event.target.value?Number(event.target.value):null})}/></label></div>
            <div className="nd-definition-summary"><strong>关系属性</strong>{relation.propertiesSchema.length ? relation.propertiesSchema.map((field)=><span key={field.key}>{field.name} · {field.type}{field.required?" · 必填":""}</span>) : <span>无局部属性</span>}</div>
            {message && <p className="nd-message">{message}</p>}<div className="nd-editor-actions"><button className="nd-button nd-button-primary" disabled={busy || !relation.name || !relation.key || !relation.sourceTypeKeys.length || !relation.targetTypeKeys.length} type="button" onClick={() => void saveRelation()}>{busy?"保存中…":"保存关系类型"}</button></div>
          </> : <div className="nd-empty nd-empty-page">选择一个关系类型。</div>}</section>
        </div>
      )}
    </StructureShell>
  );
}

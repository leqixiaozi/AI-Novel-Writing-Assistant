import { useEffect, useMemo, useRef, useState } from "react";
import type { DictionarySummary } from "../common/contracts";
import { newDesignApi } from "./api";
import StructureShell from "./StructureShell";
import RelationConfigurationPage from "./relationConfiguration";

type CatalogView = "dictionaries" | "relations";

function blankDictionary(): DictionarySummary {
  const now = new Date().toISOString();
  return { id:"",key:"",name:"",description:"",scope:"system",ownerSpaceId:null,sourceDictionaryId:null,readOnly:false,status:"draft",revision:1,items:[],createdAt:now,updatedAt:now };
}

export default function DictionaryRelationsPage() {
  const [view,setView] = useState<CatalogView>(new URLSearchParams(location.search).get("view")==="relations"?"relations":"dictionaries");
  const [dictionaries,setDictionaries] = useState<DictionarySummary[]>([]);
  const [dictionary,setDictionary] = useState<DictionarySummary | null>(null);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const newDictionaryBaseline = useRef("");
  const dirty = !!dictionary && JSON.stringify(dictionary) !== (dictionary.id ? JSON.stringify(dictionaries.find(item => item.id === dictionary.id)) : newDictionaryBaseline.current);
  const chooseDictionary = (next: DictionarySummary) => {
    if (busy || (dirty && !window.confirm("当前字典有未保存修改。放弃这些修改并切换吗？"))) return;
    if (!next.id) newDictionaryBaseline.current = JSON.stringify(next);
    setDictionary(structuredClone(next));
    setMessage("");
  };

  const load = async () => {
    const nextDictionaries = await newDesignApi.listDictionaries();
    setDictionaries(nextDictionaries);
    setDictionary((current) => current ? nextDictionaries.find((item) => item.id === current.id) ?? current : nextDictionaries[0] ?? null);
  };
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "结构目录加载失败。")); }, []);
  useEffect(() => { if (!dirty) return; const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload",protect); return () => window.removeEventListener("beforeunload",protect); }, [dirty]);

  const saveDictionary = async () => {
    if (!dictionary) return;
    setBusy(true); setMessage("");
    try {
      const saved = dictionary.id ? await newDesignApi.updateDictionary(dictionary) : await newDesignApi.createDictionary(dictionary);
      await load(); setDictionary(saved); setMessage("字典和稳定字典项已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "字典保存失败。"); }
    finally { setBusy(false); }
  };

  const activeItems = useMemo(() => dictionary?.items.filter((item) => item.status === "active") ?? [],[dictionary]);

  return (
    <StructureShell title="选项与关联" description="用稳定键管理跨模板选项，并约束不同资料之间允许建立的关联。">
      <div className="nd-segmented nd-catalog-switch">
        <button disabled={busy} className={view === "dictionaries" ? "is-active" : ""} type="button" onClick={() => setView("dictionaries")}>稳定字典</button>
        <button disabled={busy} className={view === "relations" ? "is-active" : ""} type="button" onClick={() => setView("relations")}>资料关联</button>
      </div>
      {view === "dictionaries" ? (
        <div className="nd-structure-workspace">
          <aside className="nd-catalog-list">
            <div className="nd-list-heading"><div><p className="nd-kicker">字典</p><strong>{dictionaries.length} 项</strong></div><button type="button" onClick={() => chooseDictionary(blankDictionary())}>＋</button></div>
            {dictionaries.map((item) => <button key={item.id} className={dictionary?.id === item.id ? "is-selected" : ""} type="button" onClick={() => chooseDictionary(item)}><strong>{item.name}</strong><small>{item.scope} · {item.items.filter((entry) => entry.status === "active").length} 个选项</small></button>)}
          </aside>
          <section className="nd-structure-editor"><fieldset disabled={busy} style={{display:"contents"}}>
            {dictionary ? <>
              <div className="nd-form-grid"><label className="nd-control"><span>字典名称</span><input value={dictionary.name} onChange={(event) => setDictionary({...dictionary,name:event.target.value})}/></label><label className="nd-control"><span>稳定键</span><input disabled={Boolean(dictionary.id)} value={dictionary.key} onChange={(event) => setDictionary({...dictionary,key:event.target.value})}/></label></div>
              <label className="nd-control"><span>用途说明</span><textarea value={dictionary.description} onChange={(event) => setDictionary({...dictionary,description:event.target.value})}/></label>
              <div className="nd-section-heading"><div><p className="nd-kicker">稳定字典项</p><h2>{activeItems.length} 个可用选项</h2></div><button className="nd-button nd-button-secondary" type="button" onClick={() => { const id=crypto.randomUUID(); setDictionary({...dictionary,items:[...dictionary.items,{id,key:`node_${id.replaceAll("-","").slice(0,12)}`,label:"新选项",description:"",parentId:null,value:{},sortOrder:dictionary.items.length*10+10,status:"active",revision:1,currentVersionId:null,path:[],childCount:0,referenceCount:0}]}); }}>＋ 添加选项</button></div>
              <div className="nd-dictionary-items">{dictionary.items.map((item,index) => item.status === "active" ? <div key={item.id || index} className="nd-form-grid nd-dictionary-row"><label className="nd-control"><span>稳定键</span><input value={item.key} onChange={(event) => { const items=[...dictionary.items]; items[index]={...item,key:event.target.value,value:{...item.value,value:event.target.value}}; setDictionary({...dictionary,items}); }}/></label><label className="nd-control"><span>显示名称</span><input value={item.label} onChange={(event) => { const items=[...dictionary.items]; items[index]={...item,label:event.target.value}; setDictionary({...dictionary,items}); }}/></label><button className="nd-text-button" type="button" onClick={() => { const items=[...dictionary.items]; items[index]={...item,status:"archived"}; setDictionary({...dictionary,items}); }}>停用</button></div> : null)}</div>
              {message && <p className="nd-message">{message}</p>}<div className="nd-editor-actions"><button className="nd-button nd-button-primary" disabled={busy || !dictionary.name || !dictionary.key} type="button" onClick={() => void saveDictionary()}>{busy ? "保存中…" : "保存字典"}</button></div>
            </> : <div className="nd-empty nd-empty-page">选择一个字典。</div>}
          </fieldset></section>
        </div>
      ) : (
        <RelationConfigurationPage/>
      )}
    </StructureShell>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CardGroupFormDefinition,
  CardGroupFormSlot,
  CardGroupFormSummary,
  CardTypeCategory,
  CardTypeSummary,
  RelationTypeSummary,
} from "../common/contracts";
import { newDesignApi } from "./api";
import CardTypeTreePicker from "./CardTypeTreePicker";
import FormDefinitionPreview from "./FormDefinitionPreview";
import StructureShell from "./StructureShell";
import {newStructureKey,structureDraftHash,normalizedStructureDraft} from "./structureDraftRecovery";
import {useStructureWriteRecovery} from "./structureWrites";

function starterDefinition(): CardGroupFormDefinition {
  return { primaryTypeKey:"event",groups:[{key:"main",name:"主要资料",order:10,sections:[{key:"core",name:"核心信息",order:10,slots:[{key:"primary",name:"主要资料",kind:"primary_card",allowedTypeKeys:["event"],min:1,max:1,localFields:[]}]}]}] };
}

function blankForm(): CardGroupFormSummary {
  const now = new Date().toISOString();
  return {id:"",key:newStructureKey("form"),name:"",description:"",status:"draft",revision:1,currentVersion:null,currentVersionId:null,draftDefinition:starterDefinition(),isSystem:false,createdAt:now,updatedAt:now};
}

function nextSlotKey(definition: CardGroupFormDefinition): string {
  const used = new Set(definition.groups.flatMap((group) => group.sections.flatMap((section) => section.slots.map((slot) => slot.key))));
  let index = 1;
  while (used.has(`slot_${index}`)) index += 1;
  return `slot_${index}`;
}

function relationTargetKeys(relation: RelationTypeSummary | undefined, primaryTypeKey: string): string[] | undefined {
  if (!relation) return undefined;
  if (relation.sourceTypeKeys.includes(primaryTypeKey)) return relation.targetTypeKeys;
  if (relation.direction === "undirected" && relation.targetTypeKeys.includes(primaryTypeKey)) return relation.sourceTypeKeys;
  return undefined;
}

function relationSupportsPrimary(relation: RelationTypeSummary, primaryTypeKey: string): boolean {
  return relation.sourceTypeKeys.includes(primaryTypeKey) || (relation.direction === "undirected" && relation.targetTypeKeys.includes(primaryTypeKey));
}

export default function FormDesignerPage() {
  const [forms,setForms] = useState<CardGroupFormSummary[]>([]);
  const [relations,setRelations] = useState<RelationTypeSummary[]>([]);
  const [cardTypes,setCardTypes] = useState<CardTypeSummary[]>([]);
  const [categories,setCategories] = useState<CardTypeCategory[]>([]);
  const [draft,setDraft] = useState<CardGroupFormSummary|null>(null);
  const [message,setMessage] = useState("");
  const draftRef=useRef<CardGroupFormSummary|null>(null), baseline=useRef(""), generation=useRef(0), loadingGeneration=useRef(0);
  draftRef.current=draft;
  const recovery=useStructureWriteRecovery("form",(value,saved)=>{if(!("draftDefinition" in value))return;generation.current+=1;draftRef.current=structuredClone(value);if(saved)baseline.current=structureDraftHash(value);setDraft(draftRef.current);});
  const locked=recovery.locked;
  const dirty=!!draft&&structureDraftHash(draft)!==baseline.current;
  const currentSource=forms.find(form=>form.id===draft?.id);
  const choose=(next:CardGroupFormSummary)=>{
    if(locked||recovery.isLocked())return;
    const current=draftRef.current;
    if(current&&structureDraftHash(current)!==baseline.current&&!window.confirm("当前表单有未保存修改。放弃这些修改并切换吗？"))return;
    generation.current+=1;baseline.current=structureDraftHash(next);draftRef.current=structuredClone(next);setDraft(draftRef.current);setMessage("");
  };
  const publishedTypes = useMemo(() => cardTypes.filter((item) => item.status === "published"), [cardTypes]);

  const load = async () => {
    const request=++loadingGeneration.current,selectedGeneration=generation.current;
    const [nextForms,nextRelations,nextTypes,nextCategories] = await Promise.all([
      newDesignApi.listCardGroupForms(),
      newDesignApi.listRelationTypes(),
      newDesignApi.listCardTypes(),
      newDesignApi.listCardTypeCategories(),
    ]);
    if(request!==loadingGeneration.current)return;
    setForms(nextForms);
    setRelations(nextRelations);
    setCardTypes(nextTypes);
    setCategories(nextCategories);
    if(!draftRef.current&&selectedGeneration===generation.current&&nextForms[0])choose(nextForms[0]);
  };
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "表单目录加载失败。")); }, []);

  const updateDefinition = (change:(definition:CardGroupFormDefinition)=>void) => {
    if (!draft||locked||recovery.isLocked()) return;
    const definition = structuredClone(draft.draftDefinition);
    change(definition);
    setDraft({...draft,draftDefinition:definition});
  };
  const save = async () => {
    if (!draft||locked||recovery.isLocked()) return;
    setMessage("");
    const input=normalizedStructureDraft(draft);
    await recovery.perform("save",input,(requestKey)=>input.id?newDesignApi.updateCardGroupForm({...input,requestKey}):newDesignApi.createCardGroupForm({...input,requestKey}),draft);
    void load().catch(()=>setMessage("目录刷新失败；当前草稿与已核对结果保留，请重新读取目录。"));
  };
  const publish = async () => {
    if (!draft?.id||locked||recovery.isLocked()) return;
    if(dirty){setMessage("请先保存当前表单修改，再发布该草稿的新版本。当前修改保留。");return;}
    setMessage("");
    await recovery.perform("publish",draft,(requestKey)=>newDesignApi.publishCardGroupForm(draft.id,draft.revision,requestKey));
    void load().catch(()=>setMessage("目录刷新失败；当前草稿与已核对结果保留，请重新读取目录。"));
  };
  const addGroup = () => updateDefinition((definition) => definition.groups.push({key:`group_${definition.groups.length+1}`,name:"新分组",order:(definition.groups.length+1)*10,sections:[{key:"section_1",name:"新区块",order:10,slots:[]}]}));
  const addSlot = (groupIndex:number,sectionIndex:number) => updateDefinition((definition) => {
    const section = definition.groups[groupIndex].sections[sectionIndex];
    const relation = relations.find((item) => relationSupportsPrimary(item,definition.primaryTypeKey));
    const slot: CardGroupFormSlot = {key:nextSlotKey(definition),name:"新资料位置",kind:"card_reference",relationTypeKey:relation?.key,allowedTypeKeys:relationTargetKeys(relation,definition.primaryTypeKey) ?? [publishedTypes[0]?.key ?? definition.primaryTypeKey],min:0,max:10,localFields:relation?.propertiesSchema ?? []};
    section.slots.push(slot);
  });

  return <StructureShell title="创作表单" description="用中文目录选择内容类型和关系规则，系统自动维护底层稳定标识。">
    <div className="nd-structure-workspace nd-form-designer-workspace">
      <aside className="nd-catalog-list"><div className="nd-list-heading"><div><p className="nd-kicker">表单目录</p><strong>{forms.length} 个</strong></div><button disabled={locked} type="button" onClick={() => choose(blankForm())}>＋</button></div>{forms.map((form) => <button disabled={locked} key={form.id} className={draft?.id === form.id ? "is-selected" : ""} type="button" onClick={() => choose(form)}><strong>{form.name}</strong><small>{form.currentVersion ? `已发布 v${form.currentVersion}` : "草稿"} · {form.draftDefinition.groups.length} 个分组</small></button>)}</aside>
      <section className="nd-structure-editor">{draft ? <>
        <div className="nd-form-grid">
          <label className="nd-control"><span>表单名称</span><input disabled={locked} value={draft.name} onChange={(event) => {if(!recovery.isLocked())setDraft({...draft,name:event.target.value});}} /></label>
          <CardTypeTreePicker label="主要内容类型" disabled={locked} cardTypes={publishedTypes} categories={categories} selectedKeys={[draft.draftDefinition.primaryTypeKey]} single onChange={([typeKey]) => typeKey && (typeKey===draft.draftDefinition.primaryTypeKey||window.confirm("切换主要内容类型将重新核对各资料位置的关系、允许类型和补充字段。继续调整吗？")) && updateDefinition((definition) => {
            definition.primaryTypeKey=typeKey;
            for (const slot of definition.groups.flatMap((group) => group.sections.flatMap((section) => section.slots))) {
              if (slot.kind === "primary_card") {
                slot.allowedTypeKeys=[typeKey];
                continue;
              }
              const currentRelation=relations.find((item) => item.key === slot.relationTypeKey && relationSupportsPrimary(item,typeKey));
              const nextRelation=currentRelation ?? relations.find((item) => relationSupportsPrimary(item,typeKey));
              const allowedKeys=relationTargetKeys(nextRelation,typeKey);
              slot.relationTypeKey=nextRelation?.key;
              slot.allowedTypeKeys=allowedKeys ? (slot.allowedTypeKeys.filter((key) => allowedKeys.includes(key)).length ? slot.allowedTypeKeys.filter((key) => allowedKeys.includes(key)) : allowedKeys) : slot.allowedTypeKeys;
              slot.localFields=nextRelation?.propertiesSchema ?? [];
            }
          })} />
        </div>
        <label className="nd-control"><span>用途说明</span><textarea disabled={locked} value={draft.description} onChange={(event) => {if(!recovery.isLocked())setDraft({...draft,description:event.target.value});}} /></label>
        <p className="nd-help-text">内部标识、版本与引用兼容由系统自动维护。</p>
        <details><summary>高级技术信息（只读）</summary><p className="nd-help-text">内部标识：{draft.key}；来源修订：{draft.revision}。{dirty?"当前有未保存修改。":"当前与已读取草稿一致。"}</p></details>
        {currentSource&&currentSource.revision!==draft.revision&&<p className="nd-message" role="alert">“{currentSource.name}”的目录来源已更新；当前填写保留。{locked?"先核对原请求结果，目录变化不能证明原保存没有写入。":"点击目录中的同名表单可明确切换并核对新版草稿；不会自动用新版覆盖当前填写。"}</p>}
        <div className="nd-designer-groups">{draft.draftDefinition.groups.map((group,groupIndex) => <section key={`${group.key}-${groupIndex}`} className="nd-designer-group">
          <div className="nd-section-heading"><div><p className="nd-kicker">分组 {groupIndex+1}</p><input disabled={locked} className="nd-inline-title-input" value={group.name} onChange={(event) => updateDefinition((definition) => { definition.groups[groupIndex].name=event.target.value; })} /></div></div>
          {group.sections.map((section,sectionIndex) => <div key={`${section.key}-${sectionIndex}`} className="nd-designer-section">
            <div className="nd-section-heading"><div><strong>{section.name}</strong><small>{section.slots.length} 个资料位置</small></div><button disabled={locked} className="nd-button nd-button-secondary" type="button" onClick={() => addSlot(groupIndex,sectionIndex)}>＋ 添加资料位置</button></div>
            {section.slots.map((slot,slotIndex) => {
              const relation = relations.find((item) => item.key === slot.relationTypeKey);
              const compatibleRelations = relations.filter((item) => relationSupportsPrimary(item,draft.draftDefinition.primaryTypeKey));
              return <div className="nd-slot-editor" key={`${slot.key}-${slotIndex}`}>
                <fieldset disabled={locked} className="nd-form-grid" style={{border:0,padding:0,minWidth:0}}>
                  <label className="nd-control"><span>位置名称</span><input value={slot.name} onChange={(event) => updateDefinition((definition) => { definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].name=event.target.value; })} /></label>
                  <label className="nd-control"><span>资料关系</span><select disabled={slot.kind === "primary_card"} value={slot.relationTypeKey ?? ""} onChange={(event) => updateDefinition((definition) => { const target=definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex]; const nextRelation=relations.find((item) => item.key === event.target.value); target.relationTypeKey=nextRelation?.key; target.allowedTypeKeys=relationTargetKeys(nextRelation,definition.primaryTypeKey) ?? target.allowedTypeKeys; target.localFields=nextRelation?.propertiesSchema ?? []; })}><option value="">主要资料无需关联</option>{compatibleRelations.map((item) => <option key={item.id} value={item.key}>{item.name}</option>)}</select></label>
                  <CardTypeTreePicker label="允许添加的资料" cardTypes={publishedTypes} categories={categories} selectedKeys={slot.allowedTypeKeys} availableKeys={relationTargetKeys(relation,draft.draftDefinition.primaryTypeKey)} disabled={locked||slot.kind === "primary_card"} onChange={(keys) => keys.length && updateDefinition((definition) => { definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].allowedTypeKeys=keys; })} />
                  <label className="nd-control"><span>最少</span><input type="number" min="0" value={slot.min} onChange={(event) => updateDefinition((definition) => { definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].min=Number(event.target.value); })} /></label>
                  <label className="nd-control"><span>最多</span><input type="number" min="1" value={slot.max} onChange={(event) => updateDefinition((definition) => { definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].max=Number(event.target.value); })} /></label>
                </fieldset>
                {slot.localFields.length ? <p className="nd-help-text">本表单补充项：{slot.localFields.map((field) => field.name).join("、")}</p> : null}
              </div>;
            })}
          </div>)}
        </section>)}</div>
        <button disabled={locked} className="nd-text-button" type="button" onClick={addGroup}>＋ 添加分组</button>
        <div className="nd-live-preview"><div><p className="nd-kicker">实际填写效果</p><h2>设计预览</h2></div><FormDefinitionPreview definition={draft.draftDefinition} cardTypes={publishedTypes} /></div>
        {message && <p className="nd-message" aria-live="polite">{message}</p>}{recovery.message&&<p className="nd-message" role="status">{recovery.message}</p>}{recovery.issues.length>0&&<ul role="alert">{recovery.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
        <div className="nd-editor-actions"><button className="nd-button nd-button-secondary" disabled={locked || !draft.id||dirty} type="button" onClick={() => void publish()}>{draft.currentVersion ? "发布新版本" : "发布 v1"}</button><button className="nd-button nd-button-primary" disabled={locked || !draft.name.trim() || !draft.key} type="button" onClick={() => void save()}>{recovery.working ? "核对中…" : "保存草稿"}</button><button className="nd-button nd-button-secondary" disabled={recovery.working} onClick={()=>void load().catch(()=>setMessage("重新读取表单目录失败；当前草稿保留。"))}>重新读取目录</button>{recovery.pending&&<button className="nd-button nd-button-secondary" disabled={recovery.working} onClick={()=>void recovery.verify()}>核对原请求结果</button>}{recovery.locked&&<a href="/new-design/structure/maintenance">打开运行维护</a>}</div>
      </> : <div className="nd-empty nd-empty-page">选择或创建一个创作表单。</div>}</section>
    </div>
  </StructureShell>;
}

import { useEffect, useState } from "react";
import type { CardGroupFormDefinition, CardGroupFormSlot, CardGroupFormSummary, RelationTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import FormDefinitionPreview from "./FormDefinitionPreview";
import StructureShell from "./StructureShell";

function starterDefinition(): CardGroupFormDefinition {
  return { primaryTypeKey:"event",groups:[{key:"main",name:"主要资料",order:10,sections:[{key:"core",name:"核心信息",order:10,slots:[{key:"primary",name:"主要资料",kind:"primary_card",allowedTypeKeys:["event"],min:1,max:1,localFields:[]}]}]}] };
}

function blankForm(): CardGroupFormSummary {
  const now=new Date().toISOString();
  return {id:"",key:"",name:"",description:"",status:"draft",revision:1,currentVersion:null,currentVersionId:null,draftDefinition:starterDefinition(),isSystem:false,createdAt:now,updatedAt:now};
}

export default function FormDesignerPage() {
  const [forms,setForms]=useState<CardGroupFormSummary[]>([]);
  const [relations,setRelations]=useState<RelationTypeSummary[]>([]);
  const [draft,setDraft]=useState<CardGroupFormSummary|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const load=async()=>{const [nextForms,nextRelations]=await Promise.all([newDesignApi.listCardGroupForms(),newDesignApi.listRelationTypes()]);setForms(nextForms);setRelations(nextRelations);setDraft((current)=>current?nextForms.find((item)=>item.id===current.id)??current:nextForms[0]??null);};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"表单目录加载失败。"));},[]);

  const updateDefinition=(change:(definition:CardGroupFormDefinition)=>void)=>{if(!draft)return;const definition=structuredClone(draft.draftDefinition);change(definition);setDraft({...draft,draftDefinition:definition});};
  const save=async()=>{if(!draft)return;setBusy(true);setMessage("");try{const saved=draft.id?await newDesignApi.updateCardGroupForm(draft):await newDesignApi.createCardGroupForm(draft);await load();setDraft(saved);setMessage("表单草稿已保存，设计预览与实际填写将读取同一份定义。");}catch(error){setMessage(error instanceof Error?error.message:"表单保存失败。");}finally{setBusy(false);}};
  const publish=async()=>{if(!draft?.id)return;setBusy(true);setMessage("");try{const saved=await newDesignApi.publishCardGroupForm(draft.id,draft.revision);await load();setDraft(saved);setMessage(`已发布不可变版本 v${saved.currentVersion}。`);}catch(error){setMessage(error instanceof Error?error.message:"表单发布失败。");}finally{setBusy(false);}};
  const addGroup=()=>updateDefinition((definition)=>definition.groups.push({key:`group_${definition.groups.length+1}`,name:"新分组",order:(definition.groups.length+1)*10,sections:[{key:"section_1",name:"新区块",order:10,slots:[]}]}));
  const addSlot=(groupIndex:number,sectionIndex:number)=>updateDefinition((definition)=>{const section=definition.groups[groupIndex].sections[sectionIndex];const slot:CardGroupFormSlot={key:`slot_${section.slots.length+1}`,name:"新引用槽",kind:"card_reference",relationTypeKey:relations[0]?.key,allowedTypeKeys:relations[0]?.targetTypeKeys??["character"],min:0,max:10,localFields:[]};section.slots.push(slot);});

  return <StructureShell title="创作表单" description="把多类资料、资料关联和局部填写内容编排成可发布、可复用的创作表单。">
    <div className="nd-structure-workspace nd-form-designer-workspace">
      <aside className="nd-catalog-list"><div className="nd-list-heading"><div><p className="nd-kicker">表单目录</p><strong>{forms.length} 个</strong></div><button type="button" onClick={()=>setDraft(blankForm())}>＋</button></div>{forms.map((form)=><button key={form.id} className={draft?.id===form.id?"is-selected":""} type="button" onClick={()=>setDraft(structuredClone(form))}><strong>{form.name}</strong><small>{form.currentVersion?`已发布 v${form.currentVersion}`:"草稿"} · {form.draftDefinition.groups.length} 个分组</small></button>)}</aside>
      <section className="nd-structure-editor">{draft?<>
        <div className="nd-form-grid"><label className="nd-control"><span>表单名称</span><input value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label><label className="nd-control"><span>稳定键</span><input disabled={Boolean(draft.id)} value={draft.key} onChange={(event)=>setDraft({...draft,key:event.target.value})}/></label><label className="nd-control"><span>主要内容类型</span><input value={draft.draftDefinition.primaryTypeKey} onChange={(event)=>updateDefinition((definition)=>{definition.primaryTypeKey=event.target.value;const primary=definition.groups.flatMap((group)=>group.sections.flatMap((section)=>section.slots)).find((slot)=>slot.kind==="primary_card");if(primary)primary.allowedTypeKeys=[event.target.value];})}/></label></div>
        <label className="nd-control"><span>用途说明</span><textarea value={draft.description} onChange={(event)=>setDraft({...draft,description:event.target.value})}/></label>
        <div className="nd-designer-groups">{draft.draftDefinition.groups.map((group,groupIndex)=><section key={`${group.key}-${groupIndex}`} className="nd-designer-group"><div className="nd-section-heading"><div><p className="nd-kicker">分组 {groupIndex+1}</p><input className="nd-inline-title-input" value={group.name} onChange={(event)=>updateDefinition((definition)=>{definition.groups[groupIndex].name=event.target.value;})}/></div></div>{group.sections.map((section,sectionIndex)=><div key={`${section.key}-${sectionIndex}`} className="nd-designer-section"><div className="nd-section-heading"><div><strong>{section.name}</strong><small>{section.slots.length} 个资料位置</small></div><button className="nd-button nd-button-secondary" type="button" onClick={()=>addSlot(groupIndex,sectionIndex)}>＋ 添加资料位置</button></div>{section.slots.map((slot,slotIndex)=><div className="nd-slot-editor" key={`${slot.key}-${slotIndex}`}><div className="nd-form-grid"><label className="nd-control"><span>位置名称</span><input value={slot.name} onChange={(event)=>updateDefinition((definition)=>{definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].name=event.target.value;})}/></label><label className="nd-control"><span>稳定键</span><input value={slot.key} onChange={(event)=>updateDefinition((definition)=>{definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].key=event.target.value;})}/></label><label className="nd-control"><span>资料关联</span><select disabled={slot.kind==="primary_card"} value={slot.relationTypeKey??""} onChange={(event)=>updateDefinition((definition)=>{const target=definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex];const relation=relations.find((item)=>item.key===event.target.value);target.relationTypeKey=event.target.value;target.allowedTypeKeys=relation?.targetTypeKeys??target.allowedTypeKeys;target.localFields=relation?.propertiesSchema??target.localFields;})}><option value="">主要资料无需关联</option>{relations.map((relation)=><option key={relation.id} value={relation.key}>{relation.name}</option>)}</select></label><label className="nd-control"><span>允许类型</span><input value={slot.allowedTypeKeys.join(", ")} onChange={(event)=>updateDefinition((definition)=>{definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].allowedTypeKeys=event.target.value.split(",").map((value)=>value.trim()).filter(Boolean);})}/></label><label className="nd-control"><span>最少</span><input type="number" min="0" value={slot.min} onChange={(event)=>updateDefinition((definition)=>{definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].min=Number(event.target.value);})}/></label><label className="nd-control"><span>最多</span><input type="number" min="1" value={slot.max} onChange={(event)=>updateDefinition((definition)=>{definition.groups[groupIndex].sections[sectionIndex].slots[slotIndex].max=Number(event.target.value);})}/></label></div>{slot.localFields.length?<p className="nd-help-text">本表单补充项：{slot.localFields.map((field)=>field.name).join("、")}</p>:null}</div>)}</div>)}</section>)}</div>
        <button className="nd-text-button" type="button" onClick={addGroup}>＋ 添加分组</button>
        <div className="nd-live-preview"><div><p className="nd-kicker">实际渲染定义</p><h2>设计预览</h2></div><FormDefinitionPreview definition={draft.draftDefinition}/></div>
        {message&&<p className="nd-message">{message}</p>}<div className="nd-editor-actions"><button className="nd-button nd-button-secondary" disabled={busy||!draft.id} type="button" onClick={()=>void publish()}>{draft.currentVersion?"发布新版本":"发布 v1"}</button><button className="nd-button nd-button-primary" disabled={busy||!draft.name||!draft.key} type="button" onClick={()=>void save()}>{busy?"保存中…":"保存草稿"}</button></div>
      </>:<div className="nd-empty nd-empty-page">选择或创建一个创作表单。</div>}</section>
    </div>
  </StructureShell>;
}

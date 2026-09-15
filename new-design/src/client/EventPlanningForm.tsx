import { useEffect, useMemo, useState } from "react";
import type { CardGroupFormInstance, CardGroupFormSlot, CardSummary, CardTypeSummary } from "../common/contracts";
import { ApiError, newDesignApi } from "./api";
import DynamicForm from "./DynamicForm";

interface EventPlanningFormProps { spaceId:string; bookName:string; }
interface MountDraft { cardId:string; slotKey:string; sortOrder:number; localValues:Record<string,unknown>; }

export default function EventPlanningForm({spaceId,bookName}:EventPlanningFormProps) {
  const [types,setTypes]=useState<CardTypeSummary[]>([]);
  const [cards,setCards]=useState<CardSummary[]>([]);
  const [formId,setFormId]=useState("");
  const [formVersionId,setFormVersionId]=useState("");
  const [eventId,setEventId]=useState("");
  const [eventDraft,setEventDraft]=useState<CardSummary|null>(null);
  const [instance,setInstance]=useState<CardGroupFormInstance|null>(null);
  const [mounts,setMounts]=useState<MountDraft[]>([]);
  const [issues,setIssues]=useState<Record<string,string>>({});
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [definition,setDefinition]=useState<Awaited<ReturnType<typeof newDesignApi.listCardGroupFormVersions>>[number]["definition"]|null>(null);

  useEffect(()=>{void (async()=>{try{const [nextTypes,forms]=await Promise.all([newDesignApi.listCardTypes(spaceId),newDesignApi.listCardGroupForms(spaceId)]);const published=nextTypes.filter((type)=>type.currentVersionId);const cardsByType=await Promise.all(published.map((type)=>newDesignApi.listCards(type.id,false,spaceId)));const allCards=cardsByType.flat();const eventForm=forms.find((form)=>form.key==="event_planning")??forms[0];if(!eventForm?.currentVersionId)throw new Error("事件规划表单尚未发布。");const versions=await newDesignApi.listCardGroupFormVersions(eventForm.id);const current=versions.find((version)=>version.id===eventForm.currentVersionId)??versions[0];setTypes(nextTypes);setCards(allCards);setFormId(eventForm.id);setFormVersionId(current.id);setDefinition(current.definition);const first=allCards.find((card)=>nextTypes.find((type)=>type.id===card.cardTypeId)?.key===current.definition.primaryTypeKey);if(first)setEventId(first.id);}catch(error){setMessage(error instanceof Error?error.message:"事件规划表单加载失败。");}})();},[spaceId]);

  const slots=useMemo(()=>definition?.groups.flatMap((group)=>group.sections.flatMap((section)=>section.slots)).filter((slot)=>slot.kind==="card_reference")??[],[definition]);
  const eventType=types.find((type)=>type.key===definition?.primaryTypeKey)??null;
  const eventCards=cards.filter((card)=>card.cardTypeId===eventType?.id);
  useEffect(()=>{if(!eventId||!formId)return;const card=cards.find((item)=>item.id===eventId)??null;setEventDraft(card?structuredClone(card):null);void newDesignApi.listFormInstances(spaceId,formId).then((instances)=>{const found=instances.find((item)=>item.primaryCardId===eventId)??null;setInstance(found);setMounts(found?found.mounts.map((mount)=>({cardId:mount.cardId,slotKey:mount.slotKey,sortOrder:mount.sortOrder,localValues:mount.localValues})):[]);}).catch((error)=>setMessage(error instanceof Error?error.message:"事件装配加载失败。"));},[eventId,formId,spaceId,cards]);

  const cardTypeKey=(card:CardSummary)=>types.find((type)=>type.id===card.cardTypeId)?.key??"";
  const selectedMount=(slotKey:string,cardId:string)=>mounts.find((mount)=>mount.slotKey===slotKey&&mount.cardId===cardId);
  const toggleCard=(slot:CardGroupFormSlot,cardId:string)=>{const existing=selectedMount(slot.key,cardId);if(existing){setMounts((current)=>current.filter((mount)=>!(mount.slotKey===slot.key&&mount.cardId===cardId)));return;}setMounts((current)=>[...(slot.max===1?current.filter((mount)=>mount.slotKey!==slot.key):current),{slotKey:slot.key,cardId,sortOrder:current.filter((mount)=>mount.slotKey===slot.key).length,localValues:{}}]);};
  const updateLocal=(slotKey:string,cardId:string,key:string,value:unknown)=>setMounts((current)=>current.map((mount)=>mount.slotKey===slotKey&&mount.cardId===cardId?{...mount,localValues:{...mount.localValues,[key]:value}}:mount));
  const save=async()=>{if(!eventDraft||!definition)return;setBusy(true);setIssues({});setMessage("");try{const savedEvent=await newDesignApi.updateCard(eventDraft);const payload={spaceId,formVersionId,primaryCardId:savedEvent.id,title:`${savedEvent.title} · 事件规划`,revision:instance?.revision,mounts};const saved=instance?await newDesignApi.updateFormInstance(instance.id,payload):await newDesignApi.createFormInstance(payload);setEventDraft(savedEvent);setInstance(saved);setMounts(saved.mounts.map((mount)=>({cardId:mount.cardId,slotKey:mount.slotKey,sortOrder:mount.sortOrder,localValues:mount.localValues})));setMessage("事件主卡、关系和挂载局部字段已保存到 PostgreSQL。");}catch(error){if(error instanceof ApiError)setIssues(error.issues);setMessage(error instanceof Error?error.message:"事件规划保存失败。");}finally{setBusy(false);}};

  if(!definition||!eventType)return <div className="nd-empty nd-empty-page">{message||"正在加载事件规划表单…"}</div>;
  return <div className="nd-event-form">
    <div className="nd-event-form-header"><div><p className="nd-kicker">成熟创作表单</p><h2>事件规划</h2><p>{bookName} · 主卡与引用卡保持独立，局部目标只属于本事件。</p></div><label className="nd-control"><span>选择事件主卡</span><select value={eventId} onChange={(event)=>setEventId(event.target.value)}>{eventCards.map((card)=><option key={card.id} value={card.id}>{card.title}</option>)}</select></label></div>
    {eventDraft?<>
      <section className="nd-event-primary"><div className="nd-section-heading"><div><p className="nd-kicker">事件主卡</p><h3>{eventDraft.title}</h3></div></div><label className={`nd-control${issues.title?" has-error":""}`}><span>事件标题</span><input value={eventDraft.title} onChange={(event)=>setEventDraft({...eventDraft,title:event.target.value})}/></label><DynamicForm fields={eventType.draftFields} values={eventDraft.values} issues={issues} onChange={(values)=>setEventDraft({...eventDraft,values})}/></section>
      {definition.groups.filter((group)=>group.sections.some((section)=>section.slots.some((slot)=>slot.kind==="card_reference"))).sort((a,b)=>a.order-b.order).map((group)=><section className="nd-event-group" key={group.key}><div className="nd-section-heading"><div><p className="nd-kicker">装配分组</p><h3>{group.name}</h3></div></div>{group.sections.sort((a,b)=>a.order-b.order).map((section)=><div key={section.key} className="nd-event-section"><strong>{section.name}</strong>{section.slots.filter((slot)=>slot.kind==="card_reference").map((slot)=>{const candidates=cards.filter((card)=>slot.allowedTypeKeys.includes(cardTypeKey(card)));return <div className="nd-event-slot" key={slot.key}><div><b>{slot.name}</b><small>必选 {slot.min} · 最多 {slot.max}</small></div><div className="nd-reference-grid">{candidates.map((card)=>{const mount=selectedMount(slot.key,card.id);return <article className={mount?"is-selected":""} key={card.id}><label><input type={slot.max===1?"radio":"checkbox"} name={slot.key} checked={Boolean(mount)} onChange={()=>toggleCard(slot,card.id)}/><span>{card.title}</span></label>{mount&&slot.localFields.length?<div className="nd-local-fields">{slot.localFields.map((field)=><label className="nd-control" key={field.key}><span>{field.name}{field.required?" *":""}</span><textarea value={String(mount.localValues[field.key]??"")} onChange={(event)=>updateLocal(slot.key,card.id,field.key,event.target.value)}/></label>)}</div>:null}</article>})}</div>{issues[slot.key]?<em className="nd-field-error">{issues[slot.key]}</em>:null}</div>})}</div>)}</section>)}
      {message&&<p className={`nd-message${Object.keys(issues).length?" is-error":" is-success"}`}>{message}</p>}<div className="nd-editor-actions"><button className="nd-button nd-button-primary" disabled={busy||!eventDraft.title} type="button" onClick={()=>void save()}>{busy?"保存中…":"保存事件规划"}</button></div>
    </>:<div className="nd-empty nd-empty-page">当前书籍还没有事件卡，请先在本书资料库创建事件。</div>}
  </div>;
}

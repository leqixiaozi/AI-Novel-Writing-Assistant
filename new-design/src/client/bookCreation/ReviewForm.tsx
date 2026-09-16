import { useEffect, useMemo, useState } from "react";
import type { BookCreationReviewCard, BookCreationReviewSource, BookCreationSession, BookCreationReviewType } from "../../common/contracts";
import { ApiError, newDesignApi } from "../api";
import DynamicForm from "../DynamicForm";
import DirectorControls from "./DirectorControls";
import {creationDirectorState,CREATION_DIRECTOR_STAGES} from "../../common/creationDirector";
import "./director.css";

const SOURCE_LABELS: Record<BookCreationReviewSource,string> = {
  template:"模板预填",
  ai:"AI 初稿",
  research:"研究建议",
  resource:"创作策略",
  manual:"手工添加",
};

interface Props {
  session: BookCreationSession;
  busy?: boolean;
  message?: string;
  onSession: (session:BookCreationSession)=>void;
  onCreate: (session:BookCreationSession)=>Promise<void>;
  onRegenerate?: ()=>Promise<void>;
}

function initialValues(type:BookCreationReviewType):Record<string,unknown>{
  return Object.fromEntries(type.fields.filter(field=>field.defaultValue!==undefined).map(field=>[field.key,structuredClone(field.defaultValue)]));
}

export default function BookCreationReviewForm({session,busy,message,onSession,onCreate,onRegenerate}:Props){
  const [bookName,setBookName]=useState(session.bookName);
  const [description,setDescription]=useState(session.description);
  const [cards,setCards]=useState<BookCreationReviewCard[]>(session.reviewCards);
  const [selectedId,setSelectedId]=useState(session.reviewCards[0]?.id??"");
  const [newTypeKey,setNewTypeKey]=useState(session.reviewTypes[0]?.key??"");
  const [issues,setIssues]=useState<Record<string,string>>({});
  const [working,setWorking]=useState(false);
  const [directorWorking,setDirectorWorking]=useState(false);
  const [notice,setNotice]=useState("");

  useEffect(()=>{
    setBookName(session.bookName);
    setDescription(session.description);
    setCards(session.reviewCards);
    setSelectedId(current=>session.reviewCards.some(card=>card.id===current)?current:session.reviewCards[0]?.id??"");
    setNewTypeKey(current=>session.reviewTypes.some(type=>type.key===current)?current:session.reviewTypes[0]?.key??"");
  },[session.id,session.revision]);

  const typeByKey=useMemo(()=>new Map(session.reviewTypes.map(type=>[type.key,type])),[session.reviewTypes]);
  const grouped=useMemo(()=>session.reviewTypes.map(type=>({type,cards:cards.filter(card=>card.typeKey===type.key)})).filter(group=>group.cards.length),[cards,session.reviewTypes]);
  const selected=cards.find(card=>card.id===selectedId)??null;
  const selectedType=selected?typeByKey.get(selected.typeKey)??null:null;
  const blocked=Boolean(busy||working||directorWorking),director=creationDirectorState(session.inputPayload),canConfirm=!director||director.mode==="manual"||CREATION_DIRECTOR_STAGES.every(stage=>director.completedStages.includes(stage.key));

  const patchSelected=(patch:Partial<BookCreationReviewCard>)=>setCards(current=>current.map(card=>card.id===selectedId?{...card,...patch}:card));
  const addCard=()=>{const type=typeByKey.get(newTypeKey);if(!type)return;const id=crypto.randomUUID(),card:BookCreationReviewCard={id,typeKey:type.key,title:`新建${type.name}`,values:initialValues(type),sourceKind:"manual",sourceId:null,sourceVersionId:null,originalTitle:`新建${type.name}`,originalValues:initialValues(type)};setCards(current=>[...current,card]);setSelectedId(id);setIssues({});setNotice("");};
  const removeSelected=()=>{if(!selected)return;const index=cards.findIndex(card=>card.id===selected.id),next=cards.filter(card=>card.id!==selected.id);setCards(next);setSelectedId(next[Math.min(index,next.length-1)]?.id??"");setIssues(current=>Object.fromEntries(Object.entries(current).filter(([key])=>!key.startsWith(selected.id))));setNotice("");};
  const save=async(requireComplete=false)=>{setWorking(true);setIssues({});setNotice("");try{const saved=await newDesignApi.saveBookCreationReview(session.id,{bookName,description,reviewCards:cards,revision:session.revision,requireComplete});onSession(saved);setNotice("开书表单已保存。");return saved;}catch(error){if(error instanceof ApiError){const mapped=Object.fromEntries(Object.entries(error.issues).map(([key,value])=>{const parts=key.split(".");if(parts[0]==="reviewCards"&&cards[Number(parts[1])])return [`${cards[Number(parts[1])].id}.${parts.slice(2).join(".")}`,value];return [key,value];}));setIssues(mapped);const first=cards.find(card=>Object.keys(mapped).some(key=>key.startsWith(card.id)));if(first)setSelectedId(first.id);}setNotice(error instanceof Error?error.message:"开书表单保存失败。");return null;}finally{setWorking(false);}};
  const create=async()=>{const saved=await save(true);if(saved)await onCreate(saved);};
  const continueAi=async()=>{const saved=await save();if(!saved)return;if(director){try{onSession(await newDesignApi.prepareCreationDirector(saved.id,{expectedRevision:saved.revision,idempotencyKey:crypto.randomUUID()}));}catch{onSession(await newDesignApi.getBookCreationSession(saved.id));}return;}if(onRegenerate){await onRegenerate();return;}onSession({...saved,status:"generating",stage:"understand_source",progress:18});try{onSession(await newDesignApi.generateBookDirections(saved.id));}catch{onSession(await newDesignApi.getBookCreationSession(saved.id));}};

  return <section className="nd-book-review-form">
    <header className="nd-book-review-heading"><div><p className="nd-kicker">创建前审阅</p><h2>把开书资料调整到可以直接使用</h2><p>所有入口最终都在这里确认。左侧选择资料，右侧填写表单；不需要接触内部标识或原始数据。</p></div><span>{cards.length} 项资料</span></header>
    <div className="nd-book-review-basics">
      <label className={`nd-control${issues.bookName?" has-error":""}`}><span>书名 *</span><input disabled={blocked} value={bookName} aria-invalid={Boolean(issues.bookName)} onChange={event=>setBookName(event.target.value)}/>{issues.bookName&&<em>{issues.bookName}</em>}</label>
      <label className="nd-control"><span>作品说明</span><textarea disabled={blocked} rows={3} value={description} onChange={event=>setDescription(event.target.value)}/>{issues.description&&<em>{issues.description}</em>}</label>
    </div>
    <div className="nd-book-review-workspace">
      <aside className="nd-book-review-catalog">
        <div className="nd-book-review-add"><select aria-label="选择资料类型" value={newTypeKey} onChange={event=>setNewTypeKey(event.target.value)}>{session.reviewTypes.map(type=><option key={type.key} value={type.key}>{type.name}</option>)}</select><button className="nd-button nd-button-secondary" disabled={blocked||!newTypeKey} type="button" onClick={addCard}>＋ 添加</button></div>
        <nav aria-label="待审阅资料" role="tree">{grouped.map(group=><section key={group.type.key}><div className="nd-book-review-type"><span>{group.type.name}</span><b>{group.cards.length}</b></div>{group.cards.map(card=><button className={card.id===selectedId?"is-selected":""} key={card.id} type="button" role="treeitem" aria-current={card.id===selectedId?"page":undefined} onClick={()=>setSelectedId(card.id)}><span aria-hidden="true"/><div><strong>{card.title}</strong><small>{SOURCE_LABELS[card.sourceKind]}</small></div></button>)}</section>)}</nav>
        {!cards.length&&<div className="nd-empty nd-empty-compact">当前没有预填资料。你可以直接创建空白书籍，也可以先添加人物、世界观等资料。</div>}
      </aside>
      <main className="nd-book-review-editor">{selected&&selectedType?<>
        <div className="nd-book-review-editor-head"><div><span>{SOURCE_LABELS[selected.sourceKind]}</span><h3>{selectedType.name}</h3><p>{selectedType.description||"按表单填写这项创作资料。"}</p></div><button className="nd-button nd-button-danger" disabled={blocked} type="button" onClick={removeSelected}>移除这项</button></div>
        <label className={`nd-control${issues[selected.id]||issues[`${selected.id}.title`]?" has-error":""}`}><span>资料标题 *</span><input disabled={blocked} value={selected.title} onChange={event=>patchSelected({title:event.target.value})}/>{(issues[selected.id]||issues[`${selected.id}.title`])&&<em>{issues[selected.id]||issues[`${selected.id}.title`]}</em>}</label>
        <DynamicForm disabled={blocked} fields={selectedType.fields} values={selected.values} issues={Object.fromEntries(Object.entries(issues).filter(([key])=>key.startsWith(`${selected.id}.`)).map(([key,value])=>[key.slice(selected.id.length+1),value]))} onChange={values=>patchSelected({values})}/>
      </>:<div className="nd-empty"><strong>先从左侧选择一项资料</strong><span>也可以添加新的资料，再逐项填写。</span></div>}</main>
    </div>
    {(notice||message)&&<p role="status" aria-live="polite" className={`nd-message${Object.keys(issues).length||notice&&!notice.includes("已保存")||message?" is-error":""}`}>{notice||message}</p>}
    {director&&<DirectorControls session={session} disabled={blocked} saveDraft={save} onSession={onSession} onBusy={setDirectorWorking}/>}
    <footer className="nd-book-review-actions"><div><span>创建前可保存未填完的草稿，再继续补充。</span>{!director&&<button className="nd-text-button" disabled={blocked} type="button" onClick={()=>void continueAi()}>{session.selectedDirectionId?"继续让 AI 完善初稿":"让 AI 准备故事方向"}</button>}</div><div className="nd-row-actions"><button className="nd-button nd-button-secondary" disabled={blocked} type="button" onClick={()=>void save()}>{working?"正在保存…":"保存表单"}</button><button className="nd-button nd-button-primary" disabled={blocked||!bookName.trim()||!canConfirm} type="button" onClick={()=>void create()}>{blocked?"正在处理…":"确认开书"}</button></div></footer>
  </section>;
}

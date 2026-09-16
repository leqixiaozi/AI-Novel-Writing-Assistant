import {useState} from "react";
import type {BookCreationSession} from "../../common/contracts";
import {creationDirectorState,CREATION_DIRECTOR_STAGES,type CreationDirectorMode} from "../../common/creationDirector";
import {newDesignApi} from "../api";

const MODES:Record<CreationDirectorMode,string>={automatic:"一键 AI 准备",stepwise:"分步 AI 准备",manual:"手工填写"};
export default function DirectorControls({session,disabled,saveDraft,onSession,onBusy}:{session:BookCreationSession;disabled:boolean;saveDraft:()=>Promise<BookCreationSession|null>;onSession:(session:BookCreationSession)=>void;onBusy:(value:boolean)=>void}){
  const state=creationDirectorState(session.inputPayload),[working,setWorking]=useState(false),[message,setMessage]=useState("");
  if(!state)return null;const blocked=disabled||working;
  const act=async(operation:(saved:BookCreationSession)=>Promise<BookCreationSession>)=>{setWorking(true);onBusy(true);setMessage("");try{const saved=await saveDraft();if(saved)onSession(await operation(saved));}catch(error){setMessage(error instanceof Error?error.message:"开书阶段操作失败，草稿保留。");try{onSession(await newDesignApi.getBookCreationSession(session.id));}catch{/* Keep the visible saved draft if the service is unreachable. */}}finally{setWorking(false);onBusy(false);}};
  const change=(mode:CreationDirectorMode,cursor?:number)=>void act(saved=>newDesignApi.controlCreationDirector(saved.id,{expectedRevision:saved.revision,mode,...(cursor===undefined?{}:{cursor})}));
  const prepare=()=>void act(async saved=>{let active=true,reading=false;const timer=window.setInterval(()=>{if(reading)return;reading=true;void newDesignApi.getBookCreationSession(saved.id).then(current=>{if(active)onSession(current);}).catch(()=>undefined).finally(()=>{reading=false;});},1200);try{return await newDesignApi.prepareCreationDirector(saved.id,{expectedRevision:saved.revision,idempotencyKey:crypto.randomUUID()});}finally{active=false;window.clearInterval(timer);}});
  return <section className="nd-director-controls" aria-label="开书准备阶段">
    <label className="nd-control"><span>准备方式</span><select disabled={blocked} value={state.mode} onChange={event=>change(event.target.value as CreationDirectorMode)}>{Object.entries(MODES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
    {session.directionCandidates.length>0&&<label className="nd-control"><span>创作方向</span><select disabled={blocked} value={session.selectedDirectionId??""} onChange={event=>{const directionId=event.target.value;void act(saved=>newDesignApi.controlCreationDirector(saved.id,{expectedRevision:saved.revision,mode:state.mode,cursor:1,directionId}));}}>{session.directionCandidates.map(direction=><option key={direction.id} value={direction.id}>{direction.title}</option>)}</select><small>切换方向保留已填资料，后续阶段需要重新核对。</small><p>{session.directionCandidates.find(direction=>direction.id===session.selectedDirectionId)?.premise}</p></label>}
    <ol className="nd-director-stage-list">{[...CREATION_DIRECTOR_STAGES.map(stage=>stage.name),"统一审阅"].map((name,index)=><li key={name}><button className="nd-button nd-button-secondary" type="button" disabled={blocked||index>state.cursor} aria-current={index===state.cursor?"step":undefined} onClick={()=>change(state.mode,index)}>{index+1} · {name}</button></li>)}</ol>
    <p className="nd-help-text">{state.cursor===CREATION_DIRECTOR_STAGES.length?"准备内容仍可修改；检查后点击确认开书。":state.mode==="manual"?"按表单填写，也可以切换 AI 准备。":state.mode==="automatic"?"连续准备剩余阶段，到统一审阅停下，等待你确认开书。":"准备一个阶段后停下，修改表单再继续下一阶段；返回阶段会保留已填内容。"}</p>
    {state.skippedStages.length>0&&<p className="nd-help-text">模板未启用的资料阶段：{CREATION_DIRECTOR_STAGES.filter(stage=>state.skippedStages.includes(stage.key)).map(stage=>stage.name).join("、")}，这些阶段没有生成资料。</p>}
    {state.mode!=="manual"&&state.cursor<CREATION_DIRECTOR_STAGES.length&&<button className="nd-button nd-button-primary" disabled={blocked} type="button" onClick={prepare}>{working?"正在准备…":state.mode==="automatic"?"一键准备剩余阶段":`AI 准备${CREATION_DIRECTOR_STAGES[state.cursor].name}`}</button>}
    {message&&<p role="status" className="nd-message is-error">{message}</p>}
  </section>;
}

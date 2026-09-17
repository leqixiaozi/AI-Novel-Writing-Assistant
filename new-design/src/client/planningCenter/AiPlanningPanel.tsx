import {useEffect,useRef} from "react";
import type {PlanningCenterWorkspace,PlanningObject} from "../../common/contracts";
import "./planning-center.css";

export default function AiPlanningPanel({workspace,targets,targetId,instruction,busy,blocked,failure,onTarget,onInstruction,onCancel,onGenerate}:{
 workspace:PlanningCenterWorkspace;targets:PlanningObject[];targetId:string;instruction:string;busy:boolean;blocked:boolean;failure:string;
 onTarget(value:string):void;onInstruction(value:string):void;onCancel():void;onGenerate():void;
}){
 const target=targets.find(item=>item.id===targetId);
 const levels={story:"故事总览",volume:"卷",chapter:"章节",scene:"场景"};
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const element=dialog.current,opener=document.activeElement;
  if(element&&!element.open)element.showModal();
  return()=>{if(element?.open)element.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus({preventScroll:true});};
 },[]);
 return <dialog ref={dialog} className="nd-ai-planning-dialog" aria-labelledby="ai-planning-entry-title" aria-describedby="ai-planning-description" aria-busy={busy} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
  <header className="nd-section-heading"><div><p className="nd-kicker">当前规划的辅助工具</p><h2 id="ai-planning-entry-title">AI 辅助规划</h2></div><button type="button" className="nd-dialog-close" aria-label="关闭 AI 辅助，保留要求" disabled={busy} onClick={onCancel}>×</button></header>
  <p id="ai-planning-description">生成一个新候选，现有规划保留。确认采用前，不影响创作依据。</p>
  <div className="nd-ai-planning-form">
   {targets.length?<label>本次规划目标<select value={targetId} disabled={busy} onChange={event=>onTarget(event.target.value)}>{targets.map(item=><option value={item.id} key={item.id}>{levels[item.level]} · {item.title}</option>)}</select></label>:<p>本书尚无规划，这次将建立故事总览候选。</p>}
   {target&&<p>候选版本 {target.currentVersion.version} · {target.adoptedVersion?`采用版本 ${target.adoptedVersion.version}`:"尚未采用"}</p>}
   <label>希望补充或调整什么<textarea autoFocus rows={4} disabled={busy} value={instruction} onChange={event=>onInstruction(event.target.value)} placeholder="例如：补足主角选择的代价，加强这一章的危机。留空则根据本书资料提出建议。"/></label>
   {blocked&&<p role="status">请先保存当前人工填写并核对指定来源，再生成候选；未保存填写不会被覆盖。</p>}
   {!workspace.aiCapability.configured&&<p role="status">{workspace.aiCapability.message}</p>}
   {failure&&<p className="nd-inline-message" role="alert">{failure}</p>}
   {busy&&<p role="status">正在生成候选，请等待结果。现有规划不会被替换。</p>}
   <details><summary>AI 使用什么资料？</summary><p>{workspace.aiCapability.message} 生成后可在候选比较区载入修改，或明确采用；不会直接修改正文。</p></details>
   <div className="nd-ai-planning-actions"><button type="button" className="nd-button nd-button-secondary" disabled={busy} onClick={onCancel}>{blocked?"关闭并处理人工填写":"关闭，保留要求"}</button><button type="button" className="nd-button nd-button-primary" disabled={busy||blocked||!workspace.aiCapability.configured} onClick={onGenerate}>{busy?"正在生成…":"生成候选"}</button></div>
  </div>
 </dialog>;
}

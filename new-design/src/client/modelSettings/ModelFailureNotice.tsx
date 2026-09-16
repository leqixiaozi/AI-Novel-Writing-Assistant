import {useEffect,useState} from "react";
import type {AiRuntimeRecovery} from "../../common/aiRuntime";

export function ModelFailureNotice() {
  const [failure,setFailure]=useState<AiRuntimeRecovery|null>(null);
  useEffect(()=>{const receive=(event:Event)=>setFailure((event as CustomEvent<AiRuntimeRecovery>).detail);window.addEventListener("new-design:model-failure",receive);return()=>window.removeEventListener("new-design:model-failure",receive);},[]);
  if(!failure)return null;
  return <section className="nd-shell nd-model-failure-notice" role="alert"><h2>{failure.failedStep}失败</h2><p>{failure.summary}</p><p>{failure.savedResult}</p><div className="nd-action-row"><a className="nd-button nd-button-secondary" href={failure.sourceRoute} target="_blank" rel="noreferrer">{failure.actionLabel}</a><button className="nd-button nd-button-secondary" onClick={()=>setFailure(null)}>收起提示</button></div></section>;
}

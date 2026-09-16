import type {BookCreationSession} from "../../common/contracts";
import {creationDirectorState,CREATION_DIRECTOR_STAGES} from "../../common/creationDirector";

export default function CreationRecoveryPanel({session,busy,onRetry,onTakeOver}:{session:BookCreationSession;busy:boolean;onRetry:()=>Promise<void>;onTakeOver:()=>Promise<void>}){
  const state=creationDirectorState(session.inputPayload);if(!state)return null;
  const creating=session.lastFailedStage==="install_template",stage=creating?"确认开书":CREATION_DIRECTOR_STAGES[state.cursor]?.name??"统一审阅";
  const finished=CREATION_DIRECTOR_STAGES.filter(item=>state.completedStages.includes(item.key)&&!state.skippedStages.includes(item.key)).map(item=>item.name);
  return <section className="nd-failure-panel" aria-label="开书失败与恢复">
    <p className="nd-kicker">需要处理 · {stage}</p><h2>{stage}没有完成</h2>
    <p>{session.errorMessage||"当前步骤没有完成，已保存的内容保留。"}</p>
    <p>{finished.length?`已保存阶段：${finished.join("、")}。`:"已保存开书起点和当前表单草稿。"}失败步骤不会清掉其他内容。</p>
    <p>{creating?"在本页点击“回到审阅，重试确认开书”，检查表单后点击“确认开书”；无需重新生成资料。":`在本页点击“重试${stage}”；如果想自己调整，点击“人工接管并编辑”，保存表单后可切换 AI 准备继续。`}</p>
    {!creating&&<p className="nd-help-text">如果模型未连接，先使用顶部“模型设置”检查连接，再回到本页重试。</p>}
    <div className="nd-editor-actions"><button className="nd-button nd-button-secondary" disabled={busy} type="button" onClick={()=>void onTakeOver()}>{creating?"回到审阅，重试确认开书":"人工接管并编辑"}</button>{!creating&&state.mode!=="manual"&&<button className="nd-button nd-button-primary" disabled={busy} type="button" onClick={()=>void onRetry()}>重试{stage}</button>}</div>
  </section>;
}

import {useEffect,useLayoutEffect,useState} from "react";
import type {ChapterSettlementAiReceipt,ChapterSettlementAiStatus} from "../../../common/chapterSettlementAi";
import type {ChapterSettlementEditingWorkspace} from "../../../common/chapterSettlementEditing";
import type {ResourceBackfillScope} from '../../../common/characterResources';
import type {AiRuntimeRecovery} from "../../../common/aiRuntime";
import {ApiError,newDesignApi,safeRecoveryTarget} from "../../api";
import {readAiRecovery,writeAiRecovery} from "./recoveryStorage";

export default function SettlementAiPanel({workspace,disabled,onLockChange,onReadWorkspace,resourceScope}:{workspace:ChapterSettlementEditingWorkspace;resourceScope?:ResourceBackfillScope;disabled:boolean;onLockChange:(locked:boolean)=>void;onReadWorkspace:()=>Promise<void>}){
  const [stored]=useState(()=>readAiRecovery(workspace.session.id,workspace.session.bodyVersionId));
  const [releasePrompt,setReleasePrompt]=useState(false);
  const [endPrompt,setEndPrompt]=useState(false);
  const [mutationUnknown,setMutationUnknown]=useState(false);
  const [status,setStatus]=useState<ChapterSettlementAiStatus|null>(null),[receipt,setReceipt]=useState<ChapterSettlementAiReceipt|null>(null),[pendingKey,setPendingKey]=useState<string|null>(stored?.requestKey??null),[requestId,setRequestId]=useState<string|null>(stored?.requestId??null),[busy,setBusy]=useState(false),[failure,setFailure]=useState<{step:string;message:string;retained:string;recovery:AiRuntimeRecovery|null}|null>(null),[notice,setNotice]=useState("");
  const pending=busy||mutationUnknown||pendingKey!==null||receipt?.status==="running"||receipt?.canImportSavedResult===true;
  useLayoutEffect(()=>{onLockChange(pending);},[pending,onLockChange]);
  const report=(error:unknown,step:string,retained:string)=>{const recovery=error instanceof ApiError?error.recovery:null;setFailure({step:recovery?.failedStep??step,message:error instanceof Error?error.message:"请在本页核对原请求结果。",retained:recovery?.savedResult??retained,recovery});};
  const loadStatus=async()=>{try{setStatus(await newDesignApi.getChapterSettlementAiStatus(workspace.session.id));}catch(error){report(error,"检查 AI 整理能力","正文、人工草稿与已保存提案保留。");}};
  useEffect(()=>{let active=true;void newDesignApi.getChapterSettlementAiStatus(workspace.session.id).then(value=>{if(active)setStatus(value);}).catch(error=>{if(active)report(error,"检查 AI 整理能力","正文与人工确认清单保留。");});return()=>{active=false;};},[workspace.session.id]);
  const accept=async(value:ChapterSettlementAiReceipt)=>{
    setMutationUnknown(false);
    if(receipt?.id===value.id)value={...value,modelResultSaved:receipt.modelResultSaved||value.modelResultSaved,proposalsSaved:receipt.proposalsSaved||value.proposalsSaved,proposalCount:Math.max(receipt.proposalCount,value.proposalCount)};
    setReceipt(value);setRequestId(value.id);
    const retain=value.status==="running"||value.canImportSavedResult;
    if(!retain)setPendingKey(null);
    writeAiRecovery({version:1,sessionId:workspace.session.id,bodyVersionId:workspace.session.bodyVersionId,requestKey:retain?value.requestKey:null,requestId:retain?value.id:null});
    if(value.failure)setFailure({step:value.failure.failedStep,message:value.failure.summary,retained:value.failure.savedResult,recovery:value.failure});
    if(value.proposalsSaved){setNotice(`AI 提案已保存 ${value.proposalCount} 项，进入同一人工核对清单；不会自动确认或结算。`);try{await onReadWorkspace();}catch(error){report(error,"读取已保存 AI 提案","AI 结果与提案已保存，只读刷新失败不会再次调用模型。点击刷新确认清单继续。");}}
    else if(value.modelResultSaved)setNotice("AI 结果已保存，提案尚未全部入库。只导入这份已保存结果，不会重新调用模型。");
  };
  const start=async()=>{if(busy||disabled||pending||!status?.configured)return;const key=crypto.randomUUID(),input={expectedSessionRevision:workspace.session.revision,requestKey:key,catalogHash:workspace.catalog.specificationHash,...(resourceScope?{resourceScope}:{})};if(!writeAiRecovery({version:1,sessionId:workspace.session.id,bodyVersionId:workspace.session.bodyVersionId,requestKey:key,requestId:null})){report(new Error("浏览器无法保留恢复凭证，请检查网站存储权限后整理。"),"保留 AI 请求凭证","尚未提交模型请求，正文与人工草稿保留。");return;}setPendingKey(key);setRequestId(null);setReceipt(null);setBusy(true);setFailure(null);setNotice("");try{await accept(await newDesignApi.createChapterSettlementAiExtraction(workspace.session.id,input));}catch(error){report(error,"提交 AI 正文变化整理","原请求结果待核对，正文和手工填写保留。不会自动再次请求模型。");if(error instanceof ApiError&&error.recovery?.mutationOutcome==="not_written"){setPendingKey(null);writeAiRecovery({version:1,sessionId:workspace.session.id,bodyVersionId:workspace.session.bodyVersionId,requestKey:null,requestId:null});}}finally{setBusy(false);}};
  const check=async()=>{if(busy)return;setBusy(true);setFailure(null);try{const value=requestId?await newDesignApi.getChapterSettlementAiResult(requestId):pendingKey?await newDesignApi.getChapterSettlementAiByKey(workspace.session.id,pendingKey):null;if(value)await accept(value);else setNotice("尚未读取到原请求结果，不能断言未执行。保持原请求标识继续只读核对，不会重新提交模型请求。");}catch(error){report(error,"只读核对 AI 整理结果",receipt?.modelResultSaved?"此前读取的 AI 结果已保存，保持原结果不重新生成。":"原请求状态未知，仅核对不重新调用模型。");}finally{setBusy(false);}};
  const importSaved=async()=>{if(busy||mutationUnknown||!receipt?.canImportSavedResult)return;setBusy(true);setFailure(null);try{await accept(await newDesignApi.importChapterSettlementAiSavedResult(receipt.id));}catch(error){setMutationUnknown(!(error instanceof ApiError)||error.recovery?.mutationOutcome!=="not_written");report(error,"导入已保存 AI 结果","模型结果已保存，保持同一来源；先只读核对原结果，再继续导入，不会重新生成。");}finally{setBusy(false);}};
  const releaseSaved=async()=>{if(busy||mutationUnknown||!receipt?.canReleaseSavedResult)return;setBusy(true);setFailure(null);try{await accept(await newDesignApi.releaseChapterSettlementAiSavedResult(receipt.id));setReleasePrompt(false);setNotice("本次提取已结束，旧模型结果与实际用量保留。可手工补充，或核对最新正文资料后明确发起新一次整理。");}catch(error){setMutationUnknown(!(error instanceof ApiError)||error.recovery?.mutationOutcome!=="not_written");report(error,"结束本次提取","旧模型结果保留；结束回执待核对，仅只读核对，不会修改正式事实或再次生成。");}finally{setBusy(false);}};
  const endExpired=async()=>{if(busy||mutationUnknown||!receipt?.canEndExpiredUnknownRun)return;setBusy(true);setFailure(null);try{await accept(await newDesignApi.endExpiredChapterSettlementAiRun(receipt.id));setEndPrompt(false);setNotice("过期未知提取已结束，原请求与未知用量记录保留。可手工补充，或明确发起新的整理请求。");}catch(error){setMutationUnknown(!(error instanceof ApiError)||error.recovery?.mutationOutcome!=="not_written");report(error,"结束过期未知提取","原模型完成情况和用量仍未知；原记录保留，仅只读核对，不再次生成。");}finally{setBusy(false);}};
  return <section className="nd-settlement-ai-tools" aria-label="AI 整理正文变化"><p>{status?.message??"正在检查专属 AI 整理能力…"}</p>
    <button type="button" disabled={disabled||pending||!status?.configured} onClick={()=>void start()}>AI 整理正文变化</button><button type="button" disabled={busy} onClick={()=>void loadStatus()}>检查 AI 配置</button>
    {status?.recovery&&safeRecoveryTarget(status.recovery)&&<a href={status.recovery.sourceRoute}>{status.recovery.actionLabel}</a>}
    {notice&&<p role="status">{notice}</p>}{receipt&&<p role="status">{receipt.status==="running"?"原请求执行中":receipt.status==="succeeded"?"整理完成":receipt.status==="released"?"提取已结束，原结果保留":receipt.status==="ended_unknown"?"过期未知提取已结束":"整理需要处理"} · {receipt.modelResultSaved?"模型结果已保存":"模型结果待核对"} · {receipt.proposalsSaved?`${receipt.proposalCount} 项提案已保存`:receipt.status==="released"?"旧结果未导入确认清单":receipt.status==="ended_unknown"?"模型完成情况和用量仍未知":"提案入库待完成"}</p>}
    {(pendingKey||requestId)&&<button type="button" disabled={busy} onClick={()=>void check()}>只读核对原 AI 请求</button>}
    {mutationUnknown&&<p role="alert">导入或结束回执未知，请点击只读核对原 AI 请求，核对前不会继续修改。</p>}
    {receipt?.canImportSavedResult&&<button type="button" disabled={busy||mutationUnknown} onClick={()=>void importSaved()}>{receipt.proposalsSaved&&receipt.ledgerPending?"完成运行回执（不重新生成）":"导入已保存结果（不重新生成）"}</button>}
    {receipt?.canReleaseSavedResult&&<button type="button" disabled={busy||mutationUnknown} onClick={()=>setReleasePrompt(true)}>保留旧结果并结束本次提取</button>}
    {receipt?.canEndExpiredUnknownRun&&<button type="button" disabled={busy||mutationUnknown} onClick={()=>setEndPrompt(true)}>结束过期未知提取</button>}
    {endPrompt&&<div className="nd-settlement-draft-notice"><p>原模型调用是否完成、用量仍未知。确认只结束已过期的旧领取？原记录保留，不再次调用模型，不修改正文或正式状态。</p><button type="button" disabled={busy} onClick={()=>setEndPrompt(false)}>继续只读核对</button><button type="button" disabled={busy||mutationUnknown||!receipt?.canEndExpiredUnknownRun} onClick={()=>void endExpired()}>确认结束过期未知提取</button></div>}
    {releasePrompt&&<div className="nd-settlement-draft-notice"><p>确认结束这次提取？旧模型结果与用量保留，不再导入这份旧结果，也不会修改正式事实或重新生成。</p><button type="button" disabled={busy} onClick={()=>setReleasePrompt(false)}>继续核对原结果</button><button type="button" disabled={busy||mutationUnknown||!receipt?.canReleaseSavedResult} onClick={()=>void releaseSaved()}>确认保留旧结果并结束</button></div>}
    {receipt?.proposalsSaved&&<button type="button" disabled={busy} onClick={()=>void onReadWorkspace().catch(error=>report(error,"读取已保存确认清单","AI 结果与提案已保存。"))}>刷新确认清单</button>}
    {receipt?.notes.length?<ul>{receipt.notes.map((note,index)=><li key={index}>{note}</li>)}</ul>:null}
    {failure&&<div className="nd-settlement-error" role="alert"><strong>未完成步骤：{failure.step}</strong><p>{failure.message}</p><p>保留结果：{failure.retained}</p>{failure.recovery&&safeRecoveryTarget(failure.recovery)&&<a href={failure.recovery.sourceRoute}>{failure.recovery.actionLabel}</a>}</div>}
  </section>;
}

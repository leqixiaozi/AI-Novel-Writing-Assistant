import { useEffect,useState } from "react";
import type {IndependentModelStatus} from "../../common/aiRuntime";
import {ApiError,newDesignApi} from "../api";
import StructureShell from "../StructureShell";
import "./models.css";
export {ModelFailureNotice} from "./ModelFailureNotice";

export default function ModelSettingsPage() {
  const [status,setStatus]=useState<IndependentModelStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [failedStep,setFailedStep]=useState("");
  const [message,setMessage]=useState("");
  const report=(reason:unknown,step:string)=>{setFailedStep(reason instanceof ApiError?reason.recovery?.failedStep??step:step);setError(reason instanceof Error?reason.message:"未收到有效回执，请检查服务连接。");};
  const read=async()=>{setBusy(true);setError("");setMessage("");try{setStatus(await newDesignApi.getIndependentModelStatus());}catch(reason){report(reason,"读取模型配置");}finally{setBusy(false);}};
  useEffect(()=>{void read();},[]);
  const probe=async()=>{setBusy(true);setError("");setMessage("");try{await newDesignApi.probeIndependentModel();setMessage("模型连接与名称核对通过。创作结果是否符合表单规格，还需在具体创作任务中核对。");}catch(reason){report(reason,"检查模型连接");}finally{setBusy(false);}};
  return <StructureShell title="模型设置" description="检查创作模型连接；模型不可用时保留已有资料，从创作来源页重新发起任务。">
    <section className="nd-section">
      <h2>创作模型</h2>
      {status&&<><dl><dt>模型服务</dt><dd>{status.provider==="ollama"?"Ollama":"兼容 OpenAI 接口"}</dd><dt>创作模型</dt><dd>{status.model||"尚未指定"}</dd><dt>连接地址</dt><dd>{status.endpoint||"请按配置说明检查"}</dd><dt>凭据</dt><dd>{status.hasCredential?"已配置（不显示内容）":"未配置"}</dd><dt>等待时间</dt><dd>{status.timeoutMs/1000} 秒</dd></dl>{status.recovery&&<div className="nd-message is-error" role="alert"><h3>{status.recovery.failedStep}未完成</h3><p>{status.recovery.summary}</p><p>展开下方“开发环境配置说明”，配置后重启服务，再点击“重新读取配置”。已有资料无需重新创建。</p></div>}</>}
      {error&&<div className="nd-message is-error" role="alert"><h3>{failedStep}未完成</h3><p>{error}</p><p>已有资料保留。检查配置或模型服务后，点击“重新读取配置”或“检查连接与模型”。重启服务不会自动重跑创作任务，请返回对应创作页核对状态后重试。</p></div>}
      {message&&<p role="status">{message}</p>}
      <div className="nd-action-row"><button className="nd-button nd-button-secondary" disabled={busy} onClick={()=>void read()}>重新读取配置</button><button className="nd-button nd-button-primary" disabled={busy||!status?.configured} onClick={()=>void probe()}>检查连接与模型</button><a className="nd-button nd-button-secondary" href="/new-design/structure/maintenance" target="_blank" rel="noreferrer">打开运行维护</a></div>
      <details><summary>开发环境配置说明</summary><p>当前入口读取新设计服务进程的专用配置。此处只检查配置，不保存密钥、不修改创作数据。停止服务，在新设计目录的终端设置以下环境变量后执行 npm run dev。</p><pre>{`NEW_DESIGN_AI_PROVIDER=ollama 或 openai-compatible\nNEW_DESIGN_AI_BASE_URL=服务地址（兼容接口需含 /v1）\nNEW_DESIGN_AI_MODEL=模型服务返回的完整模型名称\nNEW_DESIGN_AI_API_KEY=仅在终端配置，不加入 Git\nNEW_DESIGN_AI_TIMEOUT_MS=120000\nNEW_DESIGN_AI_MAX_TOKENS=8192`}</pre><p>PowerShell 使用 $env:变量名='值' 设置环境变量。远程地址必须为 HTTPS；Ollama 默认本机 11434 端口。不要把凭据写进提示词、资料或数据备份。</p></details>
    </section>
    <section className="nd-section"><h2>可用创作任务</h2><ul>{status?.tasks.map(task=><li key={task.taskType}>{task.label} · {task.version}</li>)}</ul><p>连接通过不代表生成成功；生成后仍需核对表单内容，采用操作在对应创作页面完成。</p></section>
  </StructureShell>;
}

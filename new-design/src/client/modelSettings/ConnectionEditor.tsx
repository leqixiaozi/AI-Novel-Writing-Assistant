import { useEffect, useState } from "react";
import type { ManagedModelConnection, ModelRouteCenterCatalog } from "../../common/modelRouting";
import { ApiError, newDesignApi } from "../api";

export function ConnectionEditor({ value, onChange, catalog, disabled, onBusy }: {value: ManagedModelConnection; onChange(value: ManagedModelConnection): void; catalog: ModelRouteCenterCatalog; disabled: boolean; onBusy(value: boolean): void}) {
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [failedStep, setFailedStep] = useState("连接检查");
  const [savedResult, setSavedResult] = useState("当前设置保留；本操作不会保存设置或重新生成资料。");
  const fingerprint = JSON.stringify(value);
  useEffect(() => { setModels([]); setMessage(""); setError(""); }, [fingerprint]);
  const probe = async () => {
    setChecking(true); onBusy(true); setError(""); setMessage("");
    try {
      const result = await newDesignApi.probeManagedModelConnection({ ...value });
      setModels(result.models);
      setMessage(result.available ? result.modelFound ? "连接通过，所填模型可用；创作内容仍需在来源页核对。" : "连接通过，请从返回列表明确选择创作模型。" : "连接未通过，请核对连接地址和服务状态。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "未收到连接检查回执。"); setFailedStep(reason instanceof ApiError ? reason.recovery?.failedStep ?? "连接检查" : "连接检查"); setSavedResult(reason instanceof ApiError ? reason.recovery?.savedResult ?? "当前设置保留；本操作不会保存设置或重新生成资料。" : "当前设置保留；本操作不会保存设置或重新生成资料。"); }
    finally { setChecking(false); onBusy(false); }
  };
  return <fieldset className="nd-model-connection" disabled={disabled || checking}><div className="nd-model-form-grid"><label className="nd-control">模型服务<select value={value.provider} onChange={event => onChange({ ...value, provider: event.target.value as ManagedModelConnection["provider"], credentialId: null })}><option value="ollama">本机 Ollama</option><option value="openai-compatible">兼容 OpenAI 接口</option></select></label><label className="nd-control">连接地址<input type="url" value={value.endpoint} placeholder={value.provider === "ollama" ? "http://127.0.0.1:11434" : "https://服务地址/v1"} onChange={event => onChange({ ...value, endpoint: event.target.value })}/></label><label className="nd-control">创作模型<input value={value.model} placeholder="填写服务返回的完整模型名称" onChange={event => onChange({ ...value, model: event.target.value })}/></label><label className="nd-control">凭据引用<select value={value.credentialId ?? ""} onChange={event => onChange({ ...value, credentialId: event.target.value || null })}><option value="">无需凭据／尚未选择</option>{catalog.credentials.filter(item => item.provider === value.provider || item.id === value.credentialId).map(item => <option key={item.id} value={item.id} disabled={item.status !== "active"}>{item.label}{!item.available ? "（环境变量不可用）" : ""}</option>)}</select></label></div><button className="nd-button nd-button-secondary" type="button" disabled={!value.endpoint} onClick={() => void probe()}>{checking ? "检查中…" : "检查连接与模型列表"}</button>{error && <div role="alert" className="nd-message is-error"><h4>{failedStep}失败</h4><p>{error}</p><p>{savedResult}</p><p>检查服务、凭据或模型名称后，点击“检查连接与模型列表”重试。</p></div>}{message && <p role="status">{message}</p>}{models.length > 0 && <label className="nd-control">返回的可用模型<select value="" onChange={event => { if (event.target.value) onChange({ ...value, model: event.target.value }); }}><option value="">请选择需要的模型，不会自动选择</option>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></label>}</fieldset>;
}
